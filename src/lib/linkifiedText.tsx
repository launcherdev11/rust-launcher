import { openUrl } from "@tauri-apps/plugin-opener";
import type { ReactNode } from "react";

const MARKDOWN_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi;
const BARE_URL_RE = /(https?:\/\/[^\s<>"'`]+)(?![^\s]*\])/gi;
const BOLD_RE = /\*\*([^*]+)\*\*/g;

type TextPart =
  | { kind: "text"; value: string }
  | { kind: "bold"; value: string }
  | { kind: "link"; label: string; href: string };

function splitBold(chunk: string): TextPart[] {
  const parts: TextPart[] = [];
  let cursor = 0;
  for (const match of chunk.matchAll(BOLD_RE)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      parts.push({ kind: "text", value: chunk.slice(cursor, index) });
    }
    parts.push({ kind: "bold", value: match[1] });
    cursor = index + match[0].length;
  }
  if (cursor < chunk.length) {
    parts.push({ kind: "text", value: chunk.slice(cursor) });
  }
  return parts.length > 0 ? parts : [{ kind: "text", value: chunk }];
}

function splitLinkified(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let cursor = 0;
  const markdownMatches = [...text.matchAll(MARKDOWN_LINK_RE)];

  for (const match of markdownMatches) {
    const index = match.index ?? 0;
    if (index > cursor) {
      parts.push(...splitBareUrls(text.slice(cursor, index)));
    }
    parts.push({ kind: "link", label: match[1], href: match[2] });
    cursor = index + match[0].length;
  }

  if (cursor < text.length) {
    parts.push(...splitBareUrls(text.slice(cursor)));
  }

  return parts.length > 0 ? parts : [{ kind: "text", value: text }];
}

function splitBareUrls(chunk: string): TextPart[] {
  const parts: TextPart[] = [];
  let cursor = 0;
  for (const match of chunk.matchAll(BARE_URL_RE)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      parts.push(...splitBold(chunk.slice(cursor, index)));
    }
    const href = match[1].replace(/[.,;:!?)]+$/g, "");
    const trailing = match[1].slice(href.length);
    parts.push({ kind: "link", label: href, href });
    if (trailing) parts.push(...splitBold(trailing));
    cursor = index + match[0].length;
  }
  if (cursor < chunk.length) {
    parts.push(...splitBold(chunk.slice(cursor)));
  }
  return parts.length > 0 ? parts : splitBold(chunk);
}

async function openExternal(href: string) {
  try {
    await openUrl(href);
  } catch (err) {
    console.error("Failed to open link:", err);
  }
}

function normalizeMarkdown(text: string): string {
  return text.replace(/\*\*(\[[^\]]+\]\(https?:\/\/[^\s)]+\))\*\*/gi, "$1");
}

export function stripMarkdownMarkers(text: string): string {
  return normalizeMarkdown(text)
    .replace(MARKDOWN_LINK_RE, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .trim();
}

export function splitAnnouncement(text: string): { title?: string; body: string } {
  const normalized = normalizeMarkdown(text).replace(/\r\n/g, "\n").trim();
  if (!normalized) return { body: "" };

  const parts = normalized.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) return { body: normalized };

  const first = parts[0];
  if (stripMarkdownMarkers(first).length <= 90) {
    return { title: stripMarkdownMarkers(first), body: parts.slice(1).join("\n\n") };
  }
  return { body: normalized };
}

export function findPrimaryLink(text: string): { label: string; href: string } | null {
  const normalized = normalizeMarkdown(text);
  const markdown = [...normalized.matchAll(MARKDOWN_LINK_RE)][0];
  if (markdown) return { label: markdown[1], href: markdown[2] };
  const bare = [...normalized.matchAll(BARE_URL_RE)][0];
  if (bare) {
    const href = bare[1].replace(/[.,;:!?)]+$/g, "");
    return { label: href, href };
  }
  return null;
}

export function LinkifiedText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const blocks = normalizeMarkdown(text).replace(/\r\n/g, "\n").split(/\n{2,}/);

  return (
    <div className={className}>
      {blocks.map((block, blockIndex) => {
        const lines = block.split("\n");
        return (
          <div key={blockIndex} className={blockIndex > 0 ? "mt-3" : undefined}>
            {lines.map((line, lineIndex) => {
              const parts = splitLinkified(line);
              const nodes: ReactNode[] = parts.map((part, partIndex) => {
                if (part.kind === "text") {
                  return <span key={`${blockIndex}-${lineIndex}-${partIndex}`}>{part.value}</span>;
                }
                if (part.kind === "bold") {
                  return (
                    <strong
                      key={`${blockIndex}-${lineIndex}-${partIndex}`}
                      className="font-semibold text-white"
                    >
                      {part.value}
                    </strong>
                  );
                }
                return (
                  <button
                    key={`${blockIndex}-${lineIndex}-${partIndex}`}
                    type="button"
                    onClick={() => void openExternal(part.href)}
                    className="inline break-all text-left font-medium text-accent-hi underline decoration-accent-hi/40 underline-offset-2 transition-colors hover:text-white hover:decoration-white/70"
                  >
                    {part.label}
                  </button>
                );
              });

              return (
                <p
                  key={`${blockIndex}-line-${lineIndex}`}
                  className={lineIndex > 0 ? "mt-1.5" : undefined}
                >
                  {nodes.length > 0 ? nodes : "\u00A0"}
                </p>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
