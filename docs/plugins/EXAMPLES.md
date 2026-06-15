# Примеры плагинов

Готовые рецепты для копирования и адаптации.

---

## 1. Счётчик запусков (JS + config)

**plugin.json:**
```json
{
  "api_version": 1,
  "id": "launch-counter",
  "name": "Launch Counter",
  "version": "1.0.0",
  "entry": "main.js",
  "hooks": ["post_launch", "launcher_ready"],
  "permissions": ["read_plugin_config", "write_plugin_config"],
  "ui": { "sidebar": true, "sidebar_label": "Счётчик" }
}
```

**main.js:**
```javascript
function register(api) {
  api.registerPanel({
    render(container) {
      const n = api.config.count ?? 0;
      container.innerHTML = `<p style="color:#fff">Запусков: ${n}</p>`;
    },
  });

  api.on("post_launch", async () => {
    const count = (api.config.count ?? 0) + 1;
    await api.setConfig({ ...api.config, count });
  });
}
```

---

## 2. Aikar's flags hint (только UI)

**plugin.json:**
```json
{
  "api_version": 1,
  "id": "aikar-hint",
  "name": "Aikar Flags Hint",
  "version": "1.0.0",
  "entry": "main.js",
  "hooks": [],
  "permissions": [],
  "ui": { "sidebar": true, "sidebar_label": "G1 GC" }
}
```

**main.js:**
```javascript
function register(api) {
  api.registerPanel({
    render(container) {
      container.innerHTML = `
        <div style="color:#fff;max-width:480px;line-height:1.5">
          <h3 style="margin:0 0 8px">Aikar's JVM flags</h3>
          <p style="opacity:.8;font-size:13px">
            Добавьте флаги G1 в Настройки → Java.
            Плагин не меняет запуск автоматически.
          </p>
        </div>`;
    },
  });
}
```

---

## 3. Декларативный IPv6 (без JS)

**plugin.json:**
```json
{
  "api_version": 1,
  "id": "jvm-ipv6",
  "name": "JVM IPv6",
  "version": "1.0.0",
  "hooks": ["pre_launch"],
  "permissions": ["modify_jvm_args"],
  "ui": { "sidebar": false }
}
```

**hooks/pre_launch.json:**
```json
{
  "jvm_args_append": [
    "-Djava.net.preferIPv4Stack=false",
    "-Djava.net.preferIPv6Addresses=true"
  ]
}
```

---

## 4. Флаг только для конкретной сборки

Замените `YOUR_PROFILE_ID` на ID из `instances/.../config.json`.

**hooks/pre_launch.json:**
```json
{
  "jvm_args_append": ["-Ddebug.build=true"],
  "profile_filter": ["YOUR_PROFILE_ID"]
}
```

---

## 5. Плагин-заглушка для теста discovery

**plugin.json:**
```json
{
  "api_version": 1,
  "id": "test-empty",
  "name": "Test Empty",
  "version": "0.0.1",
  "ui": { "sidebar": false }
}
```

Без `entry` и хуков — только проверка появления в списке.

---

## Установка любого примера

```bash
# Из корня репозитория
cp -r docs/plugins/example-plugin "$PLUGINS_DIR/my-copy"
# Отредактируйте id в plugin.json, если ставите несколько копий
```

Перезагрузите плагины в настройках лаунчера.

---

## Шаблон нового плагина

```
my-new-plugin/
├── plugin.json      # скопируйте из MANIFEST.md
├── main.js          # скопируйте register() из API.md
├── icon.png         # 256×256
└── README.md        # описание для пользователей
```
