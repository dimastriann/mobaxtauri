# MobaXTauri roadmap

This roadmap communicates direction rather than fixed deadlines. Priorities may change based on security findings, user feedback, maintainer capacity, and contributor interest.

## Now: safe public beta

- [ ] Add known-hosts storage and explicit SSH host-key verification (`security`, `help wanted`)
- [ ] Replace the application-managed vault key with a documented user/OS-backed unlock model (`security`)
- [x] Add continuous-integration checks for pull requests
- [ ] Normalize existing frontend and Rust formatting, then enforce formatting in CI (`testing`, `good first issue`)
- [ ] Reduce the existing frontend lint-warning baseline (`frontend`, `good first issue`)
- [ ] Resolve the Rust `type_complexity` and `too_many_arguments` Clippy warnings, then deny warnings in CI (`rust`, `good first issue`)
- [ ] Establish repeatable Windows, macOS, and Linux smoke-test checklists (`testing`, `help wanted`)
- [ ] Add screenshots and a short demo to the README (`documentation`, `good first issue`)
- [ ] Verify release downloads and installation instructions on each supported platform (`release`, `help wanted`)

## Next: reliability and compatibility

- [ ] Support passphrase-protected SSH private keys (`ssh`, `help wanted`)
- [ ] Improve authentication and connection error messages (`ssh`, `good first issue`)
- [ ] Stream SFTP uploads/downloads instead of buffering whole files (`sftp`, `help wanted`)
- [ ] Add transfer progress, cancellation, and conflict handling (`sftp`)
- [ ] Add integration tests against a disposable SSH server (`testing`)
- [ ] Improve keyboard navigation, focus management, and screen-reader labels (`accessibility`, `help wanted`)

## Later: broader workflows

- [ ] SSH agent support
- [ ] Port forwarding
- [ ] ProxyJump / bastion-host support
- [ ] Configurable terminal profiles and themes
- [ ] Transfer queue and synchronization workflows
- [ ] Localization infrastructure

## Suggested starter issues

These are intentionally bounded tasks that can be opened as GitHub issues and labeled for contributors:

1. **Document a Linux smoke-test checklist** — cover installation, password/key connection, terminal resize, and basic SFTP operations.
2. **Add sanitized application screenshots** — capture dashboard, terminal tabs, and SFTP using disposable hosts and fake data.
3. **Improve empty-state accessibility** — audit buttons and interactive elements for accessible names and keyboard focus.
4. **Document supported SSH key formats** — test keys against a disposable server and record supported/unsupported cases.

Before starting a large roadmap item, open an issue describing the intended behavior and design. See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow.
