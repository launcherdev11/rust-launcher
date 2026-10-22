import { invoke } from "@tauri-apps/api/core";
import { open as openFile } from "@tauri-apps/plugin-dialog";
import {
  ExternalLink,
  FolderOpen,
  ImagePlus,
  PanelLeft,
  PanelRight,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { AssetIcon } from "../../components/asset_icon";
import { TextField } from "../../components/ui";
import {
  KNOWN_THEME_VARIABLES,
  THEME_SNIPPETS,
  THEME_VARIABLE_GROUPS,
  applyThemePreview,
  buildThemeStylesheet,
  cleanVariables,
  clearThemePreview,
  errorMessage,
  findCssProblem,
  isValidVariableName,
  lengthToPx,
  requestThemeReload,
  toHexColor,
  type ThemeDetails,
  type ThemeInfo,
  type ThemeVariableDef,
  type ThemeVariables,
} from "../../lib/customTheme";

type Translate = (key: string, vars?: Record<string, string | number>) => string;

type Props = {
  themeId: string;
  tt: Translate;
  onClose: () => void;
  onSaved: (info: ThemeInfo) => void;
  showNotification: (kind: "success" | "error", message: string) => void;
};

type MetaDraft = {
  name: string;
  author: string;
  description: string;
  version: string;
};

type EditorTab = "look" | "css" | "info";

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "svg", "avif"];
const FONT_EXTENSIONS = ["woff2", "woff", "ttf", "otf"];
const PREVIEW_DEBOUNCE_MS = 180;

function snapshotOf(meta: MetaDraft, variables: ThemeVariables, css: string) {
  return JSON.stringify({ meta, variables: cleanVariables(variables), css });
}

