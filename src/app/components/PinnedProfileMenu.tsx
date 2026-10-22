import { ContextMenuPanel } from "../../components/ContextMenuPanel";
import { DeleteIcon } from "../../components/delete_icon";
import { ProfileInfoIcon } from "../../components/profile_info_modal";
import type { InstanceProfileCard, Tt } from "../types";

export type PinnedProfileMenuState = {
  profileId: string;
  x: number;
  y: number;
};

type Props = {
  menu: PinnedProfileMenuState;
  profiles: InstanceProfileCard[];
  tt: Tt;
  onClose: () => void;
  onShowInfo: (profile: InstanceProfileCard) => void;
  onOpenProfile: (profileId: string) => void;
  onCreateShortcut: (profile: InstanceProfileCard) => void;
  onTogglePin: (profile: InstanceProfileCard) => void;
  onDeleteProfile: (profileId: string) => void;
};

export function PinnedProfileMenu({
  menu,
  profiles,
  tt,
  onClose,
  onShowInfo,
  onOpenProfile,
  onCreateShortcut,
  onTogglePin,
  onDeleteProfile,
}: Props) {
  return (
    <ContextMenuPanel
      x={menu.x}
      y={menu.y}
      onClose={onClose}
      zIndex={320}
    >
      <button
        type="button"
        onClick={() => {
          const profile = profiles.find((p) => p.id === menu.profileId);
          onClose();
          if (!profile) return;
          onShowInfo(profile);
        }}
        className="flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left hover:bg-white/10"
      >
        <ProfileInfoIcon className="h-3.5 w-3.5" />
        <span>{tt("modpacks.profileInfo.menuItem")}</span>
      </button>
      <button
        type="button"
        onClick={() => {
          const profile = profiles.find((p) => p.id === menu.profileId);
          onClose();
          if (!profile) return;
          onOpenProfile(profile.id);
        }}
        className="mt-0.5 flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left hover:bg-white/10"
      >
        <img src="/launcher-assets/settings.svg" alt="" className="h-3.5 w-3.5 object-contain" />
        <span>{tt("modpacks.contextMenu.settings")}</span>
      </button>
      <button
        type="button"
        onClick={() => {
          const profile = profiles.find((p) => p.id === menu.profileId);
          onClose();
          if (!profile) return;
          onCreateShortcut(profile);
        }}
        className="mt-0.5 flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left hover:bg-white/10"
      >
        <img src="/launcher-assets/export.png" alt="" className="h-3.5 w-3.5 object-contain" />
        <span>{tt("modpacks.actions.createShortcut")}</span>
      </button>
      <button
        type="button"
        onClick={() => {
          const profile = profiles.find((p) => p.id === menu.profileId);
          onClose();
          if (!profile) return;
          onTogglePin(profile);
        }}
        className="mt-0.5 flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left hover:bg-white/10"
      >
        <img src="/launcher-assets/favorite.png" alt="" className="h-3.5 w-3.5 object-contain" />
        <span>{tt("modpacks.contextMenu.unpinFromSidebar")}</span>
      </button>
      <button
        type="button"
        onClick={() => {
          const profile = profiles.find((p) => p.id === menu.profileId);
          onClose();
          if (!profile) return;
          onDeleteProfile(profile.id);
        }}
        className="mt-0.5 flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left text-red-300 hover:bg-red-600/20"
      >
        <DeleteIcon className="h-3.5 w-3.5" />
        <span>{tt("modpacks.contextMenu.deleteProfile")}</span>
      </button>
      <button
        type="button"
        onClick={() => {
          onClose();
          onOpenProfile(menu.profileId);
        }}
        className="mt-0.5 flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left hover:bg-white/10"
      >
        <img src="/launcher-assets/edit.png" alt="" className="h-3.5 w-3.5 object-contain" />
        <span>{tt("modpacks.contextMenu.editProfile")}</span>
      </button>
    </ContextMenuPanel>
  );
}
