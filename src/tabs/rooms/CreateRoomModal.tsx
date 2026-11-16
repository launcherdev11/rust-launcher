import { useEffect, useState } from "react";
import type { CreateRoomInput } from "../../api/rooms";
import { LoaderIcon } from "../../components/loader_icon";
import { ActionButton, Modal, TextField } from "../../components/ui";
import type { useT } from "../../i18n";
import {
  MAX_ROOM_PLAYERS,
  ROOM_LOADERS,
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
  onClose,
  onSubmit,
  onWarning,
  onError,
}: {
  open: boolean;
  busy: boolean;
  tt: ReturnType<typeof useT>;
  currentGame: RoomCurrentGame | null;
  onClose: () => void;
  onSubmit: (input: CreateRoomInput) => void;
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
  }, [open]);

  const autoGame = !manual && currentGame?.loader === loader ? currentGame : null;

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
    if (!gameVersion.trim()) {
      onWarning(tt("rooms.toast.versionRequired"));
      return;
    }
    onSubmit({
      name: name.trim() || undefined,
      visibility,
      password: visibility === "private" ? trimmedPassword : undefined,
      gameVersion: gameVersion.trim(),
      loader,
      maxPlayers,
    });
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

        {currentGame && !manual ? (
          <div className="glass-inset flex items-center gap-3 px-3.5 py-3">
            <LoaderIcon loader={loader} className="h-7 w-7" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">
                {versionsLoading ? tt("common.loading") : versionLabel}
              </p>
              <p className="ui-meta truncate">
                {currentGame.source === "profile"
                  ? tt("rooms.auto.fromProfile", { name: currentGame.label })
                  : tt("rooms.auto.fromMenu")}
              </p>
            </div>
            <ActionButton size="sm" variant="ghost" onClick={() => setManual(true)}>
              {tt("rooms.auto.manual")}
            </ActionButton>
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
