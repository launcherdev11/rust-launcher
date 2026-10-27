import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { localeTag, type Language } from "../../i18n";
import { confirmDialog } from "../../lib/confirmDialog";
import {
  CHUNK_STATUS,
  deleteWorldChunks,
  getWorldOverview,
  getWorldRegion,
  listWorldDimensions,
  type WorldDimension,
  type WorldOverview,
  type WorldRegionDetail,
} from "./api";

type Tt = (key: string, vars?: Record<string, string | number>) => string;
type Notify = (kind: "info" | "success" | "error" | "warning", message: string) => void;

type Filter = "none" | "unvisited" | "outdated" | "damaged";

const REGION = 512;
const MIN_SCALE = 1 / 32;
const MAX_SCALE = 2;
const LOAD_CONCURRENCY = 3;
const VISITED_TICKS = 1200;

const VANILLA_DIMS = new Set(["minecraft:overworld", "minecraft:the_nether", "minecraft:the_end"]);

const regionKey = (rx: number, rz: number) => `${rx},${rz}`;
const chunkKey = (x: number, z: number) => `${x},${z}`;

function matchesFilter(d: WorldRegionDetail, i: number, filter: Filter, worldDv: number | null): boolean {
  const st = d.status[i];
  if (st === CHUNK_STATUS.absent) return false;
  switch (filter) {
    case "damaged":
      return st === CHUNK_STATUS.damaged || st === CHUNK_STATUS.unreadable;
    case "unvisited":
      return st !== CHUNK_STATUS.damaged && d.inhabitedTicks[i] < VISITED_TICKS;
    case "outdated":
      return worldDv != null && d.dataVersion[i] > 0 && d.dataVersion[i] < worldDv;
    default:
      return false;
  }
}

const RegionOverlay = memo(function RegionOverlay({
  detail,
  filter,
  worldDv,
  selection,
  size,
}: {
  detail: WorldRegionDetail;
  filter: Filter;
  worldDv: number | null;
  selection: Set<string>;
  size: number;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, 32, 32);
    for (let i = 0; i < 1024; i++) {
      const lx = i % 32;
      const lz = Math.floor(i / 32);
      const selected = selection.has(chunkKey(detail.rx * 32 + lx, detail.rz * 32 + lz));
      if (selected) {
        ctx.fillStyle = "rgba(168, 120, 255, 0.75)";
        ctx.fillRect(lx, lz, 1, 1);
      } else if (filter !== "none" && matchesFilter(detail, i, filter, worldDv)) {
        ctx.fillStyle = filter === "damaged" ? "rgba(255, 70, 70, 0.7)" : "rgba(255, 200, 60, 0.55)";
        ctx.fillRect(lx, lz, 1, 1);
      } else if (filter !== "none" && detail.status[i] !== CHUNK_STATUS.absent) {
        ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
        ctx.fillRect(lx, lz, 1, 1);
      }
    }
  }, [detail, filter, worldDv, selection]);
  return (
    <canvas
      ref={ref}
      width={32}
      height={32}
      className="pointer-events-none absolute inset-0"
      style={{ width: size, height: size, imageRendering: "pixelated" }}
    />
  );
});

