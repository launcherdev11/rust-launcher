<p align="center">
    <a href="README.md">English version of README</a>
  <a href="https://16luncher.ru"><img src="assets/readme.png" alt="16Launcher"></a>
  <h1 align="center">16Launcher</h1>
<p align="center">
  <em>Оптимизированный лаунчер Minecraft для создания сборок, прямой загрузки модов и запуска игры с пользовательскими настройками.</em>
</p>

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20Linux%20%7C%20MacOS-lightgrey.svg" alt="Platform">
  <img src="https://img.shields.io/badge/Downloads-30K+-brightgreen.svg" alt="Downloads">
</p>

---

**EN Readme**: [EN](README.md)

**Исходный код**: [https://github.com/launcherdev11/rust-launcher](https://github.com/launcherdev11/rust-launcher)

**Веб-сайт**: [https://16luncher.ru](https://16luncher.ru)

---
    
**16Launcher** — это оптимизированный лаунчер Minecraft для создания сборок модов, прямой загрузки модов и запуска игры с пользовательскими настройками.

## Установка

1. Скачайте последний установщик с [официального веб-сайта](https://16luncher.ru)
2. Запустите установщик и следуйте инструкциям по установке
3. Запустите 16Launcher и начните играть!

### Arch Linux (системный WebKit)

Для Arch добавлен `PKGBUILD`, который собирает лаунчер с системными библиотеками (`webkit2gtk-4.1`), без AppImage-рантайма.

```bash
cd packaging/archlinux
makepkg -si
```

Для `npm run tauri dev` на Arch также нужны системные пакеты:

```bash
sudo pacman -S --needed base-devel git npm webkit2gtk-4.1 gtk3 libayatana-appindicator gstreamer gst-plugins-base gst-plugins-good xorg-xwayland
```

Проверка GStreamer (без `autoaudiosink` WebKit падает при звуке UI):

```bash
gst-inspect-1.0 autoaudiosink
```

На Hyprland / Wayland с AMD или NVIDIA WebKitGTK может падать при запуске игры. Лаунчер по умолчанию переключает UI на XWayland (`GDK_BACKEND=x11`) и отключает GPU-ускорение WebKit. Если нужен нативный Wayland или GPU WebKit:

```bash
MC16LAUNCHER_ALLOW_WAYLAND=1 MC16LAUNCHER_WEBKIT_GPU=1 npm run tauri dev
```

## Возможности

- **Быстрый и оптимизированный**: Быстрый запуск и плавная работа
- **Поддержка нескольких версий**: Играйте в любую версию Minecraft от классической до самой последней
- **Безопасность**: Регулярные обновления и патчи безопасности
- **Управление модами**: Простая установка и организация модов

## Быстрый старт

1. **Скачайте** лаунчер с нашего [официального веб-сайта](https://16luncher.ru)
2. **Установите**, следуя инструкциям для вашей операционной системы
3. **Выберите** предпочтительную версию Minecraft
4. **Нажмите «Играть»** и наслаждайтесь!

## Поддержка

- Email: 16launcher@gmail.com
- Веб-сайт: [https://16luncher.ru](https://16luncher.ru)
- Проблемы (Issues): [GitHub Issues](https://github.com/launcherdev11/rust-launcher/issues)

## Лицензия

Этот проект лицензирован на условиях лицензии GPL-3.0.