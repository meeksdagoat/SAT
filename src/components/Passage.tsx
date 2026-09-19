import { sanitizePassageHtml } from "@/lib/rich-text";

export function splitPassageParagraphs(input: string) {
  const text = String(input ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
  const parts = text
    .split(/\n\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length ? parts : [text];
}

export function isPoemPassage(input: string) {
  return /\bpoems?\b/i.test(input || "");
}

export function Passage({
  html,
  className,
}: {
  html: string;
  className?: string;
}) {
  const paragraphs = splitPassageParagraphs(html);
  const poem = isPoemPassage(html);
  return (
    <div className={`sat-rich whitespace-pre-wrap ${className ?? ""}`}>
      {paragraphs.map((paragraph, index) => {
        const verse = poem && index > 0;
        const htmlWithBreaks = sanitizePassageHtml(paragraph).replace(/\n/g, "<br />");
        return (
          <p
            key={`${index}-${paragraph.slice(0, 24)}`}
            className={
              verse
                ? "sat-verse mb-3 whitespace-pre-line leading-7 pl-4 sm:pl-6 border-l-2 border-slate-700 last:mb-0"
                : "mb-3 leading-relaxed last:mb-0"
            }
            dangerouslySetInnerHTML={{ __html: htmlWithBreaks }}
          />
        );
      })}
    </div>
  );
}
