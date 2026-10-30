//! SSH TCP forwarding: local and dynamic (SOCKS5) forwards.
//!
//! Both kinds bind a local TCP listener. Local forwards map every accepted
//! connection to a fixed `direct-tcpip` channel target; dynamic forwards
//! speak a minimal SOCKS5 handshake and map each CONNECT request to its
//! target. The listeners live in [`ForwardManager`] and are torn down when
//! the forward is removed or its session disconnects.

use crate::ssh::ClientHandler;
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

/// How a forward is exposed locally.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ForwardKind {
    /// Local listener → fixed remote target.
    Local,
    /// Local SOCKS5 proxy → target chosen per connection.
    Dynamic,
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
}

/// Tauri-managed registry of running forwards.
#[derive(Default)]
pub struct ForwardManager {
    forwards: Mutex<HashMap<String, ActiveForward>>,
    next_id: AtomicU64,
}

impl ForwardManager {
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
                entry.task.abort();
                log::info!("Stopped forward {}", entry.info.id);
                true
            }
            None => false,
        }
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
