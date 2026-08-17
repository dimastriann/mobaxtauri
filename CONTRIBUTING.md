# Contributing to MobaXTauri

Thanks for helping improve MobaXTauri. Contributions of code, tests, documentation, design feedback, and platform testing are welcome.

## Before you start

- Read the [Code of Conduct](CODE_OF_CONDUCT.md).
- Search existing issues before opening a duplicate.
- For a bug, include reproducible steps, logs with secrets removed, and your OS/application version.
- Discuss large features or architectural changes in an issue before investing significant work.
- Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

Never include passwords, private keys, hostnames, IP addresses, terminal recordings, or configuration files from real infrastructure in an issue or pull request.

## Local setup

You need Node.js 20+, Rust stable, and the [Tauri v2 platform prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
git clone https://github.com/dimastriann/mobaxtauri.git
cd mobaxtauri
npm install
npm run tauri dev
```

Use a disposable local VM or container as your SSH/SFTP test target. Do not test development builds against production infrastructure.

## Development workflow

1. Fork the repository and create a branch from the default branch.
2. Keep each change focused on one issue or concern.
3. Follow the existing TypeScript and Rust patterns.
4. Add or update tests when behavior changes.
5. Run the relevant checks locally.
6. Open a pull request and complete the template.

Suggested branch names include `fix/sftp-refresh`, `feature/known-hosts`, and `docs/linux-setup`.

## Checks

```bash
npm run test -- --run
npm run build
npm run lint
npm run format:check
cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml --all --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

If a platform-specific check cannot be run locally, explain what you did run in the pull request.

## Pull request expectations

A useful pull request:

- links its issue when applicable;
- explains the user-visible effect and technical approach;
- includes tests or a reason tests are not applicable;
- includes screenshots or a short recording for visible UI changes;
- documents manual SSH/SFTP test conditions without exposing sensitive data;
- does not mix unrelated refactoring into the change; and
- updates documentation when setup, behavior, or limitations change.

Maintainers may request changes or close proposals that are unsafe, out of scope, inactive, or inconsistent with the roadmap. Review is a technical discussion; assume good intent and keep feedback specific.

## Areas where help is especially useful

- Secure known-hosts and host-key verification
- Windows, macOS, and Linux compatibility testing
- SSH authentication compatibility and clear error handling
- SFTP performance and large-file behavior
- Accessibility and keyboard navigation
- Automated Rust and frontend integration tests
- Contributor documentation and reproducible bug reports

By contributing, you agree that your contribution is licensed under the repository's MIT License.
