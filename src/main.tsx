import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ConsoleApp } from "./ConsoleApp";
import { isGameConsoleWindowView } from "./lib/gameConsoleWindow";
import "./index.css";

// WebKitGTK on Linux has broken backdrop-filter compositing: dirty rects grow/shrink
// during transitions and look like huge, unstable hitboxes. Opt into solid surfaces.
{
  const ua = navigator.userAgent.toLowerCase();
  const isLinux = ua.includes("linux") && !ua.includes("android");
  document.documentElement.classList.toggle("launcher-linux", isLinux);
}

const Root = isGameConsoleWindowView() ? ConsoleApp : App;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
