import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  MouseEvent,
  KeyboardEvent,
  FormEvent,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";

type ModLoader = "vanilla" | "fabric" | "forge" | "quilt";

type FileNodeKind = "file" | "directory";

type FileNode = {
  id: string;
  name: string;
  path: string;
  kind: FileNodeKind;
  children?: FileNode[];
  hasChildren?: boolean;
  sizeBytes?: number;
  extension?: string | null;
  previewContent?: string | null;
};

type ModpackProfile = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  lastPlayedAt: string | null;
  isActive: boolean;
  gameVersion: string;
  loader: ModLoader;
  includedFolders: {
    path: string;
    enabled: boolean;
    label?: string;
  }[];
  memoryMb: number;
  jvmArgs: string;
  windowResolution: {
    width: number;
    height: number;
    fullscreen: boolean;
  };
  extraLaunchArgs: string;
};

type Modpack = {
  id: string;
  name: string;
  version: string;
  loader: ModLoader;
  modsCount: number;
  sizeMb: number;
  author: string;
  updatedAt: string;
  rating: number;
  ratingVotes: number;
  pathOnDisk: string;
  description: string;
  details: string;
  thumbnailUrl: string;
  heroImageUrl: string;
  profiles: ModpackProfile[];
  fileTreeRoot?: FileNode[];
};

type FileContextAction = "open" | "reveal" | "export" | "copy-path";

type SimpleError = {
  message: string;
};

const MODPACKS_STORAGE_KEY = "mc16_modpacks_v1";

const MOCK_FILE_TREE_SBORKA: FileNode[] = [
  {
    id: "sborka-root",
    name: "Sborka",
    path: "/path/to/sborka",
    kind: "directory",
    hasChildren: true,
    children: [
      {
        id: "sborka-mods",
        name: "mods",
        path: "/path/to/sborka/mods",
        kind: "directory",
        hasChildren: true,
        children: [
          {
            id: "sborka-mods-1",
            name: "optimization-core.jar",
            path: "/path/to/sborka/mods/optimization-core.jar",
            kind: "file",
            extension: ".jar",
            sizeBytes: 4_200_000,
          },
          {
            id: "sborka-mods-2",
            name: "worldgen-plus.jar",
            path: "/path/to/sborka/mods/worldgen-plus.jar",
            kind: "file",
            extension: ".jar",
            sizeBytes: 8_600_000,
          },
        ],
      },
      {
        id: "sborka-shaders",
        name: "shaders",
        path: "/path/to/sborka/shaders",
        kind: "directory",
        hasChildren: true,
        children: [
          {
            id: "sborka-shaders-complementary",
            name: "Complementary Shaders",
            path: "/path/to/sborka/shaders/Complementary Shaders",
            kind: "directory",
            hasChildren: true,
            children: [
              {
                id: "sborka-shaders-complementary-1",
                name: "complementary-shaders.zip",
                path: "/path/to/sborka/shaders/Complementary Shaders/complementary-shaders.zip",
                kind: "file",
                extension: ".zip",
                sizeBytes: 35_000_000,
              },
            ],
          },
        ],
      },
      {
        id: "sborka-resourcepacks",
        name: "resourcepacks",
        path: "/path/to/sborka/resourcepacks",
        kind: "directory",
        hasChildren: true,
        children: [
          {
            id: "sborka-resourcepacks-default",
            name: "Sborka Default Resources.zip",
            path: "/path/to/sborka/resourcepacks/Sborka Default Resources.zip",
            kind: "file",
            extension: ".zip",
            sizeBytes: 12_000_000,
          },
        ],
      },
      {
        id: "sborka-config",
        name: "config",
        path: "/path/to/sborka/config",
        kind: "directory",
        hasChildren: true,
        children: [
          {
            id: "sborka-config-video",
            name: "video_options.toml",
            path: "/path/to/sborka/config/video_options.toml",
            kind: "file",
            extension: ".toml",
            sizeBytes: 3_000,
            previewContent:
              "# Параметры видео\nrenderDistance = 16\nvsync = true\nfullscreen = false\n",
          },
        ],
      },
    ],
  },
];

const MOCK_MODPACKS: Modpack[] = [
  {
    id: "sborka-1-20-1",
    name: "Sborka",
    version: "1.20.1",
    loader: "fabric",
    modsCount: 154,
    sizeMb: 238,
    author: "Rasul Makhmudov",
    updatedAt: "2025-09-13",
    rating: 4.9,
    ratingVotes: 128,
    pathOnDisk: "/path/to/sborka",
    description:
      "Кинематографичная, оптимизированная сборка 1.20.1 с упором на красоту и стабильность. Включает шейдеры Complementary, наборы ресурсов и тщательно подобранные моды.",
    details:
      "Сборка настроена под Fabric Loader 0.15.x, использует современные оптимизационные моды (Sodium, Lithium, Starlight и др.), а также улучшает мир, биомы и генерацию структур. Предустановлены Complementary Shaders и подборка ресурс‑паков с мягкими цветами в стиле ваниллы.",
    thumbnailUrl: "/launcher-assets/modpack-card-placeholder.png",
    heroImageUrl: "/launcher-assets/modpack-hero-placeholder.png",
    profiles: [
      {
        id: "profile-default",
        name: "Default",
        createdAt: "2025-09-10T12:00:00.000Z",
        updatedAt: "2025-09-10T12:00:00.000Z",
        lastPlayedAt: null,
        isActive: true,
        gameVersion: "1.20.1",
        loader: "fabric",
        includedFolders: [
          { path: "mods", enabled: true, label: "Моды" },
          {
            path: "shaders/Complementary Shaders",
            enabled: true,
            label: "Complementary Shaders",
          },
          { path: "resourcepacks", enabled: true, label: "Ресурс‑паки" },
        ],
        memoryMb: 6144,
        jvmArgs: "-Xms3G -Xmx6G -XX:+UseG1GC",
        windowResolution: { width: 1600, height: 900, fullscreen: false },
        extraLaunchArgs: "",
      },
      {
        id: "profile-performance",
        name: "Performance (low mem)",
        createdAt: "2025-09-11T18:20:00.000Z",
        updatedAt: "2025-09-11T18:20:00.000Z",
        lastPlayedAt: null,
        isActive: false,
        gameVersion: "1.20.1",
        loader: "fabric",
        includedFolders: [
          { path: "mods", enabled: true, label: "Моды" },
          {
            path: "shaders/Complementary Shaders",
            enabled: false,
            label: "Complementary Shaders",
          },
          { path: "resourcepacks", enabled: true, label: "Ресурс‑паки" },
        ],
        memoryMb: 4096,
        jvmArgs: "-Xms2G -Xmx4G -XX:+UseG1GC",
        windowResolution: { width: 1280, height: 720, fullscreen: false },
        extraLaunchArgs: "--fastLaunch",
      },
    ],
  },
  {
    id: "vanilla-plus-empty",
    name: "Vanilla+ (Draft)",
    version: "1.20.1",
    loader: "vanilla",
    modsCount: 0,
    sizeMb: 0,
    author: "Unknown",
    updatedAt: "2025-01-01",
    rating: 0,
    ratingVotes: 0,
    pathOnDisk: "/path/to/vanilla-plus",
    description:
      "Черновой модпак без установленных модов. Можно использовать как основу для своих сборок.",
    details:
      "Этот модпак пока не содержит модов и настроек. Используйте кнопку «Создать» или «Импорт» вверху экрана, чтобы на основе него собрать собственную конфигурацию.",
    thumbnailUrl: "/launcher-assets/modpack-card-empty.png",
    heroImageUrl: "/launcher-assets/modpack-hero-placeholder.png",
    profiles: [
      {
        id: "profile-empty-default",
        name: "Default",
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
        lastPlayedAt: null,
        isActive: true,
        gameVersion: "1.20.1",
        loader: "vanilla",
        includedFolders: [],
        memoryMb: 4096,
        jvmArgs: "-Xms2G -Xmx4G",
        windowResolution: { width: 1280, height: 720, fullscreen: false },
        extraLaunchArgs: "",
      },
    ],
  },
];

