import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { t, type Language } from "../i18n";
import type {
  GameStatus,
  InstanceProfileSummary,
  LoaderId,
  Settings,
  SidebarItemId,
  VersionItem,
} from "../app/types";

type UseDiscordPresenceOptions = {
  activeItem: SidebarItemId;
  language: Language;
  discordModsTitle: string | null;
  activeInstanceProfile: InstanceProfileSummary | null;
  gameStatus: GameStatus;
  loader: LoaderId;
  selectedVersion: VersionItem | null;
  settings: Settings | null;
};

export function useDiscordPresence({
  activeItem,
  language,
  discordModsTitle,
  activeInstanceProfile,
  gameStatus,
  loader,
  selectedVersion,
  settings,
}: UseDiscordPresenceOptions) {
  useEffect(() => {
    if (!(settings?.discord_rpc_enabled ?? true)) {
      invoke("discord_presence_clear").catch(() => {});
      return;
    }

    let details: string;
    let state: string | null = null;
    let tab = activeItem;

    if (gameStatus === "running") {
      const profileName = activeInstanceProfile?.name?.trim() || null;
      const gameVersion =
        activeInstanceProfile?.game_version?.trim() ||
        selectedVersion?.id?.trim() ||
        null;
      const loaderId = (activeInstanceProfile?.loader || loader || "").toLowerCase();
      const loaderLabel =
        loaderId === "fabric"
          ? "Fabric"
          : loaderId === "forge"
            ? "Forge"
            : loaderId === "quilt"
              ? "Quilt"
              : loaderId === "neoforge"
                ? "NeoForge"
                : loaderId === "vanilla"
                  ? "Vanilla"
                  : null;

      const metaParts = [loaderLabel, gameVersion].filter(Boolean) as string[];
      const meta = metaParts.join(" · ");
      const playingLabel = profileName
        ? meta
          ? `${profileName} · ${meta}`
          : profileName
        : meta || "Minecraft";

      details = t(language, "app.discord.playing");
      state = playingLabel;
      tab = "play";
    } else {
      switch (activeItem) {
        case "play":
          details = t(language, "app.discord.play");
          break;
        case "settings":
          details = t(language, "app.discord.settings");
          break;
        case "mods":
          details = t(language, "app.discord.mods");
          if (discordModsTitle) state = discordModsTitle;
          break;
        case "modpacks":
          details = t(language, "app.discord.modpacks");
          if (activeInstanceProfile?.name) state = activeInstanceProfile.name;
          break;
        case "friends":
          details = t(language, "app.discord.friends");
          break;
        case "rooms":
          details = t(language, "app.discord.rooms");
          break;
        case "accounts":
          details = t(language, "app.discord.accounts");
          break;
        default:
          details = t(language, "app.discord.play");
      }
    }
    invoke("discord_presence_update", { details, state, tab }).catch(() => {});
  }, [
    activeItem,
    language,
    discordModsTitle,
    activeInstanceProfile?.name,
    activeInstanceProfile?.game_version,
    activeInstanceProfile?.loader,
    gameStatus,
    loader,
    selectedVersion?.id,
    settings?.discord_rpc_enabled,
  ]);
}
