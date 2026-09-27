const ALLOWED_TAGS = new Set([
  "figure",
  "figcaption",
  "table",
  "caption",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "colgroup",
  "col",
  "svg",
  "g",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "textpath",
  "defs",
  "clippath",
  "mask",
  "pattern",
  "use",
  "marker",
  "title",
  "desc",
  "image",
  "img",
  "symbol",
  "lineargradient",
  "radialgradient",
  "stop",
  "foreignobject",
  "p",
  "span",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "sub",
  "sup",
  "ul",
  "ol",
  "li",
]);

const VOID_TAGS = new Set([
  "br",
  "img",
  "col",
  "path",
  "line",
  "circle",
  "ellipse",
  "rect",
  "polygon",
  "polyline",
  "use",
  "image",
  "stop",
]);

function sanitizeAttributes(tag: string, rawAttrs: string) {
  const attrs: string[] = [];
  const attrRe = /([:a-zA-Z_][:a-zA-Z0-9_.-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match: RegExpExecArray | null;
  while ((match = attrRe.exec(rawAttrs))) {
    const name = match[1].toLowerCase();
    const value = match[3] ?? match[4] ?? match[5] ?? "";
    if (name.startsWith("on")) continue;
    if (name === "style") {
      if (/expression|url\s*\(\s*['"]?\s*javascript:/i.test(value)) continue;
      attrs.push(`style="${value.replace(/"/g, "&quot;")}"`);
      continue;
    }
    if ((name === "href" || name === "xlink:href" || name === "src") && /^\s*javascript:/i.test(value)) {
      continue;
    }
    if (tag === "img" || tag === "image") {
      if (!["src", "alt", "width", "height", "role", "aria-label", "class", "xmlns", "xlink:href"].includes(name)) {
        continue;
      }
    }
    // Preserve original attribute casing (important for SVG viewBox, etc.)
    attrs.push(`${match[1]}="${value.replace(/"/g, "&quot;")}"`);
  }
  return attrs.length ? ` ${attrs.join(" ")}` : "";
}

/** Allowlist sanitizer for official College Board table/SVG figure HTML. */
export function sanitizeFigureHtml(input: string) {
  const source = String(input ?? "").replace(/<script\b[\s\S]*?<\/script>/gi, "");
  return source.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (full, rawName: string, rawAttrs: string) => {
    const name = rawName.toLowerCase();
    const closing = full.startsWith("</");
    if (!ALLOWED_TAGS.has(name)) return "";
    // Preserve original tag casing for SVG elements like clipPath / linearGradient.
    if (closing) return `</${rawName}>`;
    const attrs = sanitizeAttributes(name, rawAttrs);
    if (VOID_TAGS.has(name)) return `<${rawName}${attrs} />`;
    return `<${rawName}${attrs}>`;
  });
}

export function QuestionFigure({ html }: { html: string }) {
  const safe = sanitizeFigureHtml(html);
  if (!safe.trim()) return null;
  return (
    <div className="question-figure mb-5 overflow-x-auto rounded-xl border border-slate-600 bg-white p-3 text-slate-900 sm:p-4">
      <div
        className="question-figure-inner mx-auto w-fit max-w-full"
        dangerouslySetInnerHTML={{ __html: safe }}
      />
    </div>
  );
}
