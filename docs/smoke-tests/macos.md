# macOS smoke test

Version: ______ OS: ______ Tester: ______ Date: ______

## Install and launch

- [ ] Open the DMG and drag MobaXTauri to Applications.
- [ ] First launch from Applications succeeds (Gatekeeper warning handled).
- [ ] First launch creates the app-data folder and opens the dashboard.
- [ ] Updating over the previous version keeps profiles and the vault.

## Connection and auth

- [ ] Password session connects and opens a shell.
- [ ] Saved-password session connects without re-typing.
- [ ] Private-key session connects; encrypted key prompts for the passphrase.
- [ ] SSH agent via `SSH_AUTH_SOCK` connects with **Use SSH Agent**.
- [ ] Unknown host key prompts; mismatch warns; trust is remembered.
- [ ] ProxyJump through a connected bastion works.
- [ ] Startup command runs on connect and again on reconnect.

## Terminal and sessions

- [ ] Multiple tabs from one saved profile with numbered titles.
- [ ] Double-click activates; Open New Connection adds another instance.
- [ ] Split view, tab reorder, and bulk close work.
- [ ] Resize and full-screen TUIs (`vim`, `htop`) render correctly.
- [ ] UTF-8/CJK/emoji output and search work.
- [ ] Recording export, snippets, and command palette work.
- [ ] Closing with live sessions asks for confirmation.

## SFTP and tunnels

- [ ] Browse, filter, and breadcrumb navigation.
- [ ] File/folder upload, drag & drop, empty directories.
- [ ] File/folder download and conflict policies.
- [ ] Multi-select batch download/delete.
- [ ] Properties/chmod persists.
- [ ] Transfer queue progress/speed/ETA/cancel/toasts.
- [ ] Local, SOCKS5, remote forwards.

## Settings and data

- [ ] Trusted Hosts manager.
- [ ] SSH key generation/register/copy/deploy/export/delete.
- [ ] Workspace restore with duplicate instances.
- [ ] Backup/restore and imports.
- [ ] Themes/fonts/shortcuts/language persist.
- [ ] Restart leaves no ephemeral instances.
