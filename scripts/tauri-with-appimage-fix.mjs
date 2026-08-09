#!/usr/bin/env node
/**
 * Cross-platform wrapper: run `tauri`, then on Linux after `build`
 * patch AppImages (strip bundled Wayland + inject AppRun hook).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const args = process.argv.slice(2);

const tauri = spawnSync("npm", ["exec", "--", "tauri", ...args], {
  cwd: repoRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
  env: process.env,
});

if (tauri.status !== 0) {
  process.exit(tauri.status ?? 1);
}

const isBuild = args.includes("build");
if (isBuild && process.platform === "linux") {
  const patch = spawnSync(
    "bash",
    [path.join(__dirname, "patch-appimage-wayland.sh")],
    {
      cwd: repoRoot,
      stdio: "inherit",
      env: process.env,
    },
  );
  if (patch.status !== 0) {
    process.exit(patch.status ?? 1);
  }
}
