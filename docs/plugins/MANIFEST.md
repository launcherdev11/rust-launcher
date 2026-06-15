# Справочник plugin.json

Манифест `plugin.json` — единственный обязательный файл плагина. Лаунчер читает его при каждом сканировании каталога `plugins/`.

---

## Полная схема

```json
{
  "api_version": 1,
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "Что делает плагин",
  "author": "Автор",
  "homepage": "https://example.com/my-plugin",
  "min_launcher_version": "2.1.0",
  "entry": "main.js",
  "hooks": ["launcher_ready", "pre_launch", "post_launch"],
  "permissions": [
    "read_plugin_config",
    "write_plugin_config",
    "modify_jvm_args",
    "modify_game_args"
  ],
  "ui": {
    "sidebar": true,
    "sidebar_label": "My Plugin",
    "sidebar_order": 50,
    "settings_section": false
  },
  "defaults": {
    "enabled": true,
    "config": {
      "optionA": true,
      "optionB": "value"
    }
  }
}
```

---

## Поля

### `api_version` (обязательно)

| Тип | Значение |
|-----|----------|
| `number` | `1` — текущая версия API |

Должен **точно совпадать** с версией, поддерживаемой лаунчером. Иначе плагин не загрузится.

---

### `id` (обязательно)

| Тип | Ограничения |
|-----|-------------|
| `string` | Уникальный ID: `a-z`, `A-Z`, `0-9`, `-`, `_` |

Используется в `plugins-state.json`, sidebar (`plugin:<id>`), логах.

**Примеры:** `auto-ram`, `discord_rpc_extra`, `profile_notes`

**Нельзя:** `my plugin`, `плагин`, `plugin/with/slash`

---

### `name` (обязательно)

Отображаемое имя в менеджере плагинов и по умолчанию в sidebar.

---

### `version` (обязательно)

Семантическая версия плагина (`1.0.0`, `0.2.1-beta`). Лаунчер не проверяет semver — поле информационное.

---

### `description` (опционально)

Краткое описание для UI. Пустая строка по умолчанию.

---

### `author` (опционально)

Имя автора или организации.

---

### `homepage` (опционально)

URL страницы плагина, репозитория или документации.

---

### `min_launcher_version` (опционально)

Минимальная версия 16Launcher. **Пока не проверяется автоматически** — зарезервировано для будущих версий API.

---

### `entry` (опционально)

Путь к JS-файлу относительно папки плагина, например `"main.js"`.

Если не указан — плагин работает только через декларативные хуки (`hooks/pre_launch.json`), без UI и JS.

---

### `hooks` (опционально)

Массив строк — какие события жизненного цикла использует плагин:

| Значение | Когда срабатывает |
|----------|-------------------|
| `launcher_ready` | После старта лаунчера / перезагрузки плагинов |
| `pre_launch` | Перед `spawn` процесса Minecraft |
| `post_launch` | Сразу после успешного запуска игры |

Плагин получает событие только если хук указан **и** плагин включён.

---

### `permissions` (опционально)

Список разрешений — см. [PERMISSIONS.md](./PERMISSIONS.md).

Без нужного разрешения соответствующий API вернёт ошибку или будет проигнорирован (для декларативных хуков).

---

### `ui` (опционально)

| Поле | Тип | По умолчанию | Описание |
|------|-----|--------------|----------|
| `sidebar` | `boolean` | `false` | Показать вкладку в боковом меню |
| `sidebar_label` | `string?` | `name` | Подпись вкладки |
| `sidebar_order` | `number?` | `100` | Порядок (меньше — выше) |
| `settings_section` | `boolean` | `false` | Зарезервировано для встроенной секции настроек |

Для отображения панели плагин должен вызвать `api.registerPanel()` в `main.js`.

---

### `defaults` (опционально)

| Поле | Тип | По умолчанию |
|------|-----|--------------|
| `enabled` | `boolean` | `true` |
| `config` | `object` | `{}` |

Начальные значения до первого сохранения в `plugins-state.json`.

---

## Валидация

При загрузке лаунчер проверяет:

1. Наличие и парсинг `plugin.json`
2. `api_version === 1`
3. Непустые `id`, `name`, `version`
4. Допустимые символы в `id`

Ошибки отображаются в менеджере плагинов; такой плагин нельзя включить.

---

## Примеры манифестов

### Только декларативный хук (без JS)

```json
{
  "api_version": 1,
  "id": "ipv6-pref",
  "name": "Prefer IPv6",
  "version": "1.0.0",
  "hooks": ["pre_launch"],
  "permissions": ["modify_jvm_args"],
  "ui": { "sidebar": false }
}
```

+ файл `hooks/pre_launch.json`:

```json
{
  "jvm_args_append": [
    "-Djava.net.preferIPv4Stack=false",
    "-Djava.net.preferIPv6Addresses=true"
  ]
}
```

### UI-плагин без хуков запуска

```json
{
  "api_version": 1,
  "id": "notes",
  "name": "Profile Notes",
  "version": "1.0.0",
  "entry": "main.js",
  "hooks": ["launcher_ready"],
  "permissions": ["read_plugin_config", "write_plugin_config"],
  "ui": {
    "sidebar": true,
    "sidebar_label": "Заметки",
    "sidebar_order": 80
  }
}
```
