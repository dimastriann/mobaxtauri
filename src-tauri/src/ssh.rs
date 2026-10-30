use crate::known_hosts::{HostKeyAction, KnownHostsService};
use crate::session_types::{
    emit_ssh_host_key, emit_ssh_session_state, SshDisconnectReason, SshHostKeyEvent,
    SshSessionStatus,
};
use russh::client::{AuthResult, Handler, Session};
use russh::keys::agent::client::{AgentClient, AgentStream};
use russh::keys::ssh_key::PrivateKey;
use russh::keys::{HashAlg, PrivateKeyWithHashAlg};
use russh_sftp::client::SftpSession;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Runtime};
use tokio::sync::mpsc;

const TERMINAL_OUTPUT_BATCH_BYTES: usize = 256 * 1024;
// Only large bursts pay an extra coalesce round; interactive output is
// forwarded with no added delay (the frontend rAF loop already coalesces).
const TERMINAL_OUTPUT_COALESCE_BYTES: usize = 64 * 1024;
const TERMINAL_OUTPUT_COALESCE_DELAY: std::time::Duration = std::time::Duration::from_millis(4);

pub struct ClientHandler<R: Runtime> {
    pub app_handle: AppHandle<R>,
    pub session_id: String,
    pub host: String,
    pub port: u16,
    pub shell_channel_id: Arc<std::sync::OnceLock<russh::ChannelId>>,
    pub known_hosts: Arc<KnownHostsService>,
    pub terminal_output: mpsc::UnboundedSender<Vec<u8>>,
    /// Remote-forward targets: `(listen_address, listen_port)` as reported
    /// by the server maps to the local `(host, port)` the channel is
    /// tunneled to. Shared with the [`crate::port_forward::ForwardManager`].
    pub remote_forwards: RemoteForwardTargets,
}

/// Map behind remote forwarding: server-side listen address/port → local
/// target that forwarded connections are tunnelled to.
pub type RemoteForwardTargets =
    Arc<tokio::sync::Mutex<std::collections::HashMap<(String, u32), (String, u16)>>>;

/// The production runtime binding, used by the Tauri-managed session
/// state; tests bind [`ClientHandler`] to a mock runtime instead.
pub type AppClientHandler = ClientHandler<tauri::Wry>;

impl<R: Runtime> Handler for ClientHandler<R> {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh::keys::PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        let server_public_key = match server_public_key {
            russh::keys::PublicKeyOrCertificate::PublicKey { key, .. } => key,
            // Certificate host keys are not part of the supported matrix;
            // fail closed rather than trusting an unverified certificate.
            russh::keys::PublicKeyOrCertificate::Certificate(_) => {
                log::warn!(
                    "Server presented a certificate host key for {}:{} — not supported, refusing",
                    self.host,
                    self.port
                );
                return Ok(false);
            }
        };
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

    /// The server accepted a remote forward and is opening a tunnel for an
    /// inbound connection: dial the registered local target and pump bytes
    /// through the channel.
    async fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: russh::Channel<russh::client::Msg>,
        connected_address: &str,
        connected_port: u32,
        _originator_address: &str,
        _originator_port: u32,
        reply: russh::client::ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        let target = self
            .remote_forwards
            .lock()
            .await
            .get(&(connected_address.to_string(), connected_port))
            .cloned();
        let Some((target_host, target_port)) = target else {
            // Dropping the reply rejects the channel: no forward owns it.
            log::warn!(
                "Server opened a forwarded channel for {connected_address}:{connected_port} \
                 with no registered target; rejecting"
            );
            return Ok(());
        };
        reply.accept().await;
        let mut stream = channel.into_stream();
        tokio::spawn(async move {
            match tokio::net::TcpStream::connect((target_host.as_str(), target_port)).await {
                Ok(mut socket) => {
                    if let Err(error) =
                        tokio::io::copy_bidirectional(&mut socket, &mut stream).await
                    {
                        log::warn!("Remote forward to {target_host}:{target_port} ended: {error}");
                    }
                }
                Err(error) => {
                    log::warn!("Remote forward target {target_host}:{target_port} failed: {error}");
                }
            }
        });
        Ok(())
    }
}

pub struct SshSession;

