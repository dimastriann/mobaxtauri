# MobaXTauri roadmap

This roadmap communicates direction rather than fixed deadlines. Priorities may change based on security findings, user feedback, maintainer capacity, and contributor interest.

## Now: safe public beta

- [x] Add known-hosts storage and explicit SSH host-key verification (`security`, `help wanted`)
- [x] Replace the application-managed vault key with a documented user/OS-backed unlock model (`security`)
- [x] Add continuous-integration checks for pull requests
- [x] Normalize existing frontend and Rust formatting, then enforce formatting in CI (`testing`, `good first issue`)
- [x] Reduce the existing frontend lint-warning baseline (`frontend`, `good first issue`)
- [x] Resolve the Rust `type_complexity` and `too_many_arguments` Clippy warnings, then deny warnings in CI (`rust`, `good first issue`)
- [ ] Establish repeatable Windows, macOS, and Linux smoke-test checklists (`testing`, `help wanted`)
- [x] Add screenshots and a short demo to the README (`documentation`, `good first issue`)
- [ ] Verify release downloads and installation instructions on each supported platform (`release`, `help wanted`)

## Next: reliability and compatibility

- [x] Support passphrase-protected SSH private keys (`ssh`, `help wanted`)
- [x] Improve authentication and connection error messages (`ssh`, `good first issue`)
- [x] Stream SFTP uploads/downloads instead of buffering whole files (`sftp`, `help wanted`)
- [x] Add transfer progress, cancellation, and conflict handling (`sftp`)
- [x] Add integration tests against a disposable SSH server (`testing`)
- [ ] Improve keyboard navigation, focus management, and screen-reader labels (`accessibility`, `help wanted`)

## v0.8.0: SFTP productivity and session workflow

- [x] SFTP multi-select, batch delete, and batch download
- [x] SFTP properties and permission (chmod) editor
- [x] Filename filter for the current SFTP directory
- [x] Transfer speed and ETA in the queue
- [x] Per-session startup command
- [x] Trusted-hosts manager in SSH settings
- [x] EN/ID localization for the SFTP explorer, session form, and SSH settings

## v0.9.0: session instances

- [x] Open multiple independent connections from one saved session config
- [x] Activate the existing tab on double-click; open another via the context menu or Ctrl/Cmd+double-click
- [x] Numbered tab titles for repeated instances (`prod`, `prod (2)`, ...)
- [x] Share the saved vault credential per config
- [x] Resolve ProxyJump against a live instance of the chosen config
- [x] Save and restore multi-instance workspaces
- [x] Migrate app data to schema v2

## Later: broader workflows

- [x] SSH agent support
- [x] Port forwarding
- [x] ProxyJump / bastion-host support
- [x] Configurable terminal profiles and themes
- [x] Transfer queue and synchronization workflows
- [x] Localization infrastructure

## Suggested starter issues

These are intentionally bounded tasks that can be opened as GitHub issues and labeled for contributors:

1. **Document a Linux smoke-test checklist** — cover installation, password/key connection, terminal resize, and basic SFTP operations.
2. **Add sanitized application screenshots** — capture dashboard, terminal tabs, and SFTP using disposable hosts and fake data.
3. **Improve empty-state accessibility** — audit buttons and interactive elements for accessible names and keyboard focus.
4. **Document supported SSH key formats** — test keys against a disposable server and record supported/unsupported cases.

Before starting a large roadmap item, open an issue describing the intended behavior and design. See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow.
