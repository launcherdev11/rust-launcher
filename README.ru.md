<p align="center">
  <a href="https://16-launcher.ru"><img src=".github/readme/readme.png" alt="16Launcher"></a>
  <h1 align="center">16Launcher</h1>
<p align="center">
  <em>Надежный кроссплатформенный лаунчер для Minecraft. Встроенная установка модов, продвинутая оптимизация и продуманный интерфейс. Легкий, стабильный, с гибкими настройками для полного контроля над игрой.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/react-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" />
  <img src="https://img.shields.io/badge/typescript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/Rust-CE422B?style=for-the-badge&logo=rust&logoColor=white" />
  <img src="https://img.shields.io/badge/Tauri-FFC131?style=for-the-badge&logo=tauri&logoColor=white" />
</p>

---

**Исходный код**: [https://github.com/launcherdev11/rust-launcher](https://github.com/launcherdev11/rust-launcher)

**Сайт**: [https://16-launcher.ru](https://16-launcher.ru)

---
<p align="center">
<img src=".github/readme/about.png" alt="about">
</p>
---
    
**16Launcher** - Надежный кроссплатформенный лаунчер для Minecraft. Встроенная установка модов, продвинутая оптимизация и продуманный интерфейс. Легкий, стабильный, с гибкими настройками для полного контроля над игрой.

**Языки**: [English](README.md)

## Установка

1. Скачайте последнюю версию установщика с [официального сайта](https://16-launcher.ru)
2. Запустите установщик и следуйте инструкциям
3. Откройте 16Launcher и начинайте играть!

## Особенности

- **Скорость и оптимизация**: Быстрый запуск и плавная работа.
- **Поддержка версий**: Играйте на любой версии Minecraft.
- **Безопасность**: Высокая безопасность данных, игры и вашего компьютера.
- **Управление контентом**: Легкая установка и контроль над контентом.
- **Кастомные темы**: Можно ставить и создавать свои CSS-темы.

## Быстрый старт

1. **Скачайте** лаунчер с нашего [официального сайта](https://16-launcher.ru)
2. **Устанавливайте**, следуя инструкциям инсталлятора. 
3. **Выберите** версию игры.
4. **Нажмите играть** и вперед играть!

# Скриншоты

![readme_screen.png](.github/readme/readme_screen.png)
![readme_screen2.png](.github/readme/readme_screen2.png)
![readme_screen3.png](.github/readme/readme_screen3.png)
![readme_screen4.png](.github/readme/readme_screen4.png)
![readme_screen5.png](.github/readme/readme_screen5.png)
![readme_screen6.png](.github/readme/readme_screen6.png)
![readme_screen7.png](.github/readme/readme_screen7.png)
![readme_screen8.png](.github/readme/readme_screen8.png)
![readme_screen9.png](.github/readme/readme_screen9.png)

## Сборка из исходников

Лаунчер написан на Tauri 2: бэкенд на Rust лежит в `src-tauri/`, фронтенд на React 19 + TypeScript + Vite + Tailwind — в `src/`.

Понадобятся Node.js 22, стабильный тулчейн Rust и системные библиотеки для Tauri (WebView2 и MSVC Build Tools на Windows, WebKitGTK 4.1 на Linux).

```bash
npm ci
npm run tauri dev      # запуск в режиме разработки
npm run tauri build    # установщики появятся в src-tauri/target/release/bundle/
```

Подробная инструкция с зависимостями для разных систем, переменными окружения, подписью обновлений и процессом релиза — в [BUILD.ru.md](BUILD.ru.md).

## Поддержка

- Email: 16launcher@gmail.com
- Сайт: [https://16-launcher.ru](https://16-launcher.ru)
- Issues: [GitHub Issues](https://github.com/launcherdev11/rust-launcher/issues)

## Лицензия

Проект лицензирован GPL-3.0.