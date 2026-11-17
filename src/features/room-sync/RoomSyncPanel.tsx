import { useState, type ReactNode } from "react";
import type { RoomPeerSession } from "../../api/webrtc/session";
import { ActionButton, Modal, Panel, Spinner, Switch } from "../../components/ui";
import type { SyncFileKind } from "./protocol";
import { updateRoomShareSettings, useRoomShareSettings } from "./shareSettings";
import {
  useRoomSyncGuest,
  type ApplyChoices,
  type FileIssue,
  type GuestSyncState,
  type PlannedFile,
  type SyncPlan,
} from "./useRoomSyncGuest";

type Tt = (key: string, vars?: Record<string, string | number>) => string;

const MB = 1024 * 1024;
const MAX_LISTED = 200;

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function megabytes(bytes: number): string {
  return (bytes / MB).toFixed(1);
}

function ofKind(files: PlannedFile[], kind: SyncFileKind): PlannedFile[] {
  return files.filter((f) => f.kind === kind);
}

function FileList({
  items,
  fullPath = false,
  children,
}: {
  items: string[];
  fullPath?: boolean;
  children?: (path: string) => ReactNode;
}) {
  if (items.length === 0) return null;
  return (
    <ul className="max-h-40 overflow-y-auto rounded-xl border border-white/10 bg-black/30 p-1.5 text-xs">
      {items.slice(0, MAX_LISTED).map((path) => (
        <li key={path} className="flex items-center gap-2 rounded-lg px-2 py-1 text-white/80" title={path}>
          <span className="min-w-0 flex-1 truncate">{fullPath ? path : fileName(path)}</span>
          {children?.(path)}
        </li>
      ))}
    </ul>
  );
}

function Line({ tone = "muted", children }: { tone?: "muted" | "warn" | "ok"; children: ReactNode }) {
  const toneClass =
    tone === "warn" ? "text-warn-fg" : tone === "ok" ? "text-emerald-300" : "text-white/75";
  return <p className={`text-sm ${toneClass}`}>{children}</p>;
}

function Section({ title, tone, items, fullPath }: { title: string; tone?: "muted" | "warn"; items: string[]; fullPath?: boolean }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <Line tone={tone}>{title}</Line>
      <FileList items={items} fullPath={fullPath} />
    </div>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex items-start gap-2 text-sm text-white/80">
      <input
        type="checkbox"
        className="accent-checkbox mt-0.5"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{children}</span>
    </label>
  );
}

function ReviewBody({ plan, relayed, tt }: { plan: SyncPlan; relayed: boolean; tt: Tt }) {
  if (plan.versionMismatch) {
    return (
      <Line tone="warn">
        {tt("rooms.sync.versionMismatch", {
          host: `${plan.hostGameVersion} ${plan.hostLoader}`,
          local: `${plan.localGameVersion} ${plan.localLoader}`,
        })}
      </Line>
    );
  }
  const mods = ofKind(plan.missing, "mod");
  const packs = ofKind(plan.missing, "pack");
  const configs = ofKind(plan.missing, "config");
  const scripts = ofKind(plan.missing, "script");
  const assets = ofKind(plan.missing, "asset");
  const nothingToDo =
    plan.missing.length === 0 &&
    plan.enable.length === 0 &&
    plan.extraMods.length === 0 &&
    plan.extraScripts.length === 0 &&
    !plan.optionsDiffer;
  return (
    <div className="flex flex-col gap-3">
      {nothingToDo ? <Line tone="ok">{tt("rooms.sync.upToDate")}</Line> : null}
      <Section title={tt("rooms.sync.missingMods", { count: mods.length })} items={mods.map((f) => f.path)} />
      <Section title={tt("rooms.sync.missingPacks", { count: packs.length })} items={packs.map((f) => f.path)} />
      {configs.length > 0 ? <Line>{tt("rooms.sync.missingConfigs", { count: configs.length })}</Line> : null}
      {scripts.length > 0 ? <Line>{tt("rooms.sync.missingScripts", { count: scripts.length })}</Line> : null}
      {assets.length > 0 ? <Line>{tt("rooms.sync.missingAssets", { count: assets.length })}</Line> : null}
      {plan.optionsDiffer ? <Line>{tt("rooms.sync.optionsDiffer")}</Line> : null}
      {plan.enable.length > 0 ? <Line>{tt("rooms.sync.enable", { count: plan.enable.length })}</Line> : null}
      {plan.extraMods.length > 0 ? <Line>{tt("rooms.sync.extra", { count: plan.extraMods.length })}</Line> : null}
      {plan.extraScripts.length > 0 ? (
        <Line>{tt("rooms.sync.extraScripts", { count: plan.extraScripts.length })}</Line>
      ) : null}
      {plan.rejected.length > 0 ? (
        <Line tone="warn">{tt("rooms.sync.rejected", { count: plan.rejected.length })}</Line>
      ) : null}
      {relayed ? <Line tone="warn">{tt("rooms.sync.relayed")}</Line> : null}
      <p className="ui-meta">{tt("rooms.sync.reviewHint")}</p>
    </div>
  );
}

