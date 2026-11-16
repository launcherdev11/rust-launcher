type Tt = (key: string, vars?: Record<string, string | number>) => string;

const HOOK_FAILED_PREFIX = "launch_hook_failed:";
const WRAPPER_FAILED_PREFIX = "launch_wrapper_failed:";

export function launchErrorMessage(error: unknown, tt: Tt): string {
  const msg = error instanceof Error ? error.message : String(error);
  if (msg.startsWith(HOOK_FAILED_PREFIX)) {
    const detail = msg.slice(HOOK_FAILED_PREFIX.length);
    return detail === "timeout"
      ? tt("modpacks.launchHooks.errors.preLaunchTimeout")
      : tt("modpacks.launchHooks.errors.preLaunchFailed", { detail });
  }
  if (msg.startsWith(WRAPPER_FAILED_PREFIX)) {
    return tt("modpacks.launchHooks.errors.wrapperFailed", {
      detail: msg.slice(WRAPPER_FAILED_PREFIX.length),
    });
  }
  if (msg === "launch_hooks.invalid_wrapper") {
    return tt("modpacks.launchHooks.errors.invalidWrapper");
  }
  return msg;
}
