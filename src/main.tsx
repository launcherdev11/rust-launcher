import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ConsoleApp } from "./ConsoleApp";
import { isGameConsoleWindowView } from "./lib/gameConsoleWindow";
import "./index.css";

const Root = isGameConsoleWindowView() ? ConsoleApp : App;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
