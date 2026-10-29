import { useEffect, useState } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AccountSkinPreview } from "../../components/LazyAccountSkinPreview";
import { InputClearButton, Spinner } from "../../components/ui";
import { useT, type Language } from "../../i18n";
import type { ProfileAvatarInput } from "../../lib/avatar";
import { renderAssembledCapeThumbnail, type McCape } from "../../lib/cape";
import { renderAssembledSkinThumbnail, type McSkin, type SkinModelVariant } from "../../lib/skin";
import { AssetIcon, MicrosoftIcon } from "./icons";
import { wardrobeErrorText, type WardrobeState } from "./useWardrobe";

type NotificationKind = "info" | "success" | "error" | "warning";

type WardrobePanelProps = {
  language: Language;
  wardrobe: WardrobeState;
  accountKind: string;
  profile: ProfileAvatarInput;
  username: string;
  viewerKey: string;
  msLoading: boolean;
  onMicrosoftLogin: () => void | Promise<void>;
  showNotification: (kind: NotificationKind, message: string) => void;
};

type Tool = "upload" | "username" | null;

const softButton =
  "interactive-press rounded-lg border border-white/10 bg-black/35 px-3 py-1.5 text-[0.8125rem] font-semibold text-white/75 transition hover:bg-black/55 hover:text-white disabled:opacity-50";
const softButtonOn =
  "interactive-press rounded-lg border border-accent-to/40 bg-accent-from/20 px-3 py-1.5 text-[0.8125rem] font-semibold text-accent-hi transition hover:bg-accent-from/30 disabled:opacity-50";

