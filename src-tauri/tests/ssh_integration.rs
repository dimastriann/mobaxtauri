//! In-process SSH integration tests: the app's real client handler and
//! transfer flows run against a real russh server whose SFTP subsystem is
//! backed by a temp directory. The committed fixture keys serve as both the
//! server host key and the authorized client key; nothing here touches the
//! network beyond loopback.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use mobaxtauri_lib::known_hosts::KnownHostsService;
use mobaxtauri_lib::ssh::{authenticate_with_agent, ClientHandler, SshSession};
use russh::keys::agent::client::AgentClient;
use russh::keys::ssh_key::{self, HashAlg, PrivateKey};
use russh::server::{
    Auth, ChannelOpenHandle, Handler as ServerHandler, Server as _, Session as ServerSession,
};
use russh::ChannelId;
use russh_sftp::protocol::{
    Attrs, Data, File, FileAttributes, Handle, Name, OpenFlags, Status, StatusCode,
};
use russh_sftp::server::{Handler as SftpHandler, StatusReply};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::mpsc;

const USER: &str = "testuser";
const PASSWORD: &str = "hunter2-test-password";
const SHELL_BANNER: &str = "test-shell-ready\n";
const REMOTE_PROBE: &[u8] = b"remote-probe";
const TEST_TIMEOUT: Duration = Duration::from_secs(20);

fn fixture_path(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("src")
        .join("test_fixtures")
        .join(name)
}

fn load_fixture_key(name: &str) -> PrivateKey {
    let data = std::fs::read_to_string(fixture_path(name)).expect("fixture key must be readable");
    PrivateKey::from_openssh(&data).expect("fixture key must parse")
}

fn fingerprint_of(key: &ssh_key::PublicKey) -> String {
    key.fingerprint(HashAlg::Sha256).to_string()
}

fn fixture_fingerprint(name: &str) -> String {
    fingerprint_of(load_fixture_key(name).public_key())
}

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("moba-ssh-it-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("create temp root");
    dir
}

/// Server-side configuration shared by every client handler.
struct ServerConfig {
    password: String,
    /// Fingerprint accepted for public key auth; a bogus value rejects
    /// every key.
    authorized_fingerprint: String,
    sftp_root: PathBuf,
    /// Bytes echoed back through a remote-forward channel opened by
    /// `tcpip_forward`; the test waits for this to prove the tunnel works.
    remote_probe: Arc<tokio::sync::Mutex<Option<Vec<u8>>>>,
}

/// One connected client's handler: remembers the shell channel for the
/// echo behavior and hands `sftp` channels to russh-sftp.
struct ClientSessions {
    cfg: Arc<ServerConfig>,
    shell_channel: Option<ChannelId>,
    open_channels: HashMap<ChannelId, russh::Channel<russh::server::Msg>>,
}

impl ClientSessions {
    fn new(cfg: Arc<ServerConfig>) -> Self {
        Self {
            cfg,
            shell_channel: None,
            open_channels: HashMap::new(),
        }
    }
}

impl ServerHandler for ClientSessions {
    type Error = russh::Error;

    async fn auth_password(&mut self, _user: &str, password: &str) -> Result<Auth, Self::Error> {
        if password == self.cfg.password {
            Ok(Auth::Accept)
        } else {
            Ok(Auth::reject())
        }
    }

    async fn auth_publickey(
        &mut self,
        _user: &str,
        public_key: &ssh_key::PublicKey,
    ) -> Result<Auth, Self::Error> {
        if fingerprint_of(public_key) == self.cfg.authorized_fingerprint {
            Ok(Auth::Accept)
        } else {
            Ok(Auth::reject())
        }
    }