/// Error marker the frontend matches to enter passphrase prompting. It is
/// followed by nothing the client depends on; the connect flow surfaces it
/// verbatim as part of the failure message.
pub const KEY_PASSPHRASE_REQUIRED: &str = "KEY PASSPHRASE REQUIRED";

/// Runtime-typed SSH agent client: platform streams are boxed so the
/// connect flow and the list-keys command share one return type.
pub type BoxedAgentClient = AgentClient<Box<dyn AgentStream + Send + Unpin>>;

/// Connects to the user's SSH agent. Windows: the OpenSSH agent service
/// pipe first, then Pageant; Unix: the SSH_AUTH_SOCK socket.
#[cfg(windows)]
pub async fn connect_agent_client() -> Result<BoxedAgentClient, String> {
    if let Ok(client) = AgentClient::connect_named_pipe(r"\\.\pipe\openssh-ssh-agent").await {
        return Ok(client.dynamic());
    }
    if let Ok(client) = AgentClient::connect_pageant().await {
        return Ok(client.dynamic());
    }
    Err(
        "SSH agent is not available: neither the Windows OpenSSH agent pipe \
         (\\\\.\\pipe\\openssh-ssh-agent) nor Pageant responded. Start the agent service or \
         Pageant, or disable the SSH agent option."
            .to_string(),
    )
}

/// Connects to the user's SSH agent. Windows: the OpenSSH agent service
/// pipe first, then Pageant; Unix: the SSH_AUTH_SOCK socket.
#[cfg(unix)]
pub async fn connect_agent_client() -> Result<BoxedAgentClient, String> {
    let client = AgentClient::connect_env().await.map_err(|error| {
        format!(
            "SSH agent is not available: {error}. Set SSH_AUTH_SOCK to a running ssh-agent or \
             disable the SSH agent option."
        )
    })?;
    Ok(client.dynamic())
}

/// Offers every key the agent holds to the server, returning true on the
/// first acceptance. Signing is forwarded to the agent, so private key
/// material never leaves it.
pub async fn authenticate_with_agent<S>(
    session: &mut russh::client::Handle<ClientHandler<impl Runtime>>,
    user: &str,
    agent: &mut AgentClient<S>,
) -> bool
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send,
{
    let identities = match agent.request_identities().await {
        Ok(identities) => identities,
        Err(error) => {
            log::warn!("SSH agent identity query failed: {error}");
            return false;
        }
    };
    if identities.is_empty() {
        log::info!("SSH agent has no keys loaded");
        return false;
    }
    for identity in &identities {
        let key = identity.public_key().into_owned();
        log::info!(
            "Trying agent key {} ({})",
            key.fingerprint(HashAlg::Sha256),
            identity.comment()
        );
        let result = session
            .authenticate_publickey_with(user.to_string(), key, None, agent)
            .await;
        match result {
            Ok(AuthResult::Success) => return true,
            Ok(other) => log::info!("Agent key rejected: {other:?}"),
            Err(error) => log::warn!("Agent signing failed: {error}"),
        }
    }
    false
}

/// Parses and decrypts an OpenSSH private key, failing with distinct,
/// user-actionable errors instead of the auth-failure fallthrough:
///
/// - Encrypted key without a passphrase → `KEY PASSPHRASE REQUIRED`
/// - Wrong passphrase / malformed ciphertext → explicit decrypt error
/// - Unparseable PEM → explicit invalid-key error
///
/// Vendored ssh-key 0.6.16 semantics (verified from source): encrypted
/// keys parse *successfully* into `KeypairData::Encrypted`, so the only
/// reliable detection is `is_encrypted()`.
fn decode_private_key(key_data: &str, passphrase: Option<&str>) -> Result<PrivateKey, String> {
    let key = PrivateKey::from_openssh(key_data)
        .map_err(|error| format!("Private key is invalid or in an unsupported format: {error}"))?;
    if !key.is_encrypted() {
        return Ok(key);
    }
    match passphrase {
        Some(passphrase) => key.decrypt(passphrase).map_err(|error| {
            format!("Private key passphrase is incorrect or decryption failed: {error}")
        }),
        None => Err(KEY_PASSPHRASE_REQUIRED.to_string()),
    }
}

