use crate::known_hosts::{HostKeyAction, KnownHostsService};
use crate::session_types::{
    emit_ssh_host_key, emit_ssh_session_state, SshDisconnectReason, SshHostKeyEvent,
    SshSessionStatus,
};
use russh::client::{AuthResult, Handler, Session};
use russh::keys::ssh_key::PrivateKey;
use russh::keys::PrivateKeyWithHashAlg;
use russh::keys::PublicKey;
use russh_sftp::client::SftpSession;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;

const TERMINAL_OUTPUT_BATCH_BYTES: usize = 256 * 1024;
// Only large bursts pay an extra coalesce round; interactive output is
// forwarded with no added delay (the frontend rAF loop already coalesces).
const TERMINAL_OUTPUT_COALESCE_BYTES: usize = 64 * 1024;
const TERMINAL_OUTPUT_COALESCE_DELAY: std::time::Duration = std::time::Duration::from_millis(4);

pub struct ClientHandler {
    pub app_handle: AppHandle,
    pub session_id: String,
    pub host: String,
    pub port: u16,
    pub shell_channel_id: Arc<std::sync::OnceLock<russh::ChannelId>>,
    pub known_hosts: Arc<KnownHostsService>,
    pub terminal_output: mpsc::UnboundedSender<Vec<u8>>,
}

impl Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        let fingerprint = server_public_key
            .fingerprint(russh::keys::HashAlg::Sha256)
            .to_string();
        let key_type = server_public_key.algorithm().to_string();
        let action = self
            .known_hosts
            .resolve(&self.app_handle, &self.host, self.port, &fingerprint)
            .await;
        match action {
            Ok(HostKeyAction::Accept) => Ok(true),
            Ok(action @ (HostKeyAction::Unknown | HostKeyAction::Mismatch)) => {
                if action == HostKeyAction::Mismatch {
                    log::warn!(
                        "HOST KEY MISMATCH for {}:{} — refusing connection",
                        self.host,
                        self.port
                    );
                } else {
                    log::info!(
                        "Unknown host key for {}:{} ({}, {})",
                        self.host,
                        self.port,
                        key_type,
                        fingerprint
                    );
                }
                emit_ssh_host_key(
                    &self.app_handle,
                    SshHostKeyEvent {
                        session_id: self.session_id.clone(),
                        host: self.host.clone(),
                        port: self.port,
                        key_type,
                        fingerprint,
                        mismatch: action == HostKeyAction::Mismatch,
                    },
                );
                Ok(false)
            }
            // Fail closed: an unreadable store must not silently trust keys.
            Err(error) => {
                log::error!(
                    "Host key verification failed for {}:{}: {error}",
                    self.host,
                    self.port
                );
                Ok(false)
            }
        }
    }

    async fn data(
        &mut self,
        channel: russh::ChannelId,
        data: &[u8],
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        if self.shell_channel_id.get() == Some(&channel) {
            let _ = self.terminal_output.send(data.to_vec());
        }
        Ok(())
    }

    async fn extended_data(
        &mut self,
        channel: russh::ChannelId,
        ext: u32,
        data: &[u8],
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        if ext == 1 && self.shell_channel_id.get() == Some(&channel) {
            let _ = self.terminal_output.send(data.to_vec());
        }
        Ok(())
    }

    async fn channel_eof(
        &mut self,
        channel: russh::ChannelId,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        if self.shell_channel_id.get() == Some(&channel) {
            emit_ssh_session_state(
                &self.app_handle,
                self.session_id.clone(),
                SshSessionStatus::Disconnected,
                Some("Remote shell reached end of stream".into()),
                Some(SshDisconnectReason::RemoteEof),
            );
        }
        Ok(())
    }

    async fn channel_close(
        &mut self,
        channel: russh::ChannelId,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        if self.shell_channel_id.get() == Some(&channel) {
            emit_ssh_session_state(
                &self.app_handle,
                self.session_id.clone(),
                SshSessionStatus::Disconnected,
                Some("Remote shell closed".into()),
                Some(SshDisconnectReason::RemoteClosed),
            );
        }
        Ok(())
    }
}

