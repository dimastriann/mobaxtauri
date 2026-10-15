use std::io::Write;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use bytes::Bytes;
use russh::client::{AuthResult, Handler, Msg, Session};
use russh::keys::ssh_key::PublicKey;
use russh::Channel;

/// Headless SSH stress harness for the terminal-output backend drills.
///
/// Mirrors the app's russh configuration (keepalive 15s / max 3) so
/// server-side behavior under heavy output matches production. Drills:
/// relogin (repeated auth attempts), tail, cat, less, htop.
///
/// Credentials are read from a file (host[:port] on line 1, user on line 2,
/// password on line 3); nothing is ever logged. Host keys are accepted
/// unconditionally — this harness is not the security boundary, the app's
/// known-hosts store is.
#[derive(Clone)]
struct SharedCounters {
    bytes: Arc<AtomicU64>,
    closed: Arc<AtomicU64>,
}

impl Default for SharedCounters {
    fn default() -> Self {
        Self {
            bytes: Arc::new(AtomicU64::new(0)),
            closed: Arc::new(AtomicU64::new(0)),
        }
    }
}

struct StressHandler {
    shared: SharedCounters,
}

impl Handler for StressHandler {
    type Error = russh::Error;

    async fn check_server_key(&mut self, _key: &PublicKey) -> Result<bool, Self::Error> {
        Ok(true)
    }

    async fn data(
        &mut self,
        _channel: russh::ChannelId,
        data: &[u8],
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.shared
            .bytes
            .fetch_add(data.len() as u64, Ordering::Relaxed);
        Ok(())
    }

    async fn extended_data(
        &mut self,
        _channel: russh::ChannelId,
        ext: u32,
        data: &[u8],
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        if ext == 1 {
            self.shared
                .bytes
                .fetch_add(data.len() as u64, Ordering::Relaxed);
        }
        Ok(())
    }

    async fn channel_close(
        &mut self,
        _channel: russh::ChannelId,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.shared.closed.store(1, Ordering::Relaxed);
        Ok(())
    }
}

struct Vm {
    host: String,
    port: u16,
    user: String,
    password: String,
}

fn config() -> Arc<russh::client::Config> {
    Arc::new(russh::client::Config {
        keepalive_interval: Some(Duration::from_secs(15)),
        keepalive_max: 3,
        ..Default::default()
    })
}

type ShellConnection = (
    russh::client::Handle<StressHandler>,
    Channel<Msg>,
    SharedCounters,
);

async fn send(
    handle: &russh::client::Handle<StressHandler>,
    channel_id: russh::ChannelId,
    text: &[u8],
) {
    if let Err(e) = handle.data(channel_id, Bytes::from(text.to_vec())).await {
        println!("  send failed: {} bytes unacked", e.len());
    }
}

async fn connect_shell(vm: &Vm) -> Result<ShellConnection, String> {
    let shared = SharedCounters::default();
    let handler = StressHandler {
        shared: shared.clone(),
    };
    let mut handle = russh::client::connect(config(), (vm.host.as_str(), vm.port), handler)
        .await
        .map_err(|e| format!("connect: {e}"))?;

    let auth = handle
        .authenticate_password(vm.user.clone(), vm.password.clone())
        .await
        .map_err(|e| format!("auth: {e}"))?;
    if !matches!(auth, AuthResult::Success) {
        return Err(format!("auth rejected: {auth:?}"));
    }

    let channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("channel: {e}"))?;
    channel
        .request_pty(true, "xterm-256color", 120, 40, 0, 0, &[])
        .await
        .map_err(|e| format!("pty: {e}"))?;
    channel
        .request_shell(true)
        .await
        .map_err(|e| format!("shell: {e}"))?;
    Ok((handle, channel, shared))
}

async fn disconnect(handle: &mut russh::client::Handle<StressHandler>) {
    let _ = handle
        .disconnect(russh::Disconnect::ByApplication, "", "english")
        .await;
}