impl SshSession {
    // Roadmap tracks the too_many_arguments baseline; a params struct is a
    // planned follow-up.
    #[allow(clippy::too_many_arguments)]
    pub async fn connect<R: Runtime>(
        app_handle: AppHandle<R>,
        session_id: String,
        host: String,
        port: u16,
        user: String,
        password: Option<String>,
        private_key_path: Option<String>,
        key_passphrase: Option<String>,
        use_agent: bool,
        known_hosts: Arc<KnownHostsService>,
        remote_forwards: RemoteForwardTargets,
    ) -> Result<
        (
            russh::client::Handle<ClientHandler<R>>,
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
            remote_forwards,
        };

        log::info!("TCP connecting to {}:{}...", host, port);
        let mut session = russh::client::connect(config, (host.as_str(), port), sh).await?;
        log::info!("TCP connected. Authenticating...");

        let mut authenticated = false;
        // Capture what will be attempted before the values are moved into
        // the authentication calls; the failure message names them.
        let agent_attempted = use_agent;
        let key_attempted = private_key_path.is_some();
        let password_attempted = password.is_some();

        if use_agent {
            log::info!("Attempting SSH agent authentication...");
            match connect_agent_client().await {
                Ok(mut agent) => {
                    authenticated = authenticate_with_agent(&mut session, &user, &mut agent).await;
                }
                Err(error) => log::warn!("{error}"),
            }
        }

        if let Some(key_path) = private_key_path.as_ref() {
            log::info!("Attempting public key authentication with {}", key_path);
            // A key that cannot be read, parsed, or decrypted is a
            // configuration problem: fail explicitly rather than silently
            // retrying as password auth and reporting "Authentication
            // failed" for what is really an unusable key.
            match std::fs::read_to_string(key_path) {
                Ok(key_data) => match decode_private_key(&key_data, key_passphrase.as_deref()) {
                    Ok(key) => {
                        let key_arc = std::sync::Arc::new(key);
                        let key_alg = PrivateKeyWithHashAlg::new(key_arc, None);
                        match session
                            .authenticate_publickey(user.clone(), key_alg)
                            .await?
                        {
                            AuthResult::Success => authenticated = true,
                            other => {
                                log::info!("Public key auth rejected: {other:?}");
                            }
                        }
                    }
                    Err(error) => return Err(error.into()),
                },
                Err(error) => {
                    return Err(format!("Private key cannot be read: {key_path}: {error}").into())
                }
            }
        }

        if !authenticated {
            if let Some(pwd) = password.as_deref() {
                log::info!("Attempting password authentication...");
                let auth_res = session.authenticate_password(user.clone(), pwd).await?;
                log::info!("Password auth result: {:?}", auth_res);
                if let AuthResult::Success = auth_res {
                    authenticated = true;
                }
            }
        }