pub struct SshSession;

impl SshSession {
    // Roadmap tracks the too_many_arguments baseline; a params struct is a
    // planned follow-up.
    #[allow(clippy::too_many_arguments)]
    pub async fn connect(
        app_handle: AppHandle,
        session_id: String,
        host: String,
        port: u16,
        user: String,
        password: Option<String>,
        private_key_path: Option<String>,
        known_hosts: Arc<KnownHostsService>,
    ) -> Result<
        (
            russh::client::Handle<ClientHandler>,
            russh::ChannelId,
            russh::Channel<russh::client::Msg>,
            SftpSession,
        ),
        Box<dyn std::error::Error>,
    > {
        // Let russh send protocol-level keepalives. Channel data (including an
        // empty payload) is subject to terminal flow control and can time out
        // while a full-screen application is producing heavy output.
        let config = russh::client::Config {
            keepalive_interval: Some(std::time::Duration::from_secs(15)),
            keepalive_max: 3,
            ..Default::default()
        };
        let config = Arc::new(config);
        let shell_channel_id = Arc::new(std::sync::OnceLock::new());
        let (terminal_output, terminal_output_rx) = mpsc::unbounded_channel();
        spawn_terminal_output(app_handle.clone(), session_id.clone(), terminal_output_rx);
        let sh = ClientHandler {
            app_handle,
            session_id,
            host: host.clone(),
            port,
            shell_channel_id: shell_channel_id.clone(),
            known_hosts,
            terminal_output,
        };

        log::info!("TCP connecting to {}:{}...", host, port);
        let mut session = russh::client::connect(config, (host.as_str(), port), sh).await?;
        log::info!("TCP connected. Authenticating...");

        let mut authenticated = false;

        if let Some(key_path) = private_key_path {
            log::info!("Attempting public key authentication with {}", key_path);
            match std::fs::read_to_string(&key_path) {
                Ok(key_data) => match PrivateKey::from_openssh(&key_data) {
                    Ok(key) => {
                        let key_arc = std::sync::Arc::new(key);
                        let key_alg = PrivateKeyWithHashAlg::new(key_arc, None);
                        let auth_res = session
                            .authenticate_publickey(user.clone(), key_alg)
                            .await?;
                        log::info!("Public key auth result: {:?}", auth_res);
                        if let AuthResult::Success = auth_res {
                            authenticated = true;
                        }
                    }
                    Err(e) => log::error!("Failed to parse private key: {}", e),
                },
                Err(e) => log::error!("Failed to read private key file: {}", e),
            }
        }

        if !authenticated {
            if let Some(pwd) = password {
                log::info!("Attempting password authentication...");
                let auth_res = session.authenticate_password(user, pwd).await?;
                log::info!("Password auth result: {:?}", auth_res);
                if let AuthResult::Success = auth_res {
                    authenticated = true;
                }
            }
        }

        if !authenticated {
            return Err("Authentication failed".into());
        }

        log::info!("Opening channel...");
        // Open a channel and request a PTY/Shell
        let channel = session.channel_open_session().await?;
        log::info!("Channel opened with ID: {}", channel.id());
        let channel_id = channel.id();
        let _ = shell_channel_id.set(channel_id);

        log::info!("Requesting PTY...");
        channel
            .request_pty(true, "xterm-256color", 80, 24, 0, 0, &[])
            .await?;

        log::info!("Requesting Shell...");
        channel.request_shell(true).await?;
        log::info!("Shell session established.");

        log::info!("Opening SFTP channel...");
        let sftp_channel = session.channel_open_session().await?;
        sftp_channel.request_subsystem(true, "sftp").await?;
        let sftp = SftpSession::new(sftp_channel.into_stream()).await?;
        log::info!("SFTP session initialized.");

        Ok((session, channel_id, channel, sftp))
    }
}

