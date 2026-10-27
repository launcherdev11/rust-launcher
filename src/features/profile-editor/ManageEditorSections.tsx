import { useEffect, useMemo, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  SettingsRow,
  SettingsSelect,
  SettingsToggle,
  SettingsSlider,
} from "../../settings-ui/SettingsComponents";
import type { LauncherAccountSummary } from "../../app/types";
import { JavaSettingsTab } from "../../tabs/JavaSettings";
import { formatByteSize, localeTag, type Language } from "../../i18n";

export type EditorSection =
  | "content"
  | "launch"
  | "version"
  | "worlds"
  | "conflicts"
  | "cleanup"
  | "backups";

export type ProfileConflictView = {
  id: string;
  severity: "warning" | "error";
  title: string;
  reason: string;
  affected: string[];
  solutions: string[];
  category?: string;
  actions?: { id: string; label: string; kind: string; keep?: string; targets?: string[] }[];
};

export type ProfileWorldView = {
  name: string;
  path: string;
  sizeBytes: number;
  lastPlayed: number | null;
};

export type ProfileDiskFolderView = {
  id: string;
  name: string;
  sizeBytes: number;
  fileCount: number;
  cleanable: boolean;
};

type Tt = (key: string, vars?: Record<string, string | number>) => string;

const NAV_ITEMS: { id: EditorSection; key: string }[] = [
  { id: "content", key: "modpacks.editor.nav.content" },
  { id: "launch", key: "modpacks.editor.nav.launch" },
  { id: "version", key: "modpacks.editor.nav.version" },
  { id: "worlds", key: "modpacks.editor.nav.worlds" },
  { id: "conflicts", key: "modpacks.editor.nav.conflicts" },
  { id: "cleanup", key: "modpacks.editor.nav.cleanup" },
  { id: "backups", key: "modpacks.editor.nav.backups" },
];

const CONFLICT_CATEGORY_ORDER = [
  "duplicate",
  "breaks",
  "dependency",
  "loader",
  "incompatible",
  "other",
] as const;

function conflictCategoryKey(category?: string): string {
  if (
    category === "duplicate" ||
    category === "breaks" ||
    category === "dependency" ||
    category === "loader" ||
    category === "incompatible"
  ) {
    return category;
  }
  return "other";
}

export function EditorSideNav({
  section,
  onChange,
  conflictCount,
  conflictsLoading,
  tt,
}: {
  section: EditorSection;
  onChange: (s: EditorSection) => void;
  conflictCount: number;
  conflictsLoading?: boolean;
  tt: Tt;
}) {
  return (
    <aside className="glass-panel flex w-full shrink-0 flex-col gap-1 p-2 sm:w-[11.5rem]">
      {NAV_ITEMS.map((item) => {
        const active = section === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            className={`interactive-press flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs font-semibold transition-colors ${
              active
                ? "seg-on"
                : "text-white/70 hover:bg-white/10 hover:text-white"
            }`}
          >
            <span>{tt(item.key)}</span>
            {item.id === "conflicts" && (conflictCount > 0 || conflictsLoading) ? (
              <span
                className={`rounded-md px-1.5 py-0.5 text-[0.75rem] font-bold ${
                  active ? "bg-white/15 text-white" : "bg-amber-500/30 text-amber-100"
                }`}
              >
                {conflictsLoading && conflictCount === 0 ? "…" : conflictCount}
              </span>
            ) : null}
          </button>
        );
      })}
    </aside>
  );
}

