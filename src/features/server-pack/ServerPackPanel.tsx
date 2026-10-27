import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { save as saveFile } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AssetIcon } from "../../components/asset_icon";
import {
  exportServerPack,
  getServerPack,
  isModdedKind,
  listServerPackMods,
  modIncluded,
  saveServerPackConfig,
  type ServerAuth,
  type ServerPackConfig,
  type ServerPackMod,
  type ServerPackState,
} from "./api";

type Tt = (key: string, vars?: Record<string, string | number>) => string;
type Notify = (kind: "info" | "success" | "error" | "warning", message: string) => void;

const EULA_URL = "https://aka.ms/MinecraftEULA";
const AUTH_MODES: ServerAuth[] = ["microsoft", "ely", "offline"];

type PropertyField = {
  key: string;
  label: string;
  type: "text" | "number" | "bool" | "select";
  options?: string[];
};

const FIELDS: PropertyField[] = [
  { key: "motd", label: "motd", type: "text" },
  { key: "server-port", label: "port", type: "number" },
  { key: "max-players", label: "maxPlayers", type: "number" },
  { key: "difficulty", label: "difficulty", type: "select", options: ["peaceful", "easy", "normal", "hard"] },
  { key: "gamemode", label: "gamemode", type: "select", options: ["survival", "creative", "adventure", "spectator"] },
  { key: "view-distance", label: "viewDistance", type: "number" },
  { key: "simulation-distance", label: "simulationDistance", type: "number" },
  { key: "spawn-protection", label: "spawnProtection", type: "number" },
  { key: "level-seed", label: "seed", type: "text" },
  { key: "white-list", label: "whitelist", type: "bool" },
  { key: "pvp", label: "pvp", type: "bool" },
  { key: "allow-flight", label: "allowFlight", type: "bool" },
  { key: "hardcore", label: "hardcore", type: "bool" },
  { key: "enable-command-block", label: "commandBlocks", type: "bool" },
];

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-black/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function ServerPackPanel({
  profileId,
  systemMemoryGb,
  tt,
  showNotification,
}: {
  profileId: string;
  systemMemoryGb: number | null;
  tt: Tt;
  showNotification: Notify;
}) {
  const [state, setState] = useState<ServerPackState | null | undefined>(undefined);
  const [draft, setDraft] = useState<ServerPackConfig | null>(null);
  const [mods, setMods] = useState<ServerPackMod[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [building, setBuilding] = useState(false);

  const load = useCallback(() => {
    getServerPack(profileId)
      .then((s) => {
        setState(s);
        setDraft(s.config);
      })
      .catch((e) => {
        setState(null);
        showNotification("error", String(e));
      });
  }, [profileId, showNotification]);

  useEffect(() => {
    setState(undefined);
    setDraft(null);
    setMods(null);
    load();
    listServerPackMods(profileId)
      .then(setMods)
      .catch(() => setMods([]));
  }, [profileId, load]);

  const changed = useMemo(
    () => state != null && draft != null && JSON.stringify(draft) !== JSON.stringify(state.config),
    [state, draft],
  );
  const dirty = changed || (state != null && !state.saved);

  const header = (
    <div className="min-w-0">
      <div className="text-base font-semibold text-white">{tt("serverPack.title")}</div>
      <div className="mt-1 text-sm text-white/55">{tt("serverPack.hint")}</div>
    </div>
  );

  if (state === undefined || (state && !draft)) {
    return (
      <div className="glass-panel flex min-h-0 flex-1 flex-col gap-3 p-4">
        {header}
        <div className="py-8 text-center text-sm text-white/55">{tt("serverPack.loading")}</div>
      </div>
    );
  }

  if (state === null || draft === null || state.kinds.length === 0) {
    return (
      <div className="glass-panel flex min-h-0 flex-1 flex-col gap-3 p-4">
        {header}
        {state ? (
          <div className="rounded-2xl bg-black/30 px-5 py-8 text-center text-sm text-white/60">
            {tt("serverPack.unsupported", { loader: state.loader })}
          </div>
        ) : null}
      </div>
    );
  }

  const update = (patch: Partial<ServerPackConfig>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const setProperty = (key: string, value: string) =>
    setDraft((d) => (d ? { ...d, properties: { ...d.properties, [key]: value } } : d));
  const toggleMod = (mod: ServerPackMod) =>
    setDraft((d) => {
      if (!d) return d;
      const next = { ...d.modOverrides };
      const included = !modIncluded(d, mod);
      if (included === !mod.clientOnly) delete next[mod.file];
      else next[mod.file] = included;
      return { ...d, modOverrides: next };
    });

  const modded = isModdedKind(draft.kind);
  const maxGb = Math.max(2, Math.floor((systemMemoryGb ?? 16) * 0.75));
  const ramGb = Math.round(draft.ramMb / 1024);
  const includedCount = mods ? mods.filter((m) => modIncluded(draft, m)).length : 0;

  const persist = async () => {
    await saveServerPackConfig(profileId, draft);
    const fresh = await getServerPack(profileId);
    setState(fresh);
    setDraft(fresh.config);
  };

  const save = async () => {
    setSaving(true);
    try {
      await persist();
      showNotification("success", tt("serverPack.saved"));
    } catch (e) {
      showNotification("error", String(e));
    } finally {
      setSaving(false);
    }
  };

  const build = async () => {
    const safeName = state.name.replace(/[\\/:*?"<>|]/g, "_").trim() || "server";
    const dest = await saveFile({
      defaultPath: `${safeName}-server.zip`,
      filters: [{ name: "ZIP", extensions: ["zip"] }],
    }).catch(() => null);
    if (!dest) return;
    setBuilding(true);
    try {
      if (dirty) await persist();
      const result = await exportServerPack(profileId, dest);
      showNotification("success", tt("serverPack.built", { mods: result.mods, skipped: result.skipped }));
    } catch (e) {
      showNotification("error", String(e));
    } finally {
      setBuilding(false);
    }
  };

  const field = (f: PropertyField) => {
    const value = draft.properties[f.key] ?? "";
    if (f.type === "bool") {
      return (
        <label key={f.key} className="flex items-center gap-2.5 text-[0.8125rem] text-white/75">
          <input
            type="checkbox"
            checked={value === "true"}
            onChange={(e) => setProperty(f.key, e.target.checked ? "true" : "false")}
            className="accent-checkbox"
          />
          {tt(`serverPack.props.${f.label}`)}
        </label>
      );
    }
    return (
      <label key={f.key} className="flex flex-col gap-1.5 text-[0.8125rem]">
        <span className="text-white/60">{tt(`serverPack.props.${f.label}`)}</span>
        {f.type === "select" && f.options ? (
          <select
            value={value}
            onChange={(e) => setProperty(f.key, e.target.value)}
            className="launcher-select glass-control h-9 w-full pl-3 text-[0.8125rem]"
          >
            {f.options.map((o) => (
              <option key={o} value={o}>
                {tt(`serverPack.${f.key}.${o}`)}
              </option>
            ))}
          </select>
        ) : (
          <input
            value={value}
            inputMode={f.type === "number" ? "numeric" : undefined}
            onChange={(e) =>
              setProperty(f.key, f.type === "number" ? e.target.value.replace(/\D/g, "") : e.target.value)
            }
            className="glass-control h-9 w-full px-3 text-[0.8125rem] text-white outline-none"
          />
        )}
      </label>
    );
  };

  const busy = saving || building;

  return (
    <div className="glass-panel flex min-h-0 flex-1 flex-col p-4">
      <div className="flex flex-wrap items-start justify-between gap-3 pb-3">
        {header}
        <span className="text-[0.8125rem] text-white/60">
          Minecraft {state.mcVersion}
          {state.loaderVersion ? ` · ${tt(`serverPack.kind.${state.loader}`)} ${state.loaderVersion}` : ""}
        </span>
      </div>

      <div className="custom-scrollbar -mr-2 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-2">
        <Section title={tt("serverPack.core")}>
          <div className="seg-track flex w-fit flex-wrap rounded-xl p-0.5 text-[0.8125rem]">
            {state.kinds.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => update({ kind: k })}
                className={`rounded-lg px-3 py-1 font-semibold ${draft.kind === k ? "seg-on" : "text-white/60"}`}
              >
                {tt(`serverPack.kind.${k}`)}
              </button>
            ))}
          </div>
          {draft.kind ? <p className="text-[0.75rem] text-white/50">{tt(`serverPack.kindHint.${draft.kind}`)}</p> : null}
          <p className="text-[0.75rem] text-white/50">{tt("serverPack.java", { version: state.javaMajor })}</p>
          <label className="flex flex-wrap items-center gap-3 text-[0.8125rem] text-white/70">
            {tt("serverPack.memory")}
            <input
              type="range"
              min={1}
              max={Math.max(maxGb, ramGb)}
              value={ramGb}
              onChange={(e) => update({ ramMb: Number(e.target.value) * 1024 })}
              className="w-48"
            />
            <span className="tabular-nums text-white/85">{tt("serverPack.memoryValue", { gb: ramGb })}</span>
          </label>
        </Section>

        <Section title={tt("serverPack.auth.label")}>
          <div className="seg-track flex w-fit rounded-xl p-0.5 text-[0.8125rem]">
            {AUTH_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => update({ auth: mode })}
                className={`rounded-lg px-3 py-1 font-semibold ${draft.auth === mode ? "seg-on" : "text-white/60"}`}
              >
                {tt(`serverPack.auth.${mode}`)}
              </button>
            ))}
          </div>
          <p className="text-[0.75rem] text-white/50">{tt(`serverPack.authHint.${draft.auth}`)}</p>
        </Section>

        <Section title={tt("serverPack.props.title")}>
          <div className="grid gap-3 sm:grid-cols-2">{FIELDS.filter((f) => f.type !== "bool").map(field)}</div>
          <div className="grid gap-2.5 sm:grid-cols-2">{FIELDS.filter((f) => f.type === "bool").map(field)}</div>
        </Section>

        {modded ? (
          <Section
            title={tt("serverPack.mods.title")}
            aside={
              mods && mods.length > 0 ? (
                <span className="text-[0.75rem] tabular-nums text-white/55">
                  {tt("serverPack.mods.count", { included: includedCount, total: mods.length })}
                </span>
              ) : null
            }
          >
            <p className="text-[0.75rem] text-white/50">{tt("serverPack.mods.hint")}</p>
            {mods == null ? (
              <p className="text-[0.8125rem] text-white/50">{tt("serverPack.mods.loading")}</p>
            ) : mods.length === 0 ? (
              <p className="text-[0.8125rem] text-white/50">{tt("serverPack.mods.empty")}</p>
            ) : (
              <div className="custom-scrollbar flex max-h-72 flex-col overflow-y-auto rounded-xl border border-white/[0.06]">
                {mods.map((m) => (
                  <label
                    key={m.file}
                    className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-[0.8125rem] hover:bg-white/[0.04]"
                  >
                    <input
                      type="checkbox"
                      checked={modIncluded(draft, m)}
                      onChange={() => toggleMod(m)}
                      className="accent-checkbox"
                    />
                    <span className="min-w-0 flex-1 truncate text-white/85" title={m.file}>
                      {m.title}
                    </span>
                    {m.clientOnly ? (
                      <span className="rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[0.6875rem] text-white/60">
                        {tt("serverPack.mods.clientOnly")}
                      </span>
                    ) : null}
                  </label>
                ))}
              </div>
            )}
            <label className="flex items-center gap-2.5 text-[0.8125rem] text-white/75">
              <input
                type="checkbox"
                checked={draft.includeConfigs}
                onChange={(e) => update({ includeConfigs: e.target.checked })}
                className="accent-checkbox"
              />
              {tt("serverPack.mods.configs")}
            </label>
          </Section>
        ) : null}

        <Section title="EULA">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex min-w-0 flex-1 items-center gap-2.5 text-[0.8125rem] text-white/75">
              <input
                type="checkbox"
                checked={draft.eula}
                onChange={(e) => update({ eula: e.target.checked })}
                className="accent-checkbox"
              />
              {tt("serverPack.eula.accept")}
            </label>
            <button type="button" onClick={() => void openUrl(EULA_URL)} className="btn btn-sm btn-ghost">
              {tt("serverPack.eula.read")}
            </button>
          </div>
          {!draft.eula ? <p className="text-[0.75rem] text-white/50">{tt("serverPack.eula.hint")}</p> : null}
        </Section>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-3">
        <span className="min-w-0 flex-1 text-[0.75rem] text-white/50">
          {changed ? tt("serverPack.unsaved") : tt("serverPack.buildHint")}
        </span>
        <button
          type="button"
          onClick={() => setDraft(state.config)}
          disabled={!changed || busy}
          className="btn btn-sm btn-ghost"
        >
          {tt("serverPack.reset")}
        </button>
        <button type="button" onClick={() => void save()} disabled={!dirty || busy} className="btn btn-sm btn-soft">
          {tt("serverPack.save")}
        </button>
        <button type="button" onClick={() => void build()} disabled={busy} className="btn btn-sm btn-accent">
          <AssetIcon name="export" className="h-4 w-4" />
          {building ? tt("serverPack.building") : tt("serverPack.build")}
        </button>
      </div>
    </div>
  );
}
