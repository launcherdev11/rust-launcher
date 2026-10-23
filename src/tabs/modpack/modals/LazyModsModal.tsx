import { useState } from "react";
import { ChevronDown, Trash2, X } from "lucide-react";
import { Modal, TextField } from "../../../components/ui";
import type { LazyModSet } from "../types";
import type { LazyModal } from "../hooks/useLazyMods";
import type { ModpackController } from "../useModpackController";

type Props = { ctx: ModpackController };

export function LazyModsModal({ ctx }: Props) {
  const modal = ctx.lazy.modal;
  if (!modal) return null;
  return <LazyModsModalBody ctx={ctx} modal={modal} />;
}

function LazyModsModalBody({ ctx, modal }: Props & { modal: LazyModal }) {
  const { tt, lazy, refreshItems, contentTab } = ctx;
  const [newName, setNewName] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [applyIds, setApplyIds] = useState<string[]>(() =>
    lazy.sets.filter((s) => s.auto_apply).map((s) => s.id),
  );

  const close = () => lazy.setModal(null);

  const title =
    modal.mode === "add"
      ? tt("modpacks.lazy.addTitle", { count: modal.items.length })
      : modal.mode === "apply"
        ? tt("modpacks.lazy.applyTitle")
        : tt("modpacks.lazy.title");
  const subtitle =
    modal.mode === "apply" ? tt("modpacks.lazy.applyHint") : tt("modpacks.lazy.hint");

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    if (modal.mode === "add") {
      const saved = await lazy.createSetWithItems(name, modal.items, modal.skipped);
      if (saved) close();
      return;
    }
    const saved = await lazy.saveSet(null, name, false);
    if (saved) setNewName("");
  }

  async function handleApply() {
    if (modal.mode !== "apply") return;
    const profileId = modal.profileId;
    const report = await lazy.applyToProfile(profileId, applyIds);
    if (report) {
      close();
      void refreshItems(profileId, contentTab);
    }
  }

  function renderSetControls(set: LazyModSet) {
    if (modal.mode === "add") {
      return (
        <button
          type="button"
          onClick={async () => {
            if (await lazy.addItemsToSet(set, modal.items, modal.skipped)) close();
          }}
          className="btn btn-sm btn-accent"
        >
          {tt("modpacks.lazy.addHere")}
        </button>
      );
    }
    if (modal.mode === "apply") {
      return (
        <input
          type="checkbox"
          checked={applyIds.includes(set.id)}
          onChange={() =>
            setApplyIds((prev) =>
              prev.includes(set.id) ? prev.filter((id) => id !== set.id) : [...prev, set.id],
            )
          }
          className="accent-checkbox"
          aria-label={set.name}
        />
      );
    }
    return (
      <>
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-[color:var(--fg-muted)]">
          <input
            type="checkbox"
            checked={set.auto_apply}
            onChange={(e) => void lazy.saveSet(set.id, set.name, e.target.checked)}
            className="accent-checkbox"
          />
          <span>{tt("modpacks.lazy.autoApply")}</span>
        </label>
        <button
          type="button"
          onClick={() => void lazy.deleteSet(set)}
          className="icon-btn h-7 w-7"
          title={tt("modpacks.lazy.deleteSet")}
          aria-label={tt("modpacks.lazy.deleteSet")}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </>
    );
  }

  return (
    <Modal
      open
      title={title}
      subtitle={subtitle}
      onClose={close}
      closeDisabled={lazy.applying}
      closeLabel={tt("common.close")}
      maxWidthClassName="w-[min(96vw,34rem)]"
      footer={
        modal.mode === "apply" ? (
          <>
            <button type="button" onClick={close} disabled={lazy.applying} className="btn btn-ghost">
              {tt("common.cancel")}
            </button>
            <button
              type="button"
              onClick={() => void handleApply()}
              disabled={lazy.applying || applyIds.length === 0}
              className="btn btn-accent"
            >
              {lazy.applying ? tt("modpacks.common.loading") : tt("modpacks.lazy.applyConfirm")}
            </button>
          </>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3">
        {modal.mode !== "apply" && (
          <div className="flex items-center gap-2">
            <TextField
              value={newName}
              onChange={(e) => setNewName(e.target.value.slice(0, 50))}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreate();
              }}
              placeholder={tt("modpacks.lazy.namePlaceholder")}
              maxLength={50}
            />
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={!newName.trim()}
              className="btn btn-soft shrink-0"
            >
              {tt("modpacks.lazy.createSet")}
            </button>
          </div>
        )}

        <div className="custom-scrollbar flex max-h-[22rem] flex-col gap-2 overflow-y-auto pr-1">
          {lazy.sets.length === 0 && !lazy.loading && (
            <p className="px-1 py-4 text-center text-sm text-[color:var(--fg-muted)]">
              {tt("modpacks.lazy.empty")}
            </p>
          )}
          {lazy.sets.map((set) => {
            const expanded = modal.mode === "manage" && expandedId === set.id;
            return (
              <div key={set.id} className="glass-inset rounded-2xl">
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <button
                    type="button"
                    disabled={modal.mode !== "manage"}
                    onClick={() => setExpandedId(expanded ? null : set.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    {modal.mode === "manage" && (
                      <ChevronDown
                        className={`h-3.5 w-3.5 shrink-0 text-[color:var(--fg-muted)] transition-transform ${
                          expanded ? "" : "-rotate-90"
                        }`}
                      />
                    )}
                    <span className="min-w-0 truncate text-sm font-semibold text-[color:var(--fg)]">
                      {set.name}
                    </span>
                    <span className="shrink-0 rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[0.75rem] tabular-nums text-[color:var(--fg-muted)]">
                      {set.items.length}
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center gap-2">{renderSetControls(set)}</div>
                </div>
                {expanded && (
                  <div className="flex flex-col gap-1 border-t border-[color:var(--seam)] px-3 py-2">
                    {set.items.length === 0 && (
                      <p className="py-1 text-xs text-[color:var(--fg-muted)]">
                        {tt("modpacks.lazy.noItems")}
                      </p>
                    )}
                    {set.items.map((item) => (
                      <div
                        key={`${item.provider}:${item.project_id}`}
                        className="flex items-center gap-2 text-xs text-[color:var(--fg)]"
                      >
                        {item.icon_url ? (
                          <img
                            src={item.icon_url}
                            alt=""
                            className="h-5 w-5 shrink-0 rounded-md object-cover"
                          />
                        ) : (
                          <span className="h-5 w-5 shrink-0 rounded-md bg-white/[0.06]" />
                        )}
                        <span className="min-w-0 flex-1 truncate">
                          {item.title || item.project_id}
                        </span>
                        <button
                          type="button"
                          onClick={() => void lazy.removeItem(set, item)}
                          className="icon-btn h-6 w-6"
                          title={tt("modpacks.lazy.removeItem")}
                          aria-label={tt("modpacks.lazy.removeItem")}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
