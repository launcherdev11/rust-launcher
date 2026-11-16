import { useEffect, useState } from "react";
import type { CreateRoomInput } from "../../api/rooms";
import type { InstanceProfileCard } from "../../app/types";
import { LoaderIcon } from "../../components/loader_icon";
import { ActionButton, Modal, TextField } from "../../components/ui";
import type { useT } from "../../i18n";
import {
  MAX_ROOM_PLAYERS,
  ROOM_LOADERS,
  isRoomLoaderId,
  pickRoomVersionId,
  useLoaderVersions,
  type RoomCurrentGame,
  type RoomLoaderId,
} from "./roomHelpers";
import { SegmentedField } from "./roomParts";

type Visibility = "public" | "private";

const PLAYER_LIMITS = Array.from({ length: MAX_ROOM_PLAYERS - 1 }, (_, i) => i + 2);

export function CreateRoomModal({
  open,
  busy,
  tt,
  currentGame,
  profiles,
  onClose,
  onSubmit,
  onWarning,
  onError,
}: {
  open: boolean;
  busy: boolean;
  tt: ReturnType<typeof useT>;
  currentGame: RoomCurrentGame | null;
  profiles: InstanceProfileCard[];
  onClose: () => void;
  onSubmit: (input: CreateRoomInput, modpackProfileId?: string) => void;
  onWarning: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState("");
  const [loader, setLoader] = useState<RoomLoaderId>("vanilla");
  const [gameVersion, setGameVersion] = useState("");
  const [manual, setManual] = useState(false);
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [password, setPassword] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(MAX_ROOM_PLAYERS);
  const [withModpack, setWithModpack] = useState(false);
  const [modpackId, setModpackId] = useState<string | null>(null);

  const modpack = withModpack ? profiles.find((p) => p.id === modpackId) ?? null : null;
  const sourceGame: RoomCurrentGame | null = modpack
    ? {
        loader: isRoomLoaderId(modpack.loader) ? modpack.loader : "vanilla",
        gameVersion: modpack.game_version,
        loaderVersion: modpack.loader_version ?? null,
        source: "profile",
        label: modpack.name,
        profileId: modpack.id,
      }
    : currentGame;

  const { versions, loading: versionsLoading } = useLoaderVersions(loader, open, onError);

  useEffect(() => {
    if (!open) return;
    setName("");
    setLoader(currentGame?.loader ?? "vanilla");
    setGameVersion("");
    setManual(!currentGame);
    setVisibility("public");
    setPassword("");
    setMaxPlayers(MAX_ROOM_PLAYERS);
    setWithModpack(false);
    setModpackId(null);
  }, [open]);

  const autoGame = (modpack || !manual) && sourceGame?.loader === loader ? sourceGame : null;

  const pickModpack = (profile: InstanceProfileCard) => {
    setModpackId(profile.id);
    setLoader(isRoomLoaderId(profile.loader) ? profile.loader : "vanilla");
    setManual(false);
  };

  useEffect(() => {
    if (versionsLoading) return;
    const auto = pickRoomVersionId(versions, autoGame);
    setGameVersion((prev) =>
      auto ?? (prev && versions.some((v) => v.id === prev) ? prev : versions[0]?.id ?? ""),
    );
  }, [autoGame, versions, versionsLoading]);

  const submit = () => {
    const trimmedPassword = password.trim();
    if (visibility === "private" && (trimmedPassword.length < 4 || trimmedPassword.length > 32)) {
      onWarning(tt("rooms.toast.passwordRequired"));
      return;
    }
    if (withModpack && !modpack) {
      onWarning(tt("rooms.toast.modpackRequired"));
      return;
    }
    if (!gameVersion.trim()) {
      onWarning(tt("rooms.toast.versionRequired"));
      return;
    }
    onSubmit(
      {
        name: name.trim() || undefined,
        visibility,
        password: visibility === "private" ? trimmedPassword : undefined,
        gameVersion: gameVersion.trim(),
        loader,
        maxPlayers,
        modpackName: modpack?.name,
      },
      modpack?.id,
    );
  };

  const versionLabel = versions.find((v) => v.id === gameVersion)?.label ?? gameVersion;

  return (
    <Modal
      open={open}
      title={tt("rooms.createModalTitle")}
      subtitle={tt("rooms.createModalSubtitle")}
      onClose={onClose}
      closeDisabled={busy}
      closeLabel={tt("common.close")}
      footer={
        <>
          <ActionButton size="sm" variant="secondary" disabled={busy} onClick={onClose}>
            {tt("common.cancel")}
          </ActionButton>
          <ActionButton
            size="sm"
            variant="primary"
            loading={busy}
            loadingLabel={tt("rooms.creating")}
            onClick={submit}
          >
            {tt("rooms.create")}
          </ActionButton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="ui-caption font-semibold">{tt("rooms.roomNameLabel")}</span>
          <TextField
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={tt("rooms.roomNamePlaceholder")}
            disabled={busy}
            autoFocus
          />
        </label>

        <div className="flex flex-col gap-2">
          <label className="flex items-start gap-2 text-sm text-white/85">
            <input
              type="checkbox"
              className="accent-checkbox mt-0.5"
              checked={withModpack}
              disabled={busy}
              onChange={(e) => setWithModpack(e.target.checked)}
            />
            <span>
              <span className="font-semibold">{tt("rooms.createModpack.label")}</span>
              <span className="ui-meta mt-0.5 block">{tt("rooms.createModpack.hint")}</span>
            </span>
          </label>
          {withModpack ? (
            profiles.length === 0 ? (
              <p className="locked-hint">{tt("rooms.createModpack.empty")}</p>
            ) : (
              <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-xl border border-white/10 bg-black/30 p-1.5">
                {profiles.map((profile) => (
                  <li key={profile.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => pickModpack(profile)}
                      aria-pressed={profile.id === modpackId}
                      className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-1.5 text-left transition-colors ${
                        profile.id === modpackId ? "seg-on" : "hover:bg-white/[0.06]"
                      }`}
                    >
                      <LoaderIcon loader={profile.loader} className="h-5 w-5" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{profile.name}</span>
                        <span className="ui-meta block truncate">
                          {profile.loader} {profile.game_version} · {tt("rooms.createModpack.mods", { count: profile.mods_count })}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </div>

        {sourceGame && (modpack || !manual) ? (
          <div className="glass-inset flex items-center gap-3 px-3.5 py-3">
            <LoaderIcon loader={loader} className="h-7 w-7" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">
                {versionsLoading ? tt("common.loading") : versionLabel}
              </p>
              <p className="ui-meta truncate">
                {sourceGame.source === "profile"
                  ? tt("rooms.auto.fromProfile", { name: sourceGame.label })
                  : tt("rooms.auto.fromMenu")}
              </p>
            </div>
            {modpack ? null : (
              <ActionButton size="sm" variant="ghost" onClick={() => setManual(true)}>
                {tt("rooms.auto.manual")}
              </ActionButton>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {currentGame ? (
              <button
                type="button"
                onClick={() => {
                  setLoader(currentGame.loader);
                  setManual(false);
                }}
                className="interactive-press self-start text-[0.8125rem] font-semibold text-accent-hi hover:text-white"
              >
                {tt("rooms.auto.useAuto")}
              </button>
            ) : (
              <p className="locked-hint">{tt("rooms.auto.none")}</p>
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
              <label className="flex flex-1 flex-col gap-1">
                <span className="ui-caption font-semibold">{tt("rooms.loaderLabel")}</span>
                <select
                  value={loader}
                  onChange={(e) => setLoader(e.target.value as RoomLoaderId)}
                  disabled={busy}
                  className="launcher-select glass-control px-3 py-2.5 text-sm text-white outline-none"
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
                  disabled={busy || versionsLoading || versions.length === 0}
                  className="launcher-select glass-control px-3 py-2.5 text-sm text-white outline-none"
                >
                  {versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        )}

        <SegmentedField
          label={tt("rooms.maxPlayersLabel")}
          value={maxPlayers}
          onChange={setMaxPlayers}
          disabled={busy}
          options={PLAYER_LIMITS.map((count) => ({ value: count, label: count }))}
        />

        <SegmentedField<Visibility>
          label={tt("rooms.visibilityLabel")}
          value={visibility}
          onChange={(next) => {
            setVisibility(next);
            if (next === "public") setPassword("");
          }}
          disabled={busy}
          options={[
            { value: "public", label: tt("rooms.visibilityOption.public") },
            { value: "private", label: tt("rooms.visibilityOption.private") },
          ]}
        />

        <p className="ui-meta leading-relaxed">
          {visibility === "private" ? tt("rooms.privateHint") : tt("rooms.publicHint")}
        </p>

        {visibility === "private" ? (
          <label className="flex flex-col gap-1">
            <span className="ui-caption font-semibold">{tt("rooms.passwordLabel")}</span>
            <TextField
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={tt("rooms.passwordPlaceholder")}
              disabled={busy}
              autoComplete="off"
            />
          </label>
        ) : null}
      </div>
    </Modal>
  );
}
