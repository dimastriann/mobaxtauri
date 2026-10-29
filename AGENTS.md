# MobaXTauri — agent workflow guide

## Git commit convention

- Use a clear Conventional Commit subject, kept concise and specific.
- Add a short commit body that explains the user-visible or architectural change and the relevant verification performed.
- Review the staged diff before committing and keep unrelated changes out of the commit.
- Do not amend, squash, rebase, or rewrite an existing commit unless the user explicitly requests it.
- Ensure linting, formatting and testing passed before commit

### Atomic commits

- Slice every feature, bugfix, refactor, or chore into the smallest coherent commits possible — one logical change per commit — so regressions are easy to trace, revert, and bisect.
- Even small changes get their own commit; never bundle unrelated edits.
- "Small" means coherent, not broken: every commit must compile and leave the tree in a working state, passing the relevant validation gates.
- Typical slicing for a cross-stack feature: backend module + unit tests → command wiring → frontend binding, as separate commits.
- Autonomy: once a slice passes its relevant gates, commit it immediately without waiting for further confirmation.

## Validation gates (before every commit)

- Full stack: `npm run project:check` (tsc + eslint + prettier + clippy)
- Backend changes: also `cargo test --manifest-path src-tauri/Cargo.toml`
- Frontend changes: also `npm test -- --run`
- Rust style is enforced by `cargo fmt --manifest-path src-tauri/Cargo.toml --all --check`
- Decide gates by touched area: backend work → Rust gates; frontend work → tsc, eslint, prettier, vitest; changes spanning both (or unsure) → full `npm run project:check` plus the relevant test suites
- Commit only after the gates relevant to the change pass; note them in the commit body

## Architecture principle

- Default to implementing data and logic in the Rust backend; the frontend renders
- Rust-first applies to every kind of change — feature, bugfix, refactor, or chore. TypeScript is the right home only when the logic inherently requires frontend context (DOM/terminal/keystrokes/locale/pure view state)
- Fix bugs where the fault is: never patch around a backend defect in frontend glue (e.g., normalizing wrong Rust output in a store) — correct the Rust command and update its tests
- Transformations of SSH/SFTP data (metadata assembly, math, aggregation, policy mapping) happen in Rust and arrive ready to render
- New logic prefers an existing Rust module + unit test over a TypeScript helper
- Deliberate frontend stays: xterm buffer capture, keystroke-to-IPC path, locale/date formatting

## Code quality principles

- Write clean, efficient, safe code following each language's best practices: idiomatic Rust with no clippy warnings, strictly typed React/TypeScript with no `any` escape hatches.
- Prefer small, single-responsibility functions; mirror the patterns of existing modules before inventing new structures.
- No dead code, commented-out blocks, or TODO debris in commits.

## Security

- Never commit, push, or log sensitive data — credentials, private keys, tokens, vault material, host secrets — unless it is clearly labeled dummy data (precedent: the synthetic keys in `src-tauri/src/test_fixtures/`, documented in that folder's README).
- Never stage anything under `tmp/`, `logs/`, or local-state directories.
- Review the staged diff before committing; if sensitive material appears, stop and flag it instead of proceeding.
- If sensitive data has already been committed, alert the user — rotation or history rewrite is a user decision, never an agent action.

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
- Agent skills: source of truth is `.agents/skills/` (read natively by Codex and opencode); Claude Code reads synced copies in `.claude/skills/` — edit the source and run `npm run sync:skills`, which CI keeps honest via `--check`