function ProfileAccountRow({
  profileId,
  showNotification,
  tt,
}: {
  profileId: string;
  showNotification: (kind: "info" | "success" | "error" | "warning", message: string) => void;
  tt: Tt;
}) {
  const [accounts, setAccounts] = useState<LauncherAccountSummary[]>([]);
  const [accountId, setAccountId] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [list, bound] = await Promise.all([
          invoke<LauncherAccountSummary[]>("list_launcher_accounts"),
          invoke<string | null>("get_profile_account_id", { id: profileId }),
        ]);
        if (cancelled) return;
        setAccounts(list);
        setAccountId(bound && list.some((a) => a.id === bound) ? bound : "");
      } catch (e) {
        console.error(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  const options = [
    { value: "", label: tt("modpacks.profileSettingsModal.accountDefault") },
    ...accounts.map((a) => ({ value: a.id, label: a.label })),
  ];

  return (
    <SettingsRow
      label={tt("modpacks.profileSettingsModal.account")}
      hint={tt("modpacks.profileSettingsModal.accountHint")}
    >
      <SettingsSelect
        value={accountId}
        options={options}
        onChange={(next) => {
          const prev = accountId;
          setAccountId(next);
          invoke("update_profile_settings", {
            id: profileId,
            patch: { account_id: next || null },
          }).then(
            () => showNotification("success", tt("modpacks.profileSettings.saved")),
            (e) => {
              console.error(e);
              setAccountId(prev);
              showNotification("error", tt("modpacks.profileSettings.saveFailed"));
            },
          );
        }}
      />
    </SettingsRow>
  );
}

export function LaunchSettingsPanel({
  language,
  systemMemoryGb,
  settings,
  profileId,
  resolutionWidth,
  resolutionHeight,
  onResolutionWidth,
  onResolutionHeight,
  onCommitResolution,
  onResetResolution,
  onPatch,
  onRamChange,
  onRamCommit,
  showNotification,
  tt,
  javaSlot,
}: {
  language: Language;
  systemMemoryGb: number;
  settings: {
    ram_mb: number;
    show_console_on_launch: boolean;
    close_launcher_on_game_start: boolean;
    check_game_processes: boolean;
  } | null;
  profileId: string;
  resolutionWidth: string;
  resolutionHeight: string;
  onResolutionWidth: (v: string) => void;
  onResolutionHeight: (v: string) => void;
  onCommitResolution: () => void;
  onResetResolution: () => void;
  onPatch: (patch: Record<string, unknown>) => void;
  onRamChange: (gb: number) => void;
  onRamCommit: (gb: number) => void;
  showNotification: (kind: "info" | "success" | "error" | "warning", message: string) => void;
  tt: Tt;
  javaSlot?: ReactNode;
}) {
  return (
    <div className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
      <div className="rounded-2xl bg-black/35 px-4 py-4">
        <div className="mb-3 text-sm text-white/60">{tt("modpacks.profileSettingsModal.hint")}</div>
        <div className="flex flex-col gap-4">
          <SettingsToggle
            label={tt("modpacks.profileSettingsModal.closeLauncherOnStart")}
            yesLabel={tt("common.yes")}
            noLabel={tt("common.no")}
            value={settings?.close_launcher_on_game_start ?? false}
            onChange={(value: boolean) => onPatch({ close_launcher_on_game_start: value })}
          />
          <SettingsToggle
            label={tt("modpacks.profileSettingsModal.checkGameProcesses")}
            yesLabel={tt("common.yes")}
            noLabel={tt("common.no")}
            value={settings?.check_game_processes ?? true}
            onChange={(value: boolean) => onPatch({ check_game_processes: value })}
          />
          <SettingsToggle
            label={tt("modpacks.profileSettingsModal.showConsoleOnLaunch")}
            yesLabel={tt("common.yes")}
            noLabel={tt("common.no")}
            value={settings?.show_console_on_launch ?? false}
            onChange={(value: boolean) => onPatch({ show_console_on_launch: value })}
          />
          <ProfileAccountRow profileId={profileId} showNotification={showNotification} tt={tt} />
        </div>
      </div>

      <div className="rounded-2xl bg-black/35 px-4 py-4">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-white/70">
            {tt("modpacks.profileSettingsModal.resolution")}
          </span>
          <button
            type="button"
            onClick={onResetResolution}
            className="interactive-press rounded-xl bg-white/10 px-3.5 py-2 text-xs font-semibold text-white/80 hover:bg-white/20"
          >
            {tt("modpacks.profileSettingsModal.resolutionReset")}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <input
            type="number"
            inputMode="numeric"
            min={320}
            max={7680}
            placeholder={tt("modpacks.profileSettingsModal.resolutionWidth")}
            value={resolutionWidth}
            onChange={(e) => onResolutionWidth(e.target.value)}
            onBlur={onCommitResolution}
            onKeyDown={(e) => {
              if (e.key === "Enter") onCommitResolution();
            }}
            className="no-number-spin h-10 w-32 rounded-xl border border-white/15 bg-black/40 px-3 text-sm font-semibold text-white/90 outline-none focus:border-white/35"
          />
          <span className="text-sm text-white/50">×</span>
          <input
            type="number"
            inputMode="numeric"
            min={240}
            max={4320}
            placeholder={tt("modpacks.profileSettingsModal.resolutionHeight")}
            value={resolutionHeight}
            onChange={(e) => onResolutionHeight(e.target.value)}
            onBlur={onCommitResolution}
            onKeyDown={(e) => {
              if (e.key === "Enter") onCommitResolution();
            }}
            className="no-number-spin h-10 w-32 rounded-xl border border-white/15 bg-black/40 px-3 text-sm font-semibold text-white/90 outline-none focus:border-white/35"
          />
        </div>
      </div>

      <div className="rounded-2xl bg-black/35 px-4 py-4">
        <SettingsSlider
          label={tt("modpacks.profileSettingsModal.memoryRam")}
          min={1}
          max={Math.max(64, systemMemoryGb)}
          value={Math.max(1, Math.round((settings?.ram_mb ?? 4096) / 1024))}
          onChange={onRamChange}
          onChangeCommitted={onRamCommit}
          right={
            <span className="text-sm font-semibold text-white/90">
              {tt("settings.game.ram.gbValue", {
                gb: Math.max(1, Math.round((settings?.ram_mb ?? 4096) / 1024)),
              })}
            </span>
          }
        />
      </div>

      {javaSlot ?? (
        <JavaSettingsTab
          language={language}
          systemMemoryGb={systemMemoryGb}
          showNotification={showNotification}
          profileId={profileId}
          embedded
        />
      )}
    </div>
  );
}

export function WorldsPanel({
  language,
  loading,
  worlds,
  selected,
  onToggle,
  onSelectAll,
  onClearSelection,
  onOpenWorld,
  onOpenSaves,
  onOpenConfig,
  onDeleteSelected,
  deleteBusy,
  onOpenDetails,
  tt,
}: {
  language: Language;
  loading: boolean;
  worlds: ProfileWorldView[];
  selected: Set<string>;
  onToggle: (path: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onOpenWorld: (path: string) => void;
  onOpenSaves: () => void;
  onOpenConfig: () => void;
  onDeleteSelected: () => void;
  deleteBusy?: boolean;
  onOpenDetails?: (worldName: string) => void;
  tt: Tt;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return worlds;
    return worlds.filter((w) => w.name.toLowerCase().includes(q));
  }, [worlds, query]);
  const totalBytes = useMemo(
    () => worlds.reduce((sum, w) => sum + (w.sizeBytes || 0), 0),
    [worlds],
  );

  return (
    <div className="glass-panel flex min-h-0 flex-1 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold text-white">
            {tt("modpacks.editor.worldsTitle")}
          </div>
          <div className="mt-1 text-sm text-white/55">
            {tt("modpacks.editor.worldsHint")}
          </div>
        </div>
        <div className="text-sm font-semibold text-white/75">
          {tt("modpacks.editor.worldsTotal", {
            count: worlds.length,
            size: formatByteSize(language, totalBytes),
          })}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onOpenSaves}
          className="interactive-press rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/20"
        >
          {tt("modpacks.editor.openSaves")}
        </button>
        <button
          type="button"
          onClick={onOpenConfig}
          className="interactive-press rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/20"
        >
          {tt("modpacks.editor.openConfig")}
        </button>
      </div>

      {worlds.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tt("modpacks.editor.worldsSearch")}
            className="glass-control h-10 min-w-[12rem] flex-1 rounded-xl border px-3 text-sm text-white placeholder:text-white/40 outline-none"
          />
          <button
            type="button"
            onClick={onSelectAll}
            className="interactive-press rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/20"
          >
            {tt("modpacks.editor.selectAll")}
          </button>
          {selected.size > 0 ? (
            <>
              <span className="text-xs text-white/60">
                {tt("modpacks.editor.selectedCount", { count: selected.size })}
              </span>
              <button
                type="button"
                onClick={onClearSelection}
                className="interactive-press rounded-xl px-3 py-2 text-xs font-semibold text-white/60 hover:text-white"
              >
                {tt("modpacks.editor.clearSelection")}
              </button>
              <button
                type="button"
                disabled={deleteBusy}
                onClick={onDeleteSelected}
                className="interactive-press rounded-xl bg-red-600/85 px-3.5 py-2 text-xs font-semibold text-white hover:bg-red-600 disabled:opacity-50"
              >
                {deleteBusy
                  ? tt("modpacks.editor.worldsDeleting")
                  : tt("modpacks.editor.worldsDelete")}
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <div className="py-10 text-center text-sm text-white/60">
          {tt("modpacks.editor.worldsLoading")}
        </div>
      ) : worlds.length === 0 ? (
        <div className="py-10 text-center text-sm text-white/60">
          {tt("modpacks.editor.worldsEmpty")}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-10 text-center text-sm text-white/60">
          {tt("modpacks.editor.worldsNoSearchResults")}
        </div>
      ) : (
        <div className="custom-scrollbar flex flex-col gap-2 overflow-y-auto">
          {filtered.map((w) => {
            const checked = selected.has(w.path);
            return (
              <div
                key={w.path}
                className={`flex items-center justify-between gap-3 rounded-2xl bg-black/45 px-3.5 py-3.5 text-sm text-white/85 ${
                  checked ? "ring-1 ring-white/20" : ""
                }`}
              >
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggle(w.path)}
                    className="accent-checkbox"
                  />
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{w.name}</div>
                    <div className="mt-0.5 text-xs text-white/50">
                      {formatByteSize(language, w.sizeBytes)}
                      {w.lastPlayed
                        ? ` · ${tt("modpacks.editor.lastPlayed", {
                            date: new Date(w.lastPlayed * 1000).toLocaleString(),
                          })}`
                        : ""}
                    </div>
                  </div>
                </label>
                {onOpenDetails ? (
                  <button
                    type="button"
                    onClick={() => onOpenDetails(w.name)}
                    className="btn btn-sm btn-soft shrink-0"
                  >
                    {tt("worldTools.open")}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => onOpenWorld(w.path)}
                  className="interactive-press shrink-0 rounded-xl bg-white/10 px-3.5 py-2 text-xs font-semibold hover:bg-white/20"
                >
                  {tt("modpacks.editor.worldsOpen")}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ConflictCard({
  conflict: c,
  onAction,
  tt,
}: {
  conflict: ProfileConflictView;
  onAction: (conflict: ProfileConflictView, actionId: string) => void;
  tt: Tt;
}) {
  return (
    <div
      className={`rounded-2xl px-3.5 py-3 text-sm ${
        c.severity === "error" ? "bg-rose-500/10" : "bg-amber-500/10"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-white/90">{c.title}</div>
          <div className="mt-0.5 text-xs text-white/65">{c.reason}</div>
        </div>
        <div
          className={`shrink-0 rounded-xl px-2.5 py-1 text-[0.8125rem] font-semibold ${
            c.severity === "error"
              ? "bg-rose-500/30 text-rose-100"
              : "bg-amber-500/30 text-amber-100"
          }`}
        >
          {c.severity === "error"
            ? tt("modpacks.conflicts.severity.error")
            : tt("modpacks.conflicts.severity.warning")}
        </div>
      </div>
      {c.affected.length > 0 ? (
        <div className="mt-2.5 rounded-xl bg-black/25 px-2.5 py-2">
          <div className="text-[0.8125rem] font-semibold text-white/45">
            {tt("modpacks.conflicts.affected")}
            {c.affected.length > 8 ? ` · ${c.affected.length}` : ""}
          </div>
          <div className="mt-1 flex flex-col gap-0.5">
            {c.affected.map((f) => (
              <div key={f} className="truncate text-xs text-white/75" title={f}>
                {f}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {c.solutions.length > 0 ? (
        <div className="mt-2.5">
          <div className="text-[0.8125rem] font-semibold text-white/45">
            {tt("modpacks.conflicts.solutions")}
          </div>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-white/75">
            {c.solutions.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {c.actions && c.actions.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {c.actions.map((a) => (
            <button
              key={a.id}
              type="button"
              className="interactive-press rounded-xl bg-white/10 px-3.5 py-2 text-xs font-semibold text-white/85 hover:bg-white/15"
              onClick={() => onAction(c, a.id)}
            >
              {a.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ConflictsPanel({
  loading,
  conflicts,
  onAction,
  onRefresh,
  tt,
}: {
  loading: boolean;
  conflicts: ProfileConflictView[];
  onAction: (conflict: ProfileConflictView, actionId: string) => void;
  onRefresh?: () => void;
  tt: Tt;
}) {
  const errorCount = conflicts.filter((c) => c.severity === "error").length;
  const warningCount = conflicts.filter((c) => c.severity === "warning").length;
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const groups = useMemo(() => {
    const map = new Map<string, ProfileConflictView[]>();
    for (const c of conflicts) {
      const key = conflictCategoryKey(c.category);
      const list = map.get(key);
      if (list) list.push(c);
      else map.set(key, [c]);
    }
    return CONFLICT_CATEGORY_ORDER.filter((key) => (map.get(key)?.length ?? 0) > 0).map(
      (key) => ({
        key,
        items: map.get(key) ?? [],
      }),
    );
  }, [conflicts]);

  const toggleGroup = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="glass-panel custom-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-base font-semibold text-white">
          <span>{tt("modpacks.conflicts.title")}</span>
          <span className="rounded-md bg-amber-500/20 px-2.5 py-0.5 text-[0.75rem] font-semibold text-amber-100">
            {tt("modpacks.editor.beta")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-xl bg-white/10 px-2.5 py-1 text-xs font-semibold text-white/70">
            {loading
              ? tt("modpacks.conflicts.loading")
              : tt("modpacks.conflicts.count", { count: conflicts.length })}
          </div>
          {onRefresh ? (
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              className="interactive-press rounded-xl bg-white/10 px-3.5 py-2 text-xs font-semibold text-white/80 hover:bg-white/20 disabled:opacity-50"
            >
              {tt("modpacks.conflicts.refresh")}
            </button>
          ) : null}
        </div>
      </div>

      <p className="text-xs leading-relaxed text-white/50">{tt("modpacks.conflicts.hint")}</p>

      {!loading && conflicts.length > 0 ? (
        <div className="flex flex-wrap gap-2 text-xs">
          {errorCount > 0 ? (
            <span className="rounded-xl bg-rose-500/25 px-3 py-1.5 font-semibold text-rose-100">
              {tt("modpacks.conflicts.summaryErrors", { count: errorCount })}
            </span>
          ) : null}
          {warningCount > 0 ? (
            <span className="rounded-xl bg-amber-500/25 px-3 py-1.5 font-semibold text-amber-100">
              {tt("modpacks.conflicts.summaryWarnings", { count: warningCount })}
            </span>
          ) : null}
          <span className="rounded-xl bg-white/10 px-3 py-1.5 font-semibold text-white/70">
            {tt("modpacks.conflicts.groupsCount", { count: groups.length })}
          </span>
        </div>
      ) : null}

      {!loading && conflicts.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-2xl bg-emerald-500/10 px-4 py-10 text-center">
          <div className="text-base font-semibold text-emerald-100">
            {tt("modpacks.conflicts.noneTitle")}
          </div>
          <div className="max-w-sm text-sm text-white/60">{tt("modpacks.conflicts.none")}</div>
        </div>
      ) : null}

      {groups.map((group) => {
        const isCollapsed = collapsed.has(group.key);
        const groupErrors = group.items.filter((c) => c.severity === "error").length;
        return (
          <div key={group.key} className="rounded-2xl bg-black/30">
            <button
              type="button"
              onClick={() => toggleGroup(group.key)}
              className="interactive-press flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left"
            >
              <div className="min-w-0">
                <div className="text-sm font-semibold text-white">
                  {tt(`modpacks.conflicts.groups.${group.key}`)}
                </div>
                <div className="mt-0.5 text-xs text-white/50">
                  {tt("modpacks.conflicts.groupSummary", {
                    count: group.items.length,
                    errors: groupErrors,
                  })}
                </div>
              </div>
              <span className="shrink-0 text-sm text-white/50">{isCollapsed ? "▸" : "▾"}</span>
            </button>
            {!isCollapsed ? (
              <div className="flex flex-col gap-2 px-2.5 pb-2.5">
                {group.items.map((c) => (
                  <ConflictCard key={c.id} conflict={c} onAction={onAction} tt={tt} />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function CleanupPanel({
  language,
  loading,
  busy,
  usage,
  selected,
  onToggle,
  onRun,
  folderLabel,
  tt,
}: {
  language: Language;
  loading: boolean;
  busy: boolean;
  usage: { totalBytes: number; folders: ProfileDiskFolderView[] } | null;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onRun: () => void;
  folderLabel: (id: string) => string;
  tt: Tt;
}) {
  return (
    <div className="glass-panel flex min-h-0 flex-1 flex-col gap-3 p-4">
      <div>
        <div className="text-base font-semibold text-white">{tt("modpacks.editor.cleanupTitle")}</div>
        <div className="mt-1 text-sm text-white/55">{tt("modpacks.editor.cleanupHint")}</div>
      </div>
      {loading || !usage ? (
        <div className="py-10 text-center text-sm text-white/60">
          {tt("modpacks.editor.cleanupLoading")}
        </div>
      ) : (
        <>
          <div className="text-sm font-semibold text-white/80">
            {tt("modpacks.editor.cleanupTotal", {
              size: formatByteSize(language, usage.totalBytes),
            })}
          </div>
          <div className="custom-scrollbar flex flex-col gap-2 overflow-y-auto">
            {usage.folders.map((f) => (
              <label
                key={f.id}
                className={`flex items-center justify-between gap-3 rounded-2xl bg-black/45 px-3.5 py-3.5 text-sm ${
                  f.cleanable ? "cursor-pointer text-white/85" : "text-white/55"
                }`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  {f.cleanable ? (
                    <input
                      type="checkbox"
                      checked={selected.has(f.id)}
                      onChange={() => onToggle(f.id)}
                      className="accent-checkbox"
                    />
                  ) : (
                    <span className="w-5 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{folderLabel(f.id)}</div>
                    {f.cleanable ? (
                      <div className="text-xs text-emerald-300/80">
                        {tt("modpacks.editor.cleanupCleanable")}
                      </div>
                    ) : (
                      <div className="text-xs text-white/40">
                        {tt("modpacks.editor.cleanupFiles", { count: f.fileCount })}
                      </div>
                    )}
                  </div>
                </div>
                <div className="shrink-0 text-sm font-medium text-white/70">
                  {formatByteSize(language, f.sizeBytes)}
                </div>
              </label>
            ))}
          </div>
          <button
            type="button"
            disabled={busy || selected.size === 0}
            onClick={onRun}
            className="interactive-press rounded-2xl accent-bg px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? tt("modpacks.editor.cleanupRunning") : tt("modpacks.editor.cleanupRun")}
          </button>
        </>
      )}
    </div>
  );
}

export type ProfileBackupView = {
  id: string;
  createdAt: number;
  sizeBytes: number;
};

function BackupPanelIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path
        d="M12 3v10m0 0 3.5-3.5M12 13 8.5 9.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5 15.5V17a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-1.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function formatBackupStamp(language: Language, createdAt: number): string {
  try {
    return new Date(createdAt * 1000).toLocaleString(localeTag(language), {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return new Date(createdAt * 1000).toLocaleString();
  }
}

export function BackupsSectionPanel({
  language,
  profileName,
  loading,
  creating,
  restoringId,
  backups,
  onCreate,
  onRestore,
  onDelete,
  onOpenFolder,
  tt,
}: {
  language: Language;
  profileName: string;
  loading: boolean;
  creating: boolean;
  restoringId: string | null;
  backups: ProfileBackupView[];
  onCreate: () => void;
  onRestore: (backupId: string) => void;
  onDelete: (backupId: string) => void;
  onOpenFolder: () => void;
  tt: Tt;
}) {
  const totalBytes = useMemo(
    () => backups.reduce((sum, b) => sum + (b.sizeBytes || 0), 0),
    [backups],
  );
  const busy = creating || Boolean(restoringId);

  return (
    <div className="glass-panel flex min-h-0 flex-1 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-base font-semibold text-white">
            {tt("modpacks.backups.title")}
          </div>
          <div className="mt-1 text-sm text-white/55">
            {tt("modpacks.backups.hint", { name: profileName })}
          </div>
        </div>
        {!loading && backups.length > 0 ? (
          <div className="text-sm font-semibold text-white/75">
            {tt("modpacks.backups.total", {
              count: backups.length,
              size: formatByteSize(language, totalBytes),
            })}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onCreate}
          disabled={busy}
          className="interactive-press inline-flex items-center gap-2 rounded-xl accent-bg px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <BackupPanelIcon className="h-4 w-4" />
          {creating ? tt("modpacks.backups.creating") : tt("modpacks.backups.create")}
        </button>
        <button
          type="button"
          onClick={onOpenFolder}
          disabled={busy}
          className="interactive-press rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/20 disabled:opacity-50"
        >
          {tt("modpacks.backups.openFolder")}
        </button>
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center py-10 text-sm text-white/60">
          {tt("modpacks.backups.loading")}
        </div>
      ) : backups.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-2xl bg-black/30 px-6 py-12 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/8 text-white/55">
            <BackupPanelIcon className="h-7 w-7" />
          </div>
          <div className="max-w-sm">
            <div className="text-sm font-semibold text-white/85">
              {tt("modpacks.backups.empty")}
            </div>
            <div className="mt-1.5 text-xs leading-relaxed text-white/50">
              {tt("modpacks.backups.emptyHint")}
            </div>
          </div>
          <button
            type="button"
            onClick={onCreate}
            disabled={busy}
            className="interactive-press inline-flex items-center gap-2 rounded-xl accent-bg px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <BackupPanelIcon className="h-4 w-4" />
            {creating ? tt("modpacks.backups.creating") : tt("modpacks.backups.create")}
          </button>
        </div>
      ) : (
        <div className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          {backups.map((b) => {
            const stamp = formatBackupStamp(language, b.createdAt);
            const isRestoring = restoringId === b.id;
            return (
              <div
                key={b.id}
                className="flex items-center justify-between gap-3 rounded-2xl bg-black/45 px-3.5 py-3.5 text-sm text-white/85"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/8 text-white/55">
                    <BackupPanelIcon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{stamp}</div>
                    <div className="mt-0.5 text-xs text-white/50">
                      {formatByteSize(language, b.sizeBytes)}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onRestore(b.id)}
                    disabled={busy}
                    className="interactive-press rounded-xl bg-accent-from/20 px-3.5 py-2 text-xs font-semibold text-accent-hi hover:bg-accent-from/30 disabled:opacity-50"
                  >
                    {isRestoring
                      ? tt("modpacks.backups.restoring")
                      : tt("modpacks.backups.restore")}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(b.id)}
                    disabled={busy}
                    className="interactive-press rounded-xl bg-red-600/20 px-3.5 py-2 text-xs font-semibold text-red-200 hover:bg-red-600/30 disabled:opacity-50"
                  >
                    {tt("modpacks.backups.delete")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
