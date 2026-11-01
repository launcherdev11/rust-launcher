import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AssetIcon } from "../../components/asset_icon";
import { ProfileInstanceIcon } from "../../components/profile_instance_icon";
import { useT, type Language } from "../../i18n";
import { loaderLabels } from "../../tabs/modpack/helpers";
import type { LoaderId } from "../../tabs/modpack/types";

export const TRAY_MENU_WINDOW_LABEL = "tray-menu";

const PANEL_WIDTH = 288;
const WINDOW_GUTTER = 14;

type TrayProfile = {
  profileId: string;
  name: string;
  gameVersion: string;
  loader: string;
};

type TrayMenuState = {
  title: string;
  profiles: TrayProfile[];
  language: string;
};

type MenuEntry =
  | { kind: "profile"; profile: TrayProfile }
  | { kind: "show" }
  | { kind: "quit" };

const LANGUAGES: Language[] = ["ru", "en", "de", "es"];
const LOADER_ICONS = new Set(["vanilla", "forge", "fabric", "quilt", "neoforge"]);

function runAction(action: string, profileId?: string) {
  invoke("tray_menu_action", { action, profileId: profileId ?? null }).catch((e) =>
    console.error(e),
  );
}

export function TrayMenuApp() {
  const [state, setState] = useState<TrayMenuState | null>(null);
  const [cursor, setCursor] = useState(-1);
  const [openCount, setOpenCount] = useState(0);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const showOnFitRef = useRef(true);

  const language = LANGUAGES.includes(state?.language as Language)
    ? (state?.language as Language)
    : "ru";
  const tt = useT(language);

  const load = useCallback(async (show: boolean) => {
    try {
      const next = await invoke<TrayMenuState>("tray_menu_state");
      showOnFitRef.current = showOnFitRef.current || show;
      if (show) setOpenCount((n) => n + 1);
      setCursor(-1);
      setState(next);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    void load(true);
    const offOpen = listen("tray-menu-open", () => void load(true));
    const offRefresh = listen("tray-menu-refresh", () => void load(false));
    return () => {
      void offOpen.then((off) => off());
      void offRefresh.then((off) => off());
    };
  }, [load]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!state || !panel) return;
    const show = showOnFitRef.current;
    showOnFitRef.current = false;
    const height = panel.offsetHeight + WINDOW_GUTTER * 2;
    invoke("tray_menu_fit", {
      width: PANEL_WIDTH + WINDOW_GUTTER * 2,
      height,
      show,
    }).catch((e) => console.error(e));
  }, [state, openCount]);

  const entries: MenuEntry[] = [
    ...(state?.profiles ?? []).map((profile) => ({ kind: "profile" as const, profile })),
    { kind: "show" },
    { kind: "quit" },
  ];

  const activate = (entry: MenuEntry) => {
    if (entry.kind === "profile") runAction("launch", entry.profile.profileId);
    else runAction(entry.kind);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        runAction("hide");
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setCursor((c) => (c + 1) % entries.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => (c <= 0 ? entries.length - 1 : c - 1));
      } else if (e.key === "Enter" && cursor >= 0 && entries[cursor]) {
        e.preventDefault();
        activate(entries[cursor]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const profiles = state?.profiles ?? [];
  const showIndex = profiles.length;
  const quitIndex = profiles.length + 1;

  return (
    <div style={{ padding: WINDOW_GUTTER }} onContextMenu={(e) => e.preventDefault()}>
      <div
        key={openCount}
        ref={panelRef}
        style={{ width: PANEL_WIDTH }}
        className="tray-menu-panel select-none overflow-hidden rounded-2xl border border-white/10 bg-ink-900"
        onMouseLeave={() => setCursor(-1)}
      >
        <div className="flex items-center gap-2.5 px-3.5 pb-2.5 pt-3">
          <img
            src="/launcher-assets/icon.png"
            alt=""
            className="h-6 w-6 shrink-0 rounded-md object-contain"
            draggable={false}
          />
          <span className="text-sm font-semibold text-white">16Launcher</span>
        </div>
        <div className="h-px bg-white/[0.06]" />

        <div className="p-1.5">
          {profiles.length > 0 ? (
            <>
              <div className="px-2.5 pb-1 pt-1 text-xs font-semibold text-white/40">
                {state?.title}
              </div>
              {profiles.map((p, i) => {
                const active = cursor === i;
                const loader = LOADER_ICONS.has(p.loader) ? p.loader : null;
                return (
                  <button
                    key={p.profileId}
                    type="button"
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => runAction("launch", p.profileId)}
                    title={tt("trayMenu.launch", { name: p.name })}
                    className={`flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left outline-none transition-colors ${
                      active ? "bg-white/[0.07]" : ""
                    }`}
                  >
                    <ProfileInstanceIcon
                      profile={{ id: p.profileId, name: p.name }}
                      className="h-8 w-8 shrink-0"
                      initialClassName="text-xs"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[0.8125rem] font-semibold text-white">
                        {p.name}
                      </div>
                      {p.gameVersion || loader ? (
                        <div className="mt-0.5 flex items-center gap-1 text-[0.6875rem] text-white/45">
                          {loader ? (
                            <AssetIcon name={loader} className="h-3 w-3 text-white/40" />
                          ) : null}
                          <span className="truncate">
                            {[
                              loader && loader !== "vanilla"
                                ? loaderLabels[loader as LoaderId]
                                : null,
                              p.gameVersion || null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </div>
                      ) : null}
                    </div>
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.08] text-white/80 transition-opacity ${
                        active ? "opacity-100" : "opacity-0"
                      }`}
                      aria-hidden="true"
                    >
                      <AssetIcon name="play" className="h-3 w-3" />
                    </span>
                  </button>
                );
              })}
            </>
          ) : (
            <div className="px-2.5 py-2.5 text-xs text-white/45">{tt("trayMenu.empty")}</div>
          )}
        </div>

        <div className="h-px bg-white/[0.06]" />
        <div className="p-1.5">
          <button
            type="button"
            onMouseEnter={() => setCursor(showIndex)}
            onClick={() => runAction("show")}
            className={`flex h-9 w-full items-center gap-2.5 rounded-xl px-2.5 text-left text-[0.8125rem] font-semibold text-white/80 outline-none transition-colors ${
              cursor === showIndex ? "bg-white/[0.07] text-white" : ""
            }`}
          >
            <AssetIcon name="home" className="h-3.5 w-3.5 text-white/50" />
            {tt("trayMenu.show")}
          </button>
          <button
            type="button"
            onMouseEnter={() => setCursor(quitIndex)}
            onClick={() => runAction("quit")}
            className={`flex h-9 w-full items-center gap-2.5 rounded-xl px-2.5 text-left text-[0.8125rem] font-semibold outline-none transition-colors ${
              cursor === quitIndex ? "bg-danger/15 text-danger-hi" : "text-white/80"
            }`}
          >
            <span className="h-3.5 w-3.5" aria-hidden="true" />
            {tt("trayMenu.quit")}
          </button>
        </div>
      </div>
    </div>
  );
}