    async fn channel_open_session(
        &mut self,
        channel: russh::Channel<russh::server::Msg>,
        reply: ChannelOpenHandle,
        _session: &mut ServerSession,
    ) -> Result<(), Self::Error> {
        reply.accept().await;
        self.open_channels.insert(channel.id(), channel);
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    async fn pty_request(
        &mut self,
        channel: ChannelId,
        _term: &str,
        _col_width: u32,
        _row_height: u32,
        _pix_width: u32,
        _pix_height: u32,
        _modes: &[(russh::Pty, u32)],
        session: &mut ServerSession,
    ) -> Result<(), Self::Error> {
        let _ = session.channel_success(channel);
        Ok(())
    }

    async fn shell_request(
        &mut self,
        channel: ChannelId,
        session: &mut ServerSession,
    ) -> Result<(), Self::Error> {
        let _ = session.channel_success(channel);
        self.shell_channel = Some(channel);
        let _ = session.data(channel, SHELL_BANNER.as_bytes().to_vec());
        Ok(())
    }

    async fn exec_request(
        &mut self,
        channel: ChannelId,
        data: &[u8],
        session: &mut ServerSession,
    ) -> Result<(), Self::Error> {
        let _ = session.channel_success(channel);
        let mut echoed = b"exec: ".to_vec();
        echoed.extend_from_slice(data);
        echoed.push(b'\n');
        let _ = session.data(channel, echoed);
        Ok(())
    }

    async fn window_change_request(
        &mut self,
        _channel: ChannelId,
        _col_width: u32,
        _row_height: u32,
        _pix_width: u32,
        _pix_height: u32,
        _session: &mut ServerSession,
    ) -> Result<(), Self::Error> {
        Ok(())
    }

    async fn data(
        &mut self,
        channel: ChannelId,
        data: &[u8],
        session: &mut ServerSession,
    ) -> Result<(), Self::Error> {
        if self.shell_channel == Some(channel) {
            let _ = session.data(channel, data.to_vec());
        }
        Ok(())
    }

    async fn subsystem_request(
        &mut self,
        channel: ChannelId,
        name: &str,
        session: &mut ServerSession,
    ) -> Result<(), Self::Error> {
        if name != "sftp" {
            let _ = session.channel_failure(channel);
            return Ok(());
        }
        let _ = session.channel_success(channel);
        let channel = self
            .open_channels
            .remove(&channel)
            .expect("sftp channel was opened");
        // `run` is an async wrapper that spawns the protocol loop; the
        // wrapper itself must be awaited for the spawn to happen.
        russh_sftp::server::run(
            channel.into_stream(),
            SftpTestHandler::new(self.cfg.sftp_root.clone()),
        )
        .await;
        Ok(())
    }

    async fn tcpip_forward(
        &mut self,
        address: &str,
        port: &mut u32,
        session: &mut ServerSession,
    ) -> Result<bool, Self::Error> {
        // Stand-in for an inbound connection: once the client requests a
        // remote listen, open one forwarded channel back and push the probe
        // payload through it. The echo arrives in `data()` below.
        let requested = *port;
        let assigned = if requested == 0 { 22022 } else { requested };
        if requested == 0 {
            // Let the client register the mapping for the server-chosen port.
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        // The async handle variant registers the channel for confirmation;
        // push the probe through it and capture the echo.
        let server_handle = session.handle();
        let probe = self.cfg.remote_probe.clone();
        let connected_address = address.to_string();
        tokio::spawn(async move {
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            match server_handle
                .channel_open_forwarded_tcpip(
                    connected_address,
                    assigned,
                    "127.0.0.1".to_string(),
                    12345,
                )
                .await
            {
                Ok(channel) => {
                    let mut stream = channel.into_stream();
                    if stream.write_all(REMOTE_PROBE).await.is_err() {
                        return;
                    }
                    let mut echoed = vec![0_u8; REMOTE_PROBE.len()];
                    if stream.read_exact(&mut echoed).await.is_ok() {
                        *probe.lock().await = Some(echoed);
                    }
                }
                Err(error) => println!("[server] forwarded-tcpip open failed: {error}"),
            }
        });
        *port = assigned;
        Ok(true)
    }

    async fn cancel_tcpip_forward(
        &mut self,
        _address: &str,
        _port: u32,
        _session: &mut ServerSession,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }

    #[allow(clippy::too_many_arguments)]
    async fn channel_open_direct_tcpip(
        &mut self,
        channel: russh::Channel<russh::server::Msg>,
        host_to_connect: &str,
        port_to_connect: u32,
        _originator_address: &str,
        _originator_port: u32,
        reply: ChannelOpenHandle,
        _session: &mut ServerSession,
    ) -> Result<(), Self::Error> {
        reply.accept().await;
        let target = format!("{host_to_connect}:{port_to_connect}");
        let mut stream = channel.into_stream();
        // The test server behaves like `sshd`: dial the requested target and
        // pump bytes both ways through the channel.
        tokio::spawn(async move {
            match tokio::net::TcpStream::connect(&target).await {
                Ok(mut socket) => {
                    let _ = tokio::io::copy_bidirectional(&mut socket, &mut stream).await;
                }
                Err(error) => println!("[server] direct-tcpip target {target} failed: {error}"),
            }
        });
        Ok(())
    }
}

struct TestServerActor {
    cfg: Arc<ServerConfig>,
}

impl russh::server::Server for TestServerActor {
    type Handler = ClientSessions;

    fn new_client(&mut self, _peer: Option<std::net::SocketAddr>) -> Self::Handler {
        ClientSessions::new(self.cfg.clone())
    }
}

/// SFTP subsystem backed by a real temp directory. Client-visible paths
/// are absolute and mapped under the root like a chroot.
struct SftpTestHandler {
    root: PathBuf,
    next_handle: u32,
    files: HashMap<String, std::fs::File>,
    directories: HashMap<String, Vec<File>>,
}

impl SftpTestHandler {
    fn new(root: PathBuf) -> Self {
        Self {
            root,
            next_handle: 0,
            files: HashMap::new(),
            directories: HashMap::new(),
        }
    }

    fn local(&self, path: &str) -> PathBuf {
        self.root.join(path.trim_start_matches('/'))
    }

    fn next_handle(&mut self) -> String {
        self.next_handle += 1;
        format!("h{}", self.next_handle)
    }

    fn ok(&self, id: u32) -> Status {
        Status {
            id,
            status_code: StatusCode::Ok,
            error_message: "Ok".to_string(),
            language_tag: "en-US".to_string(),
        }
    }

    fn attrs(&self, path: &Path) -> Result<FileAttributes, StatusCode> {
        let metadata = std::fs::metadata(path).map_err(|error| match error.kind() {
            std::io::ErrorKind::NotFound => StatusCode::NoSuchFile,
            _ => StatusCode::Failure,
        })?;
        Ok(FileAttributes::from(&metadata))
    }
}

impl SftpHandler for SftpTestHandler {
    type Error = StatusReply;

    fn unimplemented(&self) -> Self::Error {
        StatusReply::new(StatusCode::OpUnsupported)
    }

    async fn open(
        &mut self,
        id: u32,
        filename: String,
        pflags: OpenFlags,
        _attrs: FileAttributes,
    ) -> Result<Handle, Self::Error> {
        let local = self.local(&filename);
        if pflags.intersects(OpenFlags::WRITE | OpenFlags::CREATE) {
            if let Some(parent) = local.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
        }
        let file = std::fs::OpenOptions::from(pflags)
            .open(&local)
            .map_err(|_| StatusReply::new(StatusCode::Failure))?;
        let handle = self.next_handle();
        self.files.insert(handle.clone(), file);
        Ok(Handle { id, handle })
    }

    async fn read(
        &mut self,
        id: u32,
        handle: String,
        offset: u64,
        len: u32,
    ) -> Result<Data, Self::Error> {
        use std::io::{Read, Seek, SeekFrom};
        let file = self
            .files
            .get_mut(&handle)
            .ok_or_else(|| StatusReply::new(StatusCode::Failure))?;
        file.seek(SeekFrom::Start(offset))
            .map_err(|_| StatusReply::new(StatusCode::Failure))?;
        let mut buffer = vec![0_u8; len as usize];
        let count = file
            .read(&mut buffer)
            .map_err(|_| StatusReply::new(StatusCode::Failure))?;
        if count == 0 {
            return Err(StatusReply::new(StatusCode::Eof));
        }
        buffer.truncate(count);
        Ok(Data { id, data: buffer })
    }

    async fn write(
        &mut self,
        id: u32,
        handle: String,
        offset: u64,
        data: Vec<u8>,
    ) -> Result<Status, Self::Error> {
        use std::io::{Seek, SeekFrom, Write};
        let file = self
            .files
            .get_mut(&handle)
            .ok_or_else(|| StatusReply::new(StatusCode::Failure))?;
        file.seek(SeekFrom::Start(offset))
            .map_err(|_| StatusReply::new(StatusCode::Failure))?;
        file.write_all(&data)
            .map_err(|_| StatusReply::new(StatusCode::Failure))?;
        Ok(self.ok(id))
    }

    async fn close(&mut self, id: u32, handle: String) -> Result<Status, Self::Error> {
        self.files.remove(&handle);
        self.directories.remove(&handle);
        Ok(self.ok(id))
    }

    async fn opendir(&mut self, id: u32, path: String) -> Result<Handle, Self::Error> {
        let local = self.local(&path);
        let mut files = Vec::new();
        let entries =
            std::fs::read_dir(&local).map_err(|_| StatusReply::new(StatusCode::NoSuchFile))?;
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let attrs = FileAttributes::from(&entry.metadata().expect("entry metadata"));
            files.push(File::new(name, attrs));
        }
        files.sort_by(|a, b| a.filename.cmp(&b.filename));
        let handle = self.next_handle();
        self.directories.insert(handle.clone(), files);
        Ok(Handle { id, handle })
    }

    async fn readdir(&mut self, id: u32, handle: String) -> Result<Name, Self::Error> {
        let files = self
            .directories
            .get_mut(&handle)
            .ok_or_else(|| StatusReply::new(StatusCode::Failure))?;
        if files.is_empty() {
            return Err(StatusReply::new(StatusCode::Eof));
        }
        Ok(Name {
            id,
            files: std::mem::take(files),
        })
    }

    async fn lstat(&mut self, id: u32, path: String) -> Result<Attrs, Self::Error> {
        let attrs = self.attrs(&self.local(&path)).map_err(StatusReply::new)?;
        Ok(Attrs { id, attrs })
    }

    async fn stat(&mut self, id: u32, path: String) -> Result<Attrs, Self::Error> {
        let attrs = self.attrs(&self.local(&path)).map_err(StatusReply::new)?;
        Ok(Attrs { id, attrs })
    }

    async fn realpath(&mut self, id: u32, path: String) -> Result<Name, Self::Error> {
        Ok(Name {
            id,
            files: vec![File::dummy(path)],
        })
    }

    async fn mkdir(
        &mut self,
        id: u32,
        path: String,
        _attrs: FileAttributes,
    ) -> Result<Status, Self::Error> {
        std::fs::create_dir(self.local(&path))
            .map_err(|_| StatusReply::new(StatusCode::Failure))?;
        Ok(self.ok(id))
    }

    async fn rmdir(&mut self, id: u32, path: String) -> Result<Status, Self::Error> {
        std::fs::remove_dir(self.local(&path))
            .map_err(|_| StatusReply::new(StatusCode::Failure))?;
        Ok(self.ok(id))
    }

    async fn remove(&mut self, id: u32, filename: String) -> Result<Status, Self::Error> {
        std::fs::remove_file(self.local(&filename))
            .map_err(|_| StatusReply::new(StatusCode::Failure))?;
        Ok(self.ok(id))
    }

    async fn rename(
        &mut self,
        id: u32,
        oldpath: String,
        newpath: String,
    ) -> Result<Status, Self::Error> {
        let old_local = self.local(&oldpath);
        let new_local = self.local(&newpath);
        // POSIX rename semantics: an existing target is replaced.
        let _ = std::fs::remove_file(&new_local);
        std::fs::rename(&old_local, &new_local)
            .map_err(|_| StatusReply::new(StatusCode::Failure))?;
        Ok(self.ok(id))
    }
}

/// Everything a test needs: mock Tauri runtime, known-hosts store, and a
/// running server with its SFTP root.
struct TestContext {
    handle: tauri::AppHandle<tauri::test::MockRuntime>,
    known_hosts: Arc<KnownHostsService>,
    port: u16,
    sftp_root: PathBuf,
    remote_targets: mobaxtauri_lib::ssh::RemoteForwardTargets,
    remote_probe: Arc<tokio::sync::Mutex<Option<Vec<u8>>>>,
}

/// How the test server treats the client's public key.
enum AuthorizedKey {
    /// The plain fixture key.
    Plain,
    /// The encrypted fixture key, which decrypts to its own keypair.
    Encrypted,
    /// No key matches: public key auth always rejects.
    None,
}

/// How the known-hosts store is pre-seeded with the server's host key.
enum HostTrust {
    /// Fresh store: the host key is unknown.
    Unknown,
    /// Pre-trusted with the real fingerprint.
    Trusted,
    /// Pre-trusted with a bogus fingerprint (mismatch scenario).
    Mismatch,
}

impl TestContext {
    /// Starts the server and prepares the store per the given scenarios.
    async fn start(name: &str, trust: HostTrust, authorized: AuthorizedKey) -> Self {
        let app = tauri::test::mock_app();
        let handle = app.handle().clone();
        let sftp_root = temp_dir(name);
        let authorized_fingerprint = match authorized {
            AuthorizedKey::Plain => fixture_fingerprint("plain_test_key"),
            AuthorizedKey::Encrypted => fixture_fingerprint("encrypted_test_key"),
            AuthorizedKey::None => "SHA256:bogus-no-key-authorized".to_string(),
        };
        let remote_probe = Arc::new(tokio::sync::Mutex::new(None));
        let cfg = Arc::new(ServerConfig {
            password: PASSWORD.to_string(),
            authorized_fingerprint,
            sftp_root: sftp_root.clone(),
            remote_probe: remote_probe.clone(),
        });
        let host_fingerprint = fixture_fingerprint("plain_test_key");

        let config = Arc::new(russh::server::Config {
            auth_rejection_time: Duration::from_millis(10),
            keys: vec![load_fixture_key("plain_test_key")],
            ..Default::default()
        });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind loopback listener");
        let port = listener.local_addr().expect("local addr").port();
        let server = TestServerActor { cfg };
        tokio::spawn(async move {
            let mut server = server;
            let running = server.run_on_socket(config, &listener);
            running.await.expect("server accept loop");
        });

        let known_hosts = Arc::new(KnownHostsService::with_path(
            temp_dir(&format!("{name}-known-hosts")).join("store.json"),
        ));
        match trust {
            HostTrust::Unknown => {}
            HostTrust::Trusted | HostTrust::Mismatch => {
                let fingerprint = match trust {
                    HostTrust::Trusted => host_fingerprint.clone(),
                    HostTrust::Mismatch => "SHA256:bogus-mismatch".to_string(),
                    HostTrust::Unknown => unreachable!("matched above"),
                };
                known_hosts
                    .trust(
                        &handle,
                        "127.0.0.1",
                        port,
                        "ssh-ed25519".to_string(),
                        fingerprint,
                    )
                    .await
                    .expect("pre-trusting the host key must succeed");
            }
        }

        Self {
            handle,
            known_hosts,
            port,
            sftp_root,
            remote_targets: Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new())),
            remote_probe,
        }
    }

    fn trusted_known_hosts(&self) -> Arc<KnownHostsService> {
        self.known_hosts.clone()
    }

    /// Connects through the app's real connect flow (host key check,
    /// auth, shell channel, SFTP subsystem) and returns the SFTP session.
    async fn connect_with(
        &self,
        password: Option<&str>,
        private_key_path: Option<&str>,
        key_passphrase: Option<&str>,
        known_hosts: Arc<KnownHostsService>,
    ) -> Result<russh_sftp::client::SftpSession, Box<dyn std::error::Error>> {
        let (_handle, _channel_id, _channel, sftp) = SshSession::connect(
            self.handle.clone(),
            format!(
                "it-{}",
                std::time::SystemTime::now().elapsed().unwrap().as_nanos()
            ),
            "127.0.0.1".to_string(),
            self.port,
            USER.to_string(),
            password.map(str::to_string),
            private_key_path.map(|p| fixture_path(p).to_string_lossy().to_string()),
            key_passphrase.map(str::to_string),
            false,
            known_hosts,
            self.remote_targets.clone(),
        )
        .await?;
        Ok(sftp)
    }

    /// Password-authenticated session with the trusted host key, ready
    /// for SFTP round-trip tests.
    async fn connected_sftp(&self) -> russh_sftp::client::SftpSession {
        tokio::time::timeout(
            TEST_TIMEOUT,
            self.connect_with(Some(PASSWORD), None, None, self.trusted_known_hosts()),
        )
        .await
        .expect("connect within timeout")
        .expect("trusted password session connects")
    }

    /// Password-authenticated session returning the SSH handle (needed by
    /// forwarding) alongside the SFTP session.
    #[allow(clippy::type_complexity)]
    async fn connected_session(
        &self,
    ) -> (
        Arc<russh::client::Handle<ClientHandler<tauri::test::MockRuntime>>>,
        russh_sftp::client::SftpSession,
    ) {
        let (handle, _channel_id, _channel, sftp) = tokio::time::timeout(
            TEST_TIMEOUT,
            SshSession::connect(
                self.handle.clone(),
                format!("it-fwd-{}", self.port),
                "127.0.0.1".to_string(),
                self.port,
                USER.to_string(),
                Some(PASSWORD.to_string()),
                None,
                None,
                false,
                self.trusted_known_hosts(),
                self.remote_targets.clone(),
            ),
        )
        .await
        .expect("connect within timeout")
        .expect("trusted password session connects");
        (Arc::new(handle), sftp)
    }
}

