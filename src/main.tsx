import React from "react";
import ReactDOM from "react-dom/client";
import { isDownloadsWindowView } from "./lib/downloadsWindow";
import { isGameConsoleWindowView } from "./lib/gameConsoleWindow";
import { ensureLanguageLoaded, guessInitialLanguage } from "./i18n";
import { TRAY_MENU_WINDOW_LABEL } from "./features/tray-menu/constants";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "@fontsource-variable/onest";
import "./index.css";
import "./mainMenu.css";

{
  const ua = navigator.userAgent.toLowerCase();
  const isLinux = ua.includes("linux") && !ua.includes("android");
  document.documentElement.classList.toggle("launcher-linux", isLinux);
}

function isTrayMenuWindow(): boolean {
  try {
    return getCurrentWindow().label === TRAY_MENU_WINDOW_LABEL;
  } catch {
    return false;
  }
}

const isTrayMenu = isTrayMenuWindow();
document.documentElement.classList.toggle("tray-menu-view", isTrayMenu);

const loadRoot = isTrayMenu
  ? () => import("./features/tray-menu/TrayMenuApp").then((m) => m.TrayMenuApp)
  : isGameConsoleWindowView()
    ? () => import("./ConsoleApp").then((m) => m.ConsoleApp)
    : isDownloadsWindowView()
      ? () => import("./DownloadsApp").then((m) => m.DownloadsApp)
      : () => import("./App").then((m) => m.default);

void Promise.all([loadRoot(), ensureLanguageLoaded(guessInitialLanguage())]).then(([Root]) => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <Root />
    </React.StrictMode>,
  );
});
