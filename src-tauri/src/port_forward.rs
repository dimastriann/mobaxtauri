//! SSH TCP forwarding: local and dynamic (SOCKS5) forwards.
//!
//! Both kinds bind a local TCP listener. Local forwards map every accepted
//! connection to a fixed `direct-tcpip` channel target; dynamic forwards
//! speak a minimal SOCKS5 handshake and map each CONNECT request to its
//! target. The listeners live in [`ForwardManager`] and are torn down when
//! the forward is removed or its session disconnects.

use crate::ssh::{ClientHandler, RemoteForwardTargets};
use russh::client::Handle;
use std::collections::HashMap;
use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::Runtime;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

/// How a forward is exposed.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ForwardKind {
    /// Local listener → fixed remote target.
    Local,
    /// Local SOCKS5 proxy → target chosen per connection.
    Dynamic,
    /// Server-side listener → fixed local target.
    Remote,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortForward {
    pub id: String,
    pub session_id: String,
    pub kind: ForwardKind,
    pub bind_host: String,
    pub bind_port: u16,
    pub target_host: String,
    pub target_port: u16,
}

struct ActiveForward {
    info: PortForward,
    task: JoinHandle<()>,
    /// Remote forwards stop by asking the server to cancel the listen
    /// request; local/dynamic forwards just abort their accept loop.
    cancel: Option<tokio::sync::mpsc::UnboundedSender<()>>,
}

/// Tauri-managed registry of running forwards.
#[derive(Default)]
pub struct ForwardManager {
    forwards: Mutex<HashMap<String, ActiveForward>>,
    /// Per-session remote-forward target maps, shared with the session's
    /// client handler so forwarded channels can find their local target.
    remote_targets: Mutex<HashMap<String, RemoteForwardTargets>>,
    next_id: AtomicU64,
}

impl ForwardManager {
    /// The target map for a session, created on first use and cleared on
    /// reconnect by the caller.
    pub async fn remote_targets(&self, session_id: &str) -> RemoteForwardTargets {
        let mut targets = self.remote_targets.lock().await;
        targets.entry(session_id.to_string()).or_default().clone()
    }

    /// Drops the target map for a disconnected session.
    pub async fn clear_remote_targets(&self, session_id: &str) {
        self.remote_targets.lock().await.remove(session_id);
    }

    fn new_id(&self) -> String {
        let seq = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        format!("fwd-{seq}")
    }

    /// Starts a local forward: accepted connections open a `direct-tcpip`
    /// channel to the fixed target and pump bytes both ways.
    pub async fn add_local<R: Runtime>(
        &self,
        handle: Arc<Handle<ClientHandler<R>>>,
        session_id: String,
        bind_host: String,
        bind_port: u16,
        target_host: String,
        target_port: u16,
    ) -> Result<PortForward, String> {
        let listener = bind_listener(&bind_host, bind_port).await?;
        let info = PortForward {
            id: self.new_id(),
            session_id,
            kind: ForwardKind::Local,
            bind_host: listener
                .local_addr()
                .map(|addr| addr.ip().to_string())
                .unwrap_or(bind_host),
            bind_port: listener
                .local_addr()
                .map_err(|error| format!("Failed to read the bound address: {error}"))?
                .port(),
            target_host,
            target_port,
        };
        let task = tokio::spawn(accept_local_loop(listener, handle, info.clone()));
        self.forwards.lock().await.insert(
            info.id.clone(),
            ActiveForward {
                info: info.clone(),
                task,
                cancel: None,
            },
        );
        log::info!(
            "Local forward {}: {}:{} -> {}:{} (session {})",
            info.id,
            info.bind_host,
            info.bind_port,
            info.target_host,
            info.target_port,
            info.session_id
        );
        Ok(info)
    }

    /// Starts a dynamic (SOCKS5) forward: every CONNECT request opens a
    /// `direct-tcpip` channel to the requested target.
    pub async fn add_dynamic<R: Runtime>(
        &self,
        handle: Arc<Handle<ClientHandler<R>>>,
        session_id: String,
        bind_host: String,
        bind_port: u16,
    ) -> Result<PortForward, String> {
        let listener = bind_listener(&bind_host, bind_port).await?;
        let info = PortForward {
            id: self.new_id(),
            session_id,
            kind: ForwardKind::Dynamic,
            bind_host: listener
                .local_addr()
                .map(|addr| addr.ip().to_string())
                .unwrap_or(bind_host),
            bind_port: listener
                .local_addr()
                .map_err(|error| format!("Failed to read the bound address: {error}"))?
                .port(),
            target_host: String::new(),
            target_port: 0,
        };
        let task = tokio::spawn(accept_dynamic_loop(listener, handle, info.clone()));
        self.forwards.lock().await.insert(
            info.id.clone(),
            ActiveForward {
                info: info.clone(),
                task,
                cancel: None,
            },
        );
        log::info!(
            "Dynamic forward {}: socks5://{}:{} (session {})",
            info.id,
            info.bind_host,
            info.bind_port,
            info.session_id
        );
        Ok(info)
    }