const ISSUE_TONE: Record<FileIssue, string> = {
  invalid_archive: "bg-danger-strong/25 text-danger-fg",
  executable: "bg-danger-strong/25 text-danger-fg",
  native_code: "bg-warn/20 text-warn-fg",
  no_mod_metadata: "bg-warn/20 text-warn-fg",
};

function ConfirmBody({
  state,
  tt,
  trusted,
  setTrusted,
  choices,
  setChoices,
}: {
  state: Extract<GuestSyncState, { phase: "confirm" }>;
  tt: Tt;
  trusted: boolean;
  setTrusted: (v: boolean) => void;
  choices: ApplyChoices;
  setChoices: (patch: Partial<ApplyChoices>) => void;
}) {
  const { plan, report, fromPlatforms, fromHost, blockedByRelay, failed } = state;
  const hostMods = ofKind(fromHost, "mod").map((f) => f.path);
  const hostPacks = ofKind(fromHost, "pack").map((f) => f.path);
  const hostScripts = ofKind(fromHost, "script").map((f) => f.path);
  const hostConfigs = ofKind(fromHost, "config").length;
  const hostAssets = ofKind(fromHost, "asset").length;
  const issuesByPath = new Map(report.files.map((f) => [f.path, f]));
  const issueBadges = (path: string) =>
    (issuesByPath.get(path)?.issues ?? []).map((issue) => (
      <span key={issue} className={`shrink-0 rounded-md px-1.5 py-0.5 text-[0.6875rem] ${ISSUE_TONE[issue]}`}>
        {tt(`rooms.sync.issue.${issue}`)}
      </span>
    ));
  return (
    <div className="flex flex-col gap-3">
      {fromPlatforms.length > 0 ? (
        <Line>{tt("rooms.sync.fromPlatforms", { count: fromPlatforms.length })}</Line>
      ) : null}
      {hostMods.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <Line tone="warn">{tt("rooms.sync.fromHost", { count: hostMods.length })}</Line>
          <FileList items={hostMods}>{issueBadges}</FileList>
        </div>
      ) : null}
      {hostScripts.length > 0 ? (
        <Section tone="warn" title={tt("rooms.sync.scriptsReceived", { count: hostScripts.length })} items={hostScripts} fullPath />
      ) : null}
      {hostPacks.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <Line>{tt("rooms.sync.packsReceived", { count: hostPacks.length })}</Line>
          <FileList items={hostPacks}>{issueBadges}</FileList>
        </div>
      ) : null}
      {hostConfigs > 0 ? <Line>{tt("rooms.sync.configsReceived", { count: hostConfigs })}</Line> : null}
      {hostAssets > 0 ? <Line>{tt("rooms.sync.assetsReceived", { count: hostAssets })}</Line> : null}
      <Section tone="warn" title={tt("rooms.sync.blockedByRelay", { count: blockedByRelay.length })} items={blockedByRelay} />
      <Section tone="warn" title={tt("rooms.sync.failed", { count: failed.length })} items={failed} />

      {plan.extraMods.length > 0 ? (
        <Check checked={choices.disableExtras} onChange={(disableExtras) => setChoices({ disableExtras })}>
          {tt("rooms.sync.disableExtras", { count: plan.extraMods.length })}
        </Check>
      ) : null}
      {plan.extraScripts.length > 0 ? (
        <Check
          checked={choices.removeExtraScripts}
          onChange={(removeExtraScripts) => setChoices({ removeExtraScripts })}
        >
          {tt("rooms.sync.removeExtraScripts", { count: plan.extraScripts.length })}
        </Check>
      ) : null}
      {plan.optionsDiffer ? (
        <Check checked={choices.applyOptions} onChange={(applyOptions) => setChoices({ applyOptions })}>
          {tt("rooms.sync.applyOptions")}
        </Check>
      ) : null}
      {hostMods.length + hostScripts.length > 0 ? (
        <label className="flex items-start gap-2 rounded-xl border border-warn-line/30 bg-warn/10 p-2.5 text-sm text-white/85">
          <input
            type="checkbox"
            className="accent-checkbox mt-0.5"
            checked={trusted}
            onChange={(e) => setTrusted(e.target.checked)}
          />
          <span>{tt("rooms.sync.trust")}</span>
        </label>
      ) : null}
    </div>
  );
}

