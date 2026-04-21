# MobaXTauri - Modern Remote Management Dashboard

An open-source, cross-platform alternative to MobaXterm built with **Tauri v2**, **Rust**, and **Xterm.js**.

## 🚀 Vision
MobaXTauri aims to provide a lightweight (<10MB), GPU-accelerated, and highly customizable terminal for developers who need to manage multiple SSH, SFTP, and local sessions.

## 🛠 Features
- **Multi-Tab Terminal:** High-performance terminal emulator using Xterm.js.
- **SSH Manager:** Secure session management with custom folder grouping.
- **SFTP Sidebar:** Fully integrated file manager for SSH sessions with upload, download, and file manipulation.
- **Native Experience:** Native dialogs, context menus, and window management.
- **Theme Sync:** Dynamic light/dark mode support across all components.

---

## 💻 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v20+)
- [Rust](https://www.rust-lang.org/) (Stable)
- **Linux only**: `libgtk-3-dev`, `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`

### Development Mode
1. **Clone the repository**:
   ```bash
   git clone https://github.com/yourusername/mobaxtauri.git
   cd mobaxtauri
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Run in development**:
   ```bash
   npm run tauri dev
   ```

---

## 📦 Building and Releases

### Local Build
To create a production executable for your current platform:
```bash
npm run tauri build
```
Once complete, the installers will be available in:
`src-tauri/target/release/bundle/`

### Automated Releases
MobaXTauri uses GitHub Actions for automated cross-platform releases.
- **Trigger**: Pushing a tag starting with `v*` (e.g., `v0.1.0`) will trigger a full build for Windows, macOS, and Linux.
- **Artifacts**: Binaries and installers are automatically attached to a GitHub Release draft.

---

## 📂 Data Storage & Save Locations

MobaXTauri respects system standards for data storage. All sensitive session configuration is stored locally on your machine.

### 🔐 Session Data (`sessions.bin`)
Your session profiles, folder structures, and settings are saved in a binary format managed by `tauri-plugin-store`.

- **Windows**: `%APPDATA%\com.dn201.mobaxtauri\sessions.bin`
- **macOS**: `~/Library/Application Support/com.dn201.mobaxtauri/sessions.bin`
- **Linux**: `~/.config/com.dn201.mobaxtauri/sessions.bin`

### 📥 SFTP Downloads
When you download a file via the SFTP Sidebar, a **native save dialog** will appear.
- There is no default "hidden" download folder.
- You explicitly choose the destination for every file to ensure privacy and organization.

---

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

## 🏗 Tech Stack
- **Engine:** [Tauri v2](https://v2.tauri.app/)
- **Core:** [Rust](https://www.rust-lang.org/)
- **Networking:** `russh` (SSH2 protocol) & `russh-sftp`
- **UI:** [React](https://react.dev/) + [Chakra UI v3](https://chakra-ui.com/)
- **Terminal:** [Xterm.js](https://xtermjs.org/)
- **State:** [Zustand](https://github.com/pmndrs/zustand)
