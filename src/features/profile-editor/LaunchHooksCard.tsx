import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DeleteIcon } from "../../components/delete_icon";
import { ActionButton } from "../../components/ui/ActionButton";
import { TextField } from "../../components/ui/TextField";
import { SettingsRow } from "../../settings-ui/SettingsComponents";
import { PlusIcon } from "../../tabs/modpack/icons";

type LaunchEnvVar = { name: string; value: string };

type ProfileLaunchHooks = {
  pre_launch_command: string | null;
  post_exit_command: string | null;
  wrapper_command: string | null;
  env_vars: LaunchEnvVar[];
};

type CommandField = "pre_launch_command" | "wrapper_command" | "post_exit_command";

const COMMAND_FIELDS: { field: CommandField; key: string; placeholder: string }[] = [
  { field: "pre_launch_command", key: "preLaunch", placeholder: "sync-saves pull" },
  { field: "wrapper_command", key: "wrapper", placeholder: "gamemoderun mangohud" },
  { field: "post_exit_command", key: "postExit", placeholder: "sync-saves push" },
];

const INPUT_PROPS = {
  clearable: false,
  spellCheck: false,
  autoCapitalize: "off",
  autoCorrect: "off",
  autoComplete: "off",
} as const;

export function LaunchHooksCard({
  profileId,
  showNotification,
  tt,
}: {
  profileId: string;
  showNotification: (kind: "info" | "success" | "error" | "warning", message: string) => void;
  tt: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const [hooks, setHooks] = useState<ProfileLaunchHooks | null>(null);
  const savedRef = useRef("");

  useEffect(() => {
    let cancelled = false;
    invoke<ProfileLaunchHooks>("get_profile_launch_hooks", { profileId }).then(
      (loaded) => {
        if (cancelled) return;
        savedRef.current = JSON.stringify(loaded);
        setHooks(loaded);
      },
      (e) => {
        console.error(e);
        if (!cancelled) showNotification("error", tt("modpacks.launchHooks.loadFailed"));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  async function save(next: ProfileLaunchHooks) {
    const serialized = JSON.stringify(next);
    if (serialized === savedRef.current) return;
    try {
      await invoke("set_profile_launch_hooks", { profileId, hooks: next });
      savedRef.current = serialized;
      showNotification("success", tt("modpacks.profileSettings.saved"));
    } catch (e) {
      console.error(e);
      const message =
        e === "launch_hooks.invalid_env_name"
          ? tt("modpacks.launchHooks.errors.invalidEnvName")
          : e === "launch_hooks.invalid_wrapper"
            ? tt("modpacks.launchHooks.errors.invalidWrapper")
            : tt("modpacks.profileSettings.saveFailed");
      showNotification("error", message);
    }
  }

  function updateVar(index: number, patch: Partial<LaunchEnvVar>) {
    setHooks((prev) =>
      prev
        ? {
            ...prev,
            env_vars: prev.env_vars.map((v, i) => (i === index ? { ...v, ...patch } : v)),
          }
        : prev,
    );
  }

  const envVars = hooks?.env_vars ?? [];

  return (
    <div className="rounded-2xl bg-black/35 px-4 py-4">
      <div className="text-sm font-medium text-white/70">{tt("modpacks.launchHooks.title")}</div>
      <p className="ui-meta mt-1 max-w-prose">{tt("modpacks.launchHooks.hint")}</p>

      <div className="mt-1 divide-y divide-white/[0.06]">
        {COMMAND_FIELDS.map(({ field, key, placeholder }) => (
          <SettingsRow
            key={field}
            stacked
            htmlFor={`launch-hook-${field}`}
            label={tt(`modpacks.launchHooks.${key}.label`)}
            hint={tt(`modpacks.launchHooks.${key}.hint`)}
          >
            <TextField
              {...INPUT_PROPS}
              id={`launch-hook-${field}`}
              disabled={!hooks}
              placeholder={placeholder}
              value={hooks?.[field] ?? ""}
              onChange={(e) => {
                const value = e.target.value;
                setHooks((prev) => (prev ? { ...prev, [field]: value || null } : prev));
              }}
              onBlur={() => {
                if (hooks) void save(hooks);
              }}
            />
          </SettingsRow>
        ))}

        <SettingsRow
          stacked
          label={tt("modpacks.launchHooks.env.label")}
          hint={tt("modpacks.launchHooks.env.hint")}
        >
          <div className="flex flex-col gap-2">
            {envVars.map((envVar, index) => (
              <div key={index} className="flex items-center gap-2">
                <TextField
                  {...INPUT_PROPS}
                  aria-label={tt("modpacks.launchHooks.env.name")}
                  className="min-w-0 flex-1"
                  placeholder={tt("modpacks.launchHooks.env.name")}
                  value={envVar.name}
                  onChange={(e) => updateVar(index, { name: e.target.value })}
                  onBlur={() => {
                    if (hooks) void save(hooks);
                  }}
                />
                <TextField
                  {...INPUT_PROPS}
                  aria-label={tt("modpacks.launchHooks.env.value")}
                  className="min-w-0 flex-[2]"
                  placeholder={tt("modpacks.launchHooks.env.value")}
                  value={envVar.value}
                  onChange={(e) => updateVar(index, { value: e.target.value })}
                  onBlur={() => {
                    if (hooks) void save(hooks);
                  }}
                />
                <button
                  type="button"
                  className="icon-btn shrink-0"
                  aria-label={tt("modpacks.launchHooks.env.remove")}
                  title={tt("modpacks.launchHooks.env.remove")}
                  onClick={() => {
                    if (!hooks) return;
                    const next = {
                      ...hooks,
                      env_vars: hooks.env_vars.filter((_, i) => i !== index),
                    };
                    setHooks(next);
                    void save(next);
                  }}
                >
                  <DeleteIcon />
                </button>
              </div>
            ))}
            <div>
              <ActionButton
                variant="secondary"
                size="sm"
                disabled={!hooks}
                onClick={() =>
                  setHooks((prev) =>
                    prev
                      ? { ...prev, env_vars: [...prev.env_vars, { name: "", value: "" }] }
                      : prev,
                  )
                }
              >
                <PlusIcon className="h-4 w-4" />
                {tt("modpacks.launchHooks.env.add")}
              </ActionButton>
            </div>
          </div>
        </SettingsRow>
      </div>
    </div>
  );
}