    pub async fn list(&self) -> Vec<PortForward> {
        let forwards = self.forwards.lock().await;
        let mut infos: Vec<PortForward> =
            forwards.values().map(|entry| entry.info.clone()).collect();
        infos.sort_by(|a, b| a.id.cmp(&b.id));
        infos
    }

    /// Stops a forward; its listener is dropped so the port is released.
    pub async fn remove(&self, id: &str) -> bool {
        let removed = self.forwards.lock().await.remove(id);
        match removed {
            Some(entry) => {
                match entry.cancel {
                    Some(cancel) => {
                        // Remote forwards: let the task cancel the server-side
                        // listen request before it exits.
                        let _ = cancel.send(());
                    }
                    None => entry.task.abort(),
                }
                log::info!("Stopped forward {}", entry.info.id);
                true
            }
            None => false,
        }
    }

    /// Starts a remote forward: the server listens on `remote_host`:
    /// `remote_port` (0 = server-assigned) and tunnels inbound connections
    /// to the local target. The target mapping is registered in `targets`,
    /// which the session's client handler consults.
    #[allow(clippy::too_many_arguments)]
    pub async fn add_remote<R: Runtime>(
        &self,
        targets: RemoteForwardTargets,
        handle: Arc<Handle<ClientHandler<R>>>,
        session_id: String,
        remote_host: String,
        remote_port: u16,
        target_host: String,
        target_port: u16,
    ) -> Result<PortForward, String> {
        // Register the requested port up front so connections accepted
        // immediately after the server replies already resolve; when the
        // server assigns a different port (requested 0) the mapping is
        // re-keyed below.
        targets.lock().await.insert(
            (remote_host.clone(), u32::from(remote_port)),
            (target_host.clone(), target_port),
        );
        let assigned = handle
            .tcpip_forward(remote_host.clone(), u32::from(remote_port))
            .await
            .map_err(|error| {
                format!("The server refused to forward {remote_host}:{remote_port}: {error}")
            })?;
        // The protocol only carries a port back when the client asked to be
        // assigned one; a specific request keeps the requested port.
        let assigned = if assigned == 0 {
            u32::from(remote_port)
        } else {
            assigned
        };
        targets.lock().await.insert(
            (remote_host.clone(), assigned),
            (target_host.clone(), target_port),
        );
        let info = PortForward {
            id: self.new_id(),
            session_id,
            kind: ForwardKind::Remote,
            bind_host: remote_host.clone(),
            bind_port: assigned as u16,
            target_host: target_host.clone(),
            target_port,
        };
        let (cancel_tx, mut cancel_rx) = tokio::sync::mpsc::unbounded_channel::<()>();
        let cancel_handle = handle;
        let cancel_host = remote_host.clone();
        let cancel_targets = targets;
        let task = tokio::spawn(async move {
            let _ = cancel_rx.recv().await;
            let _ = cancel_handle
                .cancel_tcpip_forward(cancel_host.clone(), assigned)
                .await;
            cancel_targets.lock().await.remove(&(cancel_host, assigned));
        });
        self.forwards.lock().await.insert(
            info.id.clone(),
            ActiveForward {
                info: info.clone(),
                task,
                cancel: Some(cancel_tx),
            },
        );
        log::info!(
            "Remote forward {}: {}:{} -> local {}:{} (session {})",
            info.id,
            info.bind_host,
            info.bind_port,
            info.target_host,
            info.target_port,
            info.session_id
        );
        Ok(info)
    }

    /// Stops every forward belonging to a session (disconnect cleanup).
    pub async fn remove_session(&self, session_id: &str) {
        let ids: Vec<String> = {
            let forwards = self.forwards.lock().await;
            forwards
                .values()
                .filter(|entry| entry.info.session_id == session_id)
                .map(|entry| entry.info.id.clone())
                .collect()
        };
        for id in ids {
            self.remove(&id).await;
        }
        self.clear_remote_targets(session_id).await;
    }
}

async fn bind_listener(bind_host: &str, bind_port: u16) -> Result<TcpListener, String> {
    TcpListener::bind((bind_host, bind_port))
        .await
        .map_err(|error| format!("Failed to bind {bind_host}:{bind_port}: {error}"))
}

