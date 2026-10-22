import type { RefObject } from "react";
import { AccountAvatar } from "../../components/account_avatar";
import { DeleteIcon } from "../../components/delete_icon";
import type { ProfileAvatarInput } from "../../lib/avatar";
import { accountKindAvatarClass } from "../accountHelpers";
import { ChevronDownIcon, PlusIcon } from "../icons";
import type { LauncherAccountSummary, Tt } from "../types";

type Props = {
  containerRef: RefObject<HTMLDivElement | null>;
  open: boolean;
  onToggle: () => void;
  tt: Tt;
  label: string;
  kind: string;
  avatarProfile: ProfileAvatarInput;
  accounts: LauncherAccountSummary[];
  kindShortLabel: (kind: string) => string;
  adding: boolean;
  onSwitch: (accountId: string) => void;
  onRemove: (accountId: string) => void;
  onAdd: () => void;
  onManageAll: () => void;
};

export function AccountSwitcher({
  containerRef,
  open,
  onToggle,
  tt,
  label,
  kind,
  avatarProfile,
  accounts,
  kindShortLabel,
  adding,
  onSwitch,
  onRemove,
  onAdd,
  onManageAll,
}: Props) {
  return (
    <div className="relative" ref={containerRef} data-no-drag>
      <button
        type="button"
        onClick={onToggle}
        data-tour-id="tour-account-switcher"
        className={`interactive-press flex h-8 max-w-[200px] items-center gap-2 rounded-lg border pl-1 pr-2 text-left text-[0.8125rem] font-semibold text-white/90 transition-colors ${
          open
            ? "border-white/15 bg-ink-800"
            : "border-white/10 bg-ink-850 hover:bg-ink-800"
        }`}
        title={tt("app.accounts.switcherTitle")}
      >
        <AccountAvatar
          username={label}
          profile={avatarProfile}
          kind={kind}
          size={56}
          className={`h-6 w-6 shrink-0 rounded-md ${accountKindAvatarClass(kind)}`}
        />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronDownIcon
          className={`transition-transform ${open ? "rotate-180 opacity-100" : "opacity-60"}`}
        />
      </button>
      {open ? (
        <div className="glass-popover absolute right-0 top-full z-[100] mt-1.5 min-w-[240px] max-w-[min(320px,calc(100vw-2rem))] overflow-hidden py-1">
          <p className="px-3 py-2 text-[0.75rem] font-bold text-white/40">
            {tt("app.accounts.switcherHeading")}
          </p>
          <div className="max-h-[min(280px,45vh)] overflow-y-auto">
            {accounts.map((acc) => (
              <div
                key={acc.id}
                className={`flex items-center gap-2 border-t border-white/5 px-2 py-1.5 first:border-t-0 ${
                  acc.is_active ? "bg-accent-from/20" : "hover:bg-white/5"
                }`}
              >
                <AccountAvatar
                  username={acc.label}
                  profile={acc.is_active ? avatarProfile : undefined}
                  kind={acc.kind}
                  size={64}
                  className={`h-8 w-8 shrink-0 rounded-full ${accountKindAvatarClass(acc.kind)}`}
                />
                <button
                  type="button"
                  disabled={acc.is_active}
                  onClick={() => {
                    if (!acc.is_active) onSwitch(acc.id);
                  }}
                  className="min-w-0 flex-1 rounded-lg px-1 py-1 text-left transition enabled:cursor-pointer enabled:hover:bg-white/10 enabled:active:scale-[0.99] disabled:cursor-default"
                >
                  <span className="block truncate text-sm font-medium text-white/95">
                    {acc.label}
                  </span>
                  <span className="mt-0.5 block text-[0.75rem] text-white/45">
                    {kindShortLabel(acc.kind)}
                    {acc.is_active
                      ? ` · ${tt("app.accounts.activeBadge")}`
                      : ""}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(acc.id)}
                  className="interactive-press shrink-0 rounded-lg p-2 text-white/35 hover:bg-red-500/15 hover:text-red-300"
                  title={tt("app.accounts.removeTitle")}
                >
                  <DeleteIcon className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <div className="border-t border-white/10" />
          <button
            type="button"
            disabled={adding}
            onClick={() => onAdd()}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-medium text-accent-hi hover:bg-white/10 disabled:opacity-50"
          >
            <PlusIcon className="h-3.5 w-3.5 shrink-0 opacity-90" />
            {tt("app.accounts.addAccount")}
          </button>
          <button
            type="button"
            onClick={onManageAll}
            className="w-full border-t border-white/10 px-3 py-2.5 text-left text-xs font-medium text-white/70 hover:bg-white/10 hover:text-white"
          >
            {tt("app.accounts.manageAll")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
