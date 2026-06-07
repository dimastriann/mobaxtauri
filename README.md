# MobaXTauri

> A lightweight, cross-platform SSH terminal & SFTP manager — inspired by MobaXterm, built with Tauri v2 and Rust.

[![Release](https://img.shields.io/github/v/release/dimastriann/mobaxtauri?style=flat-square)](https://github.com/dimastriann/mobaxtauri/releases)
[![License](https://img.shields.io/github/license/dimastriann/mobaxtauri?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue?style=flat-square)](#-download)

---

## ✨ Features

| Feature | Description |
| :--- | :--- |
| 🖥️ **Multi-Tab SSH Terminal** | High-performance terminal via Xterm.js with tab management |
| 🔄 **Background Terminals** | Keep active connections mounted; switch tabs and views without disconnecting |
| 🐧 **Dynamic OS Detection** | Auto-detect SSH host OS versions (Ubuntu, Debian, macOS, Windows, etc.) to update icons |
| 📁 **Session Manager** | Organize sessions into folders with drag-and-drop support |
| 🔐 **Secure Password Vault** | Passwords stored encrypted using Tauri Stronghold + Argon2id — never plain-text |
| 📂 **SFTP File Explorer** | Browse, upload, download, rename, and delete remote files |
| 🏷️ **Session Tagging** | Tag sessions as `prod`, `staging`, or `dev` with visual corner ribbons |
| 🧩 **Snippets** | Save and execute frequently-used commands from the sidebar |
| 💾 **Session Export / Import** | Back up and restore your full session library as a JSON file |
| 🔄 **Import from SSH Config** | Import existing sessions directly from `~/.ssh/config` |
| 📥 **Import from MobaXterm** | Import bookmarks from a MobaXterm `.ini` export file |
| ⚡ **Quick Connect** | Connect instantly using `user@host` or `user@host:port` syntax from the title bar |
| 📱 **Responsive Dashboard** | Adaptive layout shifting Stats & Environments based on display size |
| 🌗 **Dark Mode** | Full dark theme support with Chakra UI v3 |
| 🪶 **Lightweight** | Single binary, no Electron — under 10 MB for the core app |

---

## 📥 Download

Download the latest release for your platform from the [Releases page](https://github.com/yourusername/mobaxtauri/releases):

| Platform | Installer | Portable |
| :--- | :--- | :--- |
| **Windows** | `MobaXTauri_x64-setup.exe` (NSIS) or `.msi` | `MobaXTauri_Portable.exe` ✅ |
| **macOS** | `MobaXTauri.dmg` | — |
| **Linux** | `mobaxtauri_amd64.deb` | `mobaxtauri_amd64.AppImage` ✅ |

> **Windows Portable**: No installation required — just download and run `MobaXTauri_Portable.exe`.
> **Linux Portable**: The `.AppImage` is a fully self-contained executable.

---

## 💻 Getting Started (Development)

### Prerequisites
- [Node.js](https://nodejs.org/) v20+
- [Rust](https://www.rust-lang.org/) (stable toolchain)
- **Linux only**: system WebKit libraries

```bash
sudo apt-get install -y libgtk-3-dev libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
```

### Run in Development Mode

```bash
# 1. Clone the repository
git clone https://github.com/yourusername/mobaxtauri.git
cd mobaxtauri

# 2. Install frontend dependencies
npm install

# 3. Start the dev server + Tauri window
npm run tauri dev
```

### Build for Production (Local)

```bash
npm run tauri build
```

Installers will be output to:
```
src-tauri/target/release/bundle/
```

---

## 🛠 Available Scripts

| Command | Description |
| :--- | :--- |
| `npm run tauri dev` | Start development mode |
| `npm run tauri build` | Build release bundles for the current platform |
| `npm run test` | Run Vitest frontend unit tests |
| `npm run lint` | Lint frontend TypeScript/TSX with ESLint |
| `npm run lint:fix` | Auto-fix linting issues |
| `npm run format` | Format frontend code with Prettier |
| `npm run format:check` | Check formatting without writing |
| `npm run lint:rust` | Run Clippy on the Rust backend |
| `npm run format:rust` | Format Rust code with `cargo fmt` |
| `npm run project:check` | Full project validation (TS + ESLint + Prettier + Clippy) |

---

## 🔐 Secure Password Vault

Passwords are **never** stored in plain text. When you enable "Save Password Securely in Vault" on a session:

- The password is encrypted using **Tauri Stronghold** with an **Argon2id** key derivation.
- The vault file is stored locally at the app data path (see below).
- Session files (`sessions.bin`) are fully scrubbed of any password data.
- On first launch, any legacy plain-text passwords in old session files are **automatically migrated** to the vault.

---

## 📂 Data Storage Locations

All data is stored locally on your machine. Nothing is sent to any external server.

| Data | Windows | macOS | Linux |
| :--- | :--- | :--- | :--- |
| Sessions & folders | `%APPDATA%\com.dn201.mobaxtauri\sessions.bin` | `~/Library/Application Support/com.dn201.mobaxtauri/sessions.bin` | `~/.config/com.dn201.mobaxtauri/sessions.bin` |
| Encrypted vault | `%APPDATA%\com.dn201.mobaxtauri\vault.hold` | `~/Library/Application Support/com.dn201.mobaxtauri/vault.hold` | `~/.config/com.dn201.mobaxtauri/vault.hold` |

---

## 📂 Project Structure

```text
mobaxtauri/
├── src/                        # React frontend
│   ├── components/
│   │   ├── Terminal.tsx        # SSH terminal with xterm.js
│   │   ├── Sidebar.tsx         # Session, snippet, SFTP tabs
│   │   ├── SftpSidebar.tsx     # Remote file explorer
│   │   ├── NewSessionModal.tsx # Create/edit session form
│   │   ├── TabBar.tsx          # Multi-tab management
│   │   ├── TitleBar.tsx        # Quick connect & window controls
│   │   ├── ContextMenu.tsx     # Right-click menus
│   │   ├── OSIcon.tsx          # Dynamic OS status icon
│   │   └── Dashboard.tsx       # Main analytics & folders dashboard
│   ├── store/
│   │   ├── useSessionStore.ts  # Sessions, folders, snippets state
│   │   ├── useCredentialStore.ts # Stronghold vault wrapper
│   │   └── useSftpStore.ts     # SFTP browsing state
│   ├── hooks/
│   │   └── useExportImport.ts  # Session backup & import logic
│   └── utils/
│       └── importParsers.ts    # SSH config & MobaXterm INI parsers
│
└── src-tauri/                  # Rust backend
    ├── src/
    │   ├── main.rs             # App entry point
    │   ├── lib.rs              # Tauri commands & plugin setup
    │   ├── ssh.rs              # SSH session management
    │   └── sftp_utils.rs       # SFTP path utilities
    ├── capabilities/
    │   └── default.json        # Tauri permission declarations
    ├── icons/                  # App icons (all platforms)
    └── Cargo.toml              # Rust dependencies
```

---

## 🚀 Automated Releases

Releases are built automatically via GitHub Actions for all three platforms when a tag is pushed:

```bash
git tag v0.2.0
git push origin v0.2.0
```

The workflow will:
1. Run all frontend tests (Vitest) and backend tests (`cargo test`)
2. Build platform-specific installers using `tauri-action`
3. Package a **Windows Portable** `.exe` and attach it to the same release draft
4. Create a GitHub Release draft — you review it then publish

---

## 🏗 Tech Stack

| Layer | Technology |
| :--- | :--- |
| **Desktop Runtime** | [Tauri v2](https://v2.tauri.app/) |
| **Backend** | [Rust](https://www.rust-lang.org/) |
| **SSH / SFTP** | [`russh`](https://github.com/warp-tech/russh) + `russh-sftp` |
| **Credential Security** | [`tauri-plugin-stronghold`](https://github.com/tauri-apps/tauri-plugin-stronghold) + `argon2` |
| **UI Framework** | [React 19](https://react.dev/) + [Chakra UI v3](https://chakra-ui.com/) |
| **Terminal** | [Xterm.js](https://xtermjs.org/) |
| **State Management** | [Zustand](https://github.com/pmndrs/zustand) |
| **Build Tool** | [Vite](https://vitejs.dev/) |
| **Testing** | [Vitest](https://vitest.dev/) + Testing Library |

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.
