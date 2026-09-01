use crate::session_types::{emit_ssh_session_state, SshDisconnectReason, SshSessionStatus};
use russh::client::{AuthResult, Handler, Session};
use russh::keys::ssh_key::PrivateKey;
use russh::keys::PrivateKeyWithHashAlg;
use russh::keys::PublicKey;
use russh_sftp::client::SftpSession;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;

const TERMINAL_OUTPUT_BATCH_DELAY: std::time::Duration = std::time::Duration::from_millis(8);
const TERMINAL_OUTPUT_BATCH_BYTES: usize = 256 * 1024;

pub struct ClientHandler {
    pub app_handle: AppHandle,
    pub session_id: String,
    pub shell_channel_id: Arc<tokio::sync::Mutex<Option<russh::ChannelId>>>,
    pub terminal_output: mpsc::UnboundedSender<Vec<u8>>,
}

impl Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }

    async fn data(
        &mut self,
        channel: russh::ChannelId,
        data: &[u8],
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        if Some(channel) == *self.shell_channel_id.lock().await {
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
        if ext == 1 && Some(channel) == *self.shell_channel_id.lock().await {
            let _ = self.terminal_output.send(data.to_vec());
        }
        Ok(())
    }

    async fn channel_eof(
        &mut self,
        channel: russh::ChannelId,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        if Some(channel) == *self.shell_channel_id.lock().await {
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
        if Some(channel) == *self.shell_channel_id.lock().await {
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
    pub async fn connect(
        app_handle: AppHandle,
        session_id: String,
        host: String,
        port: u16,
        user: String,
        password: Option<String>,
        private_key_path: Option<String>,
    ) -> Result<
        (
            russh::client::Handle<ClientHandler>,
            russh::ChannelId,
            russh::Channel<russh::client::Msg>,
            SftpSession,
        ),
        Box<dyn std::error::Error>,
    > {
        let config = russh::client::Config::default();
        let config = Arc::new(config);
        let shell_channel_id = Arc::new(tokio::sync::Mutex::new(None));
        let (terminal_output, terminal_output_rx) = mpsc::unbounded_channel();
        spawn_terminal_output(app_handle.clone(), session_id.clone(), terminal_output_rx);
        let sh = ClientHandler {
            app_handle,
            session_id,
            shell_channel_id: shell_channel_id.clone(),
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
        *shell_channel_id.lock().await = Some(channel_id);

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
        while let Some(first) = receiver.recv().await {
            let mut batch = first;
            tokio::time::sleep(TERMINAL_OUTPUT_BATCH_DELAY).await;

            while batch.len() < TERMINAL_OUTPUT_BATCH_BYTES {
                match receiver.try_recv() {
                    Ok(chunk) => batch.extend_from_slice(&chunk),
                    Err(_) => break,
                }
            }

            let payload = String::from_utf8_lossy(&batch).into_owned();
            if let Err(error) = app_handle.emit(&event_name, payload) {
                log::warn!("Failed to emit terminal output for {session_id}: {error}");
            }
        }
    });
}
