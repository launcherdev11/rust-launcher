import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type ModrinthContentType = "mod" | "resourcepack" | "shader";
type Language = "ru" | "en";

type ModrinthProjectType = "mod" | "modpack" | "resourcepack" | "shader";

type ModrinthProject = {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  icon_url: string | null;
  downloads: number;
  follows: number;
  author: string;
  project_type: ModrinthProjectType;
};

type ModrinthSearchResponse = {
  hits: ModrinthProject[];
  limit: number;
  offset: number;
  total_hits: number;
};

type ModrinthFile = {
  url: string;
  filename: string;
  primary?: boolean;
};

type ModrinthVersion = {
  id: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
  files: ModrinthFile[];
  date_published: string;
};

type ModrinthGameVersionTag = {
  version: string;
};

type NotificationKind = "info" | "success" | "error" | "warning";

type ModsTabProps = {
  showNotification: (kind: NotificationKind, message: string) => void;
  language: Language;
};

function DownloadStatIcon() {
  return (
    <img
      src="/launcher-assets/download.png"
      alt=""
      className="h-3 w-3 shrink-0 object-contain"
      aria-hidden="true"
    />
  );
}

function HeartStatIcon() {
  return (
    <img
      src="/launcher-assets/favorite.png"
      alt=""
      className="h-4 w-4 shrink-0 object-contain"
      aria-hidden="true"
    />
  );
}

