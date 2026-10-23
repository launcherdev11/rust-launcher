import { Modal } from "../../components/ui";
import type { Tt } from "../types";

type Props = {
  tt: Tt;
  onCancel: () => void;
  onConfirm: () => void;
};

export function RemoveAccountDialog({ tt, onCancel, onConfirm }: Props) {
  return (
    <Modal
      open
      title={tt("common.confirmDialog.title")}
      closeLabel={tt("common.close")}
      onClose={onCancel}
      footer={
        <>
          <button type="button" autoFocus onClick={onCancel} className="btn btn-soft btn-sm">
            {tt("common.cancel")}
          </button>
          <button type="button" onClick={onConfirm} className="btn btn-danger btn-sm">
            {tt("common.delete")}
          </button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-white/80">{tt("app.accounts.removeConfirm")}</p>
    </Modal>
  );
}