export function ChunkMapTab({
  profileId,
  world,
  language,
  gameRunning,
  tt,
  showNotification,
}: {
  profileId: string;
  world: string;
  language: Language;
  gameRunning: boolean;
  tt: Tt;
  showNotification: Notify;
}) {
  const [dims, setDims] = useState<WorldDimension[]>([]);
  const [dimension, setDimension] = useState("minecraft:overworld");
  const [overview, setOverview] = useState<WorldOverview | null>(null);
  const [details, setDetails] = useState<Map<string, WorldRegionDetail>>(new Map());
  const [view, setView] = useState({ scale: 0.25, x: 0, y: 0 });
  const [filter, setFilter] = useState<Filter>("none");
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<{ x: number; z: number } | null>(null);
  const [rect, setRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ w: 800, h: 420 });
  const boxRef = useRef(box);
  boxRef.current = box;
  const [loadTick, setLoadTick] = useState(0);
  const notifyRef = useRef(showNotification);
  notifyRef.current = showNotification;
  const inflight = useRef(new Set<string>());
  const failed = useRef(new Set<string>());
  const drag = useRef<{ startX: number; startY: number; viewX: number; viewY: number; moved: boolean; rect: boolean } | null>(null);

  useEffect(() => {
    listWorldDimensions(profileId, world)
      .then((d) => {
        setDims(d);
        setDimension((prev) => (d.some((x) => x.id === prev) ? prev : d[0]?.id ?? prev));
      })
      .catch(() => setDims([]));
  }, [profileId, world]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setOverview(null);
    setDetails(new Map());
    setSelection(new Set());
    inflight.current.clear();
    failed.current.clear();
    getWorldOverview(profileId, world, dimension)
      .then((o) => {
        if (cancelled) return;
        setOverview(o);
        const anchor =
          o.regions.find((r) => r.rx === 0 && r.rz === 0) ??
          o.regions[Math.floor(o.regions.length / 2)] ?? { rx: 0, rz: 0 };
        const { w, h } = boxRef.current;
        setView((v) => ({
          ...v,
          x: w / 2 - (anchor.rx + 0.5) * REGION * v.scale,
          y: h / 2 - (anchor.rz + 0.5) * REGION * v.scale,
        }));
      })
      .catch((e) => !cancelled && notifyRef.current("error", String(e)));
    return () => {
      cancelled = true;
    };
  }, [profileId, world, dimension, reloadTick]);

  const size = REGION * view.scale;

  const visible = useMemo(() => {
    if (!overview) return [];
    return overview.regions.filter((r) => {
      const left = r.rx * size + view.x;
      const top = r.rz * size + view.y;
      return left + size > -size && top + size > -size && left < box.w + size && top < box.h + size;
    });
  }, [overview, size, view.x, view.y, box]);

  useEffect(() => {
    const cx = (box.w / 2 - view.x) / size;
    const cz = (box.h / 2 - view.y) / size;
    const queue = visible
      .filter((r) => {
        const k = regionKey(r.rx, r.rz);
        return !details.has(k) && !inflight.current.has(k) && !failed.current.has(k);
      })
      .sort((a, b) => Math.hypot(a.rx + 0.5 - cx, a.rz + 0.5 - cz) - Math.hypot(b.rx + 0.5 - cx, b.rz + 0.5 - cz));
    const free = LOAD_CONCURRENCY - inflight.current.size;
    for (const r of queue.slice(0, Math.max(0, free))) {
      const k = regionKey(r.rx, r.rz);
      inflight.current.add(k);
      getWorldRegion(profileId, world, dimension, r.rx, r.rz)
        .then((d) => setDetails((prev) => new Map(prev).set(k, d)))
        .catch(() => failed.current.add(k))
        .finally(() => {
          inflight.current.delete(k);
          setLoadTick((n) => n + 1);
        });
    }
  }, [visible, details, profileId, world, dimension, view.x, view.y, size, box, loadTick]);

  const toChunk = useCallback(
    (clientX: number, clientY: number) => {
      const el = containerRef.current;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const px = (clientX - r.left - view.x) / view.scale;
      const pz = (clientY - r.top - view.y) / view.scale;
      return { x: Math.floor(px / 16), z: Math.floor(pz / 16) };
    },
    [view],
  );

  const chunkInfo = useCallback(
    (x: number, z: number) => {
      const rx = Math.floor(x / 32);
      const rz = Math.floor(z / 32);
      const d = details.get(regionKey(rx, rz));
      if (!d) return null;
      const i = (x - rx * 32) + (z - rz * 32) * 32;
      return { d, i };
    },
    [details],
  );

  const onWheel = (e: React.WheelEvent) => {
    const el = containerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    setView((v) => {
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * (e.deltaY < 0 ? 1.25 : 0.8)));
      const k = next / v.scale;
      return { scale: next, x: mx - (mx - v.x) * k, y: my - (my - v.y) * k };
    });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { startX: e.clientX, startY: e.clientY, viewX: view.x, viewY: view.y, moved: false, rect: e.shiftKey };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const c = toChunk(e.clientX, e.clientY);
    setHover(c);
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
    if (d.rect) {
      const el = containerRef.current!.getBoundingClientRect();
      setRect({ x0: d.startX - el.left, y0: d.startY - el.top, x1: e.clientX - el.left, y1: e.clientY - el.top });
    } else if (d.moved) {
      setView((v) => ({ ...v, x: d.viewX + dx, y: d.viewY + dy }));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.rect && rect) {
      const el = containerRef.current!.getBoundingClientRect();
      const a = toChunk(Math.min(rect.x0, rect.x1) + el.left, Math.min(rect.y0, rect.y1) + el.top);
      const b = toChunk(Math.max(rect.x0, rect.x1) + el.left, Math.max(rect.y0, rect.y1) + el.top);
      setRect(null);
      if (!a || !b || (b.x - a.x + 1) * (b.z - a.z + 1) > 200_000) return;
      setSelection((prev) => {
        const next = new Set(prev);
        for (let x = a.x; x <= b.x; x++) {
          for (let z = a.z; z <= b.z; z++) {
            const info = chunkInfo(x, z);
            if (info && info.d.status[info.i] !== CHUNK_STATUS.absent) next.add(chunkKey(x, z));
          }
        }
        return next;
      });
      return;
    }
    if (d.moved) return;
    const c = toChunk(e.clientX, e.clientY);
    if (!c) return;
    const info = chunkInfo(c.x, c.z);
    if (!info || info.d.status[info.i] === CHUNK_STATUS.absent) return;
    setSelection((prev) => {
      const next = new Set(prev);
      const k = chunkKey(c.x, c.z);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const stats = useMemo(() => {
    let total = 0;
    let damaged = 0;
    let unvisited = 0;
    let outdated = 0;
    const worldDv = overview?.dataVersion ?? null;
    for (const d of details.values()) {
      for (let i = 0; i < 1024; i++) {
        if (d.status[i] === CHUNK_STATUS.absent) continue;
        total++;
        if (matchesFilter(d, i, "damaged", worldDv)) damaged++;
        if (matchesFilter(d, i, "unvisited", worldDv)) unvisited++;
        if (matchesFilter(d, i, "outdated", worldDv)) outdated++;
      }
    }
    return { total, damaged, unvisited, outdated };
  }, [details, overview?.dataVersion]);

  const selectFiltered = () => {
    if (filter === "none") return;
    const worldDv = overview?.dataVersion ?? null;
    const next = new Set(selection);
    for (const d of details.values()) {
      for (let i = 0; i < 1024; i++) {
        if (matchesFilter(d, i, filter, worldDv)) next.add(chunkKey(d.rx * 32 + (i % 32), d.rz * 32 + Math.floor(i / 32)));
      }
    }
    setSelection(next);
  };

  const deleteSelected = async () => {
    if (selection.size === 0) return;
    const ok = await confirmDialog({
      title: tt("worldTools.map.deleteTitle"),
      message: tt("worldTools.map.deleteMessage", { count: selection.size }),
      confirmLabel: tt("worldTools.map.delete"),
      cancelLabel: tt("common.cancel"),
      tone: "danger",
    });
    if (!ok) return;
    setDeleting(true);
    try {
      const chunks = [...selection].map((k) => {
        const [x, z] = k.split(",").map(Number);
        return { x, z };
      });
      const n = await deleteWorldChunks(profileId, world, dimension, chunks);
      showNotification("success", tt("worldTools.map.deleted", { count: n }));
      setSelection(new Set());
      setReloadTick((t) => t + 1);
    } catch (e) {
      showNotification("error", String(e));
    } finally {
      setDeleting(false);
    }
  };

  const hoverInfo = hover ? chunkInfo(hover.x, hover.z) : null;
  const filters: Filter[] = ["none", "unvisited", "outdated", "damaged"];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {dims.length > 1 ? (
          <select
            value={dimension}
            onChange={(e) => setDimension(e.target.value)}
            className="launcher-select glass-control h-8 max-w-[14rem] truncate pl-3 text-[0.8125rem]"
            aria-label={tt("worldTools.map.dimension")}
          >
            {dims.map((d) => (
              <option key={d.id} value={d.id}>
                {VANILLA_DIMS.has(d.id) ? tt(`worldTools.map.dim.${d.id.slice("minecraft:".length)}`) : d.id}
              </option>
            ))}
          </select>
        ) : null}
        <div className="seg-track flex rounded-xl p-0.5 text-[0.75rem]">
          {filters.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-lg px-2.5 py-1 font-semibold ${filter === f ? "seg-on" : "text-white/60"}`}
            >
              {tt(`worldTools.map.filter.${f}`)}
              {f === "damaged" && stats.damaged > 0 ? ` · ${stats.damaged}` : ""}
            </button>
          ))}
        </div>
        {filter !== "none" ? (
          <button type="button" onClick={selectFiltered} className="btn btn-sm btn-ghost">
            {tt("worldTools.map.selectFiltered")}
          </button>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {selection.size > 0 ? (
            <>
              <span className="text-[0.75rem] text-white/60">{tt("worldTools.map.selected", { count: selection.size })}</span>
              <button type="button" onClick={() => setSelection(new Set())} className="btn btn-sm btn-ghost">
                {tt("worldTools.map.clear")}
              </button>
              <button
                type="button"
                onClick={() => void deleteSelected()}
                disabled={deleting || gameRunning}
                className="btn btn-sm btn-danger"
                title={gameRunning ? tt("worldTools.map.closeGame") : undefined}
              >
                {deleting ? tt("worldTools.map.deleting") : tt("worldTools.map.delete")}
              </button>
            </>
          ) : null}
        </div>
      </div>

      <div
        ref={containerRef}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHover(null)}
        className="relative min-h-[22rem] flex-1 cursor-grab touch-none select-none overflow-hidden rounded-xl border border-white/[0.06] bg-[var(--ink-0)] active:cursor-grabbing"
      >
        {overview == null ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-white/55">{tt("worldTools.loading")}</div>
        ) : overview.regions.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-white/55">{tt("worldTools.map.empty")}</div>
        ) : (
          visible.map((r) => {
            const k = regionKey(r.rx, r.rz);
            const d = details.get(k);
            return (
              <div
                key={k}
                className="absolute"
                style={{ left: r.rx * size + view.x, top: r.rz * size + view.y, width: size, height: size }}
              >
                {d ? (
                  <>
                    <img
                      src={d.image}
                      alt=""
                      draggable={false}
                      className="absolute inset-0 h-full w-full"
                      style={{ imageRendering: view.scale >= 0.5 ? "pixelated" : "auto" }}
                    />
                    <RegionOverlay
                      detail={d}
                      filter={filter}
                      worldDv={overview.dataVersion}
                      selection={selection}
                      size={size}
                    />
                  </>
                ) : (
                  <div className="h-full w-full animate-pulse bg-white/[0.04] outline outline-1 outline-white/[0.06]" />
                )}
              </div>
            );
          })
        )}
        {rect ? (
          <div
            className="pointer-events-none absolute border border-accent-hi bg-accent-from/20"
            style={{
              left: Math.min(rect.x0, rect.x1),
              top: Math.min(rect.y0, rect.y1),
              width: Math.abs(rect.x1 - rect.x0),
              height: Math.abs(rect.y1 - rect.y0),
            }}
          />
        ) : null}
        {hover && hoverInfo && hoverInfo.d.status[hoverInfo.i] !== CHUNK_STATUS.absent ? (
          <div className="pointer-events-none absolute bottom-2 left-2 rounded-lg bg-black/75 px-2.5 py-1.5 text-[0.75rem] text-white/85">
            <div>
              {tt("worldTools.map.chunkAt", { x: hover.x, z: hover.z, bx: hover.x * 16, bz: hover.z * 16 })}
            </div>
            <div className="text-white/55">
              {tt(`worldTools.map.status.${["absent", "ok", "damaged", "unreadable", "proto"][hoverInfo.d.status[hoverInfo.i]] ?? "ok"}`)}
              {" · "}
              {tt("worldTools.map.inhabited", { minutes: Math.round(hoverInfo.d.inhabitedTicks[hoverInfo.i] / 1200) })}
              {hoverInfo.d.savedAt[hoverInfo.i]
                ? ` · ${new Date(hoverInfo.d.savedAt[hoverInfo.i] * 1000).toLocaleDateString(localeTag(language))}`
                : ""}
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[0.75rem] text-white/45">
        <span>{tt("worldTools.map.stats", { total: stats.total, unvisited: stats.unvisited, outdated: stats.outdated })}</span>
        {overview?.versionName ? <span>{tt("worldTools.map.worldVersion", { version: overview.versionName })}</span> : null}
        <span>{tt("worldTools.map.controls")}</span>
      </div>
    </div>
  );
}