/// Collects echoed shell bytes until the expected payload is complete.
async fn collect_until(rx: &mut mpsc::UnboundedReceiver<Vec<u8>>, expected: &[u8]) -> Vec<u8> {
    let mut collected: Vec<u8> = Vec::new();
    let deadline = tokio::time::Instant::now() + TEST_TIMEOUT;
    while collected.len() < expected.len() {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            panic!("timed out collecting shell echo");
        }
        let chunk = tokio::time::timeout(remaining, rx.recv())
            .await
            .expect("shell echo timed out")
            .expect("shell channel closed");
        collected.extend_from_slice(&chunk);
    }
    collected
}

#[tokio::test]
async fn password_auth_connects_and_shell_echoes_over_the_wire() {
    let ctx = TestContext::start("shell-echo", HostTrust::Trusted, AuthorizedKey::None).await;
    let (terminal_output, mut echo_rx) = mpsc::unbounded_channel();
    let shell_channel_id = Arc::new(OnceLock::new());
    let handler = ClientHandler {
        app_handle: ctx.handle.clone(),
        session_id: "it-shell".to_string(),
        host: "127.0.0.1".to_string(),
        port: ctx.port,
        shell_channel_id: shell_channel_id.clone(),
        known_hosts: ctx.trusted_known_hosts(),
        terminal_output,
        remote_forwards: Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new())),
    };
    let mut session = russh::client::connect(
        Arc::new(russh::client::Config::default()),
        ("127.0.0.1", ctx.port),
        handler,
    )
    .await
    .expect("client connects");
    let result = session
        .authenticate_password(USER, PASSWORD)
        .await
        .expect("auth round trip");
    assert!(
        matches!(result, russh::client::AuthResult::Success),
        "password must authenticate"
    );

    let channel = session.channel_open_session().await.expect("open channel");
    shell_channel_id
        .set(channel.id())
        .expect("fresh channel id");
    channel
        .request_pty(true, "xterm-256color", 80, 24, 0, 0, &[])
        .await
        .expect("pty request");
    channel.request_shell(true).await.expect("shell request");

    // A multi-byte character split across two SSH packets must survive
    // the client handler unchanged.
    channel.data(&b"ping"[..]).await.expect("send ping");
    channel.data(&[0xC3][..]).await.expect("send first half");
    channel.data(&[0xA9][..]).await.expect("send second half");

    let expected = format!("{SHELL_BANNER}ping\u{e9}").into_bytes();
    let collected = collect_until(&mut echo_rx, &expected).await;
    assert_eq!(collected, expected, "echo must be byte-exact");
}

