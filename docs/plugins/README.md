# Плагины 16Launcher

16Launcher поддерживает **пользовательские плагины** — расширения, которые устанавливаются в папку данных лаунчера без пересборки приложения.

Плагины могут:

- добавлять вкладку в боковое меню (UI-панель на JavaScript);
- подписываться на события жизненного цикла (`launcher_ready`, `pre_launch`, `post_launch`);
- объявлять декларативные хуки запуска через `hooks/pre_launch.json`;
- динамически задавать JVM/game аргументы перед запуском (с проверкой разрешений и фильтрацией опасных флагов);
- хранить собственную конфигурацию в `plugins-state.json`.

---

## Быстрый старт

### 1. Откройте папку плагинов

**Настройки → Лаунчер → Плагины → «Открыть папку»**

Или вручную:

| ОС | Путь |
|----|------|
| Windows | `%APPDATA%\16Launcher\plugins\` |
| Linux | `~/.local/share/16Launcher/plugins/` |
| macOS | `~/Library/Application Support/16Launcher/plugins/` |

### 2. Скопируйте пример

Скопируйте папку [`example-plugin`](./example-plugin/) целиком в каталог `plugins/`:

```
plugins/
  example-hello/          ← имя папки может быть любым
    plugin.json           ← обязателен
    main.js
    hooks/
      pre_launch.json
```

> **Важно:** идентификатор плагина берётся из поля `id` в `plugin.json`, а не из имени папки.

### 3. Перезагрузите плагины

В настройках нажмите **«Перезагрузить»** или перезапустите лаунчер.

### 4. Проверьте результат

- В боковом меню появится вкладка **Hello** (если плагин включён).
- При запуске игры в JVM добавятся флаги из хука и из `main.js`.

---

## Структура документации

| Документ | Содержание |
|----------|------------|
| [INSTALLATION.md](./INSTALLATION.md) | Установка, обновление, удаление, отладка |
| [MANIFEST.md](./MANIFEST.md) | Полная схема `plugin.json` |
| [API.md](./API.md) | JavaScript API для `main.js` |
| [HOOKS.md](./HOOKS.md) | События и декларативные хуки запуска |
| [PERMISSIONS.md](./PERMISSIONS.md) | Система разрешений |
| [EXAMPLES.md](./EXAMPLES.md) | Готовые рецепты и шаблоны |

---

## Минимальный плагин

**`plugins/my-plugin/plugin.json`:**

```json
{
  "api_version": 1,
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "Краткое описание",
  "author": "Ваше имя",
  "entry": "main.js",
  "hooks": [],
  "permissions": [],
  "ui": { "sidebar": false, "settings_section": false },
  "defaults": { "enabled": true, "config": {} }
}
```

**`plugins/my-plugin/main.js`:**

```javascript
function register(api) {
  api.log("Плагин загружен");
}
```

Этого достаточно, чтобы плагин появился в списке (без UI-вкладки).

---

## Архитектура

```
┌─────────────────────────────────────────────────────────┐
│                     16Launcher (Tauri)                   │
├─────────────────────────────────────────────────────────┤
│  Frontend (React)          │  Backend (Rust)            │
│  ─────────────────         │  ──────────────            │
│  PluginHost                │  services/plugins/         │
│  registry.ts (load JS)     │    registry.rs (discovery) │
│  PluginsManager (UI)       │    hooks.rs (pre/post)     │
│                            │    commands.rs (invoke)    │
├─────────────────────────────────────────────────────────┤
│  %DATA%/16Launcher/plugins/<folder>/                     │
│    plugin.json  main.js  hooks/  icon.png               │
│  %DATA%/16Launcher/plugins-state.json                   │
└─────────────────────────────────────────────────────────┘
```

### Поток запуска игры с плагинами

1. Лаунчер собирает JVM и game аргументы.
2. **pre_launch (Rust):** читает `hooks/pre_launch.json` у включённых плагинов.
3. **pre_launch (Rust):** применяет runtime-override из `setLaunchOverrides()` (JS).
4. **pre_launch (event):** отправляет `plugin:pre-launch` во frontend.
5. Игра запускается.
6. **post_launch:** событие `plugin:post-launch` с PID процесса.

---

## Ограничения безопасности

Лаунчер **намеренно ограничивает** возможности плагинов:

- нельзя подменить classpath, natives path, javaagent (кроме встроенного authlib-injector);
- JVM-флаги проходят через тот же фильтр, что и пользовательские настройки Java;
- плагины не могут выполнять произвольные Rust-команды — только задокументированный JS API и `api.invoke()` к существующим Tauri-командам;
- секреты (API-ключи) не должны храниться в `plugin.json` — используйте `.env` лаунчера.

Плагины устанавливаются пользователем вручную: **устанавливайте только доверенные источники**.

---

## Версионирование API

Текущая версия API: **`api_version: 1`** (соответствует 16Launcher 2.1.x).

При несовпадении `api_version` плагин не загрузится — обновите манифест или лаунчер.

---

## Поддержка

- Пример: [`example-plugin/`](./example-plugin/)
- Исходники системы плагинов: `src-tauri/src/services/plugins/`, `src/features/plugins/`