const MOCK_FILE_TREES: Record<string, FileNode[]> = {
  "/path/to/sborka": MOCK_FILE_TREE_SBORKA,
};

async function readDirectoryRecursive(
  rootPath: string,
  shallow = false,
): Promise<FileNode[]> {
  // TODO: заменить мок-реализацию на реальное чтение ФС через fs/ipcRenderer/app.getPath('userData').
  const mock = MOCK_FILE_TREES[rootPath];
  if (!mock) return [];
  if (shallow) {
    return mock.map((node) => ({
      ...node,
      children: node.children ? undefined : node.children,
      hasChildren: node.kind === "directory" ? true : false,
    }));
  }
  return mock;
}

async function loadModpacks(): Promise<{
  modpacks: Modpack[];
  error?: SimpleError;
}> {
  try {
    let modpacks: Modpack[] = [];
    if (typeof window !== "undefined" && "localStorage" in window) {
      const raw = window.localStorage.getItem(MODPACKS_STORAGE_KEY);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as Modpack[];
          if (Array.isArray(parsed)) {
            // Фильтруем старые примерные сборки, если они когда‑то сохранялись
            const SAMPLE_IDS = new Set(["sborka-1-20-1", "vanilla-plus-empty"]);
            modpacks = parsed.filter((m) => !SAMPLE_IDS.has(m.id));
          }
        } catch {
          // ignore
        }
      }
    }
    return { modpacks };
  } catch (e) {
    console.error("loadModpacks error", e);
    return {
      modpacks: [],
      error: {
        message: "Не удалось загрузить список сборок.",
      },
    };
  }
}

async function saveProfilesToDisk(modpacks: Modpack[]): Promise<void> {
  // TODO: заменить запись в localStorage на атомарную запись modpacks.json в app.getPath('userData').
  try {
    if (typeof window !== "undefined" && "localStorage" in window) {
      window.localStorage.setItem(MODPACKS_STORAGE_KEY, JSON.stringify(modpacks));
    }
  } catch (e) {
    console.error("Не удалось сохранить профили", e);
  }
}

async function launchModpackWithProfile(
  modpack: Modpack,
  profile: ModpackProfile,
): Promise<void> {
  // TODO: интегрировать с реальным launch-API лаунчера через invoke/ipcRenderer.
  try {
    console.info("Launching modpack with profile (mock):", { modpack, profile });
    await new Promise((resolve) => setTimeout(resolve, 800));
  } catch (e) {
    console.error("launchModpackWithProfile error", e);
    throw e;
  }
}

function findNodeByName(nodes: FileNode[], name: string): FileNode | null {
  const stack = [...nodes];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.name === name) return node;
    if (node.children && node.children.length) {
      stack.push(...node.children);
    }
  }
  return null;
}

function generateProfileId(): string {
  return `profile-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function generateModpackId(): string {
  return `modpack-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function formatDate(dateIso: string | null): string {
  if (!dateIso) return "—";
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return dateIso;
  return d.toLocaleDateString("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function formatSizeMb(sizeMb: number): string {
  if (!Number.isFinite(sizeMb) || sizeMb <= 0) return "—";
  return `${sizeMb} мб.`;
}

function PlayTriangleIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5 fill-current"
      aria-hidden="true"
    >
      <path d="M8 5v14l11-7L8 5Z" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4 text-sky-200/90"
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        d="M4 6a2 2 0 0 1 2-2h3.5l2 2H20a2 2 0 0 1 2 2v1H4V6Zm0 4h18v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6Z"
      />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4 text-slate-100/80"
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        d="M7 3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9.5L13.5 3H7Zm6 1.5L18.5 10H13V4.5Z"
      />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5 text-amber-300"
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        d="M12 3.5 9.4 9.3l-6 .4 4.7 3.8L6.4 19l5.6-3.4 5.6 3.4-1.7-5.5 4.7-3.8-6-.4L12 3.5Z"
      />
    </svg>
  );
}

function ChevronDownIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-3 w-3 text-white/60 transition-transform ${
        open ? "rotate-90" : ""
      }`}
      aria-hidden="true"
    >
      <path fill="currentColor" d="M9 6l6 6-6 6" />
    </svg>
  );
}

type ModpackCardProps = {
  modpack: Modpack;
  isSelected: boolean;
  onOpenModal: () => void;
  onPlay: () => void;
};

function ModpackCard({
  modpack,
  isSelected,
  onOpenModal,
  onPlay,
}: ModpackCardProps) {
  const activeProfile =
    modpack.profiles.find((p) => p.isActive) ?? modpack.profiles[0] ?? null;

  return (
    <motion.button
      type="button"
      onClick={onOpenModal}
      className={`interactive-press relative flex w-full max-w-md items-stretch rounded-2xl border px-3.5 py-3 text-left shadow-soft transition ${
        isSelected
          ? "border-white/60 bg-white/10"
          : "border-white/14 bg-black/35 hover:border-white/40 hover:bg-black/55"
      }`}
      whileHover={{ y: -1.5 }}
      whileTap={{ scale: 0.99 }}
      aria-label={`Открыть сборку ${modpack.name}`}
    >
      <div className="relative mr-3 flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white/5">
        <img
          src={modpack.thumbnailUrl}
          alt=""
          className="h-full w-full object-cover"
        />
      </div>
      <div className="min-w-0 flex-1 pr-3">
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex min-w-0 flex-col">
            <div className="flex items-baseline gap-1">
              <span className="truncate text-lg font-semibold text-white">
                {modpack.name}
              </span>
              <span className="text-xs font-semibold text-white/70">
                {modpack.version}
              </span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-white/70">
              <span>Модов: {modpack.modsCount}</span>
              <span>Модлоадер: {modpack.loader}</span>
              <span>Размер: {formatSizeMb(modpack.sizeMb)}</span>
            </div>
          </div>
        </div>
        <div className="mt-1 flex items-center justify-between text-[11px] text-white/60">
          <div className="flex items-center gap-1.5">
            <span className="inline-flex items-center gap-0.5">
              <StarIcon />
              <span>{modpack.rating.toFixed(1)}</span>
            </span>
            <span className="text-white/40">
              ({modpack.ratingVotes} оценок)
            </span>
          </div>
          {activeProfile && (
            <span className="truncate rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-gray-200">
              Профиль: {activeProfile.name}
            </span>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onPlay();
        }}
        className="interactive-press mt-auto mb-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white shadow-soft hover:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-300"
        aria-label={`Запустить сборку ${modpack.name}`}
      >
        <PlayTriangleIcon />
      </button>
    </motion.button>
  );
}

type ProfileManagerProps = {
  modpack: Modpack;
  profiles: ModpackProfile[];
  onProfilesChange: (profiles: ModpackProfile[]) => void;
  onLaunchWithProfile: (profile: ModpackProfile) => void;
};

function ProfileManager({
  modpack,
  profiles,
  onProfilesChange,
  onLaunchWithProfile,
}: ProfileManagerProps) {
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(
    () => profiles.find((p) => p.isActive)?.id ?? profiles[0]?.id ?? null,
  );

  useEffect(() => {
    const active = profiles.find((p) => p.isActive);
    if (active) {
      setSelectedProfileId(active.id);
    } else if (!profiles.find((p) => p.id === selectedProfileId)) {
      setSelectedProfileId(profiles[0]?.id ?? null);
    }
  }, [profiles, selectedProfileId]);

  const selectedProfile =
    profiles.find((p) => p.id === selectedProfileId) ?? profiles[0] ?? null;

  const setActiveProfile = useCallback(
    (id: string) => {
      const next = profiles.map((p) => ({
        ...p,
        isActive: p.id === id,
        updatedAt: p.id === id ? new Date().toISOString() : p.updatedAt,
      }));
      onProfilesChange(next);
    },
    [profiles, onProfilesChange],
  );

  const handleCreateProfile = () => {
    const name = window.prompt("Название профиля:", "Новый профиль");
    if (!name) return;
    const now = new Date().toISOString();
    const base =
      profiles.find((p) => p.isActive) ??
      profiles[0] ?? {
        memoryMb: 4096,
        loader: modpack.loader,
        gameVersion: modpack.version,
        includedFolders: [],
        jvmArgs: "-Xms2G -Xmx4G",
        windowResolution: { width: 1280, height: 720, fullscreen: false },
        extraLaunchArgs: "",
      };
    const newProfile: ModpackProfile = {
      ...base,
      id: generateProfileId(),
      name,
      createdAt: now,
      updatedAt: now,
      lastPlayedAt: null,
      isActive: false,
    };
    const next = [...profiles, newProfile];
    onProfilesChange(next);
    setSelectedProfileId(newProfile.id);
  };

  const handleCloneProfile = () => {
    if (!selectedProfile) return;
    const now = new Date().toISOString();
    const cloned: ModpackProfile = {
      ...selectedProfile,
      id: generateProfileId(),
      name: `${selectedProfile.name} (Copy)`,
      createdAt: now,
      updatedAt: now,
      lastPlayedAt: null,
      isActive: false,
    };
    const next = [...profiles, cloned];
    onProfilesChange(next);
    setSelectedProfileId(cloned.id);
  };

  const handleRenameProfile = () => {
    if (!selectedProfile) return;
    const name = window.prompt("Новое имя профиля:", selectedProfile.name);
    if (!name || name.trim() === selectedProfile.name) return;
    const next = profiles.map((p) =>
      p.id === selectedProfile.id
        ? { ...p, name: name.trim(), updatedAt: new Date().toISOString() }
        : p,
    );
    onProfilesChange(next);
  };

  const handleDeleteProfile = () => {
    if (!selectedProfile) return;
    if (!window.confirm(`Удалить профиль "${selectedProfile.name}"?`)) return;
    const next = profiles.filter((p) => p.id !== selectedProfile.id);
    if (next.length === 0) {
      window.alert("У сборки должен быть хотя бы один профиль.");
      return;
    }
    onProfilesChange(next);
    const active = next.find((p) => p.isActive) ?? next[0];
    setSelectedProfileId(active.id);
  };

  const handleToggleFolder = (path: string) => {
    if (!selectedProfile) return;
    const updated: ModpackProfile = {
      ...selectedProfile,
      includedFolders: selectedProfile.includedFolders.map((f) =>
        f.path === path ? { ...f, enabled: !f.enabled } : f,
      ),
      updatedAt: new Date().toISOString(),
    };
    const next = profiles.map((p) => (p.id === updated.id ? updated : p));
    onProfilesChange(next);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {profiles.map((profile) => {
            const isActive = profile.isActive;
            const isSelected = profile.id === selectedProfile?.id;
            return (
              <button
                key={profile.id}
                type="button"
                onClick={() => setSelectedProfileId(profile.id)}
                onDoubleClick={() => setActiveProfile(profile.id)}
                className={`interactive-press inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold shadow-soft transition ${
                  isSelected
                    ? "border-white/80 bg-white text-black"
                    : "border-white/20 bg-black/40 text-white/80 hover:border-white/50 hover:bg-black/60"
                }`}
                aria-pressed={isSelected}
                aria-label={`Профиль ${profile.name}${
                  isActive ? ", активный" : ""
                }`}
              >
                <span className="truncate max-w-[120px]">{profile.name}</span>
                {isActive && (
                  <span className="rounded-full bg-emerald-500 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em] text-white">
                    Активный
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleCreateProfile}
            className="interactive-press flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/25 focus:outline-none focus:ring-2 focus:ring-white/60"
            aria-label="Создать профиль"
          >
            +
          </button>
          <button
            type="button"
            onClick={handleCloneProfile}
            className="interactive-press hidden h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/25 focus:outline-none focus:ring-2 focus:ring-white/60 sm:flex"
            aria-label="Клонировать профиль"
          >
            ⧉
          </button>
        </div>
      </div>

      {selectedProfile && (
        <div className="glass-panel mt-1 flex flex-col gap-3 rounded-2xl border border-white/14 bg-black/45 p-3 text-xs text-white/85 backdrop-blur-xl">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-col">
              <span className="text-[11px] uppercase tracking-[0.16em] text-gray-300">
                Параметры запуска
              </span>
              <span className="mt-0.5 text-[11px] text-white/70">
                {selectedProfile.gameVersion} · {selectedProfile.loader} ·{" "}
                {selectedProfile.memoryMb} МБ RAM
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveProfile(selectedProfile.id)}
                className="interactive-press rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold text-white hover:bg-white/20"
                aria-label="Сделать профиль активным"
              >
                Сделать активным
              </button>
              <button
                type="button"
                onClick={() => onLaunchWithProfile(selectedProfile)}
                className="interactive-press flex items-center gap-1 rounded-full bg-emerald-500 px-3 py-1.5 text-[11px] font-semibold text-white shadow-soft hover:bg-emerald-400"
                aria-label="Запустить сборку с этим профилем"
              >
                <PlayTriangleIcon />
                <span>Играть</span>
              </button>
            </div>
          </div>

          <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] uppercase tracking-[0.16em] text-gray-300">
                Папки
              </span>
              <div className="flex flex-wrap gap-1.5">
                {selectedProfile.includedFolders.length === 0 && (
                  <span className="text-[11px] text-white/45">
                    Нет настроенных папок. Они будут добавлены при первом
                    запуске.
                  </span>
                )}
                {selectedProfile.includedFolders.map((folder) => (
                  <button
                    key={folder.path}
                    type="button"
                    onClick={() => handleToggleFolder(folder.path)}
                    className={`interactive-press inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ${
                      folder.enabled
                        ? "bg-white/85 text-black"
                        : "bg-black/60 text-white/60 hover:bg-black/80"
                    }`}
                    aria-pressed={folder.enabled}
                  >
                    <span className="text-[10px]">
                      {folder.enabled ? "✓" : "✕"}
                    </span>
                    <span className="truncate max-w-[120px]">
                      {folder.label ?? folder.path}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] uppercase tracking-[0.16em] text-gray-300">
                JVM и окно
              </span>
              <div className="rounded-xl bg-black/40 px-3 py-2 text-[11px] text-white/75">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-white/10 px-2 py-0.5">
                    RAM: {selectedProfile.memoryMb} МБ
                  </span>
                  <span className="rounded-full bg-white/10 px-2 py-0.5">
                    Окно: {selectedProfile.windowResolution.width}×
                    {selectedProfile.windowResolution.height}
                    {selectedProfile.windowResolution.fullscreen
                      ? " (Fullscreen)"
                      : ""}
                  </span>
                </div>
                <div className="mt-1 line-clamp-2 text-[11px] text-white/65">
                  JVM: {selectedProfile.jvmArgs || "по умолчанию"}
                </div>
                {selectedProfile.extraLaunchArgs && (
                  <div className="mt-1 text-[11px] text-white/65">
                    Аргументы игры: {selectedProfile.extraLaunchArgs}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[10px] text-white/55">
            <span>
              Создан: {formatDate(selectedProfile.createdAt)} · Изменён:{" "}
              {formatDate(selectedProfile.updatedAt)}
            </span>
            <span>
              Последний запуск: {formatDate(selectedProfile.lastPlayedAt)}
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-white/60">
            <button
              type="button"
              onClick={handleRenameProfile}
              className="interactive-press rounded-full bg-white/8 px-2 py-0.5 hover:bg-white/16"
              aria-label="Переименовать профиль"
            >
              Переименовать
            </button>
            <button
              type="button"
              onClick={handleDeleteProfile}
              className="interactive-press rounded-full bg-red-600/80 px-2 py-0.5 text-red-50 hover:bg-red-500/95"
              aria-label="Удалить профиль"
            >
              Удалить
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

type FileTreeProps = {
  rootNodes: FileNode[];
  onLazyLoadChildren: (node: FileNode) => Promise<FileNode[]>;
};

type ContextMenuState = {
  node: FileNode;
  x: number;
  y: number;
} | null;

function FileTree({ rootNodes, onLazyLoadChildren }: FileTreeProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [nodesById, setNodesById] = useState<Map<string, FileNode>>(
    () => new Map(rootNodes.map((n) => [n.id, n])),
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [loadingIds, setLoadingIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const map = new Map<string, FileNode>();
    const stack = [...rootNodes];
    while (stack.length) {
      const node = stack.pop()!;
      map.set(node.id, node);
      if (node.children) stack.push(...node.children);
    }
    setNodesById(map);
  }, [rootNodes]);

  const handleToggleExpand = async (node: FileNode) => {
    if (node.kind !== "directory") return;
    const nextExpanded = new Set(expandedIds);
    const isExpanded = expandedIds.has(node.id);
    if (isExpanded) {
      nextExpanded.delete(node.id);
      setExpandedIds(nextExpanded);
      return;
    }
    nextExpanded.add(node.id);
    setExpandedIds(nextExpanded);
    if (!node.children && node.hasChildren && !loadingIds.has(node.id)) {
      const nextLoading = new Set(loadingIds);
      nextLoading.add(node.id);
      setLoadingIds(nextLoading);
      try {
        const loadedChildren = await onLazyLoadChildren(node);
        const updatedNode: FileNode = {
          ...node,
          children: loadedChildren,
        };
        const map = new Map(nodesById);
        map.set(updatedNode.id, updatedNode);
        for (const child of loadedChildren) {
          map.set(child.id, child);
        }
        setNodesById(map);
      } finally {
        const afterLoading = new Set(nextLoading);
        afterLoading.delete(node.id);
        setLoadingIds(afterLoading);
      }
    }
  };

  const handleContextAction = (node: FileNode, action: FileContextAction) => {
    setContextMenu(null);
    switch (action) {
      case "open":
        console.info("Open file (mock)", node.path);
        break;
      case "reveal":
        console.info("Reveal in folder (mock)", node.path);
        break;
      case "export":
        console.info("Export file (mock)", node.path);
        break;
      case "copy-path":
        if (navigator.clipboard) {
          navigator.clipboard
            .writeText(node.path)
            .catch((e) => console.error("clipboard error", e));
        }
        break;
    }
  };

  const handleRowKeyDown = (
    e: KeyboardEvent<HTMLDivElement>,
    node: FileNode,
  ) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (node.kind === "directory") {
        void handleToggleExpand(node);
      } else {
        setSelectedNodeId(node.id);
      }
    } else if (
      (e.key === "ArrowRight" || e.key === "ArrowLeft") &&
      node.kind === "directory"
    ) {
      e.preventDefault();
      const isExpanded = expandedIds.has(node.id);
      if (e.key === "ArrowRight" && !isExpanded) {
        void handleToggleExpand(node);
      } else if (e.key === "ArrowLeft" && isExpanded) {
        void handleToggleExpand(node);
      }
    }
  };

  const selectedNode = selectedNodeId
    ? nodesById.get(selectedNodeId) ?? null
    : null;

  const renderNodes = (nodes: FileNode[], depth: number): JSX.Element[] => {
    const elements: JSX.Element[] = [];
    for (const node of nodes) {
      const isExpanded = expandedIds.has(node.id);
      const isLoading = loadingIds.has(node.id);
      const isSelected = node.id === selectedNodeId;
      elements.push(
        <div key={node.id} className="flex flex-col">
          <div
            role="treeitem"
            aria-expanded={node.kind === "directory" ? isExpanded : undefined}
            tabIndex={0}
            onKeyDown={(e) => handleRowKeyDown(e, node)}
            onClick={() => {
              if (node.kind === "directory") {
                void handleToggleExpand(node);
              } else {
                setSelectedNodeId(node.id);
              }
            }}
            onContextMenu={(e: MouseEvent<HTMLDivElement>) => {
              e.preventDefault();
              setSelectedNodeId(node.id);
              setContextMenu({
                node,
                x: e.clientX,
                y: e.clientY,
              });
            }}
            className={`group flex cursor-pointer items-center gap-1 rounded-xl px-2 py-1.5 text-[11px] text-white/80 transition-colors ${
              isSelected ? "bg-white/15" : "hover:bg:white/6 hover:bg-white/6"
            }`}
            style={{ paddingLeft: 8 + depth * 14 }}
          >
            {node.kind === "directory" ? (
              <ChevronDownIcon open={isExpanded} />
            ) : (
              <span className="w-3" />
            )}
            <span className="flex items-center gap-1.5">
              {node.kind === "directory" ? <FolderIcon /> : <FileIcon />}
              <span
                className={`truncate ${
                  node.name === "Complementary Shaders" ||
                  node.name.toLowerCase().includes("resourcepack")
                    ? "text-sky-200"
                    : ""
                }`}
              >
                {node.name}
              </span>
            </span>
            {isLoading && (
              <span className="ml-2 text-[10px] text-white/40">…</span>
            )}
          </div>
          {node.children && node.children.length > 0 && isExpanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.16, ease: "easeOut" }}
            >
              {renderNodes(node.children, depth + 1)}
            </motion.div>
          )}
        </div>,
      );
    }
    return elements;
  };

  return (
    <div className="flex h-full flex-col rounded-2xl border border-white/12 bg-black/40 p-2 text-xs text-white/80 backdrop-blur-xl">
      <div
        className="custom-scrollbar relative -mr-1 flex-1 overflow-y-auto pr-1"
        role="tree"
        aria-label="Файлы сборки"
      >
        {rootNodes.length === 0 ? (
          <div className="px-2 py-4 text-[11px] text-white/50">
            Структура файлов не найдена. Она появится после первой установки или
            импорта сборки.
          </div>
        ) : (
          renderNodes(rootNodes, 0)
        )}
      </div>

      <div className="mt-2 rounded-xl bg-black/55 px-3 py-2 text-[11px] text-white/75">
        {selectedNode ? (
          selectedNode.kind === "file" ? (
            <>
              <div className="flex items-center justify между">
                <span className="truncate">{selectedNode.name}</span>
                <span className="text-white/45">
                  {selectedNode.extension ?? ""}
                  {selectedNode.sizeBytes
                    ? ` · ${(selectedNode.sizeBytes / (1024 * 1024)).toFixed(
                        1,
                      )} МБ`
                    : ""}
                </span>
              </div>
              {selectedNode.previewContent ? (
                <pre className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap text-[10px] text-white/70">
                  {selectedNode.previewContent}
                </pre>
              ) : (
                <p className="mt-1 text-[10px] text-white/55">
                  Для этого файла доступна только основная информация. Для
                  открытия используйте контекстное меню.
                </p>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <span className="truncate">{selectedNode.name}</span>
                <span className="text-white/45">Папка</span>
              </div>
              <p className="mt-1 text-[10px] text-white/55">
                Щёлкните дважды или нажмите Enter для разворачивания/сворачивания
                папки.
              </p>
            </>
          )
        ) : (
          <p className="text-[10px] text-white/55">
            Выберите файл или папку, чтобы увидеть дополнительную информацию.
          </p>
        )}
      </div>

      <AnimatePresence>
        {contextMenu && (
          <motion.ul
            initial={{ opacity: 0, scale: 0.96, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 4 }}
            transition={{ duration: 0.14 }}
            className="fixed z-[9999] w-40 rounded-2xl border border-white/10 bg-black/95 p-1 text-[11px] text-white/85 shadow-soft backdrop-blur-xl"
            style={{ top: contextMenu.y, left: contextMenu.x }}
            role="menu"
            aria-label={`Действия с ${contextMenu.node.name}`}
          >
            <li>
              <button
                type="button"
                className="flex w-full items-center rounded-xl px-2 py-1.5 text-left hover:bg-white/10"
                onClick={() => handleContextAction(contextMenu.node, "open")}
              >
                Открыть
              </button>
            </li>
            <li>
              <button
                type="button"
                className="flex w-full items-center rounded-xl px-2 py-1.5 text-left hover:bg-white/10"
                onClick={() => handleContextAction(contextMenu.node, "reveal")}
              >
                Показать в папке
              </button>
            </li>
            <li>
              <button
                type="button"
                className="flex w-full items-center rounded-xl px-2 py-1.5 text-left hover:bg-white/10"
                onClick={() => handleContextAction(contextMenu.node, "export")}
              >
                Экспортировать
              </button>
            </li>
            <li>
              <button
                type="button"
                className="flex w-full items-center rounded-xl px-2 py-1.5 text-left hover:bg-white/10"
                onClick={() =>
                  handleContextAction(contextMenu.node, "copy-path")
                }
              >
                Копировать путь
              </button>
            </li>
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

type ModpackModalProps = {
  modpack: Modpack;
  fileTreeRoot: FileNode[];
  onClose: () => void;
  onProfilesChange: (profiles: ModpackProfile[]) => void;
  onFileTreeLoaded: (tree: FileNode[]) => void;
  onUpdateModpack: (next: Modpack) => void;
};

type CreateModpackData = {
  name: string;
  version: string;
  loader: ModLoader;
  author: string;
  description: string;
  details: string;
  modsFiles: string[];
  resourcepackFiles: string[];
  shaderFiles: string[];
};

type CreateModpackModalProps = {
  onClose: () => void;
  onCreate: (data: CreateModpackData) => void;
};

function CreateModpackModal({
  onClose,
  onCreate,
}: CreateModpackModalProps): JSX.Element {
  const [name, setName] = useState("");
  const [version, setVersion] = useState("1.20.1");
  const [loader, setLoader] = useState<ModLoader>("fabric");
  const [author, setAuthor] = useState("");
  const [description, setDescription] = useState("");
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [modsFiles, setModsFiles] = useState<string[]>([]);
  const [resourcepackFiles, setResourcepackFiles] = useState<string[]>([]);
  const [shaderFiles, setShaderFiles] = useState<string[]>([]);

  const handlePickFiles = async (
    kind: "mods" | "resourcepacks" | "shaders",
  ) => {
    try {
      const result = await openFileDialog({
        multiple: true,
        directory: false,
        filters:
          kind === "mods"
            ? [{ name: "Файлы модов", extensions: ["jar"] }]
            : [
                {
                  name:
                    kind === "resourcepacks"
                      ? "Ресурс‑паки"
                      : "Шейдеры",
                  extensions: ["zip"],
                },
              ],
      });

      const files: string[] =
        typeof result === "string"
          ? [result]
          : Array.isArray(result)
            ? result.filter((p): p is string => typeof p === "string")
            : [];

      if (kind === "mods") {
        setModsFiles(files);
      } else if (kind === "resourcepacks") {
        setResourcepackFiles(files);
      } else {
        setShaderFiles(files);
      }
    } catch (e) {
      console.error("Не удалось выбрать файлы для сборки", e);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || submitting) return;
    setSubmitting(true);
    onCreate({
      name: trimmedName,
      version: version.trim() || "1.20.1",
      loader,
      author: author.trim(),
      description: description.trim(),
      details: details.trim(),
      modsFiles,
      resourcepackFiles,
      shaderFiles,
    });
    setSubmitting(false);
  };

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-md"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        aria-modal="true"
        role="dialog"
        aria-label="Создание новой сборки"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            onClose();
          }
        }}
      >
        <motion.form
          onSubmit={handleSubmit}
          className="relative flex w-full max-w-xl flex-col gap-4 rounded-3xl border border-white/20 bg-gradient-to-br from-[#1e3a5f]/92 to-[#0b1628]/96 p-6 text-sm text-white shadow-[0_32px_96px_rgba(0,0,0,0.7)]"
          initial={{ opacity: 0, y: 32, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 32, scale: 0.96 }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Новая сборка</h2>
              <p className="mt-1 text-xs text-white/70">
                Задайте основные параметры, остальные настройки можно изменить позже в окне профилей.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="interactive-press flex h-8 w-8 items-center justify-center rounded-full bg-black/45 text-white/80 hover:bg-black/70 focus:outline-none focus:ring-2 focus:ring-white/70"
              aria-label="Закрыть окно создания сборки"
            >
              ×
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <label className="text-[11px] uppercase tracking-[0.16em] text-gray-300">
                Название
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Например, Sborka 1.20.1"
                className="rounded-2xl border border-white/20 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/70"
                required
              />
              <label className="mt-3 text-[11px] uppercase tracking-[0.16em] text-gray-300">
                Автор
              </label>
              <input
                type="text"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="Ваше имя или никнейм"
                className="rounded-2xl border border-white/20 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/70"
              />
            </div>

            <div className="flex flex-col gap-3">
              <div>
                <label className="text-[11px] uppercase tracking-[0.16em] text-gray-300">
                  Версия Minecraft
                </label>
                <input
                  type="text"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  placeholder="1.20.1"
                  className="mt-1 rounded-2xl border border-white/20 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/70"
                />
              </div>
              <div>
                <span className="text-[11px] uppercase tracking-[0.16em] text-gray-300">
                  Загрузчик
                </span>
                <div className="mt-1 inline-flex rounded-full bg-white/10 p-1 text-xs text-white/80">
                  {(["vanilla", "fabric", "forge", "quilt"] as ModLoader[]).map(
                    (value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setLoader(value)}
                        className={`interactive-press rounded-full px-3 py-1.5 font-semibold transition-colors ${
                          loader === value
                            ? "bg-white text-black"
                            : "bg-transparent hover:text-white"
                        }`}
                        aria-pressed={loader === value}
                      >
                        {value === "vanilla"
                          ? "Vanilla"
                          : value === "fabric"
                            ? "Fabric"
                            : value === "forge"
                              ? "Forge"
                              : "Quilt"}
                      </button>
                    ),
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <label className="text-[11px] uppercase tracking-[0.16em] text-gray-300">
                Краткое описание
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Несколько предложений о том, для чего эта сборка."
                className="min-h-[72px] resize-none rounded-2xl border border-white/20 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/70"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-[11px] uppercase tracking-[0.16em] text-gray-300">
                Детали (по желанию)
              </label>
              <textarea
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="Отдельные особенности, рекомендуемые шейдеры, ресурсы и т.п."
                className="min-h-[72px] resize-none rounded-2xl border border-white/20 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/70"
              />
            </div>
          </div>

          <div className="mt-1 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5 text-xs">
              <span className="text-[11px] uppercase tracking-[0.16em] text-gray-300">
                Моды
              </span>
              <button
                type="button"
                onClick={() => void handlePickFiles("mods")}
                className="interactive-press inline-flex items-center justify-center rounded-2xl bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20"
              >
                Выбрать .jar
              </button>
              <span className="text-[11px] text-white/55">
                {modsFiles.length > 0
                  ? `Выбрано файлов: ${modsFiles.length}`
                  : "Необязательно. Можно добавить позже."}
              </span>
            </div>
            <div className="flex flex-col gap-1.5 text-xs">
              <span className="text-[11px] uppercase tracking-[0.16em] text-gray-300">
                Ресурс‑паки
              </span>
              <button
                type="button"
                onClick={() => void handlePickFiles("resourcepacks")}
                className="interactive-press inline-flex items-center justify-center rounded-2xl bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20"
              >
                Выбрать .zip
              </button>
              <span className="text-[11px] text-white/55">
                {resourcepackFiles.length > 0
                  ? `Выбрано файлов: ${resourcepackFiles.length}`
                  : "Необязательно. Можно добавить позже."}
              </span>
            </div>
            <div className="flex flex-col gap-1.5 text-xs">
              <span className="text-[11px] uppercase tracking-[0.16em] text-gray-300">
                Шейдеры
              </span>
              <button
                type="button"
                onClick={() => void handlePickFiles("shaders")}
                className="interactive-press inline-flex items-center justify-center rounded-2xl bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20"
              >
                Выбрать .zip
              </button>
              <span className="text-[11px] text-white/55">
                {shaderFiles.length > 0
                  ? `Выбрано файлов: ${shaderFiles.length}`
                  : "Необязательно. Можно добавить позже."}
              </span>
            </div>
          </div>

          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="interactive-press rounded-full bg-white/8 px-4 py-2 text-xs font-semibold text-white/80 hover:bg-white/16"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={submitting || !name.trim()}
              className="interactive-press rounded-full bg-emerald-500 px-5 py-2 text-xs font-semibold text-white shadow-soft hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-white/20 disabled:text-white/50"
            >
              Создать
            </button>
          </div>
        </motion.form>
      </motion.div>
    </AnimatePresence>
  );
}

function ModpackModal({
  modpack,
  fileTreeRoot,
  onClose,
  onProfilesChange,
  onFileTreeLoaded,
  onUpdateModpack,
}: ModpackModalProps) {
  const [activeTab, setActiveTab] = useState<"description" | "details">(
    "description",
  );
  const [draftName, setDraftName] = useState(modpack.name);
  const [draftVersion, setDraftVersion] = useState(modpack.version);
  const [draftAuthor, setDraftAuthor] = useState(modpack.author);
  const [draftDescription, setDraftDescription] = useState(modpack.description);
  const [draftDetails, setDraftDetails] = useState(modpack.details);
  const [draftPath, setDraftPath] = useState(modpack.pathOnDisk);
  const [metaDirty, setMetaDirty] = useState(false);

  useEffect(() => {
    setDraftName(modpack.name);
    setDraftVersion(modpack.version);
    setDraftAuthor(modpack.author);
    setDraftDescription(modpack.description);
    setDraftDetails(modpack.details);
    setDraftPath(modpack.pathOnDisk);
    setMetaDirty(false);
  }, [modpack]);

  const handleSaveMeta = () => {
    const trimmedName = draftName.trim() || modpack.name;
    const updated: Modpack = {
      ...modpack,
      name: trimmedName,
      version: draftVersion.trim() || modpack.version,
      author: draftAuthor.trim() || "Локальная сборка",
      description: draftDescription.trim(),
      details: draftDetails.trim(),
      pathOnDisk: draftPath.trim(),
    };
    onUpdateModpack(updated);
    setMetaDirty(false);
  };

  const handleLaunchWithProfile = async (profile: ModpackProfile) => {
    try {
      await launchModpackWithProfile(modpack, profile);
      const nextProfiles = modpack.profiles.map((p) =>
        p.id === profile.id
          ? { ...p, lastPlayedAt: new Date().toISOString() }
          : p,
      );
      onProfilesChange(nextProfiles);
    } catch (e) {
      console.error("Ошибка запуска сборки", e);
    }
  };

  const handleLazyLoadChildren = async (node: FileNode): Promise<FileNode[]> => {
    if (node.kind !== "directory") return [];
    const allTree = await readDirectoryRecursive(modpack.pathOnDisk, false);
    onFileTreeLoaded(allTree);
    const root =
      allTree.find((n) => n.path === node.path || n.id === node.id) ?? null;
    return root && root.children ? root.children : [];
  };

  const handleOverlayClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-md"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={handleOverlayClick}
        aria-modal="true"
        role="dialog"
        aria-label={`Сборка ${modpack.name}`}
      >
        <motion.div
          className="relative flex h-[520px] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-white/20 bg-gradient-to-br from-[#1e3a5f]/90 to-[#0b1628]/95 shadow-[0_40px_120px_rgba(0,0,0,0.65)]"
          initial={{ opacity: 0, y: 40, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 40, scale: 0.96 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
        >
          <div className="relative h-40 w-full overflow-hidden">
            <img
              src={modpack.heroImageUrl}
              alt=""
              className="h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-black/10 to-black/70" />
          </div>

          <div className="relative -mt-16 flex flex-1 gap-4 px-6 pb-5">
            <div className="glass-panel relative flex w-[60%] flex-col rounded-3xl bg-black/45 px-5 pb-4 pt-4 backdrop-blur-2xl">
              <div className="flex items-start gap-4">
                <div className="h-20 w-20 overflow-hidden rounded-2xl bg-white/10">
                  <img
                    src={modpack.thumbnailUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-baseline gap-1">
                        <input
                          type="text"
                          value={draftName}
                          onChange={(e) => {
                            setDraftName(e.target.value);
                            setMetaDirty(true);
                          }}
                          className="max-w-full flex-1 bg-transparent text-2xl font-semibold text-white placeholder:text-white/40 outline-none"
                          placeholder="Название сборки"
                        />
                        <input
                          type="text"
                          value={draftVersion}
                          onChange={(e) => {
                            setDraftVersion(e.target.value);
                            setMetaDirty(true);
                          }}
                          className="w-20 bg-transparent text-sm font-semibold text-white/80 placeholder:text-white/40 outline-none"
                          placeholder="1.20.1"
                        />
                      </div>
                      <div className="mt-1 flex items-center gap-1 text-xs text-white/70">
                        <span className="text-white/60">Автор:</span>
                        <input
                          type="text"
                          value={draftAuthor}
                          onChange={(e) => {
                            setDraftAuthor(e.target.value);
                            setMetaDirty(true);
                          }}
                          className="max-w-xs flex-1 bg-transparent text-xs text-white placeholder:text-white/40 outline-none"
                          placeholder="Ваш ник или имя"
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={onClose}
                      className="interactive-press flex h-8 w-8 items-center justify-center rounded-full bg-black/45 text-white/80 hover:bg-black/70 focus:outline-none focus:ring-2 focus:ring-white/70"
                      aria-label="Закрыть модальное окно"
                    >
                      ×
                    </button>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-white/70">
                    <span className="inline-flex items-center gap-1 rounded-full bg-black/40 px-2 py-0.5">
                      <StarIcon />
                      <span>{modpack.rating.toFixed(1)}</span>
                      <span className="text-white/40">
                        ({modpack.ratingVotes})
                      </span>
                    </span>
                    <span className="rounded-full bg-black/40 px-2 py-0.5">
                      Обновлено: {formatDate(modpack.updatedAt)}
                    </span>
                    <span className="rounded-full bg-black/40 px-2 py-0.5">
                      Модов: {modpack.modsCount}
                    </span>
                    <span className="rounded-full bg-black/40 px-2 py-0.5">
                      Размер: {formatSizeMb(modpack.sizeMb)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between gap-3">
                <div className="inline-flex rounded-full bg-white/10 p-1 text-xs text-white/70">
                  <button
                    type="button"
                    onClick={() => setActiveTab("description")}
                    className={`interactive-press rounded-full px-3 py-1.5 font-semibold transition-colors ${
                      activeTab === "description"
                        ? "bg-white text-black"
                        : "bg-transparent hover:text-white"
                    }`}
                    aria-pressed={activeTab === "description"}
                  >
                    Описание
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab("details")}
                    className={`interactive-press rounded-full px-3 py-1.5 font-semibold transition-colors ${
                      activeTab === "details"
                        ? "bg-white text-black"
                        : "bg-transparent hover:text-white"
                    }`}
                    aria-pressed={activeTab === "details"}
                  >
                    Детали
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  {metaDirty && (
                    <button
                      type="button"
                      onClick={handleSaveMeta}
                      className="interactive-press rounded-full bg-white/12 px-4 py-1.5 text-xs font-semibold text-white hover:bg-white/25"
                    >
                      Сохранить
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      const active =
                        modpack.profiles.find((p) => p.isActive) ??
                        modpack.profiles[0];
                      if (!active) {
                        if (
                          window.confirm(
                            "Для сборки нет профилей. Создать профиль по умолчанию?",
                          )
                        ) {
                          // TODO: создать профиль по умолчанию и сохранить.
                        }
                        return;
                      }
                      void handleLaunchWithProfile(active);
                    }}
                    className="interactive-press inline-flex items-center gap-1.5 rounded-full bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-white shadow-soft hover:bg-emerald-400"
                    aria-label="Запустить сборку (активный профиль)"
                  >
                    <PlayTriangleIcon />
                    <span>Играть</span>
                  </button>
                </div>
              </div>

              <div className="mt-3 flex min-h-0 flex-1 overflow-hidden">
                {activeTab === "description" ? (
                  <div className="custom-scrollbar -mr-2 h-full flex-1 overflow-y-auto pr-2 text-xs text-white/80">
                    <textarea
                      value={draftDescription}
                      onChange={(e) => {
                        setDraftDescription(e.target.value);
                        setMetaDirty(true);
                      }}
                      placeholder="Описание сборки..."
                      className="min-h-[80px] w-full resize-none rounded-2xl border border-white/15 bg-black/35 px-3 py-2 text-xs leading-relaxed text-white/85 placeholder:text-white/40 outline-none focus:border-white/60"
                    />
                    <textarea
                      value={draftDetails}
                      onChange={(e) => {
                        setDraftDetails(e.target.value);
                        setMetaDirty(true);
                      }}
                      placeholder="Дополнительные детали, рекомендуемые шейдеры, ресурсы и т.п."
                      className="mt-2 min-h-[100px] w-full resize-none rounded-2xl border border-white/15 bg-black/30 px-3 py-2 text-xs text-white/80 placeholder:text-white/40 outline-none focus:border-white/60"
                    />
                  </div>
                ) : (
                  <div className="flex h-full w-full flex-col gap-2 text-xs text-white/80">
                    <div className="flex flex-col gap-1 text-[11px] text-white/70">
                      <span className="font-semibold">Путь к папке сборки</span>
                      <input
                        type="text"
                        value={draftPath}
                        onChange={(e) => {
                          setDraftPath(e.target.value);
                          setMetaDirty(true);
                        }}
                        placeholder="Например, C:\\Games\\Minecraft\\Sborka"
                        className="rounded-2xl border border-white/18 bg-black/35 px-3 py-1.5 text-[11px] text-white placeholder:text-white/35 outline-none focus:border-white/60"
                      />
                      <span className="text-[10px] text-white/55">
                        В будущем по этому пути будет строиться структура файлов. Сейчас дерево файлов заполняется только для тестовых данных.
                      </span>
                    </div>
                    <div className="flex min-h-0 flex-1">
                      <FileTree
                        rootNodes={fileTreeRoot}
                        onLazyLoadChildren={handleLazyLoadChildren}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="glass-panel relative flex w-[40%] flex-col rounded-3xl bg-black/50 px-4 py-4 backdrop-blur-2xl">
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-col">
                  <span className="text-[11px] uppercase tracking-[0.16em] text-gray-300">
                    Профили
                  </span>
                  <span className="mt-0.5 text-[11px] text-white/70">
                    Управляйте настройками для этой сборки.
                  </span>
                </div>
              </div>
              <div className="mt-3 flex-1 overflow-hidden">
                <ProfileManager
                  modpack={modpack}
                  profiles={modpack.profiles}
                  onProfilesChange={onProfilesChange}
                  onLaunchWithProfile={handleLaunchWithProfile}
                />
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export default function ModpackTab(): JSX.Element {
  const [search, setSearch] = useState("");
  const [modpacks, setModpacks] = useState<Modpack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<SimpleError | null>(null);
  const [selectedModpackId, setSelectedModpackId] = useState<string | null>(
    null,
  );
  const [modalModpackId, setModalModpackId] = useState<string | null>(null);
  const [fileTrees, setFileTrees] = useState<Record<string, FileNode[]>>({});
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [gameRootDir, setGameRootDir] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const dir = await invoke<string>("get_game_root_dir");
        if (!cancelled) {
          setGameRootDir(dir);
        }
      } catch (e) {
        console.error("Не удалось получить путь к игре для сборок", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { modpacks: loaded, error } = await loadModpacks();
      if (cancelled) return;
      setModpacks(loaded);
      if (error) setError(error);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRefresh = async () => {
    setLoading(true);
    const { modpacks: loaded, error } = await loadModpacks();
    setModpacks(loaded);
    if (error) setError(error);
    else setError(null);
    setLoading(false);
  };

  const handleCreate = () => {
    setIsCreateModalOpen(true);
  };

  const handleImport = () => {
    window.alert("Импорт сборки пока не реализован. TODO.");
  };

  const handlePlayFromCard = async (modpack: Modpack) => {
    const activeProfile =
      modpack.profiles.find((p) => p.isActive) ?? modpack.profiles[0];
    if (!activeProfile) {
      if (
        window.confirm(
          "Для этой сборки ещё нет профиля. Создать профиль по умолчанию?",
        )
      ) {
        // TODO: создать профиль по умолчанию.
      }
      return;
    }
    try {
      await launchModpackWithProfile(modpack, activeProfile);
      const nextProfiles = modpack.profiles.map((p) =>
        p.id === activeProfile.id
          ? { ...p, lastPlayedAt: new Date().toISOString() }
          : p,
      );
      const nextModpacks = modpacks.map((m) =>
        m.id === modpack.id ? { ...m, profiles: nextProfiles } : m,
      );
      setModpacks(nextModpacks);
      void saveProfilesToDisk(nextModpacks);
    } catch (e) {
      console.error("Ошибка запуска сборки", e);
    }
  };

  const filteredModpacks = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return modpacks;
    return modpacks.filter((m) => {
      const haystack =
        `${m.name} ${m.version} ${m.author} ${m.loader}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [modpacks, search]);

  const activeModalModpack =
    modalModpackId && modpacks.find((m) => m.id === modalModpackId);

  const getFileTreeForModpack = (id: string, pathOnDisk: string): FileNode[] =>
    fileTrees[id] ?? MOCK_FILE_TREES[pathOnDisk] ?? [];

  const handleProfilesChange = (
    modpackId: string,
    profiles: ModpackProfile[],
  ) => {
    const nextModpacks = modpacks.map((m) =>
      m.id === modpackId ? { ...m, profiles } : m,
    );
    setModpacks(nextModpacks);
    void saveProfilesToDisk(nextModpacks);
  };

  const handleFileTreeLoaded = (modpackId: string, tree: FileNode[]) => {
    setFileTrees((prev) => ({ ...prev, [modpackId]: tree }));
  };

  const handleCreateModpack = (data: CreateModpackData) => {
    const nowIso = new Date().toISOString();
    const version = data.version.trim() || "1.20.1";
    const loader: ModLoader = data.loader;

    const newId = generateModpackId();
    const normalizedRoot =
      gameRootDir && gameRootDir.length > 0
        ? gameRootDir.replace(/\\/g, "/")
        : "";
    const pathOnDisk =
      normalizedRoot !== ""
        ? `${normalizedRoot}/modpacks/${newId}`
        : "";

    const defaultProfile: ModpackProfile = {
      id: generateProfileId(),
      name: "Default",
      createdAt: nowIso,
      updatedAt: nowIso,
      lastPlayedAt: null,
      isActive: true,
      gameVersion: version,
      loader,
      includedFolders: [],
      memoryMb: 4096,
      jvmArgs: "-Xms2G -Xmx4G",
      windowResolution: { width: 1280, height: 720, fullscreen: false },
      extraLaunchArgs: "",
    };

    const newModpack: Modpack = {
      id: newId,
      name: data.name.trim(),
      version,
      loader,
      modsCount: data.modsFiles.length,
      sizeMb: 0,
      author: data.author.trim() || "Локальная сборка",
      updatedAt: nowIso,
      rating: 0,
      ratingVotes: 0,
      pathOnDisk,
      description: data.description.trim(),
      details: data.details.trim(),
      thumbnailUrl: "/launcher-assets/modpack-card-placeholder.png",
      heroImageUrl: "/launcher-assets/modpack-hero-placeholder.png",
      profiles: [defaultProfile],
    };

    const nextModpacks = [...modpacks, newModpack];
    setModpacks(nextModpacks);
    void saveProfilesToDisk(nextModpacks);
    setIsCreateModalOpen(false);
    setSelectedModpackId(newModpack.id);
    setModalModpackId(newModpack.id);

    const importTasks: Promise<unknown>[] = [];
    if (data.modsFiles.length > 0) {
      importTasks.push(
        invoke("import_modpack_files", {
          modpackId: newId,
          category: "mod",
          files: data.modsFiles,
        }).catch((e) =>
          console.error("Не удалось импортировать моды в сборку", e),
        ),
      );
    }
    if (data.resourcepackFiles.length > 0) {
      importTasks.push(
        invoke("import_modpack_files", {
          modpackId: newId,
          category: "resourcepack",
          files: data.resourcepackFiles,
        }).catch((e) =>
          console.error("Не удалось импортировать ресурсы в сборку", e),
        ),
      );
    }
    if (data.shaderFiles.length > 0) {
      importTasks.push(
        invoke("import_modpack_files", {
          modpackId: newId,
          category: "shader",
          files: data.shaderFiles,
        }).catch((e) =>
          console.error("Не удалось импортировать шейдеры в сборку", e),
        ),
      );
    }

    if (importTasks.length > 0) {
      void Promise.all(importTasks);
    }
  };

  const handleUpdateModpack = (updated: Modpack) => {
    const nextModpacks = modpacks.map((m) =>
      m.id === updated.id ? updated : m,
    );
    setModpacks(nextModpacks);
    void saveProfilesToDisk(nextModpacks);
  };

  return (
    <div className="relative flex h-full w-full flex-1 flex-col">
      <div className="relative z-[20] mb-4 mt-2 flex items-center justify-between gap-3">
        <div className="flex flex-1 items-center gap-2 rounded-2xl border border-white/15 bg-black/40 px-4 py-2 shadow-soft backdrop-blur-xl">
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5 text-white/50"
            aria-hidden="true"
          >
            <path
              fill="currentColor"
              d="M11 4a7 7 0 0 1 5.6 11.2l3.6 3.6a1 1 0 0 1-1.4 1.4l-3.6-3.6A7 7 0 1 1 11 4Zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z"
            />
          </svg>
          <input
            type="text"
            placeholder="Поиск..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-transparent text-sm text-white placeholder:text-white/40 focus:outline-none"
            aria-label="Поиск по сборкам"
          />
          <button
            type="button"
            className="interactive-press ml-2 rounded-full bg-white/12 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white hover:bg-white/25 focus:outline-none focus:ring-2 focus:ring-white/70"
            aria-label="Показать все сборки"
          >
            ВСЕ
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCreate}
            className="interactive-press rounded-2xl bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-white shadow-soft hover:bg-white/25 focus:outline-none focus:ring-2 focus:ring-white/70"
            aria-label="Создать сборку"
          >
            Создать
          </button>
          <button
            type="button"
            onClick={handleImport}
            className="interactive-press rounded-2xl bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-white shadow-soft hover:bg-white/25 focus:outline-none focus:ring-2 focus:ring-white/70"
            aria-label="Импортировать сборку"
          >
            ИМПОРТ
          </button>
          <button
            type="button"
            onClick={handleRefresh}
            className="interactive-press rounded-2xl bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-white shadow-soft hover:bg-white/25 focus:outline-none focus:ring-2 focus:ring-white/70"
            aria-label="Обновить список сборок"
          >
            ОБНОВИТЬ
          </button>
        </div>
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 gap-6 pb-4">
        <div className="glass-panel relative z-0 flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl bg-black/45 px-4 pb-4 pt-3 backdrop-blur-2xl">
          <div className="mb-2 flex items-center justify-between text-xs text-white/65">
            <span className="ml-1.5">
              {loading
                ? "Сканирование сборок…"
                : `Всего сборок: ${modpacks.length}`}
            </span>
            {error && <span className="text-amber-300">{error.message}</span>}
          </div>
          <div className="custom-scrollbar -mr-2 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-2">
            {loading && (
              <div className="py-8 text-center text-xs text-white/70">
                Загрузка данных о сборках…
              </div>
            )}
            {!loading &&
              filteredModpacks.map((m) => (
                <ModpackCard
                  key={m.id}
                  modpack={m}
                  isSelected={selectedModpackId === m.id}
                  onOpenModal={() => {
                    setSelectedModpackId(m.id);
                    setModalModpackId(m.id);
                  }}
                  onPlay={() => handlePlayFromCard(m)}
                />
              ))}
            {!loading && filteredModpacks.length === 0 && (
              <div className="rounded-2xl border border-dashed border-white/15 bg-black/30 px-4 py-6 text-center text-xs text-white/60">
                Сборок не найдено. Попробуйте сбросить фильтр или создать новую
                сборку.
              </div>
            )}
          </div>
        </div>

      </div>

      <AnimatePresence>
        {activeModalModpack && (
          <ModpackModal
            modpack={activeModalModpack}
            fileTreeRoot={getFileTreeForModpack(
              activeModalModpack.id,
              activeModalModpack.pathOnDisk,
            )}
            onClose={() => setModalModpackId(null)}
            onProfilesChange={(profiles) =>
              handleProfilesChange(activeModalModpack.id, profiles)
            }
            onFileTreeLoaded={(tree) =>
              handleFileTreeLoaded(activeModalModpack.id, tree)
            }
            onUpdateModpack={handleUpdateModpack}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isCreateModalOpen && (
          <CreateModpackModal
            onClose={() => setIsCreateModalOpen(false)}
            onCreate={handleCreateModpack}
          />
        )}
      </AnimatePresence>

      <div className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md">
        <div className="rounded-3xl border border-white/15 bg-black/70 px-8 py-6 text-center text-white shadow-soft">
          <div className="text-xl font-semibold">Раздел со сборками в разработке</div>
          <p className="mt-2 text-sm text-white/70">
            В ближайших обновлениях здесь появится управление сборками.
          </p>
        </div>
      </div>
    </div>
  );
}

