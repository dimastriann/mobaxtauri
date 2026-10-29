---
name: tauri-rust-bridge
description: Patterns for the Tauri IPC boundary between the React frontend and Rust backend in MobaXTauri. Use when adding or changing a Tauri command, the invoke_handler registration in lib.rs, any invoke() call site, src/types/ payload types, or moving logic across the Rust/TypeScript boundary.
---

# Tauri Rust bridge

The IPC surface lives in `src-tauri/src/lib.rs`: `#[tauri::command]` async
functions plus the `tauri::generate_handler!` registration list near the bottom
(ssh_* and sftp_* sessions/ops, credential_*, host-key trust, health, app-data
persistence, recording export). Payload contract types come from
`src-tauri/src/session_types.rs` on the Rust side and mirror `src/types/*.ts`
(`ssh.ts`, `sftp.ts` with colocated tests) on the frontend.

## Command checklist (adding or changing a command)

1. Implement the `#[tauri::command]` async fn in `lib.rs`, delegating logic to the right module (`ssh.rs`, `sftp_utils.rs`, `credentials.rs`, …). Commands stay thin; keep state behind `State<'_, AppState>`.
2. Register it in `generate_handler!` — an unregistered command fails silently at runtime with an "unrecognized command" invoke error, not at compile time.
3. Mirror the payload in `src/types/` (serde renames must match: Rust `snake_case` fields → the exact TS shape frontend code destructures).
4. Wire the frontend call site and update `src/types/*.test.ts` when the contract changes.
5. Backend gates (`cargo test`, clippy + fmt) then frontend gates (tsc, eslint, prettier, vitest) — both, since this always spans the stack.

## Call-site placement (follow the existing split)

- Stores own bounded, state-ish RPC: SFTP browsing/ops in `useSftpStore`, credential lifecycle in `useCredentialStore`, persistence snapshots via `load_app_data`/`save_app_data` in `useSessionStore`.
- `Terminal.tsx` owns the session lifecycle path: `ssh_connect`, `ssh_send_data`, `ssh_resize` — keystroke-to-IPC must stay direct in the component, never rerouted through a store (a deliberate architectural stay).
- Streaming backend→frontend data is event-driven: `ssh-data-<sessionId>` per-session payloads plus typed event constants (`SSH_SESSION_STATE_EVENT`, `SSH_HOST_KEY_EVENT` from `src/types/ssh.ts`). Use the same naming when adding streams; keep per-session events suffixed with the session id so parallel tabs stay isolated.

## Error contract

Commands return `Result<T, String>`; the string is a user-presentation message (or sentinel — see the ssh-security skill). Frontend treats `invoke` rejections as that string; never parse structured data out of error strings beyond the declared sentinels.

## Boundary rule

Rust-first (see AGENTS.md): new data transformation, aggregation, or policy goes into a Rust module with `#[cfg(test)]` coverage, not a TS helper. TypeScript keeps only what must live in the webview. When a bug crosses the bridge, fix the side that owns the fault.
