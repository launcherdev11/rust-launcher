export function isLinux(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }

  const platform = navigator.platform?.toLowerCase() ?? "";
  const userAgent = navigator.userAgent.toLowerCase();
  return platform.includes("linux") || userAgent.includes("linux");
}

/** WebKitGTK on Linux crashes when compositing backdrop-filter (common on AMDGPU + Hyprland). */
export function markLinuxPlatformClass(): void {
  if (isLinux()) {
    document.documentElement.classList.add("platform-linux");
  }
}
