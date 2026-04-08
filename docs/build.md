### Local build of **16Launcher**

### 🛠️ Prerequisites

Ensure you have the following installed:
*   **Node.js**: Version 22 or higher.
*   **Rust**: Latest stable version (`rustup` recommended).
*   **Git**: For cloning the repository.

---

### 1. Install System Dependencies

The build requires specific system libraries depending on your OS.

#### **Linux (Fedora/RHEL)**
```bash
sudo dnf install webkit2gtk4.1-devel gtk4-devel libadwaita-devel libsoup3-devel javascriptcoregtk4.1-devel openssl-devel libappindicator-gtk3-devel librsvg2-devel pkg-config gcc make
```

#### **Linux (Ubuntu/Debian)**
```bash
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-4-dev libadwaita-1-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev pkg-config build-essential
```

#### **macOS** (not tested yet)
Ensure Xcode Command Line Tools are installed:
```bash
xcode-select --install
```

#### **Windows** (not tested yet)
*   Install **Microsoft C++ Build Tools**.
*   Install **WebView2** (usually pre-installed on Win10/11).

---

### 2. Clone and Install

Clone the repository and install Node.js dependencies:

```bash
git clone https://github.com/trassert/rust-launcher.git
cd rust-launcher

# Install frontend dependencies
npm install

# Frontend build
npm run build

# Build full
npm run tauri build
```