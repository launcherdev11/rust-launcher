import type { MutableRefObject, PointerEvent as ReactPointerEvent, RefObject } from "react";
import { AccountAvatar } from "../../components/account_avatar";
import { ProfileInstanceIcon } from "../../components/profile_instance_icon";
import { SidebarAccount } from "../../components/sidebar_account";
import type { ProfileAvatarInput } from "../../lib/avatar";
import { tabPaneRole, type SplittableTabId, type TabSplitLayout } from "../../splitView";
import {
  BOTTOM_SIDEBAR_ITEMS,
  SIDEBAR_ICON_PATHS,
  TOUR_SIDEBAR_TARGET_IDS,
  type SidebarPosition,
} from "../sidebar";
import type { InstanceProfileCard, SidebarItemId, Tt } from "../types";
import { CloseIcon } from "../icons";
import type { PinnedProfileMenuState } from "./PinnedProfileMenu";

type Props = {
  tt: Tt;
  activeItem: SidebarItemId;
  sidebarRef: RefObject<HTMLElement | null>;
  sidebarButtonRefs: MutableRefObject<Partial<Record<SidebarItemId, HTMLButtonElement | null>>>;
  sidebarPosition: SidebarPosition;
  sidebarHorizontal: boolean;
  sidebarCollapsed: boolean;
  sidebarIndicator: { offset: number; span: number; ready: boolean };
  orderedSidebarItems: { id: SidebarItemId; labelKey: string }[];
  activeAccountLabel: string;
  activeAccountKind: string;
  profileAvatarInput: ProfileAvatarInput;
  platformNickname: string;
  effectiveTabSplit: TabSplitLayout | null;
  canUseSplitView: boolean;
  sidebarDragConsumedRef: MutableRefObject<boolean>;
  hotkeyForTab: (id: SidebarItemId) => string | null;
  pinnedProfiles: InstanceProfileCard[];
  onSelectTab: (tab: SidebarItemId) => void;
  onActivateTab: (tab: SplittableTabId) => void;
  onModpacksTabClick: () => boolean;
  onTabPointerDown: (tab: SplittableTabId, e: ReactPointerEvent<HTMLButtonElement>) => void;
  onDismissSplitPane: (role: "primary" | "secondary") => void;
  onPlayPinned: (profile: InstanceProfileCard) => void | Promise<void>;
  onPinnedContextMenu: (menu: PinnedProfileMenuState) => void;
  onToggleCollapsed: () => void;
};

