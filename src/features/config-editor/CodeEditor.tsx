import { memo, useEffect, useImperativeHandle, useMemo, useRef, forwardRef } from "react";
import { TOKEN_CLASS, tokenizeLine, type ConfigFormat } from "./syntax";

const HIGHLIGHT_LIMIT = 300_000;
const LINE_HEIGHT_REM = 1.375;

export type CodeEditorHandle = {
  focusLine: (line: number) => void;
  findNext: (query: string) => boolean;
};

const HighlightedLine = memo(function HighlightedLine({ text, format }: { text: string; format: ConfigFormat }) {
  if (!text) return <>{"​"}</>;
  const tokens = tokenizeLine(text, format);
  return (
    <>
      {tokens.map((t, i) => (
        <span key={i} className={TOKEN_CLASS[t.kind]}>
          {t.text}
        </span>
      ))}
    </>
  );
});

export const CodeEditor = forwardRef<
  CodeEditorHandle,
  {
    value: string;
    onChange: (next: string) => void;
    format: ConfigFormat;
    errorLine?: number | null;
    readOnly?: boolean;
    onSave?: () => void;
    ariaLabel: string;
  }
>(function CodeEditor({ value, onChange, format, errorLine, readOnly, onSave, ariaLabel }, ref) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);

  const lines = useMemo(() => value.split("\n"), [value]);
  const highlight = value.length <= HIGHLIGHT_LIMIT;

  const syncScroll = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (layerRef.current) {
      layerRef.current.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
    }
    if (gutterRef.current) gutterRef.current.style.transform = `translateY(${-ta.scrollTop}px)`;
  };

  useEffect(syncScroll, [value]);

  useImperativeHandle(ref, () => {
    const focusLine = (line: number) => {
      const ta = textareaRef.current;
      if (!ta) return;
      const idx = Math.max(0, Math.min(line - 1, lines.length - 1));
      let pos = 0;
      for (let i = 0; i < idx; i++) pos += lines[i].length + 1;
      ta.focus();
      ta.setSelectionRange(pos, pos + lines[idx].length);
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      ta.scrollTop = Math.max(0, idx * LINE_HEIGHT_REM * rem - ta.clientHeight / 2);
      syncScroll();
    };
    const findNext = (query: string) => {
      const ta = textareaRef.current;
      if (!ta || !query) return false;
      const hay = value.toLowerCase();
      const needle = query.toLowerCase();
      let at = hay.indexOf(needle, ta.selectionEnd);
      if (at < 0) at = hay.indexOf(needle);
      if (at < 0) return false;
      focusLine(value.slice(0, at).split("\n").length);
      ta.setSelectionRange(at, at + query.length);
      return true;
    };
    return { focusLine, findNext };
  });

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      onSave?.();
      return;
    }
    if (e.key === "Tab" && !readOnly) {
      e.preventDefault();
      const ta = e.currentTarget;
      const { selectionStart: s, selectionEnd: end } = ta;
      const next = `${value.slice(0, s)}  ${value.slice(end)}`;
      onChange(next);
      requestAnimationFrame(() => ta.setSelectionRange(s + 2, s + 2));
    }
  };

  const textClass = "font-mono text-[0.8125rem] leading-[1.375rem] whitespace-pre";

  return (
    <div className="relative flex min-h-[16rem] flex-1 overflow-hidden rounded-xl border border-white/[0.06] bg-[var(--ink-0)]">
      <div className="relative w-12 shrink-0 overflow-hidden border-r border-white/[0.06] bg-black/20 py-2 text-right">
        <div ref={gutterRef} className={`${textClass} pr-2 text-white/25`}>
          {lines.map((_, i) => (
            <div key={i} className={errorLine === i + 1 ? "bg-red-500/25 text-red-200" : undefined}>
              {i + 1}
            </div>
          ))}
        </div>
      </div>
      <div className="relative min-w-0 flex-1 overflow-hidden">
        {highlight ? (
          <div
            ref={layerRef}
            aria-hidden="true"
            className={`pointer-events-none absolute left-0 top-0 px-3 py-2 ${textClass}`}
          >
            {lines.map((line, i) => (
              <div key={i} className={errorLine === i + 1 ? "bg-red-500/15" : undefined}>
                <HighlightedLine text={line} format={format} />
              </div>
            ))}
          </div>
        ) : null}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={syncScroll}
          onKeyDown={onKeyDown}
          readOnly={readOnly}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          wrap="off"
          aria-label={ariaLabel}
          className={`custom-scrollbar absolute inset-0 h-full w-full resize-none overflow-auto bg-transparent px-3 py-2 outline-none ${textClass} ${
            highlight ? "text-transparent caret-white selection:bg-accent-from/35 selection:text-transparent" : "text-white/85"
          }`}
        />
      </div>
    </div>
  );
});
