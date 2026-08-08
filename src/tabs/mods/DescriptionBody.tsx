function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function attr(attrs: string, name: string): string | null {
  const quoted = new RegExp(`\\b${name}\\s*=\\s*(['"])(.*?)\\1`, "i").exec(attrs);
  if (quoted) return quoted[2];
  const bare = new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, "i").exec(attrs);
  return bare?.[1] ?? null;
}

function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  if (/^\s*javascript:/i.test(trimmed)) return null;
  return trimmed;
}

function sanitizeImgTag(attrs: string): string {
  const src = safeHttpUrl(attr(attrs, "src"));
  if (!src) return "";
  const alt = attr(attrs, "alt") ?? "";
  const width = attr(attrs, "width");
  const widthAttr =
    width && /^\d{1,4}$/.test(width) ? ` width="${width}"` : "";
  return `<img alt="${escapeHtml(alt)}" src="${escapeHtml(src)}"${widthAttr} class="mods-desc-img" loading="lazy" />`;
}

function sanitizeAnchor(openAttrs: string, inner: string): string {
  const href = safeHttpUrl(attr(openAttrs, "href"));
  if (!href) return sanitizeFragment(inner);
  return `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer noopener" class="mods-desc-link">${sanitizeFragment(inner)}</a>`;
}

/** Keep a small allowlist of HTML that Modrinth authors embed in markdown. */
function sanitizeFragment(html: string): string {
  let out = html;
  out = out.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "");
  out = out.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "");
  out = out.replace(
    /<\/?(iframe|object|embed|link|meta|base|form|input|button|textarea|select)[^>]*>/gi,
    "",
  );
  out = out.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");

  out = out.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_m, attrs: string, inner: string) =>
    sanitizeAnchor(attrs, inner),
  );
  out = out.replace(/<img\b([^>]*)\/?>/gi, (_m, attrs: string) => sanitizeImgTag(attrs));
  out = out.replace(/<br\s*\/?>/gi, "<br/>");
  out = out.replace(/<hr\b[^>]*\/?>/gi, '<hr class="mods-desc-hr" />');

  out = out.replace(
    /<(p|div|span|center|h[1-6]|ul|ol|li|blockquote|strong|em|b|i|u|code|pre)\b([^>]*)>/gi,
    (_m, tag: string, attrs: string) => {
      const align = (attr(attrs, "align") || "").toLowerCase();
      const style = attr(attrs, "style") || "";
      const centered =
        align === "center" || /text-align\s*:\s*center/i.test(style);
      const cls = centered ? ' class="mods-desc-center"' : "";
      return `<${tag.toLowerCase()}${cls}>`;
    },
  );
  out = out.replace(
    /<\/(p|div|span|center|h[1-6]|ul|ol|li|blockquote|strong|em|b|i|u|code|pre)>/gi,
    (_m, tag: string) => `</${tag.toLowerCase()}>`,
  );

  out = out.replace(
    /<\/?(?!a|img|br|hr|p|div|span|center|h[1-6]|ul|ol|li|blockquote|strong|em|b|i|u|code|pre)[a-z][^>]*>/gi,
    "",
  );
  return out;
}

function sanitizeHtml(html: string): string {
  return sanitizeFragment(html);
}

const SLOT_RE = /\uE000(\d+)\uE001/g;

function restoreSlots(html: string, slots: string[]): string {
  let out = html;
  for (let pass = 0; pass < 8; pass++) {
    if (!SLOT_RE.test(out)) break;
    SLOT_RE.lastIndex = 0;
    out = out.replace(SLOT_RE, (_m, idx: string) => slots[Number(idx)] ?? "");
  }
  return out;
}

function protectHtmlBlocks(md: string): { text: string; slots: string[] } {
  const slots: string[] = [];
  const park = (fragment: string) => {
    const i = slots.length;
    slots.push(sanitizeFragment(fragment));
    return `\uE000${i}\uE001`;
  };

  let text = md.replace(/\r\n/g, "\n");

  // Markdown image-link with raw HTML img: [<img ...>](url)
  text = text.replace(
    /\[<img\b([^>]*)\/?>\]\((https?:[^)\s]+)\)/gi,
    (_m, attrs: string, href: string) => {
      const img = sanitizeImgTag(attrs);
      const safe = safeHttpUrl(href);
      if (!img || !safe) return img || "";
      return park(
        `<a href="${escapeHtml(safe)}" target="_blank" rel="noreferrer noopener" class="mods-desc-link">${img}</a>`,
      );
    },
  );

  // Block wrappers first (nested <a>/<img> stay inside one fragment)
  text = text.replace(
    /<(p|div|center|span)\b[^>]*>[\s\S]*?<\/\1>/gi,
    (m) => park(m),
  );

  text = text.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, (m) => park(m));
  text = text.replace(/<(img|br|hr)\b[^>]*\/?>/gi, (m) => park(m));

  return { text, slots };
}

