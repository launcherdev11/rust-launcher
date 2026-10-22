import type { FileNode } from "./types";

export const DEFAULT_EXPORT_IGNORES = [
  "logs/",
  "crash-reports/",
  "screenshots/",
  "saves/",
  ".cache/",
  "cache/",
  "*.log",
  "config.json",
  "settings.json",
].join("\n");

export const RECOMMENDED_EXPORT_TOP = new Set([
  "mods",
  "config",
  "resourcepacks",
  "shaderpacks",
  "datapacks",
  "options.txt",
  "optionsof.txt",
  "optionsshaders.txt",
  "servers.dat",
  "servers.dat_old",
]);

export const MINIMAL_EXPORT_TOP = new Set(["mods", "config", "options.txt"]);

export const EXPORT_QUICK_FOLDERS = [
  "mods",
  "config",
  "resourcepacks",
  "shaderpacks",
  "datapacks",
  "options.txt",
  "servers.dat",
] as const;

export function filterExportFileTree(nodes: FileNode[], query: string): FileNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return nodes;

  const filterNode = (n: FileNode): FileNode | null => {
    const selfMatch =
      n.name.toLowerCase().includes(q) || n.path.toLowerCase().includes(q);
    if (n.is_dir) {
      if (selfMatch) return n;
      const kids = (n.children ?? [])
        .map(filterNode)
        .filter((c): c is FileNode => c != null);
      if (kids.length === 0) return null;
      return { ...n, children: kids };
    }
    return selfMatch ? n : null;
  };

  return nodes.map(filterNode).filter((n): n is FileNode => n != null);
}
