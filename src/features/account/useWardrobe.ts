import { useCallback, useEffect, useRef, useState } from "react";
import { applyMcSkinByUsername } from "../../lib/avatar";
import { fetchMcCapes, findActiveMcCape, selectMcCape, type McCape } from "../../lib/cape";
import {
  fetchMcSkins,
  fetchMcTextureDataUrl,
  findActiveMcSkin,
  selectMcSkin,
  uploadMcSkin,
  type McSkin,
  type SkinModelVariant,
} from "../../lib/skin";

export type WardrobeBusy = "apply" | "upload" | "username" | null;

export type PendingSkin = { id: string; alias: string; url: string };
export type PendingCape = { id: string | null; alias: string | null; url: string | null };

export type WardrobeState = {
  enabled: boolean;
  skins: McSkin[];
  capes: McCape[];
  skinsLoading: boolean;
  capesLoading: boolean;
  skinsError: string | null;
  capesError: string | null;
  activeSkin: McSkin | null;
  activeCape: McCape | null;
  pendingSkin: PendingSkin | null;
  pendingCape: PendingCape | null;
  hasPending: boolean;
  busy: WardrobeBusy;
  viewerSkinUrl: string | null;
  viewerCapeUrl: string | null;
  appliedSkinUrl: string | null;
  appliedCapeUrl: string | null;
  reload: () => Promise<void>;
  previewSkin: (skin: McSkin) => Promise<void>;
  previewCape: (cape: McCape | null) => Promise<void>;
  discardPending: () => void;
  applyPending: () => Promise<void>;
  uploadSkin: (filePath: string, variant: SkinModelVariant) => Promise<void>;
  applySkinByUsername: (username: string) => Promise<void>;
};

export function wardrobeErrorText(error: unknown): string {
  if (typeof error === "string") return error.trim();
  if (error instanceof Error) return error.message.trim();
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string") return message.trim();
  }
  return "";
}