export function ModsTab({ showNotification, language }: ModsTabProps) {
  const [modrinthContentType, setModrinthContentType] =
    useState<ModrinthContentType>("mod");
  const [modrinthSearch, setModrinthSearch] = useState("");
  const [modrinthGameVersion, setModrinthGameVersion] = useState("1.20.1");
  const [modrinthGameVersions, setModrinthGameVersions] = useState<string[]>(
    [],
  );
  const [modrinthLoader, setModrinthLoader] =
    useState<"forge" | "fabric" | "quilt" | "neoforge" | "any">("forge");
  const [isModrinthVersionDropdownOpen, setIsModrinthVersionDropdownOpen] =
    useState(false);
  const [isModrinthLoaderDropdownOpen, setIsModrinthLoaderDropdownOpen] =
    useState(false);
  const [modrinthProjects, setModrinthProjects] = useState<ModrinthProject[]>(
    [],
  );
  const [modrinthLoading, setModrinthLoading] = useState(false);
  const [modrinthError, setModrinthError] = useState<string | null>(null);
  const [modrinthSelectedProject, setModrinthSelectedProject] =
    useState<ModrinthProject | null>(null);
  const [modrinthVersions, setModrinthVersions] = useState<ModrinthVersion[]>(
    [],
  );
  const [modrinthVersionsLoading, setModrinthVersionsLoading] =
    useState(false);

  const modrinthTabRefs = useRef<
    Partial<Record<ModrinthContentType, HTMLButtonElement | null>>
  >({});
  const [modrinthIndicator, setModrinthIndicator] = useState<{
    left: number;
    width: number;
  }>({ left: 0, width: 0 });

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(
          "https://api.modrinth.com/v2/tag/game_version",
          { signal: controller.signal },
        );
        if (!res.ok) {
          throw new Error(
            `Modrinth вернул ошибку ${res.status} при загрузке списка версий игры`,
          );
        }
        const data: ModrinthGameVersionTag[] = await res.json();
        const versions = data
          .map((t) => t.version)
          .filter((v) => /^1\.\d+(\.\d+)?$/.test(v));
        if (versions.length > 0) {
          setModrinthGameVersions(versions);
          if (!versions.includes(modrinthGameVersion)) {
            setModrinthGameVersion(versions[0]);
          }
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        console.error(e);
      }
    })();
    return () => controller.abort();
  }, [modrinthGameVersion]);

  const loadModrinthVersions = useCallback(
    async (projectId: string) => {
      setModrinthVersionsLoading(true);
      setModrinthError(null);
      try {
        const params = new URLSearchParams();
        if (modrinthGameVersion) {
          params.set("game_versions", JSON.stringify([modrinthGameVersion]));
        }
        if (modrinthContentType === "mod" && modrinthLoader !== "any") {
          params.set("loaders", JSON.stringify([modrinthLoader]));
        }
        const url = `https://api.modrinth.com/v2/project/${projectId}/version${
          params.size > 0 ? `?${params.toString()}` : ""
        }`;

        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(
            `Modrinth вернул ошибку ${response.status} при загрузке версий`,
          );
        }
        const data: ModrinthVersion[] = await response.json();
        setModrinthVersions(data);
      } catch (e) {
        console.error(e);
        const msg =
          e instanceof Error ? e.message : "Не удалось загрузить версии мода.";
        setModrinthError(msg);
        showNotification("error", msg);
      } finally {
        setModrinthVersionsLoading(false);
      }
    },
    [modrinthContentType, modrinthGameVersion, modrinthLoader, showNotification],
  );

  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      setModrinthLoading(true);
      setModrinthError(null);
      try {
        const facets: string[][] = [
          [`project_type:${modrinthContentType}`],
          [`versions:${modrinthGameVersion}`],
        ];

        if (modrinthContentType === "mod" && modrinthLoader !== "any") {
          facets.push([`categories:${modrinthLoader}`]);
        }

        const params = new URLSearchParams({
          limit: "30",
          index: "downloads",
        });
        if (modrinthSearch.trim().length > 0) {
          params.set("query", modrinthSearch.trim());
        }
        params.set("facets", JSON.stringify(facets));

        const url = `https://api.modrinth.com/v2/search?${params.toString()}`;
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(
            `Modrinth вернул ошибку ${response.status} при загрузке списка проектов`,
          );
        }
        const data: ModrinthSearchResponse = await response.json();
        setModrinthProjects(data.hits);

        const nextSelected =
          data.hits.find(
            (p) => p.project_id === modrinthSelectedProject?.project_id,
          ) ?? data.hits[0] ?? null;
        setModrinthSelectedProject(nextSelected);
        if (nextSelected) {
          void loadModrinthVersions(nextSelected.project_id);
        } else {
          setModrinthVersions([]);
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          return;
        }
        console.error(e);
        const msg =
          e instanceof Error ? e.message : "Не удалось загрузить список проектов.";
        setModrinthError(msg);
        showNotification("error", msg);
      } finally {
        setModrinthLoading(false);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [
    modrinthContentType,
    modrinthGameVersion,
    modrinthLoader,
    modrinthSearch,
    modrinthSelectedProject?.project_id,
    loadModrinthVersions,
    showNotification,
  ]);

  useEffect(() => {
    const updateIndicator = () => {
      const el = modrinthTabRefs.current[modrinthContentType];
      if (el) {
        setModrinthIndicator({
          left: el.offsetLeft,
          width: el.offsetWidth,
        });
      }
    };

    updateIndicator();
    window.addEventListener("resize", updateIndicator);
    return () => window.removeEventListener("resize", updateIndicator);
  }, [modrinthContentType]);

  const filteredModrinthVersions = modrinthVersions.filter((v) => {
    if (modrinthGameVersion && !v.game_versions.includes(modrinthGameVersion)) {
      return false;
    }
    if (
      modrinthContentType === "mod" &&
      modrinthLoader !== "any" &&
      !v.loaders.includes(modrinthLoader)
    ) {
      return false;
    }
    return true;
  });

  return (
    <div className="flex h-full w-full max-w-5xl flex-col">
      <div className="relative z-[80] mb-4 mt-2 flex items-center justify-between gap-3">
        <div className="flex flex-1 items-center gap-2 rounded-2xl border border-white/15 bg-black/40 px-3 py-2 shadow-soft backdrop-blur-xl">
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
            placeholder={language === "ru" ? "Поиск..." : "Search..."}
            value={modrinthSearch}
            onChange={(e) => setModrinthSearch(e.target.value)}
            className="w-full bg-transparent text-sm text-white placeholder:text-white/40 focus:outline-none"
          />
        </div>
        <div className="relative flex items-center gap-2 rounded-2xl border border-white/12 bg-black/40 px-3 py-2 shadow-soft backdrop-blur-xl">
          <span className="mr-1 text-[11px] uppercase tracking-[0.16em] text-gray-400">
            {language === "ru" ? "Версия" : "Version"}
          </span>
          <div className="relative">
            <button
              type="button"
              onClick={() =>
                setIsModrinthVersionDropdownOpen((current) => !current)
              }
              className="interactive-press inline-flex min-w-[88px] items-center gap-2 rounded-full border border-white/25 bg-black/70 px-3 py-1 text-xs font-semibold text-white shadow-soft hover:border-white/60"
            >
              <span className="truncate">
                {modrinthGameVersion || "—"}
              </span>
              <span className="text-[10px] text-gray-400">▾</span>
            </button>
            {isModrinthVersionDropdownOpen && modrinthGameVersions.length > 0 && (
              <div className="absolute left-0 top-full z-[100] mt-1 max-h-64 w-32 overflow-y-auto rounded-2xl bg-black/90 p-1 text-xs shadow-soft backdrop-blur-lg">
                {modrinthGameVersions.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => {
                      setModrinthGameVersion(v);
                      setIsModrinthVersionDropdownOpen(false);
                    }}
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-1.5 text-left transition-colors ${
                      modrinthGameVersion === v
                        ? "bg-white/90 text-black"
                        : "text-white/80 hover:bg-white/10"
                    }`}
                  >
                    <span>{v}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="relative">
            <button
              type="button"
              onClick={() =>
                setIsModrinthLoaderDropdownOpen((current) => !current)
              }
              className="interactive-press inline-flex min-w-[96px] items-center gap-2 rounded-full border border-white/25 bg-black/70 px-3 py-1 text-xs font-semibold text-white shadow-soft hover:border-white/60"
            >
              <span>
                {modrinthLoader === "any"
                  ? language === "ru"
                    ? "Любой"
                    : "Any"
                  : modrinthLoader === "forge"
                    ? "Forge"
                    : modrinthLoader === "fabric"
                      ? "Fabric"
                      : modrinthLoader === "quilt"
                        ? "Quilt"
                        : "NeoForge"}
              </span>
              <span className="text-[10px] text-gray-400">▾</span>
            </button>
            {isModrinthLoaderDropdownOpen && (
              <div className="absolute left-0 top-full z-[100] mt-1 max-h-64 w-36 overflow-y-auto rounded-2xl bg-black/90 p-1 text-xs shadow-soft backdrop-blur-lg">
                {[
                  { id: "forge", label: "Forge" },
                  { id: "fabric", label: "Fabric" },
                  { id: "quilt", label: "Quilt" },
                  { id: "neoforge", label: "NeoForge" },
                  {
                    id: "any",
                    label: language === "ru" ? "Все" : "All",
                  },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      setModrinthLoader(
                        opt.id as
                          | "forge"
                          | "fabric"
                          | "quilt"
                          | "neoforge"
                          | "any",
                      );
                      setIsModrinthLoaderDropdownOpen(false);
                    }}
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-1.5 text-left transition-colors ${
                      modrinthLoader === opt.id
                        ? "bg-white/90 text-black"
                        : "text-white/80 hover:bg-white/10"
                    }`}
                  >
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="relative flex items-center gap-0 rounded-2xl border border-white/12 bg-black/50 p-1 shadow-soft backdrop-blur-xl overflow-hidden">
          <div
            className="pointer-events-none absolute top-1.5 bottom-1.5 rounded-lg bg-white/90 transition-all duration-200 ease-out"
            style={{
              left: `${modrinthIndicator.left}px`,
              width: `${modrinthIndicator.width}px`,
            }}
          />
          {(["mod", "resourcepack", "shader"] as ModrinthContentType[]).map(
            (kind) => {
              const label =
                kind === "mod"
                  ? language === "ru"
                    ? "Моды"
                    : "Mods"
                  : kind === "resourcepack"
                    ? language === "ru"
                      ? "Ресурсы"
                      : "Resources"
                    : language === "ru"
                      ? "Шейдеры"
                      : "Shaders";
              const active = modrinthContentType === kind;
              return (
                <button
                  key={kind}
                  type="button"
                  ref={(el) => {
                    modrinthTabRefs.current[kind] = el;
                  }}
                  onClick={() => setModrinthContentType(kind)}
                  className={`interactive-press relative z-10 flex-1 rounded-xl px-3 py-1 text-xs font-semibold text-center transition-colors ${
                    active
                      ? "text-black"
                      : "text-white/70 hover:text-white"
                  }`}
                >
                  {label}
                </button>
              );
            },
          )}
        </div>
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 gap-4 pb-4">
        <div className="glass-panel relative z-0 flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="mb-2 flex items-center justify-between text-xs text-white/60">
              <span className="ml-1.5">
                {modrinthLoading
                  ? language === "ru"
                    ? "Загрузка популярных проектов…"
                    : "Loading popular projects…"
                  : ""}
              </span>
            {modrinthError && (
              <span className="text-rose-300">{modrinthError}</span>
            )}
          </div>
          <div className="custom-scrollbar -mr-2 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-2">
            {modrinthProjects.map((p) => {
              const isActive =
                modrinthSelectedProject?.project_id === p.project_id;
              return (
                <button
                  key={p.project_id}
                  type="button"
                  onClick={() => {
                    setModrinthSelectedProject(p);
                    void loadModrinthVersions(p.project_id);
                  }}
                  className={`interactive-press flex w-full items-stretch rounded-2xl border px-3 py-3 text-left transition ${
                    isActive
                      ? "border-white/60 bg-white/12"
                      : "border-white/10 bg-black/35 hover:border-white/40 hover:bg-black/55"
                  }`}
                >
                  <div className="mr-3 flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/5">
                    {p.icon_url ? (
                      <img
                        src={p.icon_url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="text-xs text-white/50">Нет иконки</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1 pr-3">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-white">
                        {p.title}
                      </span>
                      <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-gray-300">
                        {p.project_type}
                      </span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-white/70">
                      {p.description}
                    </p>
                    <p className="mt-1 text-[11px] text-white/50">
                      by {p.author}
                    </p>
                  </div>
                  <div className="flex flex-col items-end justify-between text-right text-[11px] text-white/70">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1">
                        <DownloadStatIcon />
                        <span>
                          {p.downloads.toLocaleString("ru-RU")}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <HeartStatIcon />
                        <span>{p.follows.toLocaleString("ru-RU")}</span>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
            {!modrinthLoading && modrinthProjects.length === 0 && (
              <div className="rounded-2xl border border-dashed border-white/15 bg-black/30 px-4 py-6 text-center text-xs text-white/60">
                {language === "ru"
                  ? "Ничего не найдено для выбранных фильтров Modrinth."
                  : "Nothing found for the selected Modrinth filters."}
              </div>
            )}
          </div>
        </div>

        <div className="glass-panel relative z-0 flex w-80 min-h-0 flex-shrink-0 flex-col">
          <div className="mb-2 text-xs text-white/60">
            {modrinthSelectedProject
              ? ``
              : language === "ru"
                ? "Выберите проект слева, чтобы посмотреть версии"
                : "Select a project on the left to see versions"}
          </div>
          <div className="custom-scrollbar -mr-2 min-h-0 flex-1 overflow-y-auto pr-2">
            {modrinthVersionsLoading && (
              <div className="py-8 text-center text-xs text-white/70">
                Загрузка версий…
              </div>
            )}
            {!modrinthVersionsLoading &&
              modrinthSelectedProject &&
              filteredModrinthVersions.map((v) => {
                const primaryFile =
                  v.files.find((f) => f.primary) ?? v.files[0];
                return (
                  <div
                    key={v.id}
                    className="mb-2 flex items-center justify-between rounded-2xl bg-black/35 px-3 py-2 text-xs text-white/80"
                  >
                    <div className="mr-2 min-w-0 flex-1">
                      <div className="truncate font-semibold">
                        {v.version_number}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-white/55">
                        {modrinthGameVersion ? (
                          <span className="rounded-full bg-white/10 px-2 py-0.5">
                            MC {modrinthGameVersion}
                          </span>
                        ) : (
                          v.game_versions.length > 0 && (
                            <span>{v.game_versions.join(", ")}</span>
                          )
                        )}
                        {v.loaders.length > 0 && (
                          <span className="rounded-full bg-white/10 px-2 py-0.5">
                            {v.loaders.join(", ")}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={!primaryFile}
                      onClick={async () => {
                        if (!primaryFile) return;
                        try {
                          await invoke("download_modrinth_file", {
                            category: modrinthContentType,
                            url: primaryFile.url,
                            filename: primaryFile.filename,
                          });
                        showNotification(
                          "success",
                          language === "ru"
                            ? `Файл ${primaryFile.filename} сохранён в папку ${
                                modrinthContentType === "mod"
                                  ? "mods"
                                  : modrinthContentType === "resourcepack"
                                    ? "resourcepacks"
                                    : "shaderpacks"
                              }.`
                            : `File ${primaryFile.filename} saved to folder ${
                                modrinthContentType === "mod"
                                  ? "mods"
                                  : modrinthContentType === "resourcepack"
                                    ? "resourcepacks"
                                    : "shaderpacks"
                              }.`,
                        );
                        } catch (e) {
                          const msg =
                            e instanceof Error
                              ? e.message
                              : language === "ru"
                                ? "Не удалось скачать файл Modrinth."
                                : "Failed to download Modrinth file.";
                          console.error(e);
                          showNotification("error", msg);
                        }
                      }}
                      className="interactive-press ml-2 inline-flex items-center justify-center rounded-full bg-accentBlue px-3 py-1 text-[11px] font-semibold text-white shadow-soft hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/40"
                    >
                      <DownloadStatIcon />
                      <span className="ml-1">
                        {language === "ru" ? "Скачать" : "Download"}
                      </span>
                    </button>
                  </div>
                );
              })}
            {!modrinthVersionsLoading &&
              modrinthSelectedProject &&
              filteredModrinthVersions.length === 0 && (
                <div className="py-8 text-center text-xs text-white/60">
                  {language === "ru"
                    ? "Для этого проекта нет доступных версий."
                    : "There are no available versions for this project."}
                </div>
              )}
          </div>
        </div>
      </div>
    </div>
  );
}

