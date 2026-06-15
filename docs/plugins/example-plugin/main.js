/**
 * Пример точки входа плагина 16Launcher.
 *
 * Поддерживаются два стиля:
 * 1) function register(api) { ... }
 * 2) IIFE — см. документацию docs/plugins/API.md
 */
function register(api) {
  api.log("Example plugin loaded, version", api.version);

  api.registerPanel({
    render(container) {
      const card = document.createElement("div");
      card.style.cssText =
        "padding:16px;border-radius:16px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.25);color:#fff;font-family:system-ui,sans-serif;";

      const title = document.createElement("h2");
      title.textContent = api.name;
      title.style.margin = "0 0 8px";
      card.appendChild(title);

      const text = document.createElement("p");
      text.textContent = String(api.config.greeting ?? "Hello!");
      text.style.opacity = "0.8";
      card.appendChild(text);

      const btn = document.createElement("button");
      btn.textContent = "Сменить приветствие";
      btn.style.cssText =
        "margin-top:12px;padding:8px 14px;border-radius:999px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.08);color:#fff;cursor:pointer;";
      btn.onclick = async () => {
        const next = prompt("Новое приветствие:", String(api.config.greeting ?? ""));
        if (next == null) return;
        await api.setConfig({ ...api.config, greeting: next });
        text.textContent = next;
      };
      card.appendChild(btn);

      container.appendChild(card);
    },
  });

  api.on("launcher_ready", () => {
    api.log("launcher_ready");
  });

  api.on("pre_launch", async (payload) => {
    api.log("pre_launch", payload);
    if (api.config.addJvmFlag === false) return;
    if (!api.hasPermission("modify_jvm_args")) return;
    await api.setLaunchOverrides({
      jvmArgsAppend: ["-D16launcher.example.plugin=true"],
    });
  });

  api.on("post_launch", (payload) => {
    api.log("post_launch, pid=", payload.pid);
  });
}
