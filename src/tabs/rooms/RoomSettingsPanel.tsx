import { useEffect, useRef, useState } from "react";
import type { Room, UpdateRoomInput } from "../../api/rooms";
import { ActionButton, Panel, TextField } from "../../components/ui";
import type { useT } from "../../i18n";
import {
  ROOM_LOADERS,
  pickRoomVersionId,
  roomLoaderOf,
  useLoaderVersions,
  type RoomCurrentGame,
  type RoomLoaderId,
} from "./roomHelpers";

export function RoomSettingsPanel({
  room,
  tt,
  busy,
  saving,
  currentGame,
  onSave,
  onWarning,
}: {
  room: Room;
  tt: ReturnType<typeof useT>;
  busy: boolean;
  saving: boolean;
  currentGame: RoomCurrentGame | null;
  onSave: (input: UpdateRoomInput) => void;
  onWarning: (message: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState(room.name?.trim() ?? "");
  const [loader, setLoader] = useState<RoomLoaderId>(roomLoaderOf(room));
  const [gameVersion, setGameVersion] = useState(room.game_version?.trim() ?? "");
  const pickFromCurrentRef = useRef(false);

  const { versions, loading } = useLoaderVersions(loader, expanded);

  useEffect(() => {
    setName(room.name?.trim() ?? "");
    setLoader(roomLoaderOf(room));
    setGameVersion(room.game_version?.trim() ?? "");
  }, [room.id, room.name, room.loader, room.game_version]);

  useEffect(() => {
    if (loading) return;
    const picked = pickFromCurrentRef.current ? pickRoomVersionId(versions, currentGame) : null;
    pickFromCurrentRef.current = false;
    setGameVersion(
      (prev) => picked ?? (prev && versions.some((v) => v.id === prev) ? prev : versions[0]?.id ?? prev),
    );
  }, [loading, versions]);

  const useCurrentGame = () => {
    if (!currentGame) return;
    if (currentGame.loader === loader) {
      const picked = pickRoomVersionId(versions, currentGame);
      if (picked) setGameVersion(picked);
      return;
    }
    pickFromCurrentRef.current = true;
    setLoader(currentGame.loader);
  };

  const save = () => {
    if (!gameVersion.trim()) {
      onWarning(tt("rooms.toast.versionRequired"));
      return;
    }
    onSave({
      name: name.trim() || undefined,
      gameVersion: gameVersion.trim(),
      loader,
    });
  };

  return (
    <Panel padding="md" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-white/85">{tt("rooms.settingsTitle")}</h3>
        <ActionButton size="sm" variant="ghost" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
          {expanded ? tt("rooms.settingsHide") : tt("rooms.settingsShow")}
        </ActionButton>
      </div>

      {expanded ? (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="ui-caption font-semibold">{tt("rooms.roomNameLabel")}</span>
            <TextField
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={tt("rooms.roomNamePlaceholder")}
              disabled={busy}
            />
          </label>

          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="flex flex-1 flex-col gap-1">
              <span className="ui-caption font-semibold">{tt("rooms.loaderLabel")}</span>
              <select
                value={loader}
                onChange={(e) => setLoader(e.target.value as RoomLoaderId)}
                disabled={busy}
                className="launcher-select glass-control px-3 py-2 text-sm text-white outline-none"
              >
                {ROOM_LOADERS.map((id) => (
                  <option key={id} value={id}>
                    {tt(`rooms.loader.${id}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-[1.4] flex-col gap-1">
              <span className="ui-caption font-semibold">{tt("rooms.versionLabel")}</span>
              <select
                value={gameVersion}
                onChange={(e) => setGameVersion(e.target.value)}
                disabled={busy || loading || versions.length === 0}
                className="launcher-select glass-control px-3 py-2 text-sm text-white outline-none"
              >
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <ActionButton size="sm" variant="primary" loading={saving} disabled={busy} onClick={save}>
              {tt("rooms.settingsSave")}
            </ActionButton>
            {currentGame ? (
              <ActionButton size="sm" variant="ghost" disabled={busy || loading} onClick={useCurrentGame}>
                {currentGame.source === "profile"
                  ? tt("rooms.auto.fromProfile", { name: currentGame.label })
                  : tt("rooms.auto.fromMenu")}
              </ActionButton>
            ) : null}
          </div>
        </div>
      ) : null}
    </Panel>
  );
}
