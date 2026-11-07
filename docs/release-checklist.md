# Release checklist

## Before tagging

- [ ] Run `npm run check:version` and confirm all six version spots agree.
- [ ] Run `npm run project:check`.
- [ ] Run `cargo test --manifest-path src-tauri/Cargo.toml`.
- [ ] Run `npm run test -- --run`.
- [ ] Run `npm run build`.
- [ ] Complete the Windows, macOS, and Linux smoke checklists in
      `docs/smoke-tests/`.
- [ ] Review the staged diff for secrets and generated artifacts.
- [ ] Commit `chore(release): prepare version X.Y.Z`.
- [ ] Tag `vX.Y.Z` and push `main` plus the tag.

## GitHub draft release

- [ ] Wait for the Release workflow to finish.
- [ ] Confirm these assets exist:
  - Windows MSI
  - Windows NSIS setup
  - Windows portable `.exe`
  - macOS aarch64 DMG
  - Linux DEB
  - Linux AppImage
- [ ] Download and launch at least one installer per platform.
- [ ] Compare the asset names and version metadata with `X.Y.Z`.
- [ ] Paste the release-highlights list into the notes.
- [ ] Check known limitations and upgrade notes.
- [ ] Publish the draft.

## After publishing

- [ ] Verify the latest-release page and download links.
- [ ] Confirm the tag points at the release commit.
- [ ] Announce the release and open follow-up issues for deferred work.
