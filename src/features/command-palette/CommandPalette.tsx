import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { recordPaletteUse, rankCommands, type PaletteCommand, type PaletteGroup } from "./matching";

type Tt = (key: string, vars?: Record<string, string | number>) => string;

export function CommandPalette({
  open,
  onClose,
  commands,
  tt,
}: {
  open: boolean;
  onClose: () => void;
  commands: PaletteCommand[];
  tt: Tt;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setCursor(0);
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  const ranked = useMemo(
    () => (open ? rankCommands(commands, query) : []),
    [open, commands, query],
  );

  useEffect(() => {
    setCursor(0);
  }, [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-palette-index="${cursor}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (!open) return null;

  const run = (cmd: PaletteCommand) => {
    if (cmd.disabled) return;
    recordPaletteUse(cmd.id);
    onClose();
    window.setTimeout(() => cmd.run(), 0);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, Math.max(ranked.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "PageDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 8, Math.max(ranked.length - 1, 0)));
    } else if (e.key === "PageUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 8, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = ranked[cursor];
      if (cmd) run(cmd);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  let lastGroup: PaletteGroup | null = null;

  return createPortal(
    <div
      className="glass-overlay pointer-events-auto fixed inset-0 z-[360] flex items-start justify-center px-4 pt-[12vh]"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={tt("commandPalette.title")}
        className="glass-modal flex max-h-[min(70vh,34rem)] w-[min(96vw,38rem)] flex-col overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="border-b border-white/[0.07] px-4 py-3">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tt("commandPalette.placeholder")}
            aria-label={tt("commandPalette.placeholder")}
            aria-activedescendant={ranked[cursor] ? `palette-item-${cursor}` : undefined}
            className="w-full bg-transparent text-base text-white outline-none placeholder:text-white/40"
          />
        </div>
        <div ref={listRef} role="listbox" className="custom-scrollbar min-h-0 flex-1 overflow-y-auto p-1.5">
          {ranked.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-white/50">{tt("commandPalette.nothing")}</div>
          ) : (
            ranked.map((cmd, i) => {
              const header = cmd.shownGroup !== lastGroup ? cmd.shownGroup : null;
              lastGroup = cmd.shownGroup;
              const active = i === cursor;
              return (
                <div key={`${cmd.shownGroup}:${cmd.id}`}>
                  {header ? (
                    <div className="px-3 pb-1 pt-2.5 text-[0.6875rem] font-semibold text-white/40">
                      {tt(`commandPalette.group.${header}`)}
                    </div>
                  ) : null}
                  <button
                    id={`palette-item-${i}`}
                    data-palette-index={i}
                    type="button"
                    role="option"
                    aria-selected={active}
                    disabled={cmd.disabled}
                    onMouseMove={() => setCursor(i)}
                    onClick={() => run(cmd)}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors disabled:opacity-40 ${
                      active ? "seg-on" : "text-white/85"
                    }`}
                  >
                    {cmd.iconSrc ? (
                      <img src={cmd.iconSrc} alt="" className="h-6 w-6 shrink-0 rounded-md object-cover" />
                    ) : null}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{cmd.title}</span>
                      {cmd.subtitle ? (
                        <span className="block truncate text-[0.75rem] text-white/45">{cmd.subtitle}</span>
                      ) : null}
                    </span>
                    {cmd.hint ? (
                      <kbd className="shrink-0 rounded-md border border-white/15 bg-white/[0.07] px-1.5 py-0.5 text-[0.6875rem] font-semibold text-white/60">
                        {cmd.hint}
                      </kbd>
                    ) : null}
                  </button>
                </div>
              );
            })
          )}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-white/[0.07] px-4 py-2 text-[0.6875rem] text-white/40">
          <span>{tt("commandPalette.footer.navigate")}</span>
          <span>{tt("commandPalette.footer.run")}</span>
          <span>{tt("commandPalette.footer.close")}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