async fn accept_local_loop<R: Runtime>(
    listener: TcpListener,
    handle: Arc<Handle<ClientHandler<R>>>,
    info: PortForward,
) {
    loop {
        let (mut tcp, peer) = match listener.accept().await {
            Ok(accepted) => accepted,
            Err(error) => {
                log::warn!("Forward {}: accept failed: {error}", info.id);
                continue;
            }
        };
        let handle = handle.clone();
        let target_host = info.target_host.clone();
        let target_port = info.target_port;
        let id = info.id.clone();
        tokio::spawn(async move {
            match handle
                .channel_open_direct_tcpip(
                    target_host.clone(),
                    u32::from(target_port),
                    peer.ip().to_string(),
                    u32::from(peer.port()),
                )
                .await
            {
                Ok(channel) => {
                    let mut stream = channel.into_stream();
                    if let Err(error) = tokio::io::copy_bidirectional(&mut tcp, &mut stream).await {
                        log::warn!(
                            "Forward {id}: connection to {target_host}:{target_port} failed: {error}"
                        );
                    }
                }
                Err(error) => {
                    log::warn!(
                        "Forward {id}: cannot open direct-tcpip to {target_host}:{target_port}: {error}"
                    );
                }
            }
        });
    }
}

async fn accept_dynamic_loop<R: Runtime>(
    listener: TcpListener,
    handle: Arc<Handle<ClientHandler<R>>>,
    info: PortForward,
) {
    loop {
        let (tcp, peer) = match listener.accept().await {
            Ok(accepted) => accepted,
            Err(error) => {
                log::warn!("Dynamic forward {}: accept failed: {error}", info.id);
                continue;
            }
        };
        let handle = handle.clone();
        let id = info.id.clone();
        tokio::spawn(async move {
            if let Err(error) = serve_socks5(tcp, peer, handle, &id).await {
                log::debug!("Dynamic forward {id}: connection ended: {error}");
            }
        });
    }
}

/// Minimal SOCKS5 (RFC 1928) server: no-auth greeting, CONNECT only.
async fn serve_socks5<R: Runtime>(
    mut tcp: TcpStream,
    peer: SocketAddr,
    handle: Arc<Handle<ClientHandler<R>>>,
    forward_id: &str,
) -> std::io::Result<()> {
    let mut greeting = [0_u8; 2];
    tcp.read_exact(&mut greeting).await?;
    if greeting[0] != 0x05 {
        return Ok(());
    }
    let mut methods = vec![0_u8; greeting[1] as usize];
    tcp.read_exact(&mut methods).await?;
    tcp.write_all(&[0x05, 0x00]).await?;

    let mut request = [0_u8; 4];
    tcp.read_exact(&mut request).await?;
    if request[0] != 0x05 || request[1] != 0x01 {
        // Only CONNECT is supported; reply "command not supported".
        tcp.write_all(&[0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
            .await?;
        return Ok(());
    }

    let target_host = match request[3] {
        0x01 => {
            let mut addr = [0_u8; 4];
            tcp.read_exact(&mut addr).await?;
            Ipv4Addr::from(addr).to_string()
        }
        0x03 => {
            let mut len = [0_u8; 1];
            tcp.read_exact(&mut len).await?;
            let mut name = vec![0_u8; len[0] as usize];
            tcp.read_exact(&mut name).await?;
            String::from_utf8_lossy(&name).into_owned()
        }
        0x04 => {
            let mut addr = [0_u8; 16];
            tcp.read_exact(&mut addr).await?;
            Ipv6Addr::from(addr).to_string()
        }
        _ => {
            tcp.write_all(&[0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                .await?;
            return Ok(());
        }
    };
    let mut port_bytes = [0_u8; 2];
    tcp.read_exact(&mut port_bytes).await?;
    let target_port = u16::from_be_bytes(port_bytes);

    log::info!("Dynamic forward {forward_id}: CONNECT {target_host}:{target_port}");
    match handle
        .channel_open_direct_tcpip(
            target_host.clone(),
            u32::from(target_port),
            peer.ip().to_string(),
            u32::from(peer.port()),
        )
        .await
    {
        Ok(channel) => {
            tcp.write_all(&[0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                .await?;
            let mut stream = channel.into_stream();
            tokio::io::copy_bidirectional(&mut tcp, &mut stream).await?;
        }
        Err(error) => {
            log::warn!(
                "Dynamic forward {forward_id}: cannot open direct-tcpip to {target_host}:{target_port}: {error}"
            );
            tcp.write_all(&[0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                .await?;
        }
    }
    Ok(())
}
