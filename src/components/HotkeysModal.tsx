import { Fragment } from "react";
import { useT } from "../i18n";
import type { Language } from "../i18n";
import { HOTKEY_GROUP_ORDER, HOTKEY_HELP } from "../lib/hotkeyList";
import { Modal } from "./ui/Modal";

type HotkeysModalProps = {
  language: Language;
  open: boolean;
  onClose: () => void;
};

function KeyCombo({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex items-center gap-1">
      {keys.map((key, i) => (
        <Fragment key={`${key}-${i}`}>
          {i > 0 && key !== "…" ? <span className="text-white/30">+</span> : null}
          <kbd className="inline-flex min-w-[1.5rem] items-center justify-center rounded-md border border-white/15 bg-white/[0.07] px-1.5 py-0.5 text-[0.6875rem] font-semibold text-white/85">
            {key}
          </kbd>
        </Fragment>
      ))}
    </span>
  );
}

export function HotkeysModal({ language, open, onClose }: HotkeysModalProps) {
  const tt = useT(language);

  return (
    <Modal
      open={open}
      title={tt("app.hotkeys.title")}
      subtitle={tt("app.hotkeys.subtitle")}
      onClose={onClose}
      closeLabel={tt("common.close")}
      maxWidthClassName="w-[min(96vw,34rem)]"
    >
      <div className="space-y-5">
        {HOTKEY_GROUP_ORDER.map((group) => {
          const entries = HOTKEY_HELP.filter((entry) => entry.group === group);
          return (
            <section key={group}>
              <h3 className="mb-2 text-xs font-semibold text-white/55">
                {tt(`app.hotkeys.groups.${group}`)}
              </h3>
              <ul className="space-y-1.5">
                {entries.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-center justify-between gap-4 text-sm text-white/85"
                  >
                    <span className="min-w-0">{tt(`app.hotkeys.items.${entry.id}`)}</span>
                    <span className="flex shrink-0 flex-wrap items-center justify-end gap-x-2 gap-y-1">
                      {entry.keys.map((combo, i) => (
                        <KeyCombo key={i} keys={combo} />
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </Modal>
  );
}
