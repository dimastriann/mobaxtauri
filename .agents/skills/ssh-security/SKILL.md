---
name: ssh-security
description: Security rules for SSH connection, credential, vault, and host-key code in MobaXTauri. Use when touching ssh.rs, credentials.rs, vault_key.rs, known_hosts.rs, any credential_* or ssh_trust_host_key command, SshConnectRequest handling, or anything involving private keys, passphrases, saved passwords, or host trust decisions.
---

# SSH security rules

Secret-bearing surfaces: `src-tauri/src/ssh.rs` (connect/auth), `credentials.rs`
(`CredentialService` over an iota Stronghold vault), `vault_key.rs`
(`VaultKeyService`, OS keychain-held vault key), `known_hosts.rs` (trust store).
The frontend must never see, hold, or derive any secret.

## Non-negotiables

- Secrets live and die in Rust. Private keys, passphrases, and saved passwords are read, decrypted, and consumed exclusively in backend modules. Never return them from a Tauri command; never mirror them in a store (`useSessionStore` keeps session metadata, not secrets).
- The unlocked vault flows through the `credential_unlock` / `credential_save` / `credential_delete` commands (`CredentialService::unlock/save/get/delete`). Do not add a side door to read credentials — new needs go through new methods on `CredentialService`.
- Vault material persists only via Stronghold (`tauri-plugin-stronghold`); the vault key lives in the OS keychain via `VaultKeyService`. Never write vault contents to `load_app_data`/`save_app_data` (the plaintext session-store persistence) or any temp file.
- Intentional error sentinels are part of the contract: `KEY PASSPHRASE REQUIRED` (`ssh.rs`) signals the frontend's masked passphrase prompt; the "No credential was available" / "Saved credential is unavailable" messages drive the in-terminal password prompt. Tests assert on these strings — changing one means updating `ssh.rs` tests and the `Terminal.tsx` handler together.
- Error messages must describe failure classes, never echo secrets (no key bodies, passphrases, or decrypted contents in `Err` payloads or logs).
- Host trust goes through the `SSH_HOST_KEY_EVENT` prompt → `ssh_trust_host_key` command → `known_hosts.rs::resolve_host_key/upsert_host`. Never auto-accept unknown host keys, and never weaken fingerprint comparison (compare the full fingerprint, not a truncated form).

## Dataset boundaries

- The only committable key-like data is the synthetic pair in
  `src-tauri/src/test_fixtures/` (see its README — generated throwaways, passphrase
  visibly fixed for tests). Never replace them with real keys; generate fresh
  fixtures with the README's `ssh-keygen` commands.
- `tmp/`, `logs/`, and any local capture from a dev VM are never staged; add code comments explaining *why* only when the refusal would be surprising.

## When touching these modules

- New behavior near auth/vault code gets a unit test in the same module's `#[cfg(test)] mod tests`, mirroring `auth_failure_without_credentials_is_a_configuration_error` style: assert on the *sentinel message*, not on secret presence.
- Before committing, verify in the staged diff that no fixture, log line, or test change introduces real-looking key material (`ssh-`, `BEGIN OPENSSH PRIVATE KEY`, base64 blobs longer than ~60 chars that are not the known fixtures).
