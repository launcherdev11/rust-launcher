import type { Tt } from "../types";

type Props = {
  tt: Tt;
  onCancel: () => void;
  onConfirm: () => void;
};

export function RemoveAccountDialog({ tt, onCancel, onConfirm }: Props) {
  return (
    <div
      className="glass-overlay pointer-events-auto fixed inset-0 z-[340] flex items-center justify-center"
      onClick={() => onCancel()}
    >
      <div
        className="glass-modal pointer-events-auto w-[min(90vw,24rem)] p-5"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-remove-confirm-title"
      >
        <p
          id="account-remove-confirm-title"
          className="mb-5 text-sm leading-relaxed text-white/90"
        >
          {tt("app.accounts.removeConfirm")}
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onCancel()}
            className="interactive-press rounded-xl border border-white/10 bg-white/10 px-3.5 py-2 text-xs font-semibold text-white hover:bg-white/18"
          >
            {tt("common.cancel")}
          </button>
          <button
            type="button"
            onClick={() => onConfirm()}
            className="interactive-press rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-semibold text-white shadow-lg hover:bg-amber-400"
          >
            {tt("common.delete")}
          </button>
        </div>
      </div>
    </div>
  );
}