export function ThemeEditorPanel({ themeId, tt, onClose, onSaved, showNotification }: Props) {
  const te = useCallback<Translate>(
    (key, vars) => tt(`settings.launcher.themeEditor.${key}`, vars),
    [tt],
  );

  const [theme, setTheme] = useState<ThemeDetails | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [meta, setMeta] = useState<MetaDraft>({ name: "", author: "", description: "", version: "" });
  const [variables, setVariables] = useState<ThemeVariables>({});
  const [css, setCss] = useState("");
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const [tab, setTab] = useState<EditorTab>("look");
  const [livePreview, setLivePreview] = useState(true);
  const [side, setSide] = useState<"right" | "left">("right");
  const [saving, setSaving] = useState(false);
  const [newVarName, setNewVarName] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke<ThemeDetails>("get_theme", { themeId })
      .then((t) => {
        if (cancelled) return;
        const m = { name: t.name, author: t.author, description: t.description, version: t.version };
        setTheme(t);
        setMeta(m);
        setVariables(t.variables ?? {});
        setCss(t.css);
        setSavedSnapshot(snapshotOf(m, t.variables ?? {}, t.css));
      })
      .catch((e) => {
        if (!cancelled) setLoadError(errorMessage(e, te("loadFailed")));
      });
    return () => {
      cancelled = true;
    };
  }, [themeId, te]);

  // The preview replaces the saved theme's <style> until the panel closes or preview is turned off.
  useEffect(() => {
    if (!theme) return;
    if (!livePreview) {
      clearThemePreview();
      return;
    }
    const timer = window.setTimeout(() => {
      applyThemePreview(buildThemeStylesheet({ css, dir: theme.dir, variables }), themeId);
    }, PREVIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [theme, livePreview, css, variables, themeId]);

  useEffect(() => () => clearThemePreview(), []);

  const dirty = theme != null && snapshotOf(meta, variables, css) !== savedSnapshot;
  const cssProblem = useMemo(() => findCssProblem(css), [css]);

  const save = useCallback(async () => {
    if (!theme || saving) return;
    setSaving(true);
    try {
      const cleanVars = cleanVariables(variables);
      const info = await invoke<ThemeInfo>("save_theme", {
        themeId,
        meta: { ...meta, variables: cleanVars },
        css,
      });
      setSavedSnapshot(snapshotOf(meta, cleanVars, css));
      if (!livePreview) requestThemeReload();
      onSaved(info);
      showNotification("success", te("saved"));
    } catch (e) {
      showNotification("error", errorMessage(e, te("saveFailed")));
    } finally {
      setSaving(false);
    }
  }, [theme, saving, variables, themeId, meta, css, livePreview, onSaved, showNotification, te]);

  const requestClose = useCallback(() => {
    if (dirty && !window.confirm(te("discardConfirm"))) return;
    onClose();
  }, [dirty, onClose, te]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      } else if (e.key === "Escape") {
        e.preventDefault();
        requestClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [save, requestClose]);

  const setVariable = (name: string, value: string | null) => {
    setVariables((prev) => {
      const next = { ...prev };
      if (value == null || value.trim() === "") delete next[name];
      else next[name] = value;
      return next;
    });
  };

  const addAsset = async (extensions: string[]): Promise<string | null> => {
    try {
      const path = await openFile({
        multiple: false,
        directory: false,
        filters: [{ name: te("assetFilter"), extensions }],
      });
      if (!path || Array.isArray(path)) return null;
      return await invoke<string>("add_theme_asset", { themeId, sourcePath: path });
    } catch (e) {
      showNotification("error", errorMessage(e, te("assetFailed")));
      return null;
    }
  };

  const insertCss = (text: string) => {
    const ta = textareaRef.current;
    const start = ta?.selectionStart ?? css.length;
    const end = ta?.selectionEnd ?? css.length;
    const before = css.slice(0, start);
    const sep = before && !before.endsWith("\n\n") ? (before.endsWith("\n") ? "\n" : "\n\n") : "";
    const inserted = before + sep + text;
    setCss(inserted + css.slice(end));
    requestAnimationFrame(() => {
      ta?.focus();
      ta?.setSelectionRange(inserted.length, inserted.length);
    });
  };

  const customVariables = Object.keys(variables).filter((name) => !KNOWN_THEME_VARIABLES.has(name));

  const panel = (
    <div
      className={`glass-modal pointer-events-auto fixed bottom-3 top-12 z-[340] flex w-[min(30rem,calc(100vw-1.5rem))] flex-col overflow-hidden ${
        side === "right" ? "right-3" : "left-3"
      }`}
      role="dialog"
      aria-label={te("title")}
    >
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/[0.07] px-4 py-3">
        <div className="min-w-0">
          <h2 className="ui-title truncate text-base">{te("title")}</h2>
          <p className="ui-meta truncate">
            {meta.name || themeId}
            {dirty ? ` · ${te("unsaved")}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            className="icon-btn"
            onClick={() => setSide((s) => (s === "right" ? "left" : "right"))}
            title={te("switchSide")}
            aria-label={te("switchSide")}
          >
            {side === "right" ? <PanelLeft className="h-4 w-4" /> : <PanelRight className="h-4 w-4" />}
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={requestClose}
            title={te("close")}
            aria-label={te("close")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="shrink-0 px-4 pt-3">
        <div className="seg-track flex gap-1 p-1">
          {(["look", "css", "info"] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                tab === id ? "seg-on" : "text-white/60 hover:text-white"
              }`}
            >
              {te(`tabs.${id}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {loadError ? (
          <p className="ui-body text-red-300">{loadError}</p>
        ) : !theme ? (
          <p className="ui-meta">{te("loading")}</p>
        ) : tab === "look" ? (
          <div className="space-y-5">
            <p className="ui-meta">{te("lookHint")}</p>
            {THEME_VARIABLE_GROUPS.map((group) => (
              <section key={group.id} className="space-y-2">
                <h3 className="ui-section">{te(`groups.${group.id}`)}</h3>
                {group.id === "accent" && <p className="ui-caption">{te("accentHint")}</p>}
                {group.id === "background" && <p className="ui-caption">{te("backgroundHint")}</p>}
                <div className="space-y-1.5">
                  {group.vars.map((def) => (
                    <VariableRow
                      key={def.name}
                      def={def}
                      label={te(`vars.${def.name.slice(2)}`)}
                      value={variables[def.name] ?? ""}
                      onChange={(v) => setVariable(def.name, v)}
                      te={te}
                      onPickImage={async () => {
                        const rel = await addAsset(IMAGE_EXTENSIONS);
                        if (rel) setVariable(def.name, `url(${rel})`);
                      }}
                    />
                  ))}
                </div>
              </section>
            ))}

            <section className="space-y-2">
              <h3 className="ui-section">{te("groups.custom")}</h3>
              <p className="ui-caption">{te("customHint")}</p>
              {customVariables.map((name) => (
                <div key={name} className="flex items-center gap-2">
                  <code className="w-36 shrink-0 truncate text-xs text-white/70" title={name}>
                    {name}
                  </code>
                  <TextField
                    value={variables[name] ?? ""}
                    onChange={(e) => setVariable(name, e.target.value)}
                    clearable={false}
                    className="!py-1.5 text-xs"
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => setVariable(name, null)}
                    title={te("removeVar")}
                    aria-label={te("removeVar")}
                  >
                    <AssetIcon name="delete" />
                  </button>
                </div>
              ))}
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = newVarName.trim();
                  if (!isValidVariableName(name)) {
                    showNotification("error", te("badVarName"));
                    return;
                  }
                  if (!(name in variables)) setVariables((prev) => ({ ...prev, [name]: "" }));
                  setNewVarName("");
                }}
              >
                <TextField
                  value={newVarName}
                  onChange={(e) => setNewVarName(e.target.value)}
                  placeholder="--my-color"
                  className="!py-1.5 font-mono text-xs"
                />
                <button type="submit" className="btn btn-sm btn-soft">
                  <Plus className="h-3.5 w-3.5" />
                  {te("addVar")}
                </button>
              </form>
            </section>
          </div>
        ) : tab === "css" ? (
          <div className="flex h-full min-h-[20rem] flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="glass-control launcher-select h-8 min-w-0 flex-1 px-3 text-xs"
                value=""
                onChange={(e) => {
                  const snippet = THEME_SNIPPETS.find((s) => s.id === e.target.value);
                  if (snippet) insertCss(snippet.css);
                }}
              >
                <option value="">{te("snippets.placeholder")}</option>
                {THEME_SNIPPETS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {te(`snippets.${s.id}`)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-sm btn-soft"
                onClick={async () => {
                  const rel = await addAsset([...IMAGE_EXTENSIONS, ...FONT_EXTENSIONS]);
                  if (rel) insertCss(`url(${rel})`);
                }}
                title={te("insertAssetHint")}
              >
                <ImagePlus className="h-3.5 w-3.5" />
                {te("insertAsset")}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={async () => {
                  if (dirty) showNotification("error", te("externalUnsaved"));
                  try {
                    await invoke("open_theme_css_file", { themeId });
                  } catch (e) {
                    showNotification("error", errorMessage(e, tt("settings.launcher.customThemes.editCssFailed")));
                  }
                }}
                title={te("externalHint")}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {te("external")}
              </button>
            </div>
            <textarea
              ref={textareaRef}
              value={css}
              onChange={(e) => setCss(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Tab" || e.shiftKey) return;
                e.preventDefault();
                const ta = e.currentTarget;
                const { selectionStart: s, selectionEnd: end } = ta;
                const next = `${css.slice(0, s)}  ${css.slice(end)}`;
                setCss(next);
                requestAnimationFrame(() => ta.setSelectionRange(s + 2, s + 2));
              }}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className="glass-control custom-scrollbar min-h-[18rem] w-full flex-1 resize-none whitespace-pre p-3 font-mono text-xs leading-5 text-white outline-none"
            />
            <p className={`ui-caption ${cssProblem ? "!text-amber-300" : ""}`}>
              {cssProblem
                ? te(`cssProblem.${cssProblem.kind}`, { line: cssProblem.line })
                : te("cssOk")}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <Field label={te("info.name")}>
              <TextField value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} />
            </Field>
            <Field label={te("info.author")}>
              <TextField value={meta.author} onChange={(e) => setMeta({ ...meta, author: e.target.value })} />
            </Field>
            <Field label={te("info.version")}>
              <TextField
                value={meta.version}
                onChange={(e) => setMeta({ ...meta, version: e.target.value })}
                placeholder="1.0.0"
              />
            </Field>
            <Field label={te("info.description")}>
              <textarea
                value={meta.description}
                onChange={(e) => setMeta({ ...meta, description: e.target.value })}
                rows={3}
                className="glass-control ui-body w-full resize-y px-3 py-2 text-white outline-none"
              />
            </Field>
            <div className="glass-inset space-y-2 p-3">
              <p className="ui-meta">
                {te("info.id")}: <code className="text-white/80">{themeId}</code>
              </p>
              <p className="ui-caption">{te("info.previewHint")}</p>
              <button
                type="button"
                className="btn btn-sm btn-soft"
                onClick={() =>
                  invoke("open_theme_folder", { themeId }).catch((e) =>
                    showNotification("error", errorMessage(e, te("openFolderFailed"))),
                  )
                }
              >
                <FolderOpen className="h-3.5 w-3.5" />
                {te("info.openFolder")}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-white/[0.07] px-4 py-3">
        <label className="flex min-w-0 cursor-pointer items-center gap-2 text-xs text-white/75">
          <input
            type="checkbox"
            className="accent-checkbox"
            checked={livePreview}
            onChange={(e) => setLivePreview(e.target.checked)}
          />
          <span className="truncate">{te("livePreview")}</span>
        </label>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" className="btn btn-sm btn-ghost" onClick={requestClose}>
            {te("cancel")}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-accent"
            onClick={() => void save()}
            disabled={!theme || saving || !dirty}
            title="Ctrl+S"
          >
            {saving ? te("saving") : te("save")}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="ui-meta">{label}</span>
      {children}
    </label>
  );
}

function VariableRow({
  def,
  label,
  value,
  onChange,
  te,
  onPickImage,
}: {
  def: ThemeVariableDef;
  label: string;
  value: string;
  onChange: (value: string | null) => void;
  te: Translate;
  onPickImage: () => void;
}) {
  const placeholder = def.fallback || te("auto");
  const hex = toHexColor(value) ?? toHexColor(def.fallback) ?? "#808080";
  const px = lengthToPx(value) ?? lengthToPx(def.fallback) ?? 0;

  return (
    <div className="flex items-center gap-2">
      <span className="w-32 shrink-0 truncate text-xs text-white/80" title={def.name}>
        {label}
      </span>
      {def.kind === "color" && (
        <input
          type="color"
          value={hex}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-9 shrink-0 cursor-pointer rounded-lg border border-white/10 bg-transparent p-0.5"
          title={def.name}
        />
      )}
      {def.kind === "length" && (
        <input
          type="range"
          min={0}
          max={def.max ?? 32}
          step={1}
          value={px}
          onChange={(e) => onChange(`${e.target.value}px`)}
          className="w-24 shrink-0"
          title={def.name}
        />
      )}
      <TextField
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        clearable={false}
        className="!py-1.5 font-mono text-xs"
      />
      {def.kind === "image" && (
        <button
          type="button"
          className="icon-btn"
          onClick={onPickImage}
          title={te("pickImage")}
          aria-label={te("pickImage")}
        >
          <ImagePlus className="h-4 w-4" />
        </button>
      )}
      <button
        type="button"
        className="icon-btn disabled:opacity-30"
        onClick={() => onChange(null)}
        disabled={!value}
        title={te("resetVar")}
        aria-label={te("resetVar")}
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
