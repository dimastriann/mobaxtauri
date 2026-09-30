# MobaXTauri — agent workflow guide

## Git commit convention

- Use a clear Conventional Commit subject, kept concise and specific.
- Add a short commit body that explains the user-visible or architectural change and the relevant verification performed.
- Review the staged diff before committing and keep unrelated changes out of the commit.
- Do not amend, squash, rebase, or rewrite an existing commit unless the user explicitly requests it.
- Ensure linting, formatting and testing passed before commit

## Validation gates (before every commit)

- Full stack: `npm run project:check` (tsc + eslint + prettier + clippy)
- Backend changes: also `cargo test --manifest-path src-tauri/Cargo.toml`
- Frontend changes: also `npm test -- --run`
- Rust style is enforced by `cargo fmt --manifest-path src-tauri/Cargo.toml --all --check`
- Commit only after the gates relevant to the change pass; note them in the commit body

## Architecture principle

- Default to implementing data and logic in the Rust backend; the frontend renders
- Transformations of SSH/SFTP data (metadata assembly, math, aggregation, policy mapping) happen in Rust and arrive ready to render
- New logic prefers an existing Rust module + unit test over a TypeScript helper
- Deliberate frontend stays: xterm buffer capture, keystroke-to-IPC path, locale/date formatting

## Release procedure

Version lives in six files — bump all together:

1. `package.json` + `package-lock.json`
2. `src-tauri/tauri.conf.json`
3. `src-tauri/Cargo.toml` + `src-tauri/Cargo.lock`
4. UI labels: About dialog (`src/components/SettingsModal.tsx`) and connect banner (`src/components/Terminal.tsx`)

Then:

1. Run the full validation gates above
2. Commit as `chore(release): prepare version X.Y.Z`
3. Tag `vX.Y.Z` and push `main` + tag
4. `.github/workflows/release.yml` builds a draft release (Windows MSI/NSIS + portable exe, macOS DMG, Linux DEB/AppImage)
5. Verify draft artifacts on GitHub, edit the release notes, publish manually (`gh` CLI is not installed locally)

## Project conventions

- Contributing expectations and detailed check commands: `CONTRIBUTING.md`
- Roadmap and localization of future work: `ROADMAP.md`
- Roadmap items and plan docs live under `planning-project/` (gitignored, local only)