export function WardrobePanel({
  language,
  wardrobe,
  accountKind,
  profile,
  username,
  viewerKey,
  msLoading,
  onMicrosoftLogin,
  showNotification,
}: WardrobePanelProps) {
  const tt = useT(language);
  const [tool, setTool] = useState<Tool>(null);

  const applyPending = async () => {
    try {
      await wardrobe.applyPending();
      showNotification("success", tt("app.accounts.wardrobe.applied"));
    } catch (error) {
      console.debug("[wardrobe] failed to apply", error);
      showNotification("error", wardrobeErrorText(error) || tt("app.accounts.skinLibrary.error"));
    }
  };

  const onToolDone = () => {
    setTool(null);
    showNotification("success", tt("app.accounts.wardrobe.applied"));
  };

  const pendingSkinLabel = wardrobe.pendingSkin?.alias ?? wardrobe.activeSkin?.alias ?? "—";
  const pendingCapeLabel = wardrobe.pendingCape
    ? wardrobe.pendingCape.alias ?? tt("app.accounts.cape.none")
    : wardrobe.activeCape?.alias ?? tt("app.accounts.cape.none");
  const listsLoading = wardrobe.skinsLoading || wardrobe.capesLoading;

  return (
    <div className="grid gap-3 md:min-h-0 md:flex-1 md:grid-cols-[minmax(0,1.3fr)_minmax(280px,0.9fr)] md:gap-4">
      <section className="glass-panel flex min-h-[320px] min-w-0 flex-col overflow-hidden md:min-h-0">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-white/95">{tt("app.accounts.wardrobe.title")}</h2>
            <p className="mt-0.5 truncate text-[0.8125rem] text-white/40">
              {wardrobe.enabled
                ? tt("app.accounts.wardrobe.subtitle")
                : tt("app.accounts.skinLibrary.microsoftOnly")}
            </p>
          </div>
          {wardrobe.enabled ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setTool((t) => (t === "upload" ? null : "upload"))}
                className={tool === "upload" ? softButtonOn : softButton}
              >
                {tt("app.accounts.skinUpload.title")}
              </button>
              <button
                type="button"
                onClick={() => setTool((t) => (t === "username" ? null : "username"))}
                className={tool === "username" ? softButtonOn : softButton}
              >
                {tt("app.accounts.skinByUsername.title")}
              </button>
              <button
                type="button"
                disabled={listsLoading}
                onClick={() => void wardrobe.reload()}
                className="interactive-press inline-flex items-center justify-center rounded-lg border border-white/10 px-2.5 py-1.5 hover:bg-white/[0.06] disabled:opacity-50"
                title={tt("achievements.refresh")}
                aria-label={tt("achievements.refresh")}
              >
                <AssetIcon name="refresh" className="h-4 w-4 opacity-80" />
              </button>
            </div>
          ) : null}
        </div>

        {wardrobe.enabled ? (
          <>
            {tool === "upload" ? (
              <UploadTool language={language} wardrobe={wardrobe} onDone={onToolDone} />
            ) : null}
            {tool === "username" ? (
              <UsernameTool language={language} wardrobe={wardrobe} onDone={onToolDone} />
            ) : null}

            <div className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
              <section className="flex flex-col gap-2">
                <p className="text-xs font-bold text-white/45">{tt("app.accounts.wardrobe.skins")}</p>
                {wardrobe.skinsLoading && wardrobe.skins.length === 0 ? (
                  <LoadingRow label={tt("app.accounts.skinLibrary.loading")} />
                ) : wardrobe.skinsError !== null ? (
                  <ErrorRow
                    message={wardrobe.skinsError || tt("app.accounts.skinLibrary.error")}
                    onRetry={() => void wardrobe.reload()}
                  />
                ) : wardrobe.skins.length === 0 ? (
                  <p className="py-4 text-xs text-white/45">{tt("app.accounts.skinLibrary.empty")}</p>
                ) : (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2">
                    {wardrobe.skins.map((skin) => (
                      <SkinTile
                        key={skin.id}
                        skin={skin}
                        language={language}
                        pending={wardrobe.pendingSkin?.id === skin.id}
                        disabled={wardrobe.busy !== null}
                        onClick={() => void wardrobe.previewSkin(skin)}
                      />
                    ))}
                  </div>
                )}
              </section>

              <section className="flex flex-col gap-2">
                <p className="text-xs font-bold text-white/45">{tt("app.accounts.wardrobe.capes")}</p>
                {wardrobe.capesLoading && wardrobe.capes.length === 0 ? (
                  <LoadingRow label={tt("app.accounts.cape.loading")} />
                ) : wardrobe.capesError !== null ? (
                  <ErrorRow
                    message={wardrobe.capesError || tt("app.accounts.cape.error")}
                    onRetry={() => void wardrobe.reload()}
                  />
                ) : (
                  <>
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2">
                      <CapeTile
                        cape={null}
                        label={tt("app.accounts.cape.none")}
                        active={!wardrobe.activeCape}
                        pending={wardrobe.pendingCape !== null && wardrobe.pendingCape.id === null}
                        activeLabel={tt("app.accounts.skinLibrary.active")}
                        disabled={wardrobe.busy !== null}
                        onClick={() => void wardrobe.previewCape(null)}
                      />
                      {wardrobe.capes.map((cape) => (
                        <CapeTile
                          key={cape.id}
                          cape={cape}
                          label={cape.alias}
                          active={cape.state === "ACTIVE"}
                          pending={wardrobe.pendingCape?.id === cape.id}
                          activeLabel={tt("app.accounts.skinLibrary.active")}
                          disabled={wardrobe.busy !== null}
                          onClick={() => void wardrobe.previewCape(cape)}
                        />
                      ))}
                    </div>
                    {wardrobe.capes.length === 0 ? (
                      <p className="text-[0.8125rem] text-white/40">{tt("app.accounts.cape.empty")}</p>
                    ) : null}
                  </>
                )}
              </section>
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
            <p className="max-w-sm text-sm text-white/55">
              {accountKind === "ely"
                ? tt("app.accounts.wardrobe.elyBody")
                : tt("app.accounts.wardrobe.microsoftOnlyBody")}
            </p>
            {accountKind === "ely" ? (
              <button type="button" className={softButton} onClick={() => void openUrl("https://ely.by/skins")}>
                {tt("app.accounts.wardrobe.openEly")}
              </button>
            ) : (
              <button
                type="button"
                disabled={msLoading}
                onClick={() => void onMicrosoftLogin()}
                className="interactive-press flex items-center gap-2 rounded-xl border border-white/10 bg-black/35 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-black/55 hover:text-white disabled:opacity-60"
              >
                <MicrosoftIcon />
                {tt("app.accounts.microsoftSignIn")}
              </button>
            )}
          </div>
        )}
      </section>

      <div className="flex min-h-[min(380px,48vh)] min-w-0 flex-col md:min-h-0">
        <AccountSkinPreview
          key={viewerKey}
          profile={profile}
          username={username}
          skinUrl={wardrobe.viewerSkinUrl}
          capeUrl={wardrobe.viewerCapeUrl}
        >
          {wardrobe.enabled ? (
            <div className="absolute inset-x-3 bottom-3 z-10">
              {wardrobe.hasPending ? (
                <div className="glass-popover flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.8125rem] font-semibold text-white/90">
                      {tt("app.accounts.wardrobe.pendingTitle")}
                    </p>
                    <p className="truncate text-[0.75rem] text-white/45">
                      {tt("app.accounts.overview.skinLabel")}: {pendingSkinLabel} ·{" "}
                      {tt("app.accounts.overview.capeLabel")}: {pendingCapeLabel}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={wardrobe.busy !== null}
                      onClick={wardrobe.discardPending}
                      className={softButton}
                    >
                      {tt("app.accounts.wardrobe.discard")}
                    </button>
                    <button
                      type="button"
                      disabled={wardrobe.busy !== null}
                      onClick={() => void applyPending()}
                      className={softButtonOn}
                    >
                      {wardrobe.busy === "apply" ? "…" : tt("app.accounts.wardrobe.apply")}
                    </button>
                  </div>
                </div>
              ) : (
                <WearingSummary
                  skinLabel={wardrobe.activeSkin?.alias ?? null}
                  capeLabel={wardrobe.activeCape?.alias ?? null}
                  language={language}
                />
              )}
            </div>
          ) : null}
        </AccountSkinPreview>
      </div>
    </div>
  );
}