#[tokio::test]
async fn wrong_password_is_rejected_with_an_actionable_message() {
    let ctx = TestContext::start("bad-password", HostTrust::Trusted, AuthorizedKey::None).await;
    let error = match ctx
        .connect_with(
            Some("definitely-wrong"),
            None,
            None,
            ctx.trusted_known_hosts(),
        )
        .await
    {
        Err(error) => error,
        Ok(_) => panic!("wrong password must fail"),
    };
    let message = error.to_string();
    assert!(
        message.contains("Password authentication was rejected"),
        "unexpected message: {message}"
    );
}

#[tokio::test]
async fn plain_key_auth_connects_and_lists_the_sftp_root() {
    let ctx = TestContext::start("pubkey", HostTrust::Trusted, AuthorizedKey::Plain).await;
    std::fs::write(ctx.sftp_root.join("hello.txt"), b"hello").expect("seed file");

    let sftp = tokio::time::timeout(
        TEST_TIMEOUT,
        ctx.connect_with(
            None,
            Some("plain_test_key"),
            None,
            ctx.trusted_known_hosts(),
        ),
    )
    .await
    .expect("connect within timeout")
    .expect("plain key must authenticate");

    let entries = sftp.read_dir("/").await.expect("list root");
    let names: Vec<String> = entries.into_iter().map(|entry| entry.file_name()).collect();
    assert_eq!(names, vec!["hello.txt".to_string()]);
}