function inlineMd(text: string): string {
  const pieces: string[] = [];
  const withHoles = text.replace(SLOT_RE, (m) => {
    const i = pieces.length;
    pieces.push(m);
    return `\uE010${i}\uE011`;
  });

  let s = escapeHtml(withHoles);
  s = s.replace(
    /!\[([^\]]*)\]\((https?:[^)\s]+)\)/g,
    '<img alt="$1" src="$2" class="mods-desc-img" loading="lazy" />',
  );
  s = s.replace(
    /\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noreferrer noopener" class="mods-desc-link">$1</a>',
  );
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\uE010(\d+)\uE011/g, (_m, idx: string) => pieces[Number(idx)] ?? "");
  return s;
}

function simpleMarkdownToHtml(md: string): string {
  const { text, slots } = protectHtmlBlocks(md);
  const lines = text.split("\n");
  const html: string[] = [];
  let inList = false;
  let inCode = false;
  let codeBuf: string[] = [];

  const closeList = () => {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  };

  for (const raw of lines) {
    if (raw.trim().startsWith("```")) {
      if (inCode) {
        html.push(
          `<pre class="mods-desc-pre"><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`,
        );
        codeBuf = [];
        inCode = false;
      } else {
        closeList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(raw);
      continue;
    }

    if (/^\s*\uE000\d+\uE001\s*$/.test(raw)) {
      closeList();
      html.push(raw.trim());
      continue;
    }

    const heading = raw.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMd(heading[2])}</h${level}>`);
      continue;
    }

    const listItem = raw.match(/^[-*]\s+(.+)$/);
    if (listItem) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${inlineMd(listItem[1])}</li>`);
      continue;
    }

    if (raw.trim() === "") {
      closeList();
      html.push("<br/>");
      continue;
    }

    closeList();
    html.push(`<p>${inlineMd(raw)}</p>`);
  }

  if (inCode) {
    html.push(
      `<pre class="mods-desc-pre"><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`,
    );
  }
  closeList();
  return restoreSlots(html.join("\n"), slots);
}

type DescriptionBodyProps = {
  body: string;
  format: "markdown" | "html";
};

export function DescriptionBody({ body, format }: DescriptionBodyProps) {
  if (!body.trim()) {
    return <p className="text-sm text-white/50">—</p>;
  }

  const html =
    format === "html" ? sanitizeHtml(body) : simpleMarkdownToHtml(body);

  return (
    <div
      className="mods-description w-full text-sm leading-relaxed text-white/80 [&_a.mods-desc-link]:inline-block [&_a.mods-desc-link]:align-middle [&_a.mods-desc-link]:text-violet-300 [&_a.mods-desc-link]:no-underline hover:[&_a.mods-desc-link]:opacity-90 [&_code]:rounded [&_code]:bg-black/40 [&_code]:px-1 [&_h1]:mb-3 [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:text-white [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-white [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-white [&_hr.mods-desc-hr]:my-4 [&_hr.mods-desc-hr]:border-white/10 [&_img.mods-desc-img]:my-1.5 [&_img.mods-desc-img]:inline-block [&_img.mods-desc-img]:h-auto [&_img.mods-desc-img]:max-h-72 [&_img.mods-desc-img]:max-w-full [&_img.mods-desc-img]:rounded-xl [&_img.mods-desc-img]:align-middle [&_li]:ml-5 [&_li]:list-disc [&_li]:py-0.5 [&_p]:mb-3 [&_.mods-desc-center]:mb-4 [&_.mods-desc-center]:flex [&_.mods-desc-center]:flex-wrap [&_.mods-desc-center]:items-center [&_.mods-desc-center]:justify-center [&_.mods-desc-center]:gap-2 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-black/40 [&_pre]:p-3 [&_strong]:text-white/90"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
