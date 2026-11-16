import { useEffect, useState } from "react";
import type { Room } from "../../api/rooms";
import type { RoomPeerSession } from "../../api/webrtc/session";
import type { InstanceProfileCard } from "../../app/types";
import { LoaderIcon } from "../../components/loader_icon";
import { ActionButton, Modal } from "../../components/ui";
import type { SyncManifest } from "./protocol";
import { RoomSyncModal } from "./RoomSyncPanel";
import { getGuestRoomProfile, profileMatchesRoom, setGuestRoomProfile } from "./roomModpacks";
import { useRoomSyncGuest } from "./useRoomSyncGuest";

type Tt = (key: string, vars?: Record<string, string | number>) => string;

type Step = "intro" | "pick" | "sync";

export function RoomModpackGate({
  room,
  tt,
  session,
  profiles,
  onSelectProfile,
  onCreateProfile,
  onLeave,
}: {
  room: Room;
  tt: Tt;
  session: RoomPeerSession | null;
  profiles: InstanceProfileCard[];
  onSelectProfile: (profileId: string) => Promise<void>;
  onCreateProfile: (manifest: SyncManifest) => Promise<string>;
  onLeave: () => void;
}) {
  const modpackName = room.modpack_name?.trim() ?? "";
  const [readyProfileId, setReadyProfileId] = useState(() => getGuestRoomProfile(room.id));
  const [step, setStep] = useState<Step>("intro");
  const [picked, setPicked] = useState<string | null>(null);
  const sync = useRoomSyncGuest(session, null);
  const { state } = sync;

  useEffect(() => {
    setReadyProfileId(getGuestRoomProfile(room.id));
    setStep("intro");
  }, [room.id]);

  useEffect(() => {
    if (step !== "sync") return;
    let readyId: string | null = null;
    if (state.phase === "done") {
      readyId = state.profileId;
    } else if (state.phase === "review" && picked) {
      const { plan } = state;
      const same =
        !plan.versionMismatch &&
        plan.missing.length === 0 &&
        plan.enable.length === 0 &&
        plan.extraMods.length === 0 &&
        !plan.optionsDiffer;
      if (same) readyId = picked;
    }
    if (!readyId) return;
    setGuestRoomProfile(room.id, readyId);
    setReadyProfileId(readyId);
    setStep("intro");
    sync.reset();
    void onSelectProfile(readyId);
  }, [state, step]);

  useEffect(() => {
    if (step === "sync" && state.phase === "idle") setStep("intro");
  }, [state.phase, step]);

  const ready = Boolean(readyProfileId && profiles.some((p) => p.id === readyProfileId));
  if (!modpackName || ready) return null;

  const hostReachable = Boolean(session?.supportsRoomFiles);
  const versionLabel = `${room.loader ?? "vanilla"} ${room.game_version ?? ""}`.trim();
  const matching = profiles.filter((p) => profileMatchesRoom(p, room));
  const other = profiles.filter((p) => !profileMatchesRoom(p, room));

  if (step === "sync") {
    return (
      <RoomSyncModal
        sync={sync}
        tt={tt}
        onClose={() => {
          sync.reset();
          setStep("intro");
        }}
      />
    );
  }

  const download = () => {
    setStep("sync");
    void sync.start({ createProfile: onCreateProfile });
  };

  const usePicked = (profileId: string) => {
    setPicked(profileId);
    setStep("sync");
    void onSelectProfile(profileId);
    void sync.start({ profileId });
  };

  return (
    <Modal
      open
      title={tt("rooms.modpackGate.title")}
      onClose={() => {}}
      closeDisabled
      closeLabel={tt("rooms.modpackGate.leave")}
      maxWidthClassName="w-[min(96vw,30rem)]"
      footer={
        step === "intro" ? (
          <>
            <ActionButton size="sm" variant="ghost" onClick={onLeave}>
              {tt("rooms.modpackGate.leave")}
            </ActionButton>
            <ActionButton size="sm" variant="secondary" onClick={() => setStep("pick")}>
              {tt("rooms.modpackGate.haveIt")}
            </ActionButton>
            <ActionButton
              size="sm"
              disabled={!hostReachable}
              disabledReason={hostReachable ? undefined : tt("rooms.modpackGate.waitingHost")}
              onClick={download}
            >
              {tt("rooms.modpackGate.download")}
            </ActionButton>
          </>
        ) : (
          <ActionButton size="sm" variant="secondary" onClick={() => setStep("intro")}>
            {tt("rooms.modpackGate.back")}
          </ActionButton>
        )
      }
    >
      {step === "intro" ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-white/85">
            {tt("rooms.modpackGate.body", { name: modpackName, version: versionLabel })}
          </p>
          <p className="ui-meta">{tt("rooms.modpackGate.hint")}</p>
          {!hostReachable ? <p className="ui-meta">{tt("rooms.modpackGate.waitingHost")}</p> : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="ui-meta">{tt("rooms.modpackGate.pickHint", { version: versionLabel })}</p>
          {matching.length === 0 ? (
            <p className="text-sm text-warn-fg">{tt("rooms.modpackGate.noMatching")}</p>
          ) : null}
          <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
            {[...matching, ...other].map((profile) => {
              const fits = profileMatchesRoom(profile, room);
              return (
                <li key={profile.id}>
                  <button
                    type="button"
                    disabled={!fits || !hostReachable}
                    onClick={() => usePicked(profile.id)}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-45"
                    title={fits ? undefined : tt("rooms.modpackGate.wrongVersion")}
                  >
                    <LoaderIcon loader={profile.loader} className="h-6 w-6" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-white/90">{profile.name}</span>
                      <span className="ui-meta block truncate">
                        {profile.loader} {profile.game_version}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Modal>
  );
}
