# Windows smoke test

Version: ______ OS: ______ Tester: ______ Date: ______

## Install and launch

- [ ] Install the MSI and launch MobaXTauri.
- [ ] Install the NSIS setup and launch MobaXTauri.
- [ ] Run the portable `.exe` and launch MobaXTauri.
- [ ] First launch creates the app-data folder and opens the dashboard.
- [ ] Uninstall/reinstall keeps saved profiles and the credential vault.

## Connection and auth

- [ ] Password session connects and opens a shell.
- [ ] Saved-password session connects without re-typing.
- [ ] Private-key session connects; encrypted key prompts for the passphrase.
- [ ] Wrong password shows an actionable message and re-prompts.
- [ ] Windows OpenSSH Agent and Pageant sessions connect with **Use SSH Agent**.
- [ ] Unknown host key prompts; accept connects and the key is remembered.
- [ ] Mismatched host key warns and refuses until explicitly replaced.
- [ ] ProxyJump through a connected bastion works.
- [ ] Startup command runs on connect and again on reconnect.

## Terminal and sessions

- [ ] Multiple tabs from one saved profile; titles become `name (2)`.
- [ ] Double-click activates the existing instance; Open New Connection adds one.
- [ ] Split view, tab reorder, and bulk tab close work.
- [ ] Resize the window and a full-screen TUI; no wrapping corruption.
- [ ] `vim` with UTF-8/CJK text and `htop` render correctly.
- [ ] Search, recording export, snippets, and command palette work.
- [ ] Closing with live sessions asks for confirmation.

## SFTP and tunnels

- [ ] Browse, breadcrumb navigation, and filename filter work.
- [ ] Upload file, upload folder, drag & drop, and empty-directory preservation.
- [ ] Download file, download folder, and conflict policies (overwrite/rename/skip).
- [ ] Multi-select batch download and batch delete.
- [ ] Properties dialog changes permissions; the change survives reconnect.
- [ ] Transfer queue shows progress, speed, ETA, cancel, and completion toasts.
- [ ] Local, SOCKS5, and remote forwards work and release ports on removal.

## Settings and data

- [ ] Trusted Hosts lists and removes keys; next connect prompts again.
- [ ] SSH Keys generates, registers, copies, deploys, exports, and deletes.
- [ ] Workspaces save and restore multiple instances in order.
- [ ] App-data backup/restore and OpenSSH/MobaXterm imports work.
- [ ] Appearance, terminal theme/font, shortcuts, EN/ID language persist.
- [ ] App restarts without resurrecting ephemeral instances.