function WorkingBody({ state, tt }: { state: Extract<GuestSyncState, { phase: "working" }>; tt: Tt }) {
  const progress =
    state.step === "transfer" && state.total
      ? tt("rooms.sync.step.transferProgress", {
          done: megabytes(state.done ?? 0),
          total: megabytes(state.total),
        })
      : null;
  return (
    <div className="flex items-center gap-3 text-sm text-white/80">
      <Spinner />
      <span>{progress ?? tt(`rooms.sync.step.${state.step}`)}</span>
    </div>
  );
}

export function RoomSyncModal({
  sync,
  tt,
  onClose,
}: {
  sync: ReturnType<typeof useRoomSyncGuest>;
  tt: Tt;
  onClose: () => void;
}) {
  const { state } = sync;
  const [trusted, setTrusted] = useState(false);
  const [choices, setChoicesState] = useState<ApplyChoices>({
    disableExtras: true,
    removeExtraScripts: false,
    applyOptions: true,
  });
  const setChoices = (patch: Partial<ApplyChoices>) => setChoicesState((prev) => ({ ...prev, ...patch }));
  const applying = state.phase === "working" && state.step === "apply";

  let body: ReactNode = null;
  let primary: ReactNode = null;
  if (state.phase === "working") {
    body = <WorkingBody state={state} tt={tt} />;
  } else if (state.phase === "review") {
    body = <ReviewBody plan={state.plan} relayed={state.relayed} tt={tt} />;
    primary = state.plan.versionMismatch ? null : (
      <ActionButton size="sm" onClick={() => void sync.download()}>
        {state.plan.missing.length === 0 ? tt("rooms.sync.continue") : tt("rooms.sync.download")}
      </ActionButton>
    );
  } else if (state.phase === "confirm") {
    body = (
      <ConfirmBody
        state={state}
        tt={tt}
        trusted={trusted}
        setTrusted={setTrusted}
        choices={choices}
        setChoices={setChoices}
      />
    );
    const needsTrust = state.fromHost.some((f) => f.kind === "mod" || f.kind === "script");
    const blocked = state.report.files.some((f) => f.blocked);
    const { plan } = state;
    const somethingToDo =
      state.fromPlatforms.length + state.fromHost.length + plan.enable.length > 0 ||
      (choices.disableExtras && plan.extraMods.length > 0) ||
      (choices.removeExtraScripts && plan.extraScripts.length > 0) ||
      (choices.applyOptions && plan.optionsDiffer);
    primary = (
      <ActionButton
        size="sm"
        disabled={blocked || !somethingToDo || (needsTrust && !trusted)}
        disabledReason={blocked ? tt("rooms.sync.blocked") : undefined}
        onClick={() => void sync.apply(choices)}
      >
        {tt("rooms.sync.apply")}
      </ActionButton>
    );
  } else if (state.phase === "done") {
    const { backupDir, ...counts } = state.result;
    body = (
      <div className="flex flex-col gap-2">
        <Line tone="ok">{tt("rooms.sync.done", { ...counts, options: counts.options ? 1 : 0 })}</Line>
        <p className="ui-meta">{tt("rooms.sync.rollbackHint")}</p>
        {backupDir ? (
          <p className="ui-meta break-all">{tt("rooms.sync.backupDir", { path: backupDir })}</p>
        ) : null}
      </div>
    );
  } else if (state.phase === "error") {
    body = <Line tone="warn">{tt(`rooms.sync.error.${state.error}`, { detail: state.detail ?? "" })}</Line>;
  }

  return (
    <Modal
      open={state.phase !== "idle"}
      title={tt("rooms.sync.modalTitle")}
      onClose={onClose}
      closeDisabled={applying}
      closeLabel={tt("common.close")}
      maxWidthClassName="w-[min(96vw,34rem)]"
      footer={
        <>
          <ActionButton size="sm" variant="secondary" disabled={applying} onClick={onClose}>
            {state.phase === "done" || state.phase === "error" ? tt("common.close") : tt("common.cancel")}
          </ActionButton>
          {primary}
        </>
      }
    >
      {body}
    </Modal>
  );
}