/// Uploads a local file over SFTP in 64KB chunks (same size class as the
/// app's transfer loop) so the drills have data on the remote side.
async fn upload(vm: &Vm, local_path: &str, remote_path: &str) -> Result<(), String> {
    let shared = SharedCounters::default();
    let handler = StressHandler {
        shared: shared.clone(),
    };
    let mut handle = russh::client::connect(config(), (vm.host.as_str(), vm.port), handler)
        .await
        .map_err(|e| format!("connect: {e}"))?;
    let auth = handle
        .authenticate_password(vm.user.clone(), vm.password.clone())
        .await
        .map_err(|e| format!("auth: {e}"))?;
    if !matches!(auth, AuthResult::Success) {
        return Err("auth rejected".into());
    }
    let sftp_channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("channel: {e}"))?;
    sftp_channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|e| format!("subsystem: {e}"))?;
    let sftp = russh_sftp::client::SftpSession::new(sftp_channel.into_stream())
        .await
        .map_err(|e| format!("sftp init: {e}"))?;

    let data = std::fs::read(local_path).map_err(|e| format!("local read: {e}"))?;
    let mut remote = sftp
        .create(remote_path)
        .await
        .map_err(|e| format!("remote create: {e}"))?;
    let chunk_size = 64 * 1024;
    let started = Instant::now();
    for chunk in data.chunks(chunk_size) {
        tokio::io::AsyncWriteExt::write_all(&mut remote, chunk)
            .await
            .map_err(|e| format!("write: {e}"))?;
    }
    remote.sync_all().await.map_err(|e| format!("sync: {e}"))?;
    sftp.close().await.map_err(|e| format!("sftp close: {e}"))?;
    println!(
        "STRESS upload: {} MB in {:.1}s",
        data.len() / 1024 / 1024,
        started.elapsed().as_secs_f32()
    );
    disconnect(&mut handle).await;
    Ok(())
}

/// Read channel messages for `live` seconds, reporting totals and whether
/// the remote closed the channel/shell in the middle of the burst.
async fn observe_for(channel: &mut Channel<Msg>, shared: &SharedCounters, live: Duration) {
    let started = Instant::now();
    loop {
        match tokio::time::timeout(live - started.elapsed(), channel.wait()).await {
            Ok(Some(russh::ChannelMsg::Data { .. }))
            | Ok(Some(russh::ChannelMsg::ExtendedData { .. }))
            | Ok(Some(_)) => {}
            Ok(None) => {
                println!(
                    "  channel closed after {:.1}s",
                    started.elapsed().as_secs_f32()
                );
                break;
            }
            Err(_) => break, // observation window ended
        }
    }
    println!(
        "  bytes_seen={} remote_closed={}",
        shared.bytes.load(Ordering::Relaxed),
        shared.closed.load(Ordering::Relaxed)
    );
}

async fn run_drill(vm: &Vm, name: &str, command: &str, observe: Duration, post: Option<&str>) {
    println!("STRESS {name}:");
    let Ok((mut handle, mut channel, counters)) = connect_shell(vm).await else {
        println!("  setup failed");
        return;
    };
    let channel_id = channel.id();
    let started = Instant::now();
    send(&handle, channel_id, format!("{command}\n").as_bytes()).await;
    if let Some(followup) = post {
        tokio::time::sleep(Duration::from_secs(2)).await;
        send(&handle, channel_id, followup.as_bytes()).await;
    }
    observe_for(&mut channel, &counters, observe).await;
    println!("  wall={:.1}s", started.elapsed().as_secs_f32());
    disconnect(&mut handle).await;
}

async fn run_vm_command(vm: &Vm, command: &str, idle: Duration) -> Result<Vec<u8>, String> {
    let (mut handle, mut channel, _) = connect_shell(vm).await?;
    let channel_id = channel.id();
    send(&handle, channel_id, format!("{command}\n").as_bytes()).await;
    let mut out = Vec::new();
    let deadline = Instant::now() + idle;
    loop {
        match tokio::time::timeout(idle / 20, channel.wait()).await {
            Ok(Some(russh::ChannelMsg::Data { data, .. }))
            | Ok(Some(russh::ChannelMsg::ExtendedData { data, .. })) => {
                out.extend_from_slice(&data);
                if out.len() > 128 * 1024 {
                    break;
                }
            }
            Ok(Some(_)) => {}
            Ok(None) => break,
            Err(_) if Instant::now() < deadline => continue,
            Err(_) => break,
        }
    }
    disconnect(&mut handle).await;
    Ok(out)
}