export function WearingSummary({
  skinLabel,
  capeLabel,
  language,
}: {
  skinLabel: string | null;
  capeLabel: string | null;
  language: Language;
}) {
  const tt = useT(language);
  return (
    <p className="mx-auto w-fit max-w-full truncate rounded-lg bg-black/50 px-2.5 py-1 text-center text-[0.75rem] text-white/55">
      {tt("app.accounts.overview.skinLabel")}:{" "}
      <span className="font-semibold text-white/85">{skinLabel ?? tt("app.accounts.overview.defaultSkin")}</span>
      {" · "}
      {tt("app.accounts.overview.capeLabel")}:{" "}
      <span className="font-semibold text-white/85">{capeLabel ?? tt("app.accounts.cape.none")}</span>
    </p>
  );
}

function UploadTool({
  language,
  wardrobe,
  onDone,
}: {
  language: Language;
  wardrobe: WardrobeState;
  onDone: () => void;
}) {
  const tt = useT(language);
  const [path, setPath] = useState<string | null>(null);
  const [variant, setVariant] = useState<SkinModelVariant>("classic");
  const [error, setError] = useState<string | null>(null);
  const busy = wardrobe.busy === "upload";

  const pick = async () => {
    try {
      const picked = await openFileDialog({
        multiple: false,
        filters: [{ name: "PNG skin", extensions: ["png"] }],
      });
      if (typeof picked === "string" && picked.trim()) {
        setPath(picked);
        setError(null);
      }
    } catch (e) {
      console.debug("[skin] failed to pick skin file", e);
      setError(tt("app.accounts.skinUpload.error"));
    }
  };

  const upload = async () => {
    if (!path || busy) return;
    setError(null);
    try {
      await wardrobe.uploadSkin(path, variant);
      onDone();
    } catch (e) {
      console.debug("[skin] failed to upload skin", e);
      setError(wardrobeErrorText(e) || tt("app.accounts.skinUpload.error"));
    }
  };

  return (
    <div className="shrink-0 border-b border-white/10 bg-black/20 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void pick()}
          disabled={busy}
          className="interactive-press min-w-0 flex-1 truncate rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-left text-xs text-white/75 transition hover:bg-black/50 disabled:opacity-60"
        >
          {path ? path.split(/[/\\]/).pop() : tt("app.accounts.skinUpload.pick")}
        </button>
        <div className="glass-toolbar flex h-8 items-center gap-1 p-1">
          {(
            [
              ["classic", tt("app.accounts.skinUpload.standard")],
              ["slim", tt("app.accounts.skinUpload.slim")],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setVariant(id)}
              className={`interactive-press rounded-lg px-2.5 py-1 text-[0.75rem] font-semibold transition-colors ${
                variant === id ? "seg-on" : "text-white/60 hover:bg-white/10 hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button type="button" disabled={!path || busy} onClick={() => void upload()} className={softButtonOn}>
          {busy ? tt("app.accounts.skinUpload.loading") : tt("app.accounts.skinUpload.apply")}
        </button>
      </div>
      {error ? <p className="mt-2 text-[0.8125rem] text-warn-fg/80">{error}</p> : null}
    </div>
  );
}

function UsernameTool({
  language,
  wardrobe,
  onDone,
}: {
  language: Language;
  wardrobe: WardrobeState;
  onDone: () => void;
}) {
  const tt = useT(language);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const busy = wardrobe.busy === "username";

  const submit = async () => {
    const name = draft.trim();
    if (!name || busy) return;
    setError(null);
    try {
      await wardrobe.applySkinByUsername(name);
      onDone();
    } catch (e) {
      console.debug("[skin] failed to apply skin by username", e);
      const message = wardrobeErrorText(e);
      setError(
        message.toLowerCase().includes("not found")
          ? tt("app.accounts.skinByUsername.notFound")
          : message || tt("app.accounts.skinByUsername.error"),
      );
    }
  };

  return (
    <div className="shrink-0 border-b border-white/10 bg-black/20 px-4 py-3">
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="relative min-w-0 flex-1">
          <input
            type="text"
            autoFocus
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              if (error) setError(null);
            }}
            placeholder={tt("app.accounts.skinByUsername.placeholder")}
            disabled={busy}
            spellCheck={false}
            autoComplete="off"
            className={`glass-control min-w-0 w-full rounded-lg border px-2.5 py-2 text-xs text-white/90 outline-none transition placeholder:text-white/30 disabled:opacity-60 ${
              draft ? "pr-8" : ""
            }`}
          />
          <InputClearButton
            value={draft}
            onClear={() => setDraft("")}
            disabled={busy}
            className="absolute right-1 top-1/2 -translate-y-1/2"
            aria-label={tt("common.clear")}
          />
        </div>
        <button type="submit" disabled={busy || !draft.trim()} className={softButtonOn}>
          {busy ? "…" : tt("app.accounts.skinByUsername.apply")}
        </button>
      </form>
      <p className="mt-1.5 text-[0.75rem] text-white/40">
        {error ? <span className="text-warn-fg/80">{error}</span> : tt("app.accounts.wardrobe.byNameHint")}
      </p>
    </div>
  );
}

function LoadingRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-xs text-white/50">
      <Spinner className="h-4 w-4" />
      {label}
    </div>
  );
}

function ErrorRow({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex items-center gap-3 py-4">
      <p className="min-w-0 flex-1 text-xs text-warn-fg/80">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="interactive-press inline-flex items-center justify-center rounded-lg border border-white/10 px-3 py-1.5 hover:bg-white/[0.06]"
      >
        <AssetIcon name="refresh" className="h-4 w-4 opacity-80" />
      </button>
    </div>
  );
}

function tileClass(pending: boolean): string {
  return pending
    ? "border-accent-to/40 bg-accent-from/20"
    : "border-white/10 bg-black/30 hover:border-white/25 hover:bg-black/45";
}

function SkinTile({
  skin,
  language,
  pending,
  disabled,
  onClick,
}: {
  skin: McSkin;
  language: Language;
  pending: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const tt = useT(language);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={skin.alias}
      className={`interactive-press flex flex-col overflow-hidden rounded-xl border text-left transition disabled:opacity-60 ${tileClass(pending)}`}
    >
      <div className="relative aspect-square bg-[#0c0c11]">
        <TextureThumb
          render={() => renderAssembledSkinThumbnail(skin.url, { variant: skin.variant, size: 128 })}
          deps={[skin.url, skin.variant]}
        />
        {skin.state === "ACTIVE" ? (
          <span className="absolute left-1.5 top-1.5 rounded-md accent-bg px-1.5 py-0.5 text-[0.6875rem] font-semibold text-white">
            {tt("app.accounts.skinLibrary.active")}
          </span>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-1 px-2 py-1.5">
        <span className="truncate text-[0.8125rem] font-medium text-white/85">{skin.alias}</span>
        <span className="shrink-0 text-[0.6875rem] text-white/35">
          {skin.variant === "SLIM" ? tt("app.accounts.skinUpload.slim") : tt("app.accounts.skinUpload.standard")}
        </span>
      </div>
    </button>
  );
}

function CapeTile({
  cape,
  label,
  active,
  pending,
  activeLabel,
  disabled,
  onClick,
}: {
  cape: McCape | null;
  label: string;
  active: boolean;
  pending: boolean;
  activeLabel: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={label}
      className={`interactive-press flex flex-col overflow-hidden rounded-xl border text-left transition disabled:opacity-60 ${tileClass(pending)}`}
    >
      <div className="relative flex aspect-[4/5] items-center justify-center bg-[#0c0c11] p-3">
        {cape ? (
          <TextureThumb
            render={() => renderAssembledCapeThumbnail(cape.url)}
            deps={[cape.url]}
            imgClassName="h-full w-auto max-w-full object-contain"
          />
        ) : (
          <span className="text-lg text-white/20">—</span>
        )}
        {active ? (
          <span className="absolute left-1.5 top-1.5 rounded-md accent-bg px-1.5 py-0.5 text-[0.6875rem] font-semibold text-white">
            {activeLabel}
          </span>
        ) : null}
      </div>
      <span className="truncate px-2 py-1.5 text-[0.75rem] font-medium text-white/80">{label}</span>
    </button>
  );
}

function TextureThumb({
  render,
  deps,
  imgClassName = "h-full w-full object-contain p-1",
}: {
  render: () => Promise<string>;
  deps: unknown[];
  imgClassName?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    void render()
      .then((dataUrl) => {
        if (!cancelled) setSrc(dataUrl);
      })
      .catch((error) => {
        console.debug("[wardrobe] failed to render thumbnail", error);
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, deps);

  if (!src) {
    return <div className="h-full w-full animate-pulse bg-white/10" aria-hidden />;
  }
  return <img src={src} alt="" className={imgClassName} style={{ imageRendering: "pixelated" }} draggable={false} />;
}
