import { useEffect, useState } from "react";
import { t, type Language } from "../../i18n";
import { settleConfirm, subscribeConfirm, type PendingConfirm } from "../../lib/confirmDialog";
import { Modal } from "./Modal";

type Props = {
  language: Language;
};

export function ConfirmHost({ language }: Props) {
  const [current, setCurrent] = useState<PendingConfirm | null>(null);

  useEffect(() => subscribeConfirm(setCurrent), []);

  useEffect(() => {
    if (!current) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      settleConfirm(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [current]);

  const danger = (current?.tone ?? "danger") === "danger";

  return (
    <Modal
      open={current !== null}
      title={current?.title ?? t(language, "common.confirmDialog.title")}
      closeLabel={t(language, "common.close")}
      onClose={() => settleConfirm(false)}
      footer={
        <>
          <button
            type="button"
            autoFocus={danger}
            className="btn btn-soft btn-sm"
            onClick={() => settleConfirm(false)}
          >
            {current?.cancelLabel ?? t(language, "common.cancel")}
          </button>
          <button
            type="button"
            autoFocus={!danger}
            className={`btn btn-sm ${danger ? "btn-danger" : "btn-accent"}`}
            onClick={() => settleConfirm(true)}
          >
            {current?.confirmLabel ?? t(language, "common.confirmDialog.confirm")}
          </button>
        </>
      }
    >
      <p className="whitespace-pre-line text-sm leading-relaxed text-white/80">
        {current?.message}
      </p>
    </Modal>
  );
}
