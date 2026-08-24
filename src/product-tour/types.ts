export type TourStepId =
  | "welcome"
  | "sidebar"
  | "launch-controls"
  | "profiles"
  | "settings"
  | "mods"
  | "modpacks"
  | "mc-account"
  | "platform"
  | "finish";

export type TourTabId =
  | "play"
  | "settings"
  | "mods"
  | "modpacks"
  | "friends"
  | "rooms"
  | "accounts";

export type TourAccountsSection = "accounts" | "platform";

export type TourStep = {
  id: TourStepId;
  target?: string;
  tab?: TourTabId;
  accountsSection?: TourAccountsSection;
  placement?: "top" | "bottom" | "left" | "right" | "center";
};

export const TOUR_STEPS: TourStep[] = [
  { id: "welcome", placement: "center" },
  { id: "sidebar", target: "tour-sidebar", tab: "play", placement: "right" },
  { id: "launch-controls", target: "tour-launch-controls", tab: "play", placement: "top" },
  { id: "profiles", target: "tour-profiles", tab: "play", placement: "bottom" },
  { id: "settings", target: "tour-sidebar-settings", tab: "play", placement: "right" },
  { id: "mods", target: "tour-sidebar-mods", tab: "play", placement: "right" },
  { id: "modpacks", target: "tour-sidebar-modpacks", tab: "play", placement: "right" },
  { id: "mc-account", target: "tour-account-switcher", tab: "play", placement: "bottom" },
  { id: "platform", target: "tour-platform-register", tab: "accounts", accountsSection: "platform", placement: "left" },
  { id: "finish", placement: "center" },
];
