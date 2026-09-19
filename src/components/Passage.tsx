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

export function Passage({
  html,
  className,
}: {
  html: string;
  className?: string;
}) {
  const paragraphs = splitPassageParagraphs(html);
  return (
    <div className={`sat-rich whitespace-pre-wrap ${className ?? ""}`}>
      {paragraphs.map((paragraph, index) => (
        <p
          key={`${index}-${paragraph.slice(0, 24)}`}
          className="mb-3 leading-relaxed last:mb-0"
          dangerouslySetInnerHTML={{ __html: sanitizePassageHtml(paragraph) }}
        />
      ))}
    </div>
  );
}
