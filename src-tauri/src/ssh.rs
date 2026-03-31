use std::sync::Arc;
use russh::client::{AuthResult, Handler, Session};
use russh::keys::PublicKey;
use tauri::{AppHandle, Emitter};

pub struct ClientHandler {
    pub app_handle: AppHandle,
    pub session_id: String,
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
        _channel: russh::ChannelId,
        data: &[u8],
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        let payload = String::from_utf8_lossy(data).to_string();
        let event_name = format!("ssh-data-{}", self.session_id);
        let _ = self.app_handle.emit(&event_name, payload);
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
    ) -> Result<(russh::client::Handle<ClientHandler>, russh::ChannelId, russh::Channel<russh::client::Msg>), Box<dyn std::error::Error>> {
        let config = russh::client::Config::default();
        let config = Arc::new(config);
        let sh = ClientHandler {
            app_handle,
            session_id,
        };
        
        log::info!("TCP connecting to {}:{}...", host, port);
        let mut session = russh::client::connect(config, (host.as_str(), port), sh).await?;
        log::info!("TCP connected. Authenticating...");
        
        if let Some(pwd) = password {
            let auth_res = session.authenticate_password(user, pwd).await?;
            log::info!("Authentication result: {:?}", auth_res);
            match auth_res {
                AuthResult::Success => {}
                _ => return Err("Authentication failed".into()),
            }
        }

        log::info!("Opening channel...");
        // Open a channel and request a PTY/Shell
        let channel = session.channel_open_session().await?;
        log::info!("Channel opened with ID: {}", channel.id());
        let channel_id = channel.id();
        
        log::info!("Requesting PTY...");
        channel.request_pty(true, "xterm-256color", 80, 24, 0, 0, &[]).await?;
        
        log::info!("Requesting Shell...");
        channel.request_shell(true).await?;
        log::info!("Shell session established.");
        
        Ok((session, channel_id, channel))
    }
}
