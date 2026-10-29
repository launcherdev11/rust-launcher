type LoaderIconAsset = { name: string; mono?: boolean };

export const LOADER_ICONS: Record<string, LoaderIconAsset> = {
  fabric: { name: "fabric" },
  forge: { name: "forge", mono: true },
  neoforge: { name: "neoforge" },
  quilt: { name: "quilt" },
};
