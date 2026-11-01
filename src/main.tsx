import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ConsoleApp } from "./ConsoleApp";
import { isGameConsoleWindowView } from "./lib/gameConsoleWindow";
import { TRAY_MENU_WINDOW_LABEL, TrayMenuApp } from "./features/tray-menu/TrayMenuApp";
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

const Root = isTrayMenu ? TrayMenuApp : isGameConsoleWindowView() ? ConsoleApp : App;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
