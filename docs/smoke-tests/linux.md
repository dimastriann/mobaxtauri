# Linux smoke test

Version: ______ Distro: ______ Desktop: ______ Tester: ______ Date: ______

## Install and launch

- [ ] Install the DEB and launch from the application menu.
- [ ] Run the AppImage (after `chmod +x`) and launch.
- [ ] First launch creates the app-data folder and opens the dashboard.
- [ ] Test on at least one GNOME/Keyring and one KWallet desktop if possible.

## Connection and auth

- [ ] Password session connects and opens a shell.
- [ ] Saved-password session connects; vault unlock works with Secret Service.
- [ ] Minimal desktop without Secret Service falls back to the master password.
- [ ] Private-key session connects; encrypted key prompts.
- [ ] SSH agent via `SSH_AUTH_SOCK` works.
- [ ] Host-key prompt, mismatch warning, and trust persistence.
- [ ] ProxyJump and startup command.

## Terminal and sessions

- [ ] Multiple instances from one profile with numbered titles.
- [ ] Double-click activation and Open New Connection.
- [ ] Split view, tab reorder, bulk close.
- [ ] Resize and full-screen TUIs, UTF-8/CJK output, search.
- [ ] Recording export, snippets, command palette.
- [ ] Close confirmation with live sessions.

## SFTP and tunnels

- [ ] Browse/filter/breadcrumbs.
- [ ] Upload/download files and folders, drag & drop, empty dirs.
- [ ] Conflict policies and multi-select batch actions.
- [ ] Properties/chmod.
- [ ] Transfer queue progress/speed/ETA/cancel/toasts.
- [ ] Local/SOCKS5/remote forwards and port cleanup.

## Settings and data

- [ ] Trusted Hosts manager.
- [ ] SSH key generation/register/copy/deploy/export/delete.
- [ ] Workspace restore with duplicates.
- [ ] Backup/restore and SSH config/MobaXterm imports.
- [ ] Themes/fonts/shortcuts/language persist.
- [ ] Restart leaves no ephemeral instances.