export function RoomSyncPanel({
  isOwner,
  tt,
  session,
  profileId,
}: {
  isOwner: boolean;
  tt: Tt;
  session: RoomPeerSession | null;
  profileId: string | null;
}) {
  const share = useRoomShareSettings();
  const sync = useRoomSyncGuest(isOwner ? null : session, profileId);

  if (isOwner) {
    return (
      <Panel padding="md" className="flex flex-col gap-3">
        <p className="ui-section">{tt("rooms.sync.title")}</p>
        <p className="ui-meta">{tt("rooms.sync.ownerHint")}</p>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-white/85">{tt("rooms.sync.shareLabel")}</span>
          <Switch
            checked={share.enabled}
            onChange={(enabled) => updateRoomShareSettings({ enabled })}
            title={tt("rooms.sync.shareLabel")}
          />
        </div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-white/85">{tt("rooms.sync.shareConfigsLabel")}</p>
            <p className="ui-meta mt-0.5">{tt("rooms.sync.shareConfigsHint")}</p>
          </div>
          <Switch
            checked={share.configs}
            disabled={!share.enabled}
            onChange={(configs) => updateRoomShareSettings({ configs })}
            title={tt("rooms.sync.shareConfigsLabel")}
            className="shrink-0"
          />
        </div>
      </Panel>
    );
  }

  const unavailable = !profileId
    ? tt("rooms.sync.needProfile")
    : !session?.supportsRoomFiles
      ? tt("rooms.sync.hostUnavailable")
      : undefined;

  return (
    <Panel padding="md" className="flex flex-col gap-3">
      <p className="ui-section">{tt("rooms.sync.title")}</p>
      <p className="ui-meta">{tt("rooms.sync.guestHint")}</p>
      <div>
        <ActionButton
          size="sm"
          variant="secondary"
          disabled={Boolean(unavailable) || sync.state.phase !== "idle"}
          disabledReason={unavailable}
          onClick={() => void sync.start()}
        >
          {tt("rooms.sync.start")}
        </ActionButton>
      </div>
      {unavailable ? <p className="ui-meta">{unavailable}</p> : null}
      <RoomSyncModal sync={sync} tt={tt} onClose={sync.reset} />
    </Panel>
  );
}
