export type HotkeyGroupId = "navigation" | "play" | "content" | "general";

export type HotkeyHelpEntry = {
  id: string;
  group: HotkeyGroupId;
  keys: string[][];
  labelKey?: string;
};

export const HOTKEY_GROUP_ORDER: HotkeyGroupId[] = ["navigation", "play", "content", "general"];

export const HOTKEY_HELP: HotkeyHelpEntry[] = [
  { id: "tabs", group: "navigation", keys: [["1"], ["…"], ["6"]] },
  { id: "cycleTabs", group: "navigation", keys: [["Ctrl", "Tab"], ["Ctrl", "Shift", "Tab"]] },
  { id: "history", group: "navigation", keys: [["Alt", "←"], ["Alt", "→"]] },
  { id: "settings", group: "navigation", keys: [["Ctrl", ","]] },
  { id: "sidebar", group: "navigation", keys: [["Ctrl", "B"]] },
  { id: "back", group: "navigation", keys: [["Esc"]] },
  { id: "launch", group: "play", keys: [["Ctrl", "Enter"]] },
  { id: "stop", group: "play", keys: [["Ctrl", "Shift", "K"]] },
  { id: "copyConsole", group: "play", keys: [["Ctrl", "Shift", "C"]] },
  { id: "detachConsole", group: "play", keys: [["Ctrl", "Shift", "D"]] },
  { id: "create", group: "content", keys: [["Ctrl", "N"]] },
  { id: "import", group: "content", keys: [["Ctrl", "I"]] },
  { id: "screenshots", group: "content", keys: [["Ctrl", "Shift", "S"]] },
  { id: "palette", group: "general", keys: [["Ctrl", "K"]], labelKey: "commandPalette.hotkey" },
  { id: "search", group: "content", keys: [["/"]] },
  { id: "refresh", group: "content", keys: [["F5"]] },
  { id: "help", group: "general", keys: [["F1"], ["?"]] },
];