#[tokio::test]
async fn unauthorized_key_is_rejected_with_an_actionable_message() {
    let ctx = TestContext::start("bad-pubkey", HostTrust::Trusted, AuthorizedKey::Encrypted).await;
    let error = match ctx
        .connect_with(
            None,
            Some("plain_test_key"),
            None,
            ctx.trusted_known_hosts(),
        )
        .await
    {
        Err(error) => error,
        Ok(_) => panic!("unauthorized key must fail"),
    };
    let message = error.to_string();
    assert!(
        message.contains("Public key authentication was rejected"),
        "unexpected message: {message}"
    );
}

#[tokio::test]
async fn encrypted_key_with_passphrase_authenticates() {
    // The encrypted fixture is the same ed25519 key as plain_test_key, so
    // the server accepts it once the passphrase unlocks the signature.
    let ctx = TestContext::start(
        "encrypted-key",
        HostTrust::Trusted,
        AuthorizedKey::Encrypted,
    )
    .await;
    let sftp = ctx
        .connect_with(
            None,
            Some("encrypted_test_key"),
            Some("mobaxtauri-test-passphrase"),
            ctx.trusted_known_hosts(),
        )
        .await
        .expect("encrypted key must authenticate");
    sftp.read_dir("/").await.expect("sftp session is live");
}

#[tokio::test]
async fn unknown_host_key_is_refused() {
    let ctx = TestContext::start("unknown-host", HostTrust::Unknown, AuthorizedKey::None).await;
    let result = ctx
        .connect_with(Some(PASSWORD), None, None, ctx.trusted_known_hosts())
        .await;
    assert!(result.is_err(), "unknown host key must be refused");
}

#[tokio::test]
async fn trusted_host_key_connects() {
    let ctx = TestContext::start("trusted-host", HostTrust::Trusted, AuthorizedKey::None).await;
    let sftp = ctx
        .connect_with(Some(PASSWORD), None, None, ctx.trusted_known_hosts())
        .await
        .expect("trusted host key must connect");
    sftp.read_dir("/").await.expect("sftp session is live");
}

