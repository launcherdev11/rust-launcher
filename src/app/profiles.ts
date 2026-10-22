import type { InstanceProfileCard, InstanceProfileSummary } from "./types";

type SummarySource = Pick<InstanceProfileSummary, "id" | "name" | "game_version" | "loader"> & {
  loader_version?: string | null;
};

type CardSource = SummarySource &
  Pick<
    InstanceProfileCard,
    | "icon_path"
    | "created_at"
    | "mods_count"
    | "resourcepacks_count"
    | "shaderpacks_count"
    | "total_size_bytes"
    | "directory"
  > & {
    play_time_seconds?: number | null;
    last_played_at?: number | null;
  };

export function toInstanceProfileSummary(p: SummarySource): InstanceProfileSummary {
  return {
    id: p.id,
    name: p.name,
    game_version: p.game_version,
    loader: p.loader,
    loader_version: p.loader_version ?? null,
  };
}

export function toInstanceProfileCard(p: CardSource): InstanceProfileCard {
  return {
    ...toInstanceProfileSummary(p),
    icon_path: p.icon_path,
    created_at: p.created_at,
    play_time_seconds: p.play_time_seconds ?? 0,
    last_played_at: p.last_played_at ?? null,
    mods_count: p.mods_count,
    resourcepacks_count: p.resourcepacks_count,
    shaderpacks_count: p.shaderpacks_count,
    total_size_bytes: p.total_size_bytes,
    directory: p.directory,
  };
}
