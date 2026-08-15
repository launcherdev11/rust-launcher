import { useCallback, useEffect, useRef, useState } from "react";
import { IdleAnimation, SkinViewer } from "skinview3d";
import {
  DEFAULT_SKIN_URL,
  applyMcSkinByUsername,
  loadViewerSkinSource,
  type ProfileAvatarInput,
} from "../lib/avatar";
import {
  fetchMcCapes,
  findActiveMcCape,
  renderAssembledCapeThumbnail,
  selectMcCape,
  type McCape,
} from "../lib/cape";

export type AccountSkinPreviewProps = {
  profile: ProfileAvatarInput;
  username: string;
  showCapePicker?: boolean;
  onSettingsClick?: () => void;
  settingsTitle?: string;
  capePickerTitle?: string;
  capeNoneLabel?: string;
  capeEmptyHint?: string;
  capeLoadingLabel?: string;
  capeErrorHint?: string;
  skinByUsernameTitle?: string;
  skinByUsernamePlaceholder?: string;
  skinByUsernameApply?: string;
  skinByUsernameReset?: string;
  skinByUsernameLoading?: string;
  skinByUsernameError?: string;
  skinByUsernameNotFound?: string;
  className?: string;
};

export function AccountSkinPreview({
  profile,
  username,
  showCapePicker = false,
  onSettingsClick,
  settingsTitle,
  capePickerTitle = "Cape",
  capeNoneLabel = "No cape",
  capeEmptyHint = "You have no capes on this account.",
  capeLoadingLabel = "Loading capes…",
  capeErrorHint = "Failed to load capes.",
  skinByUsernameTitle = "Skin by username",
  skinByUsernamePlaceholder = "Steve",
  skinByUsernameApply = "Apply",
  skinByUsernameReset = "Reset",
  skinByUsernameLoading = "Loading skin…",
  skinByUsernameError = "Failed to load skin.",
  skinByUsernameNotFound = "Player not found.",
  className,
}: AccountSkinPreviewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<SkinViewer | null>(null);
  const skinPanelRef = useRef<HTMLDivElement>(null);
  const [capePickerOpen, setCapePickerOpen] = useState(false);
  const [skinByUsernameOpen, setSkinByUsernameOpen] = useState(false);
  const [capes, setCapes] = useState<McCape[]>([]);
  const [capesLoading, setCapesLoading] = useState(false);
  const [capesError, setCapesError] = useState<string | null>(null);
  const [capeApplying, setCapeApplying] = useState(false);
  const [previewCapeUrl, setPreviewCapeUrl] = useState<string | null>(null);
  const [skinUsernameDraft, setSkinUsernameDraft] = useState("");
  const [skinOverrideUrl, setSkinOverrideUrl] = useState<string | null>(null);
  const [skinOverrideLabel, setSkinOverrideLabel] = useState<string | null>(null);
  const [skinLookupLoading, setSkinLookupLoading] = useState(false);
  const [skinLookupError, setSkinLookupError] = useState<string | null>(null);

  const activeCape = findActiveMcCape(capes);

  const loadCapes = useCallback(async () => {
    if (!showCapePicker) return;
    setCapesLoading(true);
    setCapesError(null);
    try {
      const list = await fetchMcCapes();
      setCapes(list);
      const active = findActiveMcCape(list);
      setPreviewCapeUrl(active?.url ?? null);
    } catch (error) {
      console.debug("[cape] failed to load capes", error);
      setCapesError(capeErrorHint);
      setCapes([]);
      setPreviewCapeUrl(null);
    } finally {
      setCapesLoading(false);
    }
  }, [showCapePicker, capeErrorHint]);

  useEffect(() => {
    setCapePickerOpen(false);
    setCapes([]);
    setCapesError(null);
    setPreviewCapeUrl(null);
    setSkinByUsernameOpen(false);
    setSkinUsernameDraft("");
    setSkinOverrideUrl(null);
    setSkinOverrideLabel(null);
    setSkinLookupLoading(false);
    setSkinLookupError(null);
    if (showCapePicker) {
      void loadCapes();
    }
  }, [showCapePicker, profile.mc_uuid, loadCapes]);

  useEffect(() => {
    if (!capePickerOpen && !skinByUsernameOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (capePickerOpen && rootRef.current && !rootRef.current.contains(target)) {
        setCapePickerOpen(false);
      }
      if (skinByUsernameOpen && skinPanelRef.current && !skinPanelRef.current.contains(target)) {
        setSkinByUsernameOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (skinByUsernameOpen) {
        setSkinByUsernameOpen(false);
        return;
      }
      if (capePickerOpen) setCapePickerOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [capePickerOpen, skinByUsernameOpen]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const canvas = document.createElement("canvas");
    canvas.className = "block h-full w-full";
    container.appendChild(canvas);

    const width = Math.max(container.clientWidth, 280);
    const height = Math.max(container.clientHeight, 360);

    const viewer = new SkinViewer({
      canvas,
      width,
      height,
    });
    viewer.autoRotate = false;
    viewer.zoom = 0.82;
    viewer.animation = new IdleAnimation();
    viewer.playerObject.rotation.y = Math.PI * 0.22;
    viewerRef.current = viewer;

    const resize = () => {
      const nextWidth = container.clientWidth;
      const nextHeight = container.clientHeight;
      if (nextWidth > 0 && nextHeight > 0) {
        viewer.setSize(nextWidth, nextHeight);
      }
    };

    const resizeObserver = new ResizeObserver(() => resize());
    resizeObserver.observe(container);
    resize();

    return () => {
      resizeObserver.disconnect();
      viewer.dispose();
      viewerRef.current = null;
      canvas.remove();
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.disposed) return;

    let cancelled = false;
    let blobUrl: string | null = null;

    const applySkin = async () => {
      try {
        if (skinOverrideUrl) {
          await viewer.loadSkin(skinOverrideUrl, { ears: false, model: "auto-detect" });
          if (cancelled || viewer.disposed) return;
          viewer.playerObject.ears.visible = false;
          return;
        }

        const source = await loadViewerSkinSource(profile, username);
        if (cancelled || viewer.disposed) return;

        if (source.startsWith("blob:")) {
          blobUrl = source;
        }

        await viewer.loadSkin(source, { ears: false, model: "auto-detect" });
        if (cancelled || viewer.disposed) return;
        viewer.playerObject.ears.visible = false;
      } catch (error) {
        console.debug("[skin] failed to load skin preview", error);
        if (!cancelled && !viewer.disposed) {
          await viewer.loadSkin(DEFAULT_SKIN_URL, { ears: false, model: "auto-detect" });
          if (cancelled || viewer.disposed) return;
          viewer.playerObject.ears.visible = false;
        }
      }
    };

    void applySkin();

    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [
    profile.nickname,
    profile.ely_username,
    profile.ely_uuid,
    profile.mc_uuid,
    username,
    skinOverrideUrl,
  ]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.disposed) return;

    let cancelled = false;

    const applyCape = async () => {
      if (!showCapePicker || !previewCapeUrl) {
        viewer.loadCape(null);
        return;
      }
      try {
        await viewer.loadCape(previewCapeUrl, { backEquipment: "cape" });
        if (cancelled || viewer.disposed) return;
      } catch (error) {
        console.debug("[cape] failed to load cape preview", error);
        if (!cancelled && !viewer.disposed) {
          viewer.loadCape(null);
        }
      }
    };

    void applyCape();

    return () => {
      cancelled = true;
    };
  }, [showCapePicker, previewCapeUrl]);

  const handleSelectCape = async (capeId: string | null) => {
    if (capeApplying) return;
    setCapeApplying(true);
    setCapesError(null);
    try {
      const updated = await selectMcCape(capeId);
      setCapes(updated);
      const active = findActiveMcCape(updated);
      setPreviewCapeUrl(active?.url ?? null);
    } catch (error) {
      console.debug("[cape] failed to select cape", error);
      setCapesError(capeErrorHint);
    } finally {
      setCapeApplying(false);
    }
  };

  const handleResetSkinOverride = () => {
    setSkinOverrideUrl(null);
    setSkinOverrideLabel(null);
    setSkinLookupError(null);
    setSkinUsernameDraft("");
  };

  const handleApplySkinByUsername = async () => {
    const nextUsername = skinUsernameDraft.trim();
    if (!nextUsername || skinLookupLoading) return;

    setSkinLookupLoading(true);
    setSkinLookupError(null);
    try {
      const dataUrl = await applyMcSkinByUsername(nextUsername);
      setSkinOverrideUrl(dataUrl);
      setSkinOverrideLabel(nextUsername);
    } catch (error) {
      console.debug("[skin] failed to apply skin by username", error);
      const message = error instanceof Error ? error.message : "";
      if (message.toLowerCase().includes("not found")) {
        setSkinLookupError(skinByUsernameNotFound);
      } else {
        setSkinLookupError(message.trim() || skinByUsernameError);
      }
    } finally {
      setSkinLookupLoading(false);
    }
  };

  const selectedCapeId = activeCape?.id ?? null;

  return (
    <div
      ref={rootRef}
      className={
        className ??
        "relative flex h-full min-h-[min(360px,40vh)] w-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/40 shadow-xl backdrop-blur-md"
      }
    >
      {onSettingsClick ? (
        <button
          type="button"
          onClick={onSettingsClick}
          className="interactive-press absolute left-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-black/50 backdrop-blur-sm transition hover:bg-black/70"
          title={settingsTitle}
        >
          <img src="/launcher-assets/settings.png" alt="" className="h-4 w-4 object-contain" />
        </button>
      ) : null}

      {showCapePicker ? (
        <div className="absolute right-3 top-3 z-10 flex flex-col items-end gap-2">
          <button
            type="button"
            onClick={() => {
              setSkinByUsernameOpen(false);
              setCapePickerOpen((open) => !open);
            }}
            className="interactive-press flex h-9 items-center gap-2 rounded-xl border border-white/[0.08] bg-[#16161e]/95 px-3 text-xs font-semibold text-white/90 shadow-[0_4px_16px_rgba(0,0,0,0.35)] transition hover:bg-[#1c1c26] hover:border-white/[0.12]"
            title={capePickerTitle}
            aria-expanded={capePickerOpen}
          >
            <CapeIcon />
            <span>{capePickerTitle}</span>
            {activeCape ? (
              <span className="ml-0.5 h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]" />
            ) : null}
          </button>

          {capePickerOpen ? (
            <div className="w-[min(100vw-2rem,15.5rem)] overflow-hidden rounded-xl border border-white/[0.07] bg-[#16161e] shadow-[0_16px_48px_rgba(0,0,0,0.55)]">
              <div className="border-b border-white/[0.06] px-3 py-2.5">
                <p className="text-[11px] font-semibold text-white/85">{capePickerTitle}</p>
                <p className="mt-0.5 truncate text-[10px] text-white/40">
                  {activeCape ? activeCape.alias : capeNoneLabel}
                </p>
              </div>

              <div className="max-h-[min(50vh,16rem)] overflow-y-auto py-1">
                {capesLoading ? (
                  <div className="flex items-center justify-center gap-2 py-8 text-xs text-white/50">
                    <SpinnerIcon />
                    {capeLoadingLabel}
                  </div>
                ) : capesError ? (
                  <div className="px-3 py-6 text-center">
                    <p className="text-xs text-amber-200/80">{capesError}</p>
                    <button
                      type="button"
                      onClick={() => void loadCapes()}
                      className="interactive-press mt-2 rounded-lg border border-white/10 px-3 py-1.5 text-[11px] font-semibold text-white/70 hover:bg-white/[0.06]"
                    >
                      ↻
                    </button>
                  </div>
                ) : (
                  <ul className="flex flex-col">
                    <CapeListItem
                      label={capeNoneLabel}
                      selected={selectedCapeId === null}
                      disabled={capeApplying}
                      onClick={() => void handleSelectCape(null)}
                    >
                      <div className="flex h-full w-full items-center justify-center">
                        <NoCapeIcon />
                      </div>
                    </CapeListItem>

                    {capes.map((cape) => (
                      <CapeListItem
                        key={cape.id}
                        label={cape.alias}
                        selected={selectedCapeId === cape.id}
                        disabled={capeApplying}
                        onClick={() => void handleSelectCape(cape.id)}
                      >
                        <CapeThumbnail url={cape.url} />
                      </CapeListItem>
                    ))}
                  </ul>
                )}

                {!capesLoading && !capesError && capes.length === 0 ? (
                  <p className="px-3 py-2 text-center text-[11px] leading-snug text-white/40">
                    {capeEmptyHint}
                  </p>
                ) : null}
              </div>

              {capeApplying ? (
                <div className="border-t border-white/[0.06] px-3 py-1.5 text-center text-[10px] text-white/40">
                  …
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(16,185,129,0.12),transparent_68%)]"
        aria-hidden
      />
      <div ref={containerRef} className="relative min-h-0 flex-1" />

      {showCapePicker ? (
        <div ref={skinPanelRef} className="absolute bottom-3 left-3 z-10 flex flex-col items-start gap-2">
          {skinByUsernameOpen ? (
            <div className="w-[min(100vw-2rem,18.5rem)] overflow-hidden rounded-xl border border-white/[0.07] bg-[#16161e] shadow-[0_16px_48px_rgba(0,0,0,0.55)]">
              <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-3 py-2.5">
                <p className="text-[11px] font-semibold text-white/85">{skinByUsernameTitle}</p>
                {skinOverrideLabel ? (
                  <button
                    type="button"
                    onClick={handleResetSkinOverride}
                    className="interactive-press shrink-0 text-[10px] font-semibold text-emerald-300/80 hover:text-emerald-200"
                    title={skinByUsernameReset}
                  >
                    {skinByUsernameReset}
                  </button>
                ) : null}
              </div>

              <form
                className="flex items-center gap-2 px-3 py-2.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleApplySkinByUsername();
                }}
              >
                <input
                  type="text"
                  autoFocus
                  value={skinUsernameDraft}
                  onChange={(event) => {
                    setSkinUsernameDraft(event.target.value);
                    if (skinLookupError) setSkinLookupError(null);
                  }}
                  placeholder={skinByUsernamePlaceholder}
                  disabled={skinLookupLoading}
                  spellCheck={false}
                  autoComplete="off"
                  className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/35 px-2.5 py-1.5 text-xs text-white/90 outline-none transition placeholder:text-white/30 focus:border-emerald-400/35 disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={skinLookupLoading || !skinUsernameDraft.trim()}
                  className="interactive-press shrink-0 rounded-lg border border-emerald-400/25 bg-emerald-500/15 px-3 py-1.5 text-[11px] font-semibold text-emerald-100/95 transition hover:bg-emerald-500/25 disabled:opacity-50"
                >
                  {skinLookupLoading ? "…" : skinByUsernameApply}
                </button>
              </form>

              {skinLookupLoading ? (
                <p className="px-3 pb-2.5 text-[10px] text-white/40">{skinByUsernameLoading}</p>
              ) : skinLookupError ? (
                <p className="px-3 pb-2.5 text-[10px] text-amber-200/80">{skinLookupError}</p>
              ) : skinOverrideLabel ? (
                <p className="truncate px-3 pb-2.5 text-[10px] text-emerald-200/70">{skinOverrideLabel}</p>
              ) : null}
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => {
              setCapePickerOpen(false);
              setSkinByUsernameOpen((open) => !open);
            }}
            className="interactive-press flex h-9 items-center gap-2 rounded-xl border border-white/[0.08] bg-[#16161e]/95 px-3 text-xs font-semibold text-white/90 shadow-[0_4px_16px_rgba(0,0,0,0.35)] transition hover:border-white/[0.12] hover:bg-[#1c1c26]"
            title={skinByUsernameTitle}
            aria-expanded={skinByUsernameOpen}
          >
            <SkinIcon />
            <span>{skinByUsernameTitle}</span>
            {skinOverrideLabel ? (
              <span className="ml-0.5 h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]" />
            ) : null}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function CapeThumbnail({ url }: { url: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);

    void renderAssembledCapeThumbnail(url)
      .then((dataUrl) => {
        if (!cancelled) setSrc(dataUrl);
      })
      .catch((error) => {
        console.debug("[cape] failed to render cape thumbnail", error);
        if (!cancelled) setSrc(null);
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <div className="relative flex h-full items-center justify-center overflow-hidden">
      {src ? (
        <img
          src={src}
          alt=""
          className="h-full w-auto max-w-none drop-shadow-[0_2px_6px_rgba(0,0,0,0.45)]"
          style={{ imageRendering: "pixelated" }}
        />
      ) : (
        <div className="h-4 w-4 animate-pulse rounded bg-white/10" aria-hidden />
      )}
    </div>
  );
}

function CapeListItem({
  label,
  selected,
  disabled,
  onClick,
  children,
}: {
  label: string;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        title={label}
        className={`interactive-press flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition disabled:opacity-60 ${
          selected
            ? "bg-emerald-500/[0.08]"
            : "hover:bg-white/[0.04]"
        }`}
      >
        <div
          className={`relative flex h-8 w-5 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-[#0c0c11] ${
            selected ? "border-emerald-400/35" : "border-white/[0.07]"
          }`}
        >
          {children}
        </div>
        <span
          className={`min-w-0 flex-1 truncate text-[11px] font-medium ${
            selected ? "text-emerald-100/95" : "text-white/75"
          }`}
        >
          {label}
        </span>
        <span
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition ${
            selected
              ? "border-emerald-400/50 bg-emerald-500 text-white"
              : "border-white/15 bg-transparent"
          }`}
          aria-hidden
        >
          {selected ? <CheckIcon /> : null}
        </span>
      </button>
    </li>
  );
}

function SkinIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
      <path d="M12 3.5c-1.9 0-3.4 1.5-3.4 3.4S10.1 10.3 12 10.3s3.4-1.5 3.4-3.4S13.9 3.5 12 3.5Zm0 8.2c-3.3 0-6.5 1.8-6.5 4.3v1.7c0 .6.5 1.1 1.1 1.1h10.8c.6 0 1.1-.5 1.1-1.1v-1.7c0-2.5-3.2-4.3-6.5-4.3Z" />
    </svg>
  );
}

function CapeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
      <path d="M12 3c-2.4 0-4.4.7-5.6 1.6-.7.5-1.1 1.2-1.2 1.9L4.8 18.2c-.1.7.3 1.3.9 1.6.5.2 1.1.2 1.5-.2L9 17.3l2.2 3.2c.3.4.8.6 1.3.5.5-.1.8-.5.9-1l1.1-4.3 2.7 2.2c.5.4 1.1.4 1.6.2.6-.3 1-.9.9-1.6l-.4-11.7c-.1-.7-.5-1.4-1.2-1.9C16.4 3.7 14.4 3 12 3Zm0 2c1.9 0 3.4.5 4.2 1.1.2.2.3.3.3.4l.3 9.2-2.6-2.1c-.5-.4-1.2-.4-1.7 0-.4.3-.6.8-.6 1.3l-.8 3.1-1.5-2.2c-.3-.5-.9-.7-1.5-.5-.3.1-.5.3-.7.5L6.5 16.6l.4-9.1c0-.1.1-.2.3-.4C8.6 5.5 10.1 5 12 5Z" />
    </svg>
  );
}

function NoCapeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 text-white/25" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 3c-2.4 0-4.4.7-5.6 1.6-.7.5-1.1 1.2-1.2 1.9L4.8 18.2c-.1.7.3 1.3.9 1.6.5.2 1.1.2 1.5-.2L9 17.3l2.2 3.2c.3.4.8.6 1.3.5.5-.1.8-.5.9-1l1.1-4.3 2.7 2.2c.5.4 1.1.4 1.6.2.6-.3 1-.9.9-1.6l-.4-11.7c-.1-.7-.5-1.4-1.2-1.9C16.4 3.7 14.4 3 12 3Z"
        opacity="0.5"
      />
      <path
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        d="M5 5l14 14"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 fill-current" aria-hidden="true">
      <path d="M10.2 2.8 4.5 8.5 1.8 5.8l-.9.9 3.6 3.6 6.6-6.6-.9-.9Z" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4 animate-spin text-white/40"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
        fill="none"
        strokeDasharray="31.4 31.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
