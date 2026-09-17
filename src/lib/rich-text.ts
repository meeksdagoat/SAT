export const UNDERLINE_CLASS =
  "underline decoration-sky-400 decoration-2 underline-offset-4 font-semibold text-sky-200";

export interface RichSpan {
  text: string;
  underline?: boolean;
  bold?: boolean;
  italic?: boolean;
}

const ALLOWED = new Set(["u", "ins", "b", "strong", "i", "em"]);

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, "\u00a0")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function markupToHtml(input: string) {
  let text = String(input ?? "");
  text = text.replace(/&lt;(\/?u|\/?ins|\/?b|\/?strong|\/?i|\/?em)\b[^&]*&gt;/gi, (_, tag: string) => {
    const name = tag.replace(/^\//, "").toLowerCase();
    return tag.startsWith("/") ? `</${name}>` : `<${name}>`;
  });
  text = text.replace(/\[u\]/gi, "<u>").replace(/\[\/u\]/gi, "</u>");
  text = text.replace(/\[ins\]/gi, "<u>").replace(/\[\/ins\]/gi, "</u>");
  text = text.replace(/_{4,}/g, "<u>\u00a0\u00a0\u00a0\u00a0</u>");
  text = text.replace(/__([^_\n]+)__/g, "<u>$1</u>");
  text = text.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
  text = text.replace(
    /(^|[\s([{"'])_([^_\s][^_\n]*[^_\s]|[^_\s])_(?=[\s)\].,;:!?}'"]|$)/g,
    "$1<u>$2</u>",
  );
  text = text.replace(/\*([^*\n]+)\*/g, "<i>$1</i>");
  return text;
}

export function parseRichText(input: string): RichSpan[] {
  const html = markupToHtml(input);
  const spans: RichSpan[] = [];
  const stack: string[] = [];
  const tagRe = /<\/?([a-z]+)(?:\s[^>]*)?>/gi;

  function flags() {
    const tags = new Set(stack);
    return {
      underline: tags.has("u") || tags.has("ins"),
      bold: tags.has("b") || tags.has("strong"),
      italic: tags.has("i") || tags.has("em"),
    };
  }

  function push(raw: string) {
    const text = decodeEntities(raw);
    if (!text) return;
    const next = flags();
    const prev = spans[spans.length - 1];
    if (
      prev &&
      Boolean(prev.underline) === next.underline &&
      Boolean(prev.bold) === next.bold &&
      Boolean(prev.italic) === next.italic
    ) {
      prev.text += text;
      return;
    }
    spans.push({ text, ...next });
  }

  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(html))) {
    push(html.slice(last, match.index));
    const name = match[1].toLowerCase();
    if (ALLOWED.has(name)) {
      if (match[0][1] === "/") {
        const index = stack.lastIndexOf(name);
        if (index >= 0) stack.splice(index, 1);
      } else {
        stack.push(name);
      }
    } else {
      push(match[0]);
    }
    last = match.index + match[0].length;
  }
  push(html.slice(last));
  return spans.length ? spans : [{ text: "" }];
}

export function richTextPlain(input: string) {
  return parseRichText(input)
    .map((span) => span.text)
    .join("");
}