#[tokio::test]
async fn mismatched_host_key_is_refused() {
    let ctx = TestContext::start("mismatched-host", HostTrust::Mismatch, AuthorizedKey::None).await;
    let result = ctx
        .connect_with(Some(PASSWORD), None, None, ctx.trusted_known_hosts())
        .await;
    assert!(result.is_err(), "mismatched host key must be refused");
}

/// An in-process SSH agent holding the fixture key, reachable through a
/// duplex channel — no OS agent service involved. Encrypted fixtures are
/// decrypted first, like a user would with their agent.
async fn spawn_agent_with_key(
    fixture: &str,
    passphrase: Option<&str>,
) -> AgentClient<tokio::io::DuplexStream> {
    let key = load_fixture_key(fixture);
    let key = match passphrase {
        Some(passphrase) => key.decrypt(passphrase).expect("fixture key must decrypt"),
        None => key,
    };
    let (client_side, agent_side) = tokio::io::duplex(64 * 1024);
    tokio::spawn(russh::keys::agent::server::serve(
        futures::stream::iter(vec![Ok(agent_side)]),
        (),
    ));
    let mut agent = AgentClient::connect(client_side);
    agent
        .add_identity(&key, &[])
        .await
        .expect("fixture key must load into the in-process agent");
    agent
}

/// Opens an unauthenticated client session against the test server.
async fn connect_unauthenticated(
    ctx: &TestContext,
    session_id: &str,
) -> russh::client::Handle<ClientHandler<tauri::test::MockRuntime>> {
    let handler = ClientHandler {
        app_handle: ctx.handle.clone(),
        session_id: session_id.to_string(),
        host: "127.0.0.1".to_string(),
        port: ctx.port,
        shell_channel_id: Arc::new(OnceLock::new()),
        known_hosts: ctx.trusted_known_hosts(),
        terminal_output: mpsc::unbounded_channel().0,
        remote_forwards: Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new())),
    };
    russh::client::connect(
        Arc::new(russh::client::Config::default()),
        ("127.0.0.1", ctx.port),
        handler,
    )
    .await
    .expect("client connects")
}

#[tokio::test]
async fn agent_auth_authenticates_with_the_loaded_key() {
    let ctx = TestContext::start("agent-auth", HostTrust::Trusted, AuthorizedKey::Plain).await;
    let mut agent = spawn_agent_with_key("plain_test_key", None).await;
    let mut session = connect_unauthenticated(&ctx, "it-agent-auth").await;

    let authenticated = authenticate_with_agent(&mut session, USER, &mut agent).await;
    assert!(
        authenticated,
        "the agent's authorized key must authenticate"
    );
}

#[tokio::test]
async fn agent_auth_rejects_unauthorized_keys() {
    // The server only authorizes the plain fixture; the agent holds the
    // independent encrypted-fixture key, so every identity is rejected.
    let ctx = TestContext::start("agent-reject", HostTrust::Trusted, AuthorizedKey::Plain).await;
    let mut agent =
        spawn_agent_with_key("encrypted_test_key", Some("mobaxtauri-test-passphrase")).await;
    let mut session = connect_unauthenticated(&ctx, "it-agent-reject").await;

    let authenticated = authenticate_with_agent(&mut session, USER, &mut agent).await;
    assert!(!authenticated, "unauthorized agent keys must be rejected");
}

#[tokio::test]
async fn agent_list_keys_reports_loaded_identities() {
    let mut agent = spawn_agent_with_key("plain_test_key", None).await;
    let identities = agent
        .request_identities()
        .await
        .expect("list agent identities");
    assert_eq!(identities.len(), 1);
    let key = identities[0].public_key();
    assert_eq!(
        key.fingerprint(HashAlg::Sha256).to_string(),
        fixture_fingerprint("plain_test_key"),
        "the agent must report the loaded fixture key"
    );
}

#[tokio::test]
async fn single_file_round_trip_is_byte_exact_including_chunking() {
    let ctx = TestContext::start("file-roundtrip", HostTrust::Trusted, AuthorizedKey::None).await;
    let sftp = ctx.connected_sftp().await;
    let transfers = mobaxtauri_lib::transfers::TransferManager::default();

    // Large enough to span several 64 KiB upload chunks; pseudo-random so
    // a lost or duplicated chunk cannot pass byte comparison by accident.
    let payload: Vec<u8> = (0..256 * 1024_usize).map(|i| (i % 251) as u8).collect();
    let local = ctx
        .sftp_root
        .parent()
        .expect("temp parent")
        .join("file-roundtrip-src.bin");
    std::fs::write(&local, &payload).expect("write local source");

    mobaxtauri_lib::sftp_transfer::upload_file(
        &ctx.handle,
        &sftp,
        &transfers,
        "it-session".to_string(),
        local.to_string_lossy().to_string(),
        "/files/big.bin".to_string(),
        "it-upload".to_string(),
        None,
    )
    .await
    .expect("upload succeeds");

    let uploaded = std::fs::read(ctx.sftp_root.join("files").join("big.bin"))
        .expect("uploaded file exists on the server");
    assert_eq!(uploaded, payload, "upload must be byte-exact across chunks");

    let download_target = ctx
        .sftp_root
        .parent()
        .expect("temp parent")
        .join("file-roundtrip-dst.bin");
    mobaxtauri_lib::sftp_transfer::download_file(
        &ctx.handle,
        &sftp,
        &transfers,
        "it-session".to_string(),
        "/files/big.bin".to_string(),
        download_target.to_string_lossy().to_string(),
        "it-download".to_string(),
    )
    .await
    .expect("download succeeds");

    let downloaded = std::fs::read(&download_target).expect("downloaded file exists");
    assert_eq!(downloaded, payload, "round trip must be byte-exact");
}

