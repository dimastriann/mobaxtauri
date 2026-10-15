---
name: terminal-session-management
description: Invariants for SSH session and tab lifecycle in MobaXTauri. Use when changing session_manager.rs, session_types.rs, useSessionStore, workspace save/restore, tab open/close in TabBar, Terminal reconnect flows, or anything mapping UI tabs to session IDs and backend channels.
---

# Terminal session management

Two owners split the lifecycle, and the seam matters:

- **Frontend (React/zustand)** owns *what the user sees*: `src/store/useSessionStore.ts` (sessions map, `openTabs`, `activeSessionId`, bell/activity status), `TabBar.tsx` (tab strip), `Terminal.tsx` (per-tab xterm). One tab always corresponds to exactly one `sessionId` — keep that bijection when adding split views, reuse, or bulk close.
- **Backend (Rust)** owns *what the server experiences*: `session_manager.rs` holds the live `HashMap<String, ManagedSshSession>`, hands out connection handles and shell channels, and runs the health loop emitting `emit_ssh_health`. Connect/disconnect decisions translate to `ssh_connect`/`ssh_disconnect` only.

## Invariants (do not break)

- Status is a projection, never a source: `SessionStatus` (`connecting/connected/error/disconnected`) is maintained by the frontend from command results and the `SSH_SESSION_STATE_EVENT` stream; session *restoration from disk* (`load_app_data`) intentionally strips status (`PersistedSession` omits it). Restoring a session must never resurrect a stale `connected` state.
- Keystrokes, password/passphrase intake, and reconnect banners live in `Terminal.tsx` and send through `ssh_send_data` — never introduce a store-side path (deliberate frontend stay; see AGENTS.md).
- Disconnect reasons come from `session_types.rs::SshDisconnectReason`. The `requested` reason is the frontend's own explicit close; any other reason triggers the reconnect banner path in `Terminal.tsx`. Adding a reason variant means updating the frontend handling in the same slice, or a tab silently shows the wrong banner.
- Tab close is a three-way unmount contract in `Terminal.tsx`: dispose xterm and listeners, `ssh_disconnect` the session, and drop the tab from `openTabs`. Any new close path (scripted cleanup, bulk close, palette actions) must trigger the same flow or the backend leaks a live connection.
- Health events are keyed by session id; a new per-session event stream must suffix `-<sessionId>` like the existing `ssh-data-` channel so parallel tabs don't cross-wire.

## Workspace persistence

Sessions/tabs persist via `save_app_data`/`load_app_data` in Rust (`persistence.rs`-backed, plaintext app config — no secrets may ride along; credentials live in the vault per the ssh-security skill). Changes to the persisted shape must bump `PersistedAppData` handling on both sides in the same commit so a rollback restore still loads.

## Tested areas

- Rust: inline `#[cfg(test)] tests` in `session_manager.rs` and `session_types.rs` cover lifecycle edges (empty manager, insert/replace semantics).
- Frontend: colocated vitest files (`useSessionStore.test.ts`, `TabBar` interactions elsewhere in `src/components/`); keep store-level slicing rules (tab add/remove/status changes) tested at the store, not in component snapshots.
