import { type CSSProperties, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { EmptyState, Modal, Spinner } from "../../../components/ui";
import { hexToRgb, rgbToHex } from "../../settings/accentColor";
import type { ModpackController } from "../useModpackController";

type Props = { ctx: ModpackController };

type TextureIcon = { id: string; data_uri: string };

const TILE_BACKGROUNDS = [
  "#4b3277",
  "#2f5a2c",
  "#6a4526",
  "#4a4a55",
  "#24507a",
  "#7a2b2b",
  "#7a6420",
  "#22605d",
];

const PIXELATED: CSSProperties = { imageRendering: "pixelated" };

function tileStyle(background: string | null, unitPx: number): CSSProperties {
  const rgb = background ? hexToRgb(background) : null;
  if (!rgb) return {};
  const light = rgbToHex(
    ...([rgb.r, rgb.g, rgb.b].map((v) => Math.round(v + (255 - v) * 0.22)) as [number, number, number]),
  );
  const dark = rgbToHex(
    ...([rgb.r, rgb.g, rgb.b].map((v) => Math.round(v * 0.62)) as [number, number, number]),
  );
  return {
    backgroundColor: background ?? undefined,
    boxShadow: `inset ${unitPx}px ${unitPx}px 0 ${light}, inset -${unitPx}px -${unitPx}px 0 ${dark}`,
  };
}

export function ProfileIconModal({ ctx }: Props) {
  const { iconPickerProfile, setIconPickerProfile, handleApplyTextureIcon, handleChooseProfileIconFile, tt } =
    ctx;
  const open = iconPickerProfile !== null;
  const profileId = iconPickerProfile?.id ?? null;

  const [icons, setIcons] = useState<TextureIcon[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [background, setBackground] = useState<string | null>(TILE_BACKGROUNDS[0]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setSelectedId(null);
    void invoke<TextureIcon[]>("list_profile_texture_icons", { profileId })
      .then((list) => {
        if (cancelled) return;
        setIcons(list);
        setSelectedId(list[0]?.id ?? null);
      })
      .catch((e) => {
        if (cancelled) return;
        setIcons([]);
        setLoadError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  const selected = icons.find((icon) => icon.id === selectedId) ?? null;
  const close = () => {
    if (!busy) setIconPickerProfile(null);
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={tt("modpacks.iconPicker.title")}
      subtitle={iconPickerProfile?.name}
      onClose={close}
      closeDisabled={busy}
      closeLabel={tt("common.close")}
      maxWidthClassName="w-[min(96vw,34rem)]"
      footer={
        <>
          <button
            type="button"
            className="btn btn-sm btn-ghost mr-auto"
            disabled={busy || !iconPickerProfile}
            onClick={() => {
              if (iconPickerProfile) void run(() => handleChooseProfileIconFile(iconPickerProfile));
            }}
          >
            {tt("modpacks.iconPicker.fromFile")}
          </button>
          <button type="button" className="btn btn-sm btn-soft" disabled={busy} onClick={close}>
            {tt("common.cancel")}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-accent"
            disabled={busy || !selected || !iconPickerProfile}
            onClick={() => {
              if (iconPickerProfile && selected) {
                void run(() => handleApplyTextureIcon(iconPickerProfile, selected.id, background));
              }
            }}
          >
            {busy ? <Spinner className="h-3.5 w-3.5" /> : null}
            {tt("modpacks.iconPicker.apply")}
          </button>
        </>
      }
    >
      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <Spinner className="h-5 w-5" />
        </div>
      ) : loadError ? (
        <EmptyState
          compact
          title={tt("modpacks.iconPicker.noTextures")}
          description={tt("modpacks.iconPicker.noTexturesHint")}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <div
              className="flex h-20 w-20 shrink-0 items-center justify-center rounded-md"
              style={tileStyle(background, 4)}
            >
              {selected ? (
                <img src={selected.data_uri} alt="" className="h-16 w-16" style={PIXELATED} />
              ) : null}
            </div>
            <div className="min-w-0 flex-1">
              <div className="ui-caption mb-2">{tt("modpacks.iconPicker.background")}</div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setBackground(null)}
                  title={tt("modpacks.iconPicker.noBackground")}
                  aria-label={tt("modpacks.iconPicker.noBackground")}
                  aria-pressed={background === null}
                  className={`interactive-press h-7 w-7 rounded-md border border-dashed border-white/30 bg-transparent ${
                    background === null ? "ring-2 ring-accent-to ring-offset-1 ring-offset-ink-900" : ""
                  }`}
                />
                {TILE_BACKGROUNDS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setBackground(color)}
                    aria-label={color}
                    aria-pressed={background === color}
                    className={`interactive-press h-7 w-7 rounded-md ${
                      background === color ? "ring-2 ring-accent-to ring-offset-1 ring-offset-ink-900" : ""
                    }`}
                    style={tileStyle(color, 2)}
                  />
                ))}
              </div>
            </div>
          </div>

          <div>
            <div className="ui-caption mb-2">{tt("modpacks.iconPicker.textures")}</div>
            <div className="custom-scrollbar -mr-2 grid max-h-60 grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))] gap-1.5 overflow-y-auto pr-2">
              {icons.map((icon) => {
                const active = icon.id === selectedId;
                return (
                  <button
                    key={icon.id}
                    type="button"
                    onClick={() => setSelectedId(icon.id)}
                    onDoubleClick={() => {
                      if (iconPickerProfile && !busy) {
                        void run(() => handleApplyTextureIcon(iconPickerProfile, icon.id, background));
                      }
                    }}
                    title={icon.id.replace(/_/g, " ")}
                    aria-pressed={active}
                    className={`interactive-press flex aspect-square items-center justify-center rounded-xl border transition-colors ${
                      active
                        ? "border-accent-to/70 bg-accent-from/20"
                        : "border-white/[0.07] bg-white/[0.04] hover:border-white/20 hover:bg-white/[0.08]"
                    }`}
                  >
                    <img src={icon.data_uri} alt="" className="h-8 w-8" style={PIXELATED} />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
