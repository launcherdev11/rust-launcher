import { type CSSProperties } from "react";
import { ProfileInfoModal } from "../components/profile_info_modal";
import { ScreenshotsModal } from "../features/screenshots";
import { ListView } from "./modpack/views/ListView";
import { CreateView } from "./modpack/views/CreateView";
import { ImportView } from "./modpack/views/ImportView";
import { ManageView } from "./modpack/views/ManageView";
import { ContextMenus } from "./modpack/modals/ContextMenus";
import { BackupsModal } from "./modpack/modals/BackupsModal";
import { GroupModal } from "./modpack/modals/GroupModal";
import { DeleteConfirmDialogs } from "./modpack/modals/DeleteConfirmDialogs";
import { PresetsModal } from "./modpack/modals/PresetsModal";
import { ContentUpdatesModal } from "./modpack/modals/ContentUpdatesModal";
import { ProfileSettingsModal } from "./modpack/modals/ProfileSettingsModal";
import { ChangeVersionModal } from "./modpack/modals/ChangeVersionModal";
import { ExportModal } from "./modpack/modals/ExportModal";
import { useModpackController } from "./modpack/useModpackController";
import type { ModpackTabProps } from "./modpack/types";

export function ModpackTab(props: ModpackTabProps) {
  const ctx = useModpackController(props);
  const {
    scaledRootRef,
    fillPane,
    activeView,
    manageZoomed,
    scaledHostSize,
    uiScale,
    headerTitle,
    language,
    profileInfoProfile,
    setProfileInfoProfile,
    selectedProfileId,
    isScreenshotsOpen,
    setIsScreenshotsOpen,
    showNotification,
  } = ctx;

  return (
    <div
      ref={scaledRootRef}
      className={`flex w-full min-h-0 flex-1 flex-col gap-4 ${
        fillPane || activeView === "manage"
          ? "h-full max-w-none self-stretch px-0 sm:px-1"
          : "max-w-none self-stretch"
      }`}
      style={
        manageZoomed && scaledHostSize
          ? ({
              zoom: uiScale,
              flex: "none",
              width: `${scaledHostSize.w / uiScale}px`,
              height: `${scaledHostSize.h / uiScale}px`,
            } as CSSProperties)
          : undefined
      }
    >
      {(activeView === "create" || activeView === "import") && (
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-white">{headerTitle}</h1>
        </div>
      )}

      {activeView === "list"
        ? <ListView ctx={ctx} />
        : activeView === "create"
          ? <CreateView ctx={ctx} />
          : activeView === "import"
            ? <ImportView ctx={ctx} />
            : <ManageView ctx={ctx} />}

      <ContextMenus ctx={ctx} />

      <BackupsModal ctx={ctx} />

      <GroupModal ctx={ctx} />

      <DeleteConfirmDialogs ctx={ctx} />

      <PresetsModal ctx={ctx} />

      <ContentUpdatesModal ctx={ctx} />

      <ProfileInfoModal
        language={language}
        profile={profileInfoProfile}
        onClose={() => setProfileInfoProfile(null)}
      />

      <ProfileSettingsModal ctx={ctx} />

      <ChangeVersionModal ctx={ctx} />

      <ExportModal ctx={ctx} />

      <ScreenshotsModal
        language={language}
        profileId={selectedProfileId}
        open={isScreenshotsOpen}
        onClose={() => setIsScreenshotsOpen(false)}
        showNotification={showNotification}
      />

    </div>
  );
}

export default ModpackTab;
