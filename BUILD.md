# Building and running 16Launcher

Русская версия: [BUILD.ru.md](BUILD.ru.md)

16Launcher is a Tauri 2 application: the backend is Rust (`src-tauri/`), the frontend is React 19 + TypeScript + Vite + Tailwind (`src/`).

## Requirements

| Tool | Version |
| --- | --- |
| Node.js | 22 (the version used in CI) with npm |
| Rust | stable toolchain, installed with [rustup](https://rustup.rs) |
| Java | optional, only for running Minecraft from a dev build; the launcher can download its own runtime |

### Windows

- Microsoft C++ Build Tools (the "Desktop development with C++" workload).
- WebView2 Runtime. It ships with Windows 11 and is preinstalled on most up-to-date Windows 10 systems.

### Linux

Debian/Ubuntu packages (same list as in CI):

```bash
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev build-essential curl wget file libssl-dev \
  libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libglib2.0-dev \
  pkg-config libwayland-dev libxkbcommon-dev wayland-protocols
```

On Arch Linux: `webkit2gtk-4.1 gtk3 libayatana-appindicator glib2 base-devel nodejs npm rust`.

### macOS

Xcode Command Line Tools (`xcode-select --install`). The minimum supported system version is 11.0.

## Getting the sources

```bash
git clone https://github.com/launcherdev11/rust-launcher.git
cd rust-launcher
npm ci
```

Rust dependencies are fetched by Cargo on the first build.

## Running in development

```bash
npm run tauri dev
```

This starts Vite on `http://localhost:1420` (via `beforeDevCommand`), builds the Rust part and opens the launcher window. Frontend changes are applied with hot reload; Rust changes trigger a rebuild and restart.

The first build compiles all Rust dependencies and takes a while. Later runs are incremental.

Other useful scripts:

| Command | What it does |
| --- | --- |
| `npm run dev` | Frontend only, in a browser. Tauri APIs are not available there, so most features will not work. |
| `npm run build` | `tsc && vite build`. This is also the frontend type check; the project has no ESLint or JS test runner. |
| `npm run preview` | Serves the built `dist/` locally. |
| `npm run tauri:raw -- <args>` | Calls the Tauri CLI directly, bypassing the AppImage wrapper script. |
| `npm run clean` | `tauri clean`, removes Rust build artifacts. |

`npm run tauri` goes through `scripts/tauri-with-appimage-fix.mjs`. On Linux, after `tauri build`, it runs `scripts/patch-appimage-wayland.sh` to patch the AppImage for Wayland. On other systems it is a plain pass-through to the Tauri CLI.

## Checks before a pull request

```bash
npm run build                      # TypeScript + Vite

cd src-tauri
cargo check --locked
cargo clippy --locked
cargo test                         # all unit tests
cargo test analysis_logs           # a single module or test by name
```

Unit tests live in inline `#[cfg(test)]` modules (for example in `curseforge` and `game/analysis_logs`); there is no `tests/` directory.

## Production build

```bash
npm run tauri build
```

The command runs `npm run build` first (`beforeBuildCommand`), then compiles the Rust crate in release mode and produces installers in `src-tauri/target/release/bundle/`.

Bundle targets are set in `src-tauri/tauri.conf.json`: `nsis`, `appimage`, `deb`, `rpm`, `dmg`. Each OS builds only the formats it supports:

| OS | Output |
| --- | --- |
| Windows | NSIS installer (`.exe`) |
| Linux | AppImage, `.deb`, `.rpm` |
| macOS | `.dmg` |

To build a single format, pass `--bundles`:

```bash
npm run tauri build -- --bundles nsis
```

To get only the executable without installers, use `--no-bundle`. The binary is written to `src-tauri/target/release/`.

### Updater signing

`createUpdaterArtifacts` is enabled, so a full `tauri build` signs update artifacts and needs the private updater key in the environment:

```bash
export TAURI_SIGNING_PRIVATE_KEY="<key contents or path to the key file>"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="<password, if the key has one>"
```

The matching public key is already in `tauri.conf.json` (`plugins.updater.pubkey`). The private key is held by the maintainers and is not stored in the repository.

For a local build without the key, disable updater artifacts with a config override. Save this as `local.conf.json` outside the repository tree (or in a path ignored by git):

```json
{ "bundle": { "createUpdaterArtifacts": false } }
```

and pass it to the build:

```bash
npm run tauri build -- --config path/to/local.conf.json
```

### Arch Linux package

`packaging/archlinux/` contains a `PKGBUILD` and a `.desktop` file. The package builds the frontend and the release binary against the system WebKitGTK:

```bash
cd packaging/archlinux
makepkg -si
```

## Configuration through environment variables

The Rust side loads a `.env` file at startup. It looks in the current directory and its parents, next to the executable, and in `src-tauri/`. Values from `.env` override variables that are already set. The file is ignored by git.

| Variable | Purpose |
| --- | --- |
| `PLATFORM_API_BASE_URL` | Platform API base URL used by the Rust side. Falls back to `VITE_API_BASE_URL`, then to `https://api.16-launcher.ru`. |
| `VITE_API_BASE_URL` | Same for the frontend. It is read by Vite at build time, so restart the dev server after changing it. |
| `DISCORD_APPLICATION_ID` | Discord Rich Presence application ID. A built-in default is used when it is not set. |
| `DISCORD_RPC_LARGE_IMAGE_KEY`, `DISCORD_RPC_SMALL_IMAGE_KEY` | Rich Presence image keys. |
| `MS_CLIENT_SECRET` | Optional secret for the Microsoft OAuth application. |
| `PROXY_HOST`, `PROXY_HOSTS`, `PROXY_HOST_FORGE_IPV6` | Proxy hosts used for game traffic (`PROXY_HOSTS` is a comma-separated list). |

Example `.env` for working against a local API:

```env
PLATFORM_API_BASE_URL=http://127.0.0.1:8080
VITE_API_BASE_URL=http://127.0.0.1:8080
```

If you point the launcher to another host, add it to `connect-src` in the CSP section of `src-tauri/tauri.conf.json`. Localhost addresses are already allowed.

## Platform backend

The `backend/` directory (accounts, friends, rooms, presence) is not part of this repository and is managed separately. The launcher uses the public API at `https://api.16-launcher.ru` by default, so you do not need to run the backend to work on the launcher.

## Releases

1. Update the version in all three files and keep them identical: `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`.
2. Run the **Release Tauri** workflow (`.github/workflows/release-tauri.yml`) from the Actions tab. It builds Windows, Linux and macOS bundles with `tauri-action` and creates a GitHub release tagged `v<version>`. Versions containing `beta` or `rc` are marked as pre-releases.
3. The workflow expects these repository secrets: `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, `DISCORD_APPLICATION_ID`, `DISCORD_RPC_LARGE_IMAGE_KEY`.

The updater reads `latest.json` from the GitHub release, with `https://api.16-launcher.ru/releases/latest.json` as a mirror.

## Troubleshooting

- **Port 1420 is busy.** Vite runs with `strictPort`, so it fails instead of picking another port. Stop the process that holds the port.
- **`webkit2gtk-4.1` or `javascriptcoregtk` not found on Linux.** Install the packages from the list above; the 4.1 series is required.
- **`A public key has been found, but no private key`.** The build tried to sign updater artifacts. Set `TAURI_SIGNING_PRIVATE_KEY` or disable `createUpdaterArtifacts` as described above.
- **Disk space.** `src-tauri/target/` grows to several gigabytes. `npm run clean` removes it.