fn load_vm(path: &str) -> Result<Vm, String> {
    let lines: Vec<String> = std::fs::read_to_string(path)
        .map_err(|e| format!("read: {e}"))?
        .lines()
        .map(|l| l.trim().to_string())
        .collect();
    if lines.len() < 3 {
        return Err("cred file needs host[:port], user, password lines".into());
    }
    let (host, port) = match lines[0].rsplit_once(':') {
        Some((host, port)) => (
            host.trim().to_string(),
            port.trim()
                .parse::<u16>()
                .map_err(|e| format!("port: {e}"))?,
        ),
        None => (lines[0].clone(), 22),
    };
    Ok(Vm {
        host,
        port,
        user: lines[1].clone(),
        password: lines[2].clone(),
    })
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 {
        eprintln!(
            "usage: ssh_stress <cred-file> <local-log-file> <log-path-on-vm> [relogin-attempts] | ssh_stress <cred-file> run <command>"
        );
        std::process::exit(2);
    }
    let vm = match load_vm(&args[1]) {
        Ok(vm) => vm,
        Err(e) => {
            eprintln!("failed to load credentials: {e}");
            std::process::exit(2);
        }
    };
    let local_log = args.get(2).cloned().unwrap_or_default();
    let log_path = args
        .get(3)
        .cloned()
        .unwrap_or_else(|| "/tmp/odoo-api.log".to_string());
    let relogin_attempts: usize = args.get(4).and_then(|c| c.parse().ok()).unwrap_or(3);

    // Round 0: one-shot command passthrough for diagnostics.
    if args.len() >= 3 && args[2] == "run" {
        let command = args[3].clone();
        match run_vm_command(&vm, &command, Duration::from_secs(15)).await {
            Ok(out) => {
                if let Err(e) = std::io::stdout().write_all(&out) {
                    eprintln!("stdout failed: {e}");
                }
            }
            Err(e) => eprintln!("run failed: {e}"),
        }
        return;
    }

    if let Err(e) = upload(&vm, &local_log, &log_path).await {
        eprintln!("upload failed: {e}");
        std::process::exit(1);
    }

    // Round 1: repeated login attempts (the reported re-login failure).
    for attempt in 1..=relogin_attempts {
        match connect_shell(&vm).await {
            Ok((mut handle, channel, _)) => {
                let start = Instant::now();
                let channel_id = channel.id();
                send(&handle, channel_id, b"echo stress-ok\n").await;
                tokio::time::sleep(Duration::from_millis(300)).await;
                println!(
                    "STRESS relogin {attempt}: ok in {:.1}s",
                    start.elapsed().as_secs_f32()
                );
                drop(channel);
                disconnect(&mut handle).await;
            }
            Err(e) => println!("STRESS relogin {attempt}: FAILED {e}"),
        }
        tokio::time::sleep(Duration::from_millis(300)).await;
    }

    // Round 2: heavy-output drills against the uploaded log.
    run_drill(
        &vm,
        "tail-100000",
        &format!("wc -l {log_path}; tail -n 100000 {log_path}"),
        Duration::from_secs(30),
        None,
    )
    .await;
    run_drill(
        &vm,
        "cat-whole",
        &format!("cat {log_path}; echo __STRESS_DONE__"),
        Duration::from_secs(30),
        None,
    )
    .await;
    run_drill(
        &vm,
        "less",
        &format!("less {log_path}"),
        Duration::from_secs(6),
        Some("q"),
    )
    .await;
    run_drill(&vm, "htop", "htop", Duration::from_secs(4), Some("q")).await;
}
