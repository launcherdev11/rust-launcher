# Разрешения плагинов

Разрешения объявляются в `plugin.json` → `permissions` и проверяются при вызове API или применении декларативных хуков.

Принцип: **минимально необходимый набор** — запрашивайте только то, что нужно.

---

## Список разрешений

| ID | Описание |
|----|----------|
| `read_plugin_config` | Чтение `api.config` / `getConfig()` |
| `write_plugin_config` | `setConfig()` |
| `modify_jvm_args` | JVM-флаги: `hooks/pre_launch.json`, `setLaunchOverrides.jvmArgsAppend` |
| `modify_game_args` | Game-аргументы: `hooks/pre_launch.json`, `setLaunchOverrides.gameArgsAppend` |
| `read_settings` | *Зарезервировано* — пока через `api.invoke("get_settings")` |
| `read_profiles` | *Зарезервировано* — пока через `api.invoke("get_profiles")` |
| `emit_notifications` | *Зарезервировано* — будущий `api.notify()` |

---

## Поведение при отсутствии разрешения

| Действие | Результат |
|----------|-----------|
| `setConfig` без `write_plugin_config` | Ошибка (throw) |
| `setLaunchOverrides` без `modify_jvm_args` | Ошибка (throw) |
| `jvm_args_append` в JSON без `modify_jvm_args` | **Игнорируется** (silent) |
| `game_args_append` в JSON без `modify_game_args` | **Игнорируется** |

---

## Примеры наборов

### Только UI, без доступа к запуску

```json
"permissions": ["read_plugin_config", "write_plugin_config"]
```

### Декларативный JVM-тюнинг

```json
"permissions": ["modify_jvm_args"]
```

### Полный контроль аргументов запуска

```json
"permissions": ["modify_jvm_args", "modify_game_args"]
```

---

## Безопасность для пользователей

Перед установкой плагина проверяйте:

1. Какие `permissions` запрашиваются
2. Содержимое `main.js` и `hooks/pre_launch.json`
3. Источник (официальный репозиторий, известный автор)

Плагин с `modify_jvm_args` **не может** обойти фильтр опасных флагов, но может влиять на поведение JVM в допустимых пределах.

---

## Для авторов плагинов

Документируйте запрашиваемые разрешения в README плагина:

```markdown
## Разрешения
- `modify_jvm_args` — добавляет `-Dmyplugin.enabled=true` при запуске
- `write_plugin_config` — сохраняет пользовательские заметки
```
