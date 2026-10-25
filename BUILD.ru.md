# Запуск и сборка 16Launcher

English version: [BUILD.md](BUILD.md)

16Launcher — приложение на Tauri 2: бэкенд на Rust (`src-tauri/`), фронтенд на React 19 + TypeScript + Vite + Tailwind (`src/`).

## Требования

| Инструмент | Версия |
| --- | --- |
| Node.js | 22 (как в CI) вместе с npm |
| Rust | stable, устанавливается через [rustup](https://rustup.rs) |
| Java | необязательно, нужна только для запуска Minecraft из dev-сборки; лаунчер умеет скачивать свою |

### Windows

- Microsoft C++ Build Tools (рабочая нагрузка «Разработка классических приложений на C++»).
- WebView2 Runtime. Он входит в Windows 11 и есть на большинстве обновлённых Windows 10.

### Linux

Пакеты для Debian/Ubuntu (тот же список, что в CI):

```bash
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev build-essential curl wget file libssl-dev \
  libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libglib2.0-dev \
  pkg-config libwayland-dev libxkbcommon-dev wayland-protocols
```

Для Arch Linux: `webkit2gtk-4.1 gtk3 libayatana-appindicator glib2 base-devel nodejs npm rust`.

### macOS

Xcode Command Line Tools (`xcode-select --install`). Минимальная версия системы — 11.0.

## Получение исходников

```bash
git clone https://github.com/launcherdev11/rust-launcher.git
cd rust-launcher
npm ci
```

Зависимости Rust Cargo скачает при первой сборке.

## Запуск для разработки

```bash
npm run tauri dev
```

Команда поднимает Vite на `http://localhost:1420` (через `beforeDevCommand`), собирает Rust-часть и открывает окно лаунчера. Изменения фронтенда применяются без перезапуска, при изменении Rust приложение пересобирается и перезапускается.

Первая сборка компилирует все зависимости Rust и занимает заметное время, последующие инкрементальные.

Остальные скрипты:

| Команда | Что делает |
| --- | --- |
| `npm run dev` | Только фронтенд, в браузере. API Tauri там недоступны, поэтому большая часть функций не работает. |
| `npm run build` | `tsc && vite build`. Это же проверка типов фронтенда: ESLint и JS-тестов в проекте нет. |
| `npm run preview` | Локально отдаёт собранный `dist/`. |
| `npm run tauri:raw -- <аргументы>` | Вызывает Tauri CLI напрямую, минуя обёртку для AppImage. |
| `npm run clean` | `tauri clean`, удаляет артефакты сборки Rust. |

`npm run tauri` запускается через `scripts/tauri-with-appimage-fix.mjs`. На Linux после `tauri build` он вызывает `scripts/patch-appimage-wayland.sh`, который патчит AppImage для Wayland. На остальных системах это обычная передача аргументов в Tauri CLI.

## Проверки перед pull request

```bash
npm run build                      # TypeScript + Vite

cd src-tauri
cargo check --locked
cargo clippy --locked
cargo test                         # все unit-тесты
cargo test analysis_logs           # один модуль или тест по имени
```

Unit-тесты лежат во встроенных модулях `#[cfg(test)]` (например, в `curseforge` и `game/analysis_logs`). Каталога `tests/` нет.

## Production-сборка

```bash
npm run tauri build
```

Сначала выполняется `npm run build` (`beforeBuildCommand`), затем крейт Rust собирается в release-режиме, а установщики появляются в `src-tauri/target/release/bundle/`.

Форматы бандлов заданы в `src-tauri/tauri.conf.json`: `nsis`, `appimage`, `deb`, `rpm`, `dmg`. Каждая ОС собирает только поддерживаемые ей форматы:

| ОС | Результат |
| --- | --- |
| Windows | установщик NSIS (`.exe`) |
| Linux | AppImage, `.deb`, `.rpm` |
| macOS | `.dmg` |

Чтобы собрать один формат, передайте `--bundles`:

```bash
npm run tauri build -- --bundles nsis
```

Чтобы получить только исполняемый файл без установщиков, используйте `--no-bundle`. Бинарник окажется в `src-tauri/target/release/`.

### Подпись обновлений

Включён `createUpdaterArtifacts`, поэтому полная `tauri build` подписывает артефакты обновлений и требует приватный ключ апдейтера в окружении:

```bash
export TAURI_SIGNING_PRIVATE_KEY="<содержимое ключа или путь к файлу>"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="<пароль, если он задан>"
```

Публичный ключ уже прописан в `tauri.conf.json` (`plugins.updater.pubkey`). Приватный ключ хранится у мейнтейнеров и в репозитории его нет.

Для локальной сборки без ключа отключите артефакты обновлений через переопределение конфига. Сохраните файл `local.conf.json` вне дерева репозитория (или по пути, который игнорирует git):

```json
{ "bundle": { "createUpdaterArtifacts": false } }
```

и передайте его в сборку:

```bash
npm run tauri build -- --config path/to/local.conf.json
```

### Пакет для Arch Linux

В `packaging/archlinux/` лежат `PKGBUILD` и `.desktop`-файл. Пакет собирает фронтенд и release-бинарник на системном WebKitGTK:

```bash
cd packaging/archlinux
makepkg -si
```

## Настройка через переменные окружения

Rust-часть при старте читает файл `.env`. Поиск идёт в текущем каталоге и его родителях, рядом с исполняемым файлом и в `src-tauri/`. Значения из `.env` перекрывают уже заданные переменные. Сам файл игнорируется git.

| Переменная | Назначение |
| --- | --- |
| `PLATFORM_API_BASE_URL` | Базовый URL API платформы для Rust-части. Если не задана, берётся `VITE_API_BASE_URL`, затем `https://api.16-launcher.ru`. |
| `VITE_API_BASE_URL` | То же для фронтенда. Vite читает её при сборке, поэтому после изменения перезапустите dev-сервер. |
| `DISCORD_APPLICATION_ID` | ID приложения Discord Rich Presence. Без неё используется встроенное значение. |
| `DISCORD_RPC_LARGE_IMAGE_KEY`, `DISCORD_RPC_SMALL_IMAGE_KEY` | Ключи изображений Rich Presence. |
| `MS_CLIENT_SECRET` | Необязательный секрет приложения Microsoft OAuth. |
| `PROXY_HOST`, `PROXY_HOSTS`, `PROXY_HOST_FORGE_IPV6` | Хосты прокси для игрового трафика (`PROXY_HOSTS` — список через запятую). |

Пример `.env` для работы с локальным API:

```env
PLATFORM_API_BASE_URL=http://127.0.0.1:8080
VITE_API_BASE_URL=http://127.0.0.1:8080
```

Если указываете другой хост, добавьте его в `connect-src` секции CSP в `src-tauri/tauri.conf.json`. Адреса localhost там уже разрешены.

## Бэкенд платформы

Каталог `backend/` (аккаунты, друзья, комнаты, присутствие) не входит в этот репозиторий и ведётся отдельно. По умолчанию лаунчер использует публичный API `https://api.16-launcher.ru`, поэтому для работы над лаунчером бэкенд поднимать не нужно.

## Релизы

1. Обновите версию в трёх файлах и держите её одинаковой: `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`.
2. Запустите workflow **Release Tauri** (`.github/workflows/release-tauri.yml`) на вкладке Actions. Он собирает бандлы для Windows, Linux и macOS через `tauri-action` и создаёт GitHub release с тегом `v<версия>`. Версии с `beta` или `rc` помечаются как pre-release.
3. Для workflow нужны секреты репозитория: `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, `DISCORD_APPLICATION_ID`, `DISCORD_RPC_LARGE_IMAGE_KEY`.

Апдейтер читает `latest.json` из GitHub release, зеркало — `https://api.16-launcher.ru/releases/latest.json`.

## Частые проблемы

- **Порт 1420 занят.** Vite запускается с `strictPort` и не выбирает другой порт, а завершается с ошибкой. Остановите процесс, который держит порт.
- **Не найден `webkit2gtk-4.1` или `javascriptcoregtk` на Linux.** Установите пакеты из списка выше, нужна именно серия 4.1.
- **`A public key has been found, but no private key`.** Сборка пытается подписать артефакты обновлений. Задайте `TAURI_SIGNING_PRIVATE_KEY` или отключите `createUpdaterArtifacts`, как описано выше.
- **Много места занимает `src-tauri/target/`.** Каталог вырастает до нескольких гигабайт. Очистить его можно командой `npm run clean`.