export function useWardrobe(enabled: boolean, accountKey: string): WardrobeState {
  const [skins, setSkins] = useState<McSkin[]>([]);
  const [capes, setCapes] = useState<McCape[]>([]);
  const [skinsLoading, setSkinsLoading] = useState(false);
  const [capesLoading, setCapesLoading] = useState(false);
  const [skinsError, setSkinsError] = useState<string | null>(null);
  const [capesError, setCapesError] = useState<string | null>(null);
  const [appliedSkinUrl, setAppliedSkinUrl] = useState<string | null>(null);
  const [appliedCapeUrl, setAppliedCapeUrl] = useState<string | null>(null);
  const [pendingSkin, setPendingSkin] = useState<PendingSkin | null>(null);
  const [pendingCape, setPendingCape] = useState<PendingCape | null>(null);
  const [busy, setBusy] = useState<WardrobeBusy>(null);
  const generationRef = useRef(0);

  const loadSkins = useCallback(async () => {
    const generation = generationRef.current;
    setSkinsLoading(true);
    setSkinsError(null);
    try {
      const list = await fetchMcSkins();
      if (generation === generationRef.current) setSkins(list);
    } catch (error) {
      console.debug("[skin] failed to load skin library", error);
      if (generation === generationRef.current) {
        setSkins([]);
        setSkinsError(wardrobeErrorText(error));
      }
    } finally {
      if (generation === generationRef.current) setSkinsLoading(false);
    }
  }, []);

  const loadCapes = useCallback(async () => {
    const generation = generationRef.current;
    setCapesLoading(true);
    setCapesError(null);
    try {
      const list = await fetchMcCapes();
      const active = findActiveMcCape(list);
      const url = active ? await fetchMcTextureDataUrl(active.url) : null;
      if (generation === generationRef.current) {
        setCapes(list);
        setAppliedCapeUrl(url);
      }
    } catch (error) {
      console.debug("[cape] failed to load capes", error);
      if (generation === generationRef.current) {
        setCapes([]);
        setAppliedCapeUrl(null);
        setCapesError(wardrobeErrorText(error));
      }
    } finally {
      if (generation === generationRef.current) setCapesLoading(false);
    }
  }, []);

  const reload = useCallback(async () => {
    if (!enabled) return;
    await Promise.all([loadSkins(), loadCapes()]);
  }, [enabled, loadSkins, loadCapes]);

  useEffect(() => {
    generationRef.current += 1;
    setSkins([]);
    setCapes([]);
    setSkinsError(null);
    setCapesError(null);
    setSkinsLoading(false);
    setCapesLoading(false);
    setAppliedSkinUrl(null);
    setAppliedCapeUrl(null);
    setPendingSkin(null);
    setPendingCape(null);
    setBusy(null);
    if (enabled) void Promise.all([loadSkins(), loadCapes()]);
  }, [enabled, accountKey, loadSkins, loadCapes]);

  const activeSkin = findActiveMcSkin(skins);
  const activeCape = findActiveMcCape(capes);

  const previewSkin = useCallback(
    async (skin: McSkin) => {
      if (skin.state === "ACTIVE") {
        setPendingSkin(null);
        return;
      }
      const url = (await fetchMcTextureDataUrl(skin.url)) ?? skin.url;
      setPendingSkin({ id: skin.id, alias: skin.alias, url });
    },
    [],
  );

  const previewCape = useCallback(
    async (cape: McCape | null) => {
      const currentId = activeCape?.id ?? null;
      const nextId = cape?.id ?? null;
      if (nextId === currentId) {
        setPendingCape(null);
        return;
      }
      const url = cape ? await fetchMcTextureDataUrl(cape.url) : null;
      setPendingCape({ id: nextId, alias: cape?.alias ?? null, url });
    },
    [activeCape?.id],
  );

  const discardPending = useCallback(() => {
    setPendingSkin(null);
    setPendingCape(null);
  }, []);

  const applyPending = useCallback(async () => {
    if (busy || (!pendingSkin && !pendingCape)) return;
    setBusy("apply");
    try {
      if (pendingSkin) {
        const url = await selectMcSkin(pendingSkin.id);
        setAppliedSkinUrl(url);
        setPendingSkin(null);
      }
      if (pendingCape) {
        const updated = await selectMcCape(pendingCape.id);
        setCapes(updated);
        setAppliedCapeUrl(pendingCape.url);
        setPendingCape(null);
      }
      await loadSkins();
    } finally {
      setBusy(null);
    }
  }, [busy, pendingSkin, pendingCape, loadSkins]);

  const uploadSkin = useCallback(
    async (filePath: string, variant: SkinModelVariant) => {
      if (busy) return;
      setBusy("upload");
      try {
        const url = await uploadMcSkin(filePath, variant);
        setAppliedSkinUrl(url);
        setPendingSkin(null);
        await loadSkins();
      } finally {
        setBusy(null);
      }
    },
    [busy, loadSkins],
  );

  const applySkinByUsername = useCallback(
    async (username: string) => {
      if (busy) return;
      setBusy("username");
      try {
        const url = await applyMcSkinByUsername(username);
        setAppliedSkinUrl(url);
        setPendingSkin(null);
        await loadSkins();
      } finally {
        setBusy(null);
      }
    },
    [busy, loadSkins],
  );

  return {
    enabled,
    skins,
    capes,
    skinsLoading,
    capesLoading,
    skinsError,
    capesError,
    activeSkin,
    activeCape,
    pendingSkin,
    pendingCape,
    hasPending: Boolean(pendingSkin || pendingCape),
    busy,
    viewerSkinUrl: pendingSkin?.url ?? appliedSkinUrl,
    viewerCapeUrl: pendingCape ? pendingCape.url : appliedCapeUrl,
    appliedSkinUrl,
    appliedCapeUrl,
    reload,
    previewSkin,
    previewCape,
    discardPending,
    applyPending,
    uploadSkin,
    applySkinByUsername,
  };
}