#[tokio::test]
async fn folder_upload_creates_the_whole_tree_including_empty_dirs() {
    let ctx = TestContext::start("folder-upload", HostTrust::Trusted, AuthorizedKey::None).await;
    let sftp = ctx.connected_sftp().await;
    let transfers = mobaxtauri_lib::transfers::TransferManager::default();

    let source = temp_dir("folder-upload-src");
    std::fs::create_dir_all(source.join("nested").join("deeper")).expect("create nested dirs");
    std::fs::create_dir_all(source.join("empty")).expect("create empty dir");
    std::fs::write(source.join("top.txt"), b"top-level").expect("write top file");
    std::fs::write(source.join("nested").join("mid.txt"), b"mid-level").expect("write mid file");
    std::fs::write(
        source.join("nested").join("deeper").join("leaf.txt"),
        b"leaf payload",
    )
    .expect("write leaf file");

    mobaxtauri_lib::sftp_transfer::upload_folder(
        &ctx.handle,
        &sftp,
        &transfers,
        "it-session".to_string(),
        source.to_string_lossy().to_string(),
        "/upload".to_string(),
        "it-folder-upload".to_string(),
        None,
    )
    .await
    .expect("folder upload succeeds");

    let root = ctx.sftp_root.join("upload");
    assert_eq!(
        std::fs::read(root.join("top.txt")).expect("top file"),
        b"top-level"
    );
    assert_eq!(
        std::fs::read(root.join("nested").join("mid.txt")).expect("mid file"),
        b"mid-level"
    );
    assert_eq!(
        std::fs::read(root.join("nested").join("deeper").join("leaf.txt")).expect("leaf file"),
        b"leaf payload"
    );
    let empty = root.join("empty");
    assert!(empty.is_dir(), "empty directories must be created remotely");
}

#[tokio::test]
async fn folder_download_preserves_the_remote_tree() {
    let ctx = TestContext::start("folder-download", HostTrust::Trusted, AuthorizedKey::None).await;
    let sftp = ctx.connected_sftp().await;
    let transfers = mobaxtauri_lib::transfers::TransferManager::default();

    // Seed the remote side of the chroot: files, nesting, and an empty dir.
    let remote = ctx.sftp_root.join("seeded");
    std::fs::create_dir_all(remote.join("sub").join("empty-inside")).expect("seed nested dirs");
    std::fs::create_dir_all(remote.join("void")).expect("seed empty dir");
    std::fs::write(remote.join("a.txt"), b"alpha").expect("seed a.txt");
    std::fs::write(remote.join("sub").join("b.bin"), b"\x00\x01\x02\xfe\xff").expect("seed b.bin");

    let target = temp_dir("folder-download-dst").join("out");
    mobaxtauri_lib::sftp_transfer::download_folder(
        &ctx.handle,
        &sftp,
        &transfers,
        "it-session".to_string(),
        "/seeded".to_string(),
        target.to_string_lossy().to_string(),
        "it-folder-download".to_string(),
        None,
    )
    .await
    .expect("folder download succeeds");

    assert_eq!(
        std::fs::read(target.join("a.txt")).expect("a.txt"),
        b"alpha"
    );
    assert_eq!(
        std::fs::read(target.join("sub").join("b.bin")).expect("b.bin"),
        b"\x00\x01\x02\xfe\xff"
    );
    assert!(
        target.join("void").is_dir(),
        "empty remote dirs must appear locally"
    );
    assert!(
        target.join("sub").join("empty-inside").is_dir(),
        "nested dirs must be preserved"
    );
}

#[tokio::test]
async fn folder_upload_conflict_policy_renames_the_target() {
    let ctx = TestContext::start("folder-conflict", HostTrust::Trusted, AuthorizedKey::None).await;
    let sftp = ctx.connected_sftp().await;
    let transfers = mobaxtauri_lib::transfers::TransferManager::default();

    std::fs::create_dir_all(ctx.sftp_root.join("existing")).expect("seed existing remote folder");

    let source = temp_dir("folder-conflict-src");
    std::fs::write(source.join("data.txt"), b"new-contents").expect("write source file");

    mobaxtauri_lib::sftp_transfer::upload_folder(
        &ctx.handle,
        &sftp,
        &transfers,
        "it-session".to_string(),
        source.to_string_lossy().to_string(),
        "/existing".to_string(),
        "it-conflict-upload".to_string(),
        Some("rename".to_string()),
    )
    .await
    .expect("conflict resolution with rename succeeds");

    let renamed = ctx.sftp_root.join("existing (2)");
    assert!(
        renamed.is_dir(),
        "rename policy must upload under a suffixed target"
    );
    assert_eq!(
        std::fs::read(renamed.join("data.txt")).expect("suffixed file"),
        b"new-contents"
    );
    assert!(
        ctx.sftp_root.join("existing").is_dir(),
        "the original remote folder must stay untouched"
    );
}

/// Loopback echo service: every accepted connection is echoed back.
async fn spawn_echo_server() -> (u16, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind echo listener");
    let port = listener.local_addr().expect("echo local addr").port();
    let task = tokio::spawn(async move {
        loop {
            let Ok((mut socket, _peer)) = listener.accept().await else {
                break;
            };
            tokio::spawn(async move {
                let mut buffer = [0_u8; 4096];
                loop {
                    match socket.read(&mut buffer).await {
                        Ok(0) | Err(_) => break,
                        Ok(count) => {
                            if socket.write_all(&buffer[..count]).await.is_err() {
                                break;
                            }
                        }
                    }
                }
            });
        }
    });
    (port, task)
}

