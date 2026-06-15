# JavaScript API плагинов

Точка входа — файл, указанный в `entry` (обычно `main.js`). Лаунчер загружает скрипт и вызывает функцию `register(api)`.

---

## Шаблон main.js

```javascript
function register(api) {
  // Инициализация
  api.log("loaded");

  // UI (если ui.sidebar = true)
  api.registerPanel({
    render(container) {
      container.innerHTML = "<p>Hello</p>";
    },
  });

  // События
  api.on("launcher_ready", () => {});
  api.on("pre_launch", async (payload) => {});
  api.on("post_launch", (payload) => {});
}
```

### Альтернативный стиль (IIFE)

```javascript
(function (api) {
  api.log("loaded");
})(/* api инжектируется лаунчером */);
```

Рекомендуется использовать `function register(api)` — проще отлаживать.

---

## Объект `api`

### Свойства (только чтение)

| Свойство | Тип | Описание |
|----------|-----|----------|
| `id` | `string` | ID плагина из манифеста |
| `name` | `string` | Отображаемое имя |
| `version` | `string` | Версия плагина |
| `config` | `object` | Текущая конфигурация |
| `permissions` | `string[]` | Список разрешений |

### `api.hasPermission(permission: string): boolean`

Проверка разрешения перед опасными действиями.

```javascript
if (api.hasPermission("modify_jvm_args")) {
  await api.setLaunchOverrides({ jvmArgsAppend: ["-Dfoo=bar"] });
}
```

---

### `api.getConfig(): Promise<object>`

Загружает актуальный конфиг с диска (`plugins-state.json`).

---

### `api.setConfig(config: object): Promise<void>`

Сохраняет конфиг. Требует **`write_plugin_config`**.

```javascript
await api.setConfig({
  ...api.config,
  lastOpened: Date.now(),
});
```

---

### `api.invoke<T>(command: string, args?: object): Promise<T>`

Вызов любой **существующей** Tauri-команды лаунчера.

```javascript
const profiles = await api.invoke("get_profiles");
const settings = await api.invoke("get_settings");
```

> Используйте только стабильные команды. Список команд может меняться между версиями лаунчера.

**Полезные команды:**

| Команда | Описание |
|---------|----------|
| `get_profiles` | Список сборок |
| `get_selected_profile` | Активная сборка |
| `get_settings` | Глобальные настройки |
| `get_java_settings` | Настройки Java |
| `is_game_running_now` | Запущена ли игра |
| `list_launcher_plugins` | Список плагинов |

---

### `api.on(event, handler): () => void`

Подписка на события плагина. Возвращает функцию отписки.

| Событие | Payload | Описание |
|---------|---------|----------|
| `launcher_ready` | `{ pluginId }` | Лаунчер готов |
| `pre_launch` | см. ниже | Перед запуском игры |
| `post_launch` | см. ниже | После запуска игры |

**`pre_launch` payload:**

```typescript
{
  profileId?: string | null;
  versionId: string;
  jvmArgs: string[];
  gameArgs: string[];
}
```

**`post_launch` payload:**

```typescript
{
  profileId?: string | null;
  versionId: string;
  pid: number;
}
```

Пример:

```javascript
api.on("pre_launch", async (payload) => {
  api.log("Запуск", payload.versionId, "профиль", payload.profileId);
});
```

---

### `api.setLaunchOverrides(overrides): Promise<void>`

Задаёт JVM/game аргументы **на один ближайший запуск**. Сбрасывается после `post_launch`.

```javascript
await api.setLaunchOverrides({
  jvmArgsAppend: ["-Dmyplugin=true"],
  gameArgsAppend: ["--demo"],  // требует modify_game_args
});
```

| Поле | Разрешение |
|------|------------|
| `jvmArgsAppend` | `modify_jvm_args` |
| `gameArgsAppend` | `modify_game_args` |

Флаги проходят фильтр безопасности лаунчера.

---

### `api.registerPanel({ render, destroy? })`

Регистрирует UI для вкладки sidebar.

```javascript
api.registerPanel({
  render(container) {
    const el = document.createElement("div");
    el.textContent = "Содержимое панели";
    container.appendChild(el);

    // Опционально: вернуть cleanup
    return () => el.remove();
  },
  destroy() {
    // Вызывается при выгрузке плагина
  },
});
```

`container` — `HTMLElement` внутри `PluginHost`. Стилизуйте элементы inline или через классы Tailwind (если применимы в контексте).

---

### `api.log(...args)`

Лог в консоль: `[Plugin:<id>] ...`

---

## Tauri-события (низкий уровень)

Помимо `api.on()`, лаунчер эмитит глобальные события:

| Событие | Payload |
|---------|---------|
| `plugin:launcher-ready` | `()` |
| `plugin:pre-launch` | `PreLaunchEventPayload` |
| `plugin:post-launch` | `PostLaunchEventPayload` |

Подписка из frontend лаунчера (не из плагина):

```javascript
import { listen } from "@tauri-apps/api/event";
await listen("plugin:pre-launch", (e) => console.log(e.payload));
```

---

## Ограничения

1. **Нет ES modules** — один файл `main.js`, без `import`/`export` (кроме паттерна `register`).
2. **Нет npm-зависимостей** — только браузерный JS + `api.invoke`.
3. **Синхронный запуск** — `pre_launch` должен завершиться до spawn; долгие async-операции могут задержать запуск.
4. **Один panel** на плагин.

---

## Полный пример

См. [`example-plugin/main.js`](./example-plugin/main.js).