fn spawn_terminal_output(
    app_handle: AppHandle,
    session_id: String,
    mut receiver: mpsc::UnboundedReceiver<Vec<u8>>,
) {
    tokio::spawn(async move {
        let event_name = format!("ssh-data-{session_id}");
        // A chunk boundary can split a multi-byte UTF-8 character; the
        // incomplete tail is carried into the next batch instead of being
        // decoded as U+FFFD replacement characters.
        let mut pending: Vec<u8> = Vec::new();
        while let Some(first) = receiver.recv().await {
            let mut batch = std::mem::take(&mut pending);
            batch.extend_from_slice(&first);
            drain_receiver(&mut receiver, &mut batch);

            if batch.len() >= TERMINAL_OUTPUT_COALESCE_BYTES {
                tokio::time::sleep(TERMINAL_OUTPUT_COALESCE_DELAY).await;
                drain_receiver(&mut receiver, &mut batch);
            }

            let complete_len = complete_utf8_len(&batch);
            let payload = String::from_utf8_lossy(&batch[..complete_len]).into_owned();
            pending = batch.split_off(complete_len);
            if let Err(error) = app_handle.emit(&event_name, payload) {
                log::warn!("Failed to emit terminal output for {session_id}: {error}");
            }
        }
        // Receiver closed: flush any carried bytes so nothing is dropped.
        if !pending.is_empty() {
            let payload = String::from_utf8_lossy(&pending).into_owned();
            let _ = app_handle.emit(&event_name, payload);
        }
    });
}

fn drain_receiver(receiver: &mut mpsc::UnboundedReceiver<Vec<u8>>, batch: &mut Vec<u8>) {
    while batch.len() < TERMINAL_OUTPUT_BATCH_BYTES {
        match receiver.try_recv() {
            Ok(chunk) => batch.extend_from_slice(&chunk),
            Err(_) => break,
        }
    }
}

/// Length of the leading portion of `data` that forms complete UTF-8.
/// Trailing invalid bytes are included (they decode to U+FFFD); only a
/// trailing incomplete multi-byte sequence is excluded, since the next
/// chunk may complete it.
fn complete_utf8_len(data: &[u8]) -> usize {
    let mut offset = 0;
    loop {
        match std::str::from_utf8(&data[offset..]) {
            Ok(_) => return data.len(),
            // `None` means the sequence is truncated by the end of the
            // slice: everything from `valid_up_to` on is an incomplete
            // character and must be carried over.
            Err(error) => match error.error_len() {
                Some(invalid_len) => offset += error.valid_up_to() + invalid_len,
                None => return offset + error.valid_up_to(),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::complete_utf8_len;

    #[test]
    fn keeps_ascii_whole() {
        assert_eq!(complete_utf8_len(b"hello"), 5);
        assert_eq!(complete_utf8_len(&[]), 0);
    }

    #[test]
    fn holds_back_split_three_byte_char() {
        // '日' = E6 97 A5
        assert_eq!(complete_utf8_len(&[0xE6, 0x97]), 0);
        assert_eq!(complete_utf8_len(&[b'a', 0xE6, 0x97]), 1);
        assert_eq!(complete_utf8_len(&[0xE6, 0x97, 0xA5]), 3);
    }

    #[test]
    fn holds_back_split_four_byte_char() {
        // '😀' = F0 9F 98 80
        assert_eq!(complete_utf8_len(&[0xF0, 0x9F, 0x98]), 0);
        assert_eq!(complete_utf8_len(&[0xF0, 0x9F, 0x98, 0x80]), 4);
    }

    #[test]
    fn includes_invalid_bytes_for_replacement() {
        // 0xFF is invalid, not incomplete: it must be emitted (as U+FFFD),
        // never carried, or the stream would stall.
        assert_eq!(complete_utf8_len(&[b'a', 0xFF, b'b']), 3);
    }

    #[test]
    fn invalid_bytes_before_incomplete_tail() {
        assert_eq!(complete_utf8_len(&[0xFF, 0xE6, 0x97]), 1);
    }
}