        if !authenticated {
            return Err(describe_auth_failure(
                agent_attempted,
                key_attempted,
                password_attempted,
                &user,
                &host,
            )
            .into());
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

/// Builds the final authentication failure message, distinguishing what
/// was actually attempted. "Password" in the wording is load-bearing: the
/// terminal uses it to decide whether a password re-prompt can help, so
/// the agent prefix is prepended rather than replacing the wording.
/// Pre-authentication transport errors (DNS refused, handshake aborted,
/// server closed the TCP stream) already surface as distinct russh errors
/// and are not handled here.
fn describe_auth_failure(
    agent_attempted: bool,
    key_attempted: bool,
    password_attempted: bool,
    user: &str,
    host: &str,
) -> String {
    let target = format!("{user}@{host}");
    let base = match (key_attempted, password_attempted) {
        (true, true) => {
            format!(
                "Public key and password authentication were rejected by {target}; check the key and password configured for this session"
            )
        }
        (true, false) => format!(
            "Public key authentication was rejected by {target}; the server did not accept this key file"
        ),
        (false, true) => format!(
            "Password authentication was rejected by {target}; the username or password may be wrong"
        ),
        (false, false) => format!(
            "No credential was available when connecting to {target}; configure a password, save one in the vault, or select a private key"
        ),
    };
    if agent_attempted {
        let hint = "If the agent should authenticate this session, load the key into the \
                    agent and add its public key to the server's authorized_keys.";
        format!("The SSH agent's keys were rejected by {target}. {base} {hint}")
    } else {
        base
    }
}

fn spawn_terminal_output<R: Runtime>(
    app_handle: AppHandle<R>,
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
            let mut batch = take_batch(first, &mut receiver, &mut pending);

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

/// Joins a freshly received chunk with carried bytes plus whatever is
/// already waiting in the channel, up to the batch cap. The extra-coalesce
/// stay-awake round lives in `spawn_terminal_output`, so this seam stays
/// synchronous and mock-testable.
fn take_batch(
    first: Vec<u8>,
    receiver: &mut mpsc::UnboundedReceiver<Vec<u8>>,
    carry: &mut Vec<u8>,
) -> Vec<u8> {
    let mut batch = std::mem::take(carry);
    batch.extend_from_slice(&first);
    drain_receiver(receiver, &mut batch);
    batch
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
    use super::{
        complete_utf8_len, decode_private_key, describe_auth_failure, KEY_PASSPHRASE_REQUIRED,
    };

    const FIXTURE_PASSPHRASE: &str = "mobaxtauri-test-passphrase";

    fn fixture(name: &str) -> String {
        std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("src")
                .join("test_fixtures")
                .join(name),
        )
        .expect("test fixture must be readable")
    }

    // Real throwaway RSA-less ed25519 keys generated at authoring time with
    // ssh-keygen; safe to commit, passphrase is documented above.
    #[test]
    fn encrypted_key_without_passphrase_asks_for_one() {
        let key_data = fixture("encrypted_test_key");
        let error = decode_private_key(&key_data, None).unwrap_err();
        assert_eq!(error, KEY_PASSPHRASE_REQUIRED);
    }

    #[test]
    fn encrypted_key_decrypts_with_correct_passphrase() {
        let key_data = fixture("encrypted_test_key");
        let key = decode_private_key(&key_data, Some(FIXTURE_PASSPHRASE)).expect("must decrypt");
        assert!(!key.is_encrypted());
        assert_eq!(key.algorithm(), russh::keys::ssh_key::Algorithm::Ed25519);
    }

    #[test]
    fn encrypted_key_rejects_wrong_passphrase() {
        let key_data = fixture("encrypted_test_key");
        let error = decode_private_key(&key_data, Some("definitely-wrong")).unwrap_err();
        assert!(
            error.contains("passphrase is incorrect"),
            "unexpected error text: {error}"
        );
    }

    #[test]
    fn plaintext_key_needs_no_passphrase() {
        let key_data = fixture("plain_test_key");
        let key = decode_private_key(&key_data, None).expect("plaintext key must parse");
        assert!(!key.is_encrypted());
        assert_eq!(key.algorithm(), russh::keys::ssh_key::Algorithm::Ed25519);
    }

    #[test]
    fn plaintext_key_passphrase_is_harmless() {
        // An unencrypted key must not lose usability when a (stale)
        // passphrase happens to be provided.
        let key_data = fixture("plain_test_key");
        let key = decode_private_key(&key_data, Some("unused-passphrase")).expect("must parse");
        assert!(!key.is_encrypted());
    }

    #[test]
    fn malformed_key_data_errors_explicitly() {
        let error = decode_private_key("not-a-pem", None).unwrap_err();
        assert!(
            error.contains("unsupported format"),
            "unexpected error text: {error}"
        );
    }

    #[test]
    fn auth_failure_names_what_was_attempted() {
        let message = describe_auth_failure(false, false, true, "ops", "prod.example.com");
        assert!(message.starts_with("Password authentication"), "{message}");
        assert!(message.contains("ops@prod.example.com"), "{message}");
    }

    #[test]
    fn auth_failure_combines_key_and_password() {
        let message = describe_auth_failure(false, true, true, "ops", "host");
        assert!(message.starts_with("Public key and password"), "{message}");
    }

    #[test]
    fn auth_failure_key_only_does_not_offer_password_prompt() {
        let message = describe_auth_failure(false, true, false, "ops", "host");
        assert!(
            message.starts_with("Public key authentication"),
            "{message}"
        );
    }

    #[test]
    fn auth_failure_without_credentials_is_a_configuration_error() {
        let message = describe_auth_failure(false, false, false, "ops", "host");
        assert!(message.contains("No credential was available"), "{message}");
    }

    #[test]
    fn auth_failure_with_agent_keeps_the_password_prompt_wording() {
        // The agent prefix is prepended; the "Password authentication was
        // rejected" substring the terminal re-prompt flow matches on must
        // stay intact.
        let message = describe_auth_failure(true, false, true, "ops", "host");
        assert!(message.starts_with("The SSH agent's keys"), "{message}");
        assert!(
            message.contains("Password authentication was rejected"),
            "{message}"
        );
        assert!(
            message.contains("authorized_keys"),
            "the agent hint must point at authorized_keys: {message}"
        );
    }

    // ── Output-pipeline stress (mocked bursts) ─────────────────────
    use super::{drain_receiver, take_batch};
    use tokio::sync::mpsc::unbounded_channel;

    /// Synchronous mock of `spawn_terminal_output` semantics: drain to the
    /// cap, split at UTF-8 safety boundaries, carry incomplete tails. The
    /// 4ms extra coalesce round only changes how much is drained per
    /// iteration, never what is decoded, so it is omitted here.
    fn run_pipeline_mock(chunks: Vec<Vec<u8>>) -> Vec<u8> {
        let (sender, mut receiver) = unbounded_channel();
        for chunk in chunks {
            sender.send(chunk).expect("mock channel open");
        }
        drop(sender);

        let mut pending: Vec<u8> = Vec::new();
        let mut emitted: Vec<u8> = Vec::new();
        while let Ok(first) = receiver.try_recv() {
            let mut batch = take_batch(first, &mut receiver, &mut pending);
            // Mock the ≥64KB extra drain round at zero cost.
            drain_receiver(&mut receiver, &mut batch);

            let complete_len = complete_utf8_len(&batch);
            emitted.extend_from_slice(&batch[..complete_len]);
            pending = batch.split_off(complete_len);
        }
        emitted.extend_from_slice(&pending);
        emitted
    }

    /// One Odoo-style access-log-ish line with a CJK customer name; chunk
    /// sizes deliberately misalign with character boundaries.
    fn stress_line(sequence: usize) -> Vec<u8> {
        let line = format!(
            "2026-10-10 09:41:22,{:03} {} INFO moba-test odoo.http: record[{}] partner name=\"株式会社テンソル {}\" HTTP 200 OK 3 rows\r\n",
            sequence % 1000,
            1000 + sequence % 2900,
            sequence % 99999,
            sequence
        );
        line.into_bytes()
    }

    #[test]
    fn high_volume_burst_preserves_all_bytes_in_order() {
        // ~2MB: 10_000 chunks, each carrying 2 whole lines; the chunk edge
        // splits multi-byte characters mid-sequence at unaligned offsets.
        const CHUNKS: usize = 10_000;
        let mut chunks = Vec::with_capacity(CHUNKS);
        let mut expected: Vec<u8> = Vec::with_capacity(CHUNKS * 400);
        for sequence in 0..CHUNKS {
            let a = stress_line(sequence);
            let b = stress_line(sequence + CHUNKS);
            let mut chunk = a.clone();
            chunk.extend_from_slice(&b);
            // Split at a byte offset inside a multi-byte character.
            chunks.push(chunk[..chunk.len() - 2].to_vec());
            chunks.push(chunk[chunk.len() - 2..].to_vec());
            expected.extend_from_slice(&chunk);
        }

        let emitted = run_pipeline_mock(chunks);

        assert_eq!(emitted.len(), expected.len());
        assert_eq!(emitted, expected);
    }

    #[test]
    fn single_chunk_larger_than_batch_cap_is_not_truncated() {
        // A lone 1MB chunk must pass whole: the cap only decides how much
        // is ADDED to a batch, never how much is emitted.
        let mut chunk = Vec::with_capacity(1024 * 1024);
        for sequence in 0..4_000 {
            chunk.extend_from_slice(&stress_line(sequence));
        }
        let emitted = run_pipeline_mock(vec![chunk.clone()]);
        assert_eq!(emitted, chunk);
    }

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
