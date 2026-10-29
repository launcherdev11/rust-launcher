import { useEffect, useState } from "react";
import { t, type Language } from "../../i18n";
import { settlePrompt, subscribePrompt, type PendingPrompt } from "../../lib/promptDialog";
import { Modal } from "./Modal";
import { TextField } from "./TextField";

type Props = {
  language: Language;
};

const FORM_ID = "ui-prompt-form";
const INPUT_ID = "ui-prompt-input";

export function PromptHost({ language }: Props) {
  const [current, setCurrent] = useState<PendingPrompt | null>(null);
  const [value, setValue] = useState("");

  useEffect(() => subscribePrompt(setCurrent), []);

  useEffect(() => {
    setValue(current?.defaultValue ?? "");
  }, [current]);

  useEffect(() => {
    if (!current) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      settlePrompt(null);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [current]);

  const trimmed = value.trim();

  return (
    <Modal
      open={current !== null}
      title={current?.title ?? ""}
      closeLabel={t(language, "common.close")}
      onClose={() => settlePrompt(null)}
      footer={
        <>
          <button type="button" className="btn btn-soft btn-sm" onClick={() => settlePrompt(null)}>
            {current?.cancelLabel ?? t(language, "common.cancel")}
          </button>
          <button
            type="submit"
            form={FORM_ID}
            disabled={!trimmed}
            className="btn btn-accent btn-sm disabled:opacity-50"
          >
            {current?.confirmLabel ?? t(language, "common.save")}
          </button>
        </>
      }
    >
      <form
        id={FORM_ID}
        onSubmit={(e) => {
          e.preventDefault();
          if (trimmed) settlePrompt(trimmed);
        }}
      >
        {current?.label ? (
          <label htmlFor={INPUT_ID} className="ui-meta mb-1.5 block">
            {current.label}
          </label>
        ) : null}
        <TextField
          id={INPUT_ID}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={current?.placeholder}
          maxLength={current?.maxLength}
          aria-label={current?.label ? undefined : current?.title}
          spellCheck={false}
          autoComplete="off"
        />
      </form>
    </Modal>
  );
}