async fn echo_round_trip(port: u16, payload: &[u8]) -> Vec<u8> {
    let mut client = tokio::net::TcpStream::connect(("127.0.0.1", port))
        .await
        .expect("connect to the forward");
    client.write_all(payload).await.expect("write payload");
    let mut received = vec![0_u8; payload.len()];
    tokio::time::timeout(TEST_TIMEOUT, client.read_exact(&mut received))
        .await
        .expect("echo within timeout")
        .expect("echo read");
    received
}

#[tokio::test]
async fn local_forward_tunnels_tcp_through_the_session() {
    let ctx = TestContext::start("forward-local", HostTrust::Trusted, AuthorizedKey::None).await;
    let (handle, _sftp) = ctx.connected_session().await;
    let (echo_port, _echo) = spawn_echo_server().await;
    let forwards = mobaxtauri_lib::port_forward::ForwardManager::default();

    let forward = forwards
        .add_local(
            handle,
            "it-forward-local".to_string(),
            "127.0.0.1".to_string(),
            0,
            "127.0.0.1".to_string(),
            echo_port,
        )
        .await
        .expect("local forward starts");
    assert_eq!(
        forward.kind,
        mobaxtauri_lib::port_forward::ForwardKind::Local
    );
    assert!(forward.bind_port > 0, "an ephemeral port must be assigned");

    let received = echo_round_trip(forward.bind_port, b"ping-through-the-tunnel").await;
    assert_eq!(received, b"ping-through-the-tunnel");

    let listed = forwards.list().await;
    assert_eq!(listed.len(), 1, "the forward must be listed");

    assert!(forwards.remove(&forward.id).await, "forward removal");
    // Give the aborted accept loop a moment to drop the listener.
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(
        tokio::net::TcpStream::connect(("127.0.0.1", forward.bind_port))
            .await
            .is_err(),
        "the local port must be released after removal"
    );
}

#[tokio::test]
async fn dynamic_forward_proxies_socks5_connect_through_the_session() {
    let ctx = TestContext::start("forward-dynamic", HostTrust::Trusted, AuthorizedKey::None).await;
    let (handle, _sftp) = ctx.connected_session().await;
    let (echo_port, _echo) = spawn_echo_server().await;
    let forwards = mobaxtauri_lib::port_forward::ForwardManager::default();

    let forward = forwards
        .add_dynamic(
            handle,
            "it-forward-dynamic".to_string(),
            "127.0.0.1".to_string(),
            0,
        )
        .await
        .expect("dynamic forward starts");

    // Minimal SOCKS5 client: no-auth greeting, CONNECT to the echo service.
    let mut client = tokio::net::TcpStream::connect(("127.0.0.1", forward.bind_port))
        .await
        .expect("connect to the socks5 forward");
    client
        .write_all(&[0x05, 0x01, 0x00])
        .await
        .expect("socks5 greeting");
    let mut greeting_reply = [0_u8; 2];
    client
        .read_exact(&mut greeting_reply)
        .await
        .expect("socks5 greeting reply");
    assert_eq!(greeting_reply, [0x05, 0x00], "no-auth method accepted");

    let mut request = vec![0x05, 0x01, 0x00, 0x03, 9];
    request.extend_from_slice(b"127.0.0.1");
    request.extend_from_slice(&echo_port.to_be_bytes());
    client.write_all(&request).await.expect("socks5 connect");
    let mut reply = [0_u8; 10];
    client
        .read_exact(&mut reply)
        .await
        .expect("socks5 connect reply");
    assert_eq!(reply[0], 0x05, "socks5 version in reply");
    assert_eq!(reply[1], 0x00, "socks5 connect must succeed");

    client
        .write_all(b"socks-payload")
        .await
        .expect("write payload");
    let mut echoed = [0_u8; 13];
    tokio::time::timeout(TEST_TIMEOUT, client.read_exact(&mut echoed))
        .await
        .expect("echo within timeout")
        .expect("echo read");
    assert_eq!(&echoed, b"socks-payload");

    assert!(forwards.remove(&forward.id).await, "forward removal");
}

#[tokio::test]
async fn remote_forward_tunnels_server_connections_to_a_local_target() {
    let ctx = TestContext::start("forward-remote", HostTrust::Trusted, AuthorizedKey::None).await;
    let (handle, _sftp) = ctx.connected_session().await;
    let (echo_port, _echo) = spawn_echo_server().await;
    let forwards = mobaxtauri_lib::port_forward::ForwardManager::default();

    let forward = forwards
        .add_remote(
            ctx.remote_targets.clone(),
            handle,
            "it-forward-remote".to_string(),
            "127.0.0.1".to_string(),
            22022,
            "127.0.0.1".to_string(),
            echo_port,
        )
        .await
        .expect("remote forward starts");
    assert_eq!(
        forward.kind,
        mobaxtauri_lib::port_forward::ForwardKind::Remote
    );
    assert_eq!(forward.bind_port, 22022);

    // The harness opens a forwarded channel as soon as the forward is
    // accepted and pushes the probe payload through the tunnel.
    let echoed = tokio::time::timeout(TEST_TIMEOUT, async {
        loop {
            if let Some(bytes) = ctx.remote_probe.lock().await.clone() {
                break bytes;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("remote forward probe within timeout");
    assert_eq!(
        echoed, REMOTE_PROBE,
        "probe must reach the local echo target through the tunnel"
    );

    assert!(forwards.remove(&forward.id).await, "forward removal");
}
