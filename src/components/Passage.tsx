import { sanitizePassageHtml } from "@/lib/rich-text";

export function Passage({
  html,
  className,
}: {
  html: string;
  className?: string;
}) {
  return (
    <div
      className={`sat-rich ${className ?? ""}`}
      dangerouslySetInnerHTML={{ __html: sanitizePassageHtml(html) }}
    />
  );
}