export function AppSidebar({
  tt,
  activeItem,
  sidebarRef,
  sidebarButtonRefs,
  sidebarPosition,
  sidebarHorizontal,
  sidebarCollapsed,
  sidebarIndicator,
  orderedSidebarItems,
  activeAccountLabel,
  activeAccountKind,
  profileAvatarInput,
  platformNickname,
  effectiveTabSplit,
  canUseSplitView,
  sidebarDragConsumedRef,
  hotkeyForTab,
  pinnedProfiles,
  onSelectTab,
  onActivateTab,
  onModpacksTabClick,
  onTabPointerDown,
  onDismissSplitPane,
  onPlayPinned,
  onPinnedContextMenu,
  onToggleCollapsed,
}: Props) {
  return (
    <aside
      ref={sidebarRef}
      data-tour-id="tour-sidebar"
      className={[
        "shell-sidebar",
        sidebarPosition === "right" ? "shell-sidebar-right" : "",
        sidebarHorizontal ? "shell-sidebar-horizontal" : "",
        sidebarPosition === "bottom" ? "shell-sidebar-bottom" : "",
        sidebarCollapsed ? "shell-sidebar-collapsed" : "",
      ].join(" ")}
    >
      <span
        className="shell-nav-bar"
        style={
          sidebarHorizontal
            ? {
                width: `${sidebarIndicator.span}px`,
                transform: `translateX(${sidebarIndicator.offset}px)`,
                opacity: sidebarIndicator.ready ? 1 : 0,
                willChange: "transform",
              }
            : {
                height: `${sidebarIndicator.span}px`,
                transform: `translateY(${sidebarIndicator.offset}px)`,
                opacity: sidebarIndicator.ready ? 1 : 0,
                willChange: "transform",
              }
        }
      />
      <SidebarAccount
        avatar={
          <AccountAvatar
            username={activeAccountLabel}
            profile={profileAvatarInput}
            kind={activeAccountKind}
            size={72}
            className="h-8 w-8 shrink-0 rounded-lg"
          />
        }
        label={activeAccountLabel}
        kind={activeAccountKind}
        platformNickname={platformNickname}
        offlineText={tt("app.accounts.offlineBadge")}
        title={tt("app.accounts.sidebarTooltip")}
        active={activeItem === "accounts"}
        collapsed={sidebarCollapsed}
        buttonRef={(el) => {
          sidebarButtonRefs.current.accounts = el;
        }}
        onClick={() => onSelectTab("accounts")}
      />
      <nav className="shell-nav">
        {orderedSidebarItems.map((item) => {
          const tabId = item.id as SplittableTabId;
          const splitRole = effectiveTabSplit && tabPaneRole(tabId, effectiveTabSplit);
          const isActive = activeItem === tabId;
          const label = tt(item.labelKey);
          return (
            <div
              key={item.id}
              className="group relative"
              data-tour-id={TOUR_SIDEBAR_TARGET_IDS[item.id]}
            >
              <button
                type="button"
                onClick={() => {
                  if (sidebarDragConsumedRef.current) {
                    sidebarDragConsumedRef.current = false;
                    return;
                  }
                  if (tabId === "modpacks") {
                    const modpacksPaneVisible =
                      effectiveTabSplit != null
                        ? effectiveTabSplit.primary === "modpacks" ||
                          effectiveTabSplit.secondary === "modpacks"
                        : activeItem === "modpacks";
                    if (modpacksPaneVisible && onModpacksTabClick()) {
                      onActivateTab(tabId);
                      return;
                    }
                  }
                  onActivateTab(tabId);
                }}
                aria-label={label}
                aria-keyshortcuts={hotkeyForTab(item.id) ?? undefined}
                title={
                  canUseSplitView
                    ? tt("app.splitView.dragHint", { tab: label })
                    : sidebarCollapsed
                      ? hotkeyForTab(item.id)
                        ? `${label} (${hotkeyForTab(item.id)})`
                        : label
                      : undefined
                }
                ref={(el) => {
                  sidebarButtonRefs.current[item.id] = el;
                }}
                className={[
                  "nav-item",
                  isActive ? "nav-item-active" : "",
                  !isActive && splitRole ? "nav-item-split" : "",
                  canUseSplitView ? "nav-item-splittable" : "",
                ].join(" ")}
                onPointerDown={(e) => onTabPointerDown(tabId, e)}
              >
                {SIDEBAR_ICON_PATHS[item.id] ? (
                  <img src={SIDEBAR_ICON_PATHS[item.id]} alt="" draggable={false} />
                ) : null}
                <span className="truncate">{label}</span>
              </button>
              {splitRole ? (
                <button
                  type="button"
                  className="tab-split-sidebar-close tab-split-sidebar-close-vertical interactive-press no-shift"
                  title={tt("app.splitView.closePane")}
                  aria-label={tt("app.splitView.closePane")}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDismissSplitPane(splitRole);
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <CloseIcon />
                </button>
              ) : null}
            </div>
          );
        })}
      </nav>

      <div className="shell-foot">
        {pinnedProfiles.length > 0 ? (
          <div className="pin-row">
            {pinnedProfiles.map((profile) => (
              <button
                key={profile.id}
                type="button"
                onClick={() => {
                  void onPlayPinned(profile);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onPinnedContextMenu({
                    profileId: profile.id,
                    x: e.clientX,
                    y: e.clientY,
                  });
                }}
                title={profile.name}
                className="pin-btn group"
              >
                <ProfileInstanceIcon
                  profile={{ id: profile.id, name: profile.name }}
                  className="absolute inset-0 size-full rounded-xl"
                  initialClassName="text-xs"
                />
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/40 group-hover:opacity-100">
                  <svg viewBox="0 0 24 24" className="h-4 w-4 fill-white" aria-hidden="true">
                    <path d="M8 6.5v11l9-5.5-9-5.5z" />
                  </svg>
                </span>
              </button>
            ))}
          </div>
        ) : null}
        {BOTTOM_SIDEBAR_ITEMS.map((item) => {
          const label = tt(item.labelKey);
          const isActive = activeItem === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              aria-label={label}
              aria-keyshortcuts={hotkeyForTab(item.id) ?? undefined}
              title={
                sidebarCollapsed
                  ? hotkeyForTab(item.id)
                    ? `${label} (${hotkeyForTab(item.id)})`
                    : label
                  : undefined
              }
              ref={(el) => {
                sidebarButtonRefs.current[item.id] = el;
              }}
              className={`nav-item ${isActive ? "nav-item-active" : ""}`}
            >
              {SIDEBAR_ICON_PATHS[item.id] ? (
                <img src={SIDEBAR_ICON_PATHS[item.id]} alt="" draggable={false} />
              ) : null}
              <span className="truncate">{label}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="nav-item shell-collapse-btn"
          aria-label={tt(sidebarCollapsed ? "app.sidebar.expand" : "app.sidebar.collapse")}
          title={tt(sidebarCollapsed ? "app.sidebar.expand" : "app.sidebar.collapse")}
          aria-expanded={!sidebarCollapsed}
        >
          <svg viewBox="0 0 24 24" className="shell-collapse-icon" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 6l-6 6 6 6" />
          </svg>
          <span className="truncate">{tt("app.sidebar.collapse")}</span>
        </button>
      </div>
    </aside>
  );
}
