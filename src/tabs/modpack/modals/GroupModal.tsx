import { InputClearButton } from "../../../components/ui";
import { PROFILE_GROUP_COLOR_STYLES, PROFILE_GROUP_COLORS } from "../../../lib/profile-groups";
import { ChevronDown } from "lucide-react";
import { ProfileInstanceIcon } from "../../../components/profile_instance_icon";
import type { ModpackController } from "../useModpackController";

type Props = { ctx: ModpackController };

export function GroupModal({ ctx }: Props) {
  const {
    isGroupModalOpen,
    setEditingGroupId,
    setIsGroupModalOpen,
    editingGroupId,
    tt,
    groupFormName,
    setGroupFormName,
    groupFormColor,
    setGroupFormColor,
    groupProfilesDropdownRef,
    setIsGroupProfilesDropdownOpen,
    groupFormProfileIds,
    isGroupProfilesDropdownOpen,
    profiles,
    setGroupFormProfileIds,
    handleSaveGroup,
  } = ctx;

  return (
    <>
      {isGroupModalOpen && (
        <div
          className="glass-overlay fixed inset-0 z-50 flex items-center justify-center"
          onClick={() => {
            setEditingGroupId(null);
            setIsGroupModalOpen(false);
          }}
        >
          <div
            className="glass-modal flex w-full max-w-md flex-col p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-4 text-lg font-semibold text-white">
              {editingGroupId ? tt("modpacks.groups.editTitle") : tt("modpacks.groups.createTitle")}
            </h3>

            <label className="mb-3 block">
              <span className="mb-1.5 block text-xs font-medium text-white/60">
                {tt("modpacks.groups.nameLabel")}
              </span>
              <div className="relative">
                <input
                  type="text"
                  value={groupFormName}
                  onChange={(e) => setGroupFormName(e.target.value)}
                  placeholder={tt("modpacks.groups.namePlaceholder")}
                  className={`glass-control w-full rounded-xl border px-3 py-2 text-sm text-white placeholder:text-white/35 focus:outline-none ${
                    groupFormName ? "pr-9" : ""
                  }`}
                  autoFocus
                />
                <InputClearButton
                  value={groupFormName}
                  onClear={() => setGroupFormName("")}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2"
                  aria-label={tt("common.clear")}
                />
              </div>
            </label>

            <div className="mb-3">
              <span className="mb-1.5 block text-xs font-medium text-white/60">
                {tt("modpacks.groups.colorLabel")}
              </span>
              <div className="flex flex-wrap gap-2">
                {PROFILE_GROUP_COLORS.map((color) => {
                  const styles = PROFILE_GROUP_COLOR_STYLES[color];
                  const selected = groupFormColor === color;
                  return (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setGroupFormColor(color)}
                      className={`interactive-press flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs ${
                        selected
                          ? `${styles.border} ${styles.headerBg} ${styles.accent}`
                          : "border-white/10 bg-black/30 text-white/60 hover:bg-white/10"
                      }`}
                    >
                      <span className={`h-3 w-3 rounded-full ${styles.dot}`} />
                      {tt(`modpacks.groups.color.${color}`)}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mb-4" ref={groupProfilesDropdownRef}>
              <span className="mb-1.5 block text-xs font-medium text-white/60">
                {tt("modpacks.groups.profilesLabel")}
              </span>
              <button
                type="button"
                onClick={() => setIsGroupProfilesDropdownOpen((v) => !v)}
                className="interactive-press flex w-full items-center justify-between gap-2 rounded-xl border border-white/15 bg-black/40 px-4 py-2 text-left text-sm text-white/85 hover:bg-black/55"
              >
                <span className="truncate">
                  {groupFormProfileIds.size > 0
                    ? tt("modpacks.groups.profilesSelected", {
                        count: groupFormProfileIds.size,
                      })
                    : tt("modpacks.groups.profilesPlaceholder")}
                </span>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-white/50 transition ${
                    isGroupProfilesDropdownOpen ? "rotate-180" : ""
                  }`}
                />
              </button>
              {isGroupProfilesDropdownOpen && (
                <div className="custom-scrollbar mt-1 max-h-48 overflow-y-auto rounded-xl border border-white/15 bg-black/80 p-1 shadow-soft">
                  {profiles.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-white/50">{tt("modpacks.list.empty")}</div>
                  ) : (
                    profiles.map((p) => {
                      const checked = groupFormProfileIds.has(p.id);
                      return (
                        <label
                          key={p.id}
                          className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-white/85 hover:bg-white/10"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              setGroupFormProfileIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(p.id)) next.delete(p.id);
                                else next.add(p.id);
                                return next;
                              });
                            }}
                            className="rounded border-white/20 bg-black/40"
                          />
                          <ProfileInstanceIcon profile={p} className="h-6 w-6 shrink-0 rounded-lg" />
                          <span className="min-w-0 truncate">{p.name}</span>
                        </label>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditingGroupId(null);
                  setIsGroupModalOpen(false);
                }}
                className="interactive-press rounded-xl bg-white/10 px-3.5 py-2 text-xs font-semibold text-white/80 hover:bg-white/20"
              >
                {tt("modpacks.groups.cancel")}
              </button>
              <button
                type="button"
                onClick={handleSaveGroup}
                className="interactive-press rounded-xl accent-bg px-3.5 py-2 text-xs font-semibold text-white hover:opacity-90"
              >
                {editingGroupId ? tt("modpacks.groups.save") : tt("modpacks.groups.create")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
