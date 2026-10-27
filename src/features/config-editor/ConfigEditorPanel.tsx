import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AssetIcon } from "../../components/asset_icon";
import { InputClearButton } from "../../components/ui";
import { formatByteSize, localeTag, type Language } from "../../i18n";
import { confirmDialog } from "../../lib/confirmDialog";
import {
  SAVE_CONFLICT,
  listConfigFiles,
  listConfigVersions,
  readConfigFile,
  readConfigVersion,
  saveConfigFile,
  searchConfigFiles,
  validateConfigToml,
  type ConfigFileEntry,
  type ConfigSearchHit,
  type ConfigVersion,
} from "./api";
import { CodeEditor, type CodeEditorHandle } from "./CodeEditor";
import { diffLines, foldDiff } from "./lineDiff";
import { checkJson, formatFromPath } from "./syntax";

type Tt = (key: string, vars?: Record<string, string | number>) => string;
type Notify = (kind: "info" | "success" | "error" | "warning", message: string) => void;

type OpenFile = {
  path: string;
  saved: string;
  draft: string;
  modifiedMs: number;
  lossy: boolean;
};

type Problem = { line: number | null; message: string } | null;

function groupOf(path: string): string {
  const parts = path.split("/");
  return parts.length > 2 ? parts.slice(0, -1).join("/") : parts.length === 2 ? parts[0] : "";
}

