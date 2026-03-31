# MobaxTauri - Modern Remote Management Dashboard

An open-source, cross-platform alternative to MobaXterm built with Tauri v2, Rust, and Xterm.js.

## 🚀 Vision
MobaTauri aims to provide a lightweight (<10MB), GPU-accelerated, and highly customizable terminal for developers who need to manage multiple SSH, SFTP, and RDP sessions.

## 🛠 Features (Roadmap)
- [ ] **Multi-Tab Terminal:** High-performance terminal emulator using Xterm.js.
- [ ] **SSH Manager:** Secure credential storage using Tauri Stronghold.
- [ ] **SFTP Sidebar:** Drag-and-drop file management while connected via SSH.
- [ ] **Multi-Exec:** Send the same command to multiple servers at once.
- [ ] **Portable:** Zero-install executable for Windows, macOS, and Linux.
- [ ] **Session Portability:** Import/Export session configurations via JSON.
- [ ] **Secure Storage:** AES-256 encryption for exported session files.
- [ ] **MobaXterm Compatibility:** Import legacy .mxtsessions files.

## 🏗 Tech Stack
- **Engine:** [Tauri v2](https://v2.tauri.app/)
- **Core:** [Rust](https://www.rust-lang.org/)
- **Networking:** `russh` (SSH2 protocol) & `russh-sftp`
- **UI:** [React](https://react.dev/) + [Xterm.js](https://xtermjs.org/)
- **State:** [Zustand](https://github.com/pmndrs/zustand) (for managing active sessions)

## 📂 Project Structure
```text
├── src-tauri/          # Rust Backend logic
│   ├── src/
│   │   ├── main.rs     # App entry & Plugin init
│   │   └── ssh.rs      # SSH & SFTP implementations
│   └── Cargo.toml      # Rust dependencies
├── src/                # Frontend UI
│   ├── components/     # Terminal, Sidebar, TabBar
│   ├── store/          # Session management
│   └── App.tsx         # Main layout
└── README.md
```