function FileList({
  files,
  activePath,
  dirtyPath,
  query,
  language,
  onOpen,
  tt,
}: {
  files: ConfigFileEntry[];
  activePath: string | null;
  dirtyPath: string | null;
  query: string;
  language: Language;
  onOpen: (path: string, line?: number) => void;
  tt: Tt;
}) {
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const map = new Map<string, ConfigFileEntry[]>();
    for (const f of files) {
      if (q && !f.path.toLowerCase().includes(q)) continue;
      const g = groupOf(f.path);
      const list = map.get(g) ?? [];
      list.push(f);
      map.set(g, list);
    }
    return [...map.entries()];
  }, [files, query]);

  if (groups.length === 0) {
    return <div className="px-2 py-6 text-center text-sm text-white/50">{tt("configEditor.noFiles")}</div>;
  }

  return (
    <>
      {groups.map(([group, list]) => (
        <div key={group || "root"} className="mb-1">
          {group ? (
            <div className="truncate px-2 pb-0.5 pt-2 text-[0.6875rem] font-semibold text-white/40" title={group}>
              {group}
            </div>
          ) : null}
          {list.map((f) => {
            const name = f.path.split("/").pop() ?? f.path;
            const active = f.path === activePath;
            return (
              <button
                key={f.path}
                type="button"
                onClick={() => onOpen(f.path)}
                title={`${f.path} · ${formatByteSize(language, f.size)}`}
                className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left text-[0.8125rem] transition-colors ${
                  active ? "seg-on" : "text-white/75 hover:bg-white/[0.06]"
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{name}</span>
                {dirtyPath === f.path ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-hi" /> : null}
              </button>
            );
          })}
        </div>
      ))}
    </>
  );
}

function VersionsPane({
  profileId,
  path,
  current,
  language,
  onRestore,
  onClose,
  tt,
}: {
  profileId: string;
  path: string;
  current: string;
  language: Language;
  onRestore: (content: string) => void;
  onClose: () => void;
  tt: Tt;
}) {
  const [versions, setVersions] = useState<ConfigVersion[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listConfigVersions(profileId, path)
      .then((v) => {
        if (cancelled) return;
        setVersions(v);
        setSelected(v[0]?.id ?? null);
      })
      .catch(() => !cancelled && setVersions([]));
    return () => {
      cancelled = true;
    };
  }, [profileId, path]);

  useEffect(() => {
    if (!selected) {
      setContent(null);
      return;
    }
    let cancelled = false;
    readConfigVersion(profileId, path, selected)
      .then((c) => !cancelled && setContent(c))
      .catch(() => !cancelled && setContent(null));
    return () => {
      cancelled = true;
    };
  }, [profileId, path, selected]);

  const diff = useMemo(() => {
    if (content == null) return null;
    const lines = diffLines(content, current);
    return lines ? foldDiff(lines) : null;
  }, [content, current]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-white/85">{tt("configEditor.history.title")}</div>
        <button type="button" onClick={onClose} className="btn btn-sm btn-ghost">
          {tt("configEditor.history.back")}
        </button>
      </div>
      {versions == null ? (
        <div className="py-6 text-center text-sm text-white/55">{tt("configEditor.loading")}</div>
      ) : versions.length === 0 ? (
        <div className="py-6 text-center text-sm text-white/55">{tt("configEditor.history.empty")}</div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2 lg:flex-row">
          <div className="custom-scrollbar flex max-h-40 shrink-0 flex-col gap-0.5 overflow-y-auto lg:max-h-none lg:w-52">
            {versions.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setSelected(v.id)}
                className={`rounded-lg px-2.5 py-1.5 text-left text-[0.8125rem] ${
                  v.id === selected ? "seg-on" : "text-white/75 hover:bg-white/[0.06]"
                }`}
              >
                {new Date(v.savedAtMs).toLocaleString(localeTag(language))}
                <span className="block text-[0.6875rem] text-white/40">{formatByteSize(language, v.size)}</span>
              </button>
            ))}
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2 text-[0.75rem] text-white/50">
              <span className="min-w-0 flex-1">{tt("configEditor.history.diffHint")}</span>
              <button
                type="button"
                disabled={content == null}
                onClick={() => content != null && onRestore(content)}
                className="btn btn-sm btn-soft"
              >
                {tt("configEditor.history.restore")}
              </button>
            </div>
            <div className="custom-scrollbar min-h-[12rem] flex-1 overflow-auto rounded-xl border border-white/[0.06] bg-[var(--ink-0)] py-1 font-mono text-[0.75rem] leading-[1.45]">
              {diff == null ? (
                <div className="px-3 py-4 font-sans text-sm text-white/55">
                  {content == null ? tt("configEditor.loading") : tt("configEditor.history.tooDifferent")}
                </div>
              ) : diff.every((l) => l.kind === "same" || l.kind === "gap") ? (
                <div className="px-3 py-4 font-sans text-sm text-white/55">{tt("configEditor.history.identical")}</div>
              ) : (
                diff.map((l, i) =>
                  l.kind === "gap" ? (
                    <div key={i} className="px-3 py-0.5 font-sans text-[0.6875rem] text-white/30">
                      {tt("configEditor.history.hidden", { count: l.hidden })}
                    </div>
                  ) : (
                    <div
                      key={i}
                      className={`whitespace-pre px-3 ${
                        l.kind === "added"
                          ? "bg-emerald-500/10 text-emerald-200"
                          : l.kind === "removed"
                            ? "bg-red-500/10 text-red-200"
                            : "text-white/55"
                      }`}
                    >
                      {l.kind === "added" ? "+ " : l.kind === "removed" ? "- " : "  "}
                      {l.text}
                    </div>
                  ),
                )
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function ConfigEditorPanel({
  profileId,
  language,
  tt,
  showNotification,
}: {
  profileId: string;
  language: Language;
  tt: Tt;
  showNotification: Notify;
}) {
  const [files, setFiles] = useState<ConfigFileEntry[] | null>(null);
  const [filter, setFilter] = useState("");
  const [contentMode, setContentMode] = useState(false);
  const [hits, setHits] = useState<ConfigSearchHit[] | null>(null);
  const [open, setOpen] = useState<OpenFile | null>(null);
  const [problem, setProblem] = useState<Problem>(null);
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const editorRef = useRef<CodeEditorHandle | null>(null);
  const pendingLineRef = useRef<number | null>(null);

  const dirty = open != null && open.draft !== open.saved;
  const format = open ? formatFromPath(open.path) : "text";

  const reloadFiles = useCallback(() => {
    listConfigFiles(profileId)
      .then(setFiles)
      .catch(() => setFiles([]));
  }, [profileId]);

  useEffect(() => {
    setFiles(null);
    setOpen(null);
    reloadFiles();
  }, [reloadFiles]);

  useEffect(() => {
    const q = filter.trim();
    if (!contentMode || q.length < 2) {
      setHits(null);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      searchConfigFiles(profileId, q)
        .then((h) => !cancelled && setHits(h))
        .catch(() => !cancelled && setHits([]));
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [profileId, filter, contentMode]);

  useEffect(() => {
    if (!open) {
      setProblem(null);
      return;
    }
    const text = open.draft;
    const path = open.path.toLowerCase();
    let cancelled = false;
    const t = window.setTimeout(() => {
      if (format === "json" && path.endsWith(".json")) {
        const p = checkJson(text);
        setProblem(p ? { line: p.line, message: p.message } : null);
      } else if (format === "toml") {
        validateConfigToml(text)
          .then((r) => !cancelled && setProblem(r.ok ? null : { line: r.line, message: r.message ?? "" }))
          .catch(() => !cancelled && setProblem(null));
      } else {
        setProblem(null);
      }
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [open?.draft, open?.path, format]);

  useEffect(() => {
    if (pendingLineRef.current != null && open) {
      const line = pendingLineRef.current;
      pendingLineRef.current = null;
      requestAnimationFrame(() => editorRef.current?.focusLine(line));
    }
  }, [open?.path]);

  const confirmDiscard = useCallback(async () => {
    if (!dirty) return true;
    return confirmDialog({
      title: tt("configEditor.unsaved.title"),
      message: tt("configEditor.unsaved.message"),
      confirmLabel: tt("configEditor.unsaved.discard"),
      cancelLabel: tt("common.cancel"),
      tone: "danger",
    });
  }, [dirty, tt]);

  const openFile = useCallback(
    async (path: string, line?: number) => {
      if (open?.path === path) {
        if (line) editorRef.current?.focusLine(line);
        return;
      }
      if (!(await confirmDiscard())) return;
      try {
        const res = await readConfigFile(profileId, path);
        pendingLineRef.current = line ?? null;
        setShowHistory(false);
        setOpen({ path, saved: res.content, draft: res.content, modifiedMs: res.modifiedMs, lossy: res.lossy });
      } catch (e) {
        showNotification("error", String(e));
      }
    },
    [open?.path, confirmDiscard, profileId, showNotification],
  );

  const save = useCallback(
    async (force = false) => {
      if (!open || saving || (!dirty && !force)) return;
      if (problem && !force) {
        const ok = await confirmDialog({
          title: tt("configEditor.invalid.title"),
          message: tt("configEditor.invalid.message", { message: problem.message }),
          confirmLabel: tt("configEditor.invalid.saveAnyway"),
          cancelLabel: tt("common.cancel"),
          tone: "danger",
        });
        if (!ok) return;
      }
      setSaving(true);
      try {
        const modifiedMs = await saveConfigFile(profileId, open.path, open.draft, open.modifiedMs, force);
        setOpen((prev) => (prev ? { ...prev, saved: prev.draft, modifiedMs } : prev));
        showNotification("success", tt("configEditor.saved"));
        reloadFiles();
      } catch (e) {
        if (String(e) === SAVE_CONFLICT) {
          const overwrite = await confirmDialog({
            title: tt("configEditor.conflict.title"),
            message: tt("configEditor.conflict.message"),
            confirmLabel: tt("configEditor.conflict.overwrite"),
            cancelLabel: tt("common.cancel"),
            tone: "danger",
          });
          setSaving(false);
          if (overwrite) void save(true);
          return;
        }
        showNotification("error", String(e));
      } finally {
        setSaving(false);
      }
    },
    [open, saving, dirty, problem, profileId, showNotification, tt, reloadFiles],
  );

  const revert = useCallback(() => {
    setOpen((prev) => (prev ? { ...prev, draft: prev.saved } : prev));
  }, []);

  return (
    <div className="glass-panel flex min-h-0 flex-1 flex-col gap-3 p-4">
      <div>
        <div className="text-base font-semibold text-white">{tt("configEditor.title")}</div>
        <div className="mt-1 text-sm text-white/55">{tt("configEditor.hint")}</div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
        <div className="flex max-h-72 shrink-0 flex-col gap-2 lg:max-h-none lg:w-60">
          <div className="relative">
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={contentMode ? tt("configEditor.searchContent") : tt("configEditor.searchFiles")}
              className="glass-control h-9 w-full px-3 pr-8 text-sm text-white outline-none placeholder:text-white/40"
            />
            <InputClearButton
              value={filter}
              onClear={() => setFilter("")}
              className="absolute right-2 top-1/2 -translate-y-1/2"
              aria-label={tt("common.clear")}
            />
          </div>
          <div className="seg-track flex rounded-xl p-0.5 text-[0.75rem]">
            {[false, true].map((mode) => (
              <button
                key={String(mode)}
                type="button"
                onClick={() => setContentMode(mode)}
                className={`flex-1 rounded-lg px-2 py-1 font-semibold ${contentMode === mode ? "seg-on" : "text-white/60"}`}
              >
                {tt(mode ? "configEditor.mode.content" : "configEditor.mode.names")}
              </button>
            ))}
          </div>
          <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
            {files == null ? (
              <div className="py-6 text-center text-sm text-white/55">{tt("configEditor.loading")}</div>
            ) : contentMode && hits ? (
              hits.length === 0 ? (
                <div className="py-6 text-center text-sm text-white/50">{tt("configEditor.noHits")}</div>
              ) : (
                hits.map((h) => (
                  <button
                    key={`${h.path}:${h.lineNo}`}
                    type="button"
                    onClick={() => void openFile(h.path, h.lineNo)}
                    className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.06]"
                  >
                    <div className="truncate text-[0.6875rem] text-white/45">
                      {h.path}:{h.lineNo}
                    </div>
                    <div className="truncate font-mono text-[0.75rem] text-white/80">{h.line}</div>
                  </button>
                ))
              )
            ) : (
              <FileList
                files={files}
                activePath={open?.path ?? null}
                dirtyPath={dirty ? open!.path : null}
                query={contentMode ? "" : filter}
                language={language}
                onOpen={(p, line) => void openFile(p, line)}
                tt={tt}
              />
            )}
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
          {!open ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl bg-black/30 px-6 py-12 text-center">
              <AssetIcon name="file" className="h-7 w-7 text-white/45" />
              <div className="text-sm text-white/55">{tt("configEditor.pickFile")}</div>
            </div>
          ) : showHistory ? (
            <VersionsPane
              profileId={profileId}
              path={open.path}
              current={open.draft}
              language={language}
              onRestore={(content) => {
                setOpen((prev) => (prev ? { ...prev, draft: content } : prev));
                setShowHistory(false);
                showNotification("info", tt("configEditor.history.restored"));
              }}
              onClose={() => setShowHistory(false)}
              tt={tt}
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1 truncate font-mono text-[0.8125rem] text-white/70" title={open.path}>
                  {open.path}
                  {dirty ? <span className="ml-1.5 text-accent-hi">●</span> : null}
                </div>
                <input
                  value={findQuery}
                  onChange={(e) => setFindQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (!editorRef.current?.findNext(findQuery)) {
                        showNotification("info", tt("configEditor.findNothing"));
                      }
                    }
                  }}
                  placeholder={tt("configEditor.find")}
                  className="glass-control h-8 w-36 px-2.5 text-[0.8125rem] text-white outline-none placeholder:text-white/35"
                />
                <button type="button" onClick={() => setShowHistory(true)} className="btn btn-sm btn-ghost">
                  <AssetIcon name="clock" className="h-3.5 w-3.5" />
                  {tt("configEditor.history.open")}
                </button>
                <button type="button" onClick={revert} disabled={!dirty || saving} className="btn btn-sm btn-ghost">
                  {tt("configEditor.revert")}
                </button>
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={!dirty || saving}
                  className="btn btn-sm btn-accent"
                  title="Ctrl+S"
                >
                  {saving ? tt("configEditor.saving") : tt("configEditor.save")}
                </button>
              </div>
              {open.lossy ? (
                <div className="rounded-lg bg-amber-500/10 px-3 py-1.5 text-[0.75rem] text-amber-100/85">
                  {tt("configEditor.lossy")}
                </div>
              ) : null}
              {problem ? (
                <button
                  type="button"
                  onClick={() => problem.line && editorRef.current?.focusLine(problem.line)}
                  className="rounded-lg bg-red-500/10 px-3 py-1.5 text-left text-[0.75rem] text-red-200/90"
                >
                  {problem.line
                    ? tt("configEditor.problemAt", { line: problem.line, message: problem.message })
                    : problem.message}
                </button>
              ) : null}
              <CodeEditor
                ref={editorRef}
                value={open.draft}
                onChange={(draft) => setOpen((prev) => (prev ? { ...prev, draft } : prev))}
                format={format}
                errorLine={problem?.line ?? null}
                onSave={() => void save()}
                ariaLabel={open.path}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
