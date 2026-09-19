"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { parseRichText, UNDERLINE_CLASS, type RichSpan } from "@/lib/rich-text";

export type HighlightColor = "yellow" | "pink" | "blue";

export interface TextHighlight {
  start: number;
  end: number;
  color: HighlightColor;
}

const COLOR_CLASS: Record<HighlightColor, string> = {
  yellow: "bg-yellow-500/30 text-yellow-100",
  pink: "bg-pink-500/30 text-pink-100",
  blue: "bg-sky-500/30 text-sky-100",
};

function offsetsInRoot(root: HTMLElement, range: Range) {
  if (!root.contains(range.commonAncestorContainer)) return null;
  const pre = range.cloneRange();
  pre.selectNodeContents(root);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  const end = start + range.toString().length;
  if (end <= start) return null;
  return { start, end };
}

function mergeHighlights(list: TextHighlight[], next: TextHighlight): TextHighlight[] {
  const kept = list.filter((item) => item.end <= next.start || item.start >= next.end);
  const overlapping = list.filter((item) => !(item.end <= next.start || item.start >= next.end));
  const pieces: TextHighlight[] = [];
  for (const item of overlapping) {
    if (item.start < next.start) pieces.push({ ...item, end: next.start });
    if (item.end > next.end) pieces.push({ ...item, start: next.end });
  }
  return [...kept, ...pieces, next].sort((a, b) => a.start - b.start);
}

function clearHighlights(list: TextHighlight[], start: number, end: number) {
  const result: TextHighlight[] = [];
  for (const item of list) {
    if (item.end <= start || item.start >= end) {
      result.push(item);
      continue;
    }
    if (item.start < start) result.push({ ...item, end: start });
    if (item.end > end) result.push({ ...item, start: end });
  }
  return result;
}

function decorate(text: string, span: RichSpan | undefined, color?: HighlightColor) {
  let node: ReactNode = text;
  if (span?.italic) node = <i>{node}</i>;
  if (span?.bold) node = <b className="font-semibold">{node}</b>;
  if (span?.underline) node = <u className={UNDERLINE_CLASS}>{node}</u>;
  if (color) node = <mark className={`${COLOR_CLASS[color]} rounded-sm`}>{node}</mark>;
  return node;
}

function renderSpans(spans: RichSpan[], highlights: TextHighlight[], from = 0, to?: number) {
  const plain = spans.map((span) => span.text).join("");
  const endBound = to ?? plain.length;
  const points = new Set<number>([from, endBound]);
  const ranges: { start: number; end: number; span: RichSpan }[] = [];
  let offset = 0;
  for (const span of spans) {
    const start = offset;
    const end = offset + span.text.length;
    ranges.push({ start, end, span });
    if (end > from && start < endBound) {
      points.add(Math.max(from, start));
      points.add(Math.min(endBound, end));
    }
    offset = end;
  }
  for (const item of highlights) {
    points.add(Math.max(from, Math.min(endBound, item.start)));
    points.add(Math.max(from, Math.min(endBound, item.end)));
  }
  const sorted = Array.from(points).sort((a, b) => a - b);
  const parts: ReactNode[] = [];
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (end <= start) continue;
    const span = ranges.find((item) => item.start <= start && item.end >= end)?.span;
    const color = [...highlights].reverse().find((item) => item.start <= start && item.end >= end)?.color;
    parts.push(
      <span key={`${start}-${end}`}>{decorate(plain.slice(start, end), span, color)}</span>,
    );
  }
  return parts;
}

export function HighlightableBlock({
  text,
  highlights,
  onChange,
  className,
}: {
  text: string;
  highlights: TextHighlight[];
  onChange: (next: TextHighlight[]) => void;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [toolbar, setToolbar] = useState<{ top: number; left: number; start: number; end: number } | null>(null);
  const spans = useMemo(() => parseRichText(text), [text]);

  useEffect(() => {
    function hideIfOutside(event: Event) {
      const target = event.target as Node | null;
      if (target && rootRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest("[data-highlight-toolbar]")) return;
      setToolbar(null);
    }
    document.addEventListener("mousedown", hideIfOutside);
    return () => document.removeEventListener("mousedown", hideIfOutside);
  }, []);

  function showToolbar() {
    const root = rootRef.current;
    const selection = window.getSelection();
    if (!root || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setToolbar(null);
      return;
    }
    const range = selection.getRangeAt(0);
    const offsets = offsetsInRoot(root, range);
    if (!offsets) {
      setToolbar(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    setToolbar({
      top: Math.max(8, rect.top - 48),
      left: Math.min(window.innerWidth - 200, Math.max(12, rect.left + rect.width / 2 - 88)),
      start: offsets.start,
      end: offsets.end,
    });
  }

  function apply(color: HighlightColor) {
    if (!toolbar) return;
    onChange(mergeHighlights(highlights, { start: toolbar.start, end: toolbar.end, color }));
    window.getSelection()?.removeAllRanges();
    setToolbar(null);
  }

  function clear() {
    if (!toolbar) return;
    onChange(clearHighlights(highlights, toolbar.start, toolbar.end));
    window.getSelection()?.removeAllRanges();
    setToolbar(null);
  }

  return (
    <div className="relative">
      <div
        ref={rootRef}
        onMouseUp={showToolbar}
        onTouchEnd={() => setTimeout(showToolbar, 50)}
        className={`sat-rich select-text whitespace-pre-wrap ${className ?? ""}`}
      >
        {(() => {
          const verseAt = /\bpoems?\b/i.test(text) ? text.indexOf("\n\n") : -1;
          if (verseAt < 0) return renderSpans(spans, highlights);
          return (
            <>
              {renderSpans(spans, highlights, 0, verseAt)}
              {"\n\n"}
              <div className="sat-verse mt-1 whitespace-pre-line leading-7 pl-4 sm:pl-6 border-l-2 border-slate-700">
                {renderSpans(spans, highlights, verseAt + 2)}
              </div>
            </>
          );
        })()}
      </div>
      {toolbar ? (
        <div
          data-highlight-toolbar
          className="fixed z-40 flex items-center gap-1 rounded-xl border border-slate-600 bg-slate-900 p-1 shadow-xl"
          style={{ top: toolbar.top, left: toolbar.left }}
          onMouseDown={(event) => event.preventDefault()}
        >
          <button
            type="button"
            aria-label="Highlight yellow"
            className="h-9 w-9 rounded-lg bg-yellow-500/30 text-yellow-100"
            onClick={() => apply("yellow")}
          />
          <button
            type="button"
            aria-label="Highlight pink"
            className="h-9 w-9 rounded-lg bg-pink-500/30 text-pink-100"
            onClick={() => apply("pink")}
          />
          <button
            type="button"
            aria-label="Highlight blue"
            className="h-9 w-9 rounded-lg bg-sky-500/30 text-sky-100"
            onClick={() => apply("blue")}
          />
          <button
            type="button"
            aria-label="Clear highlight"
            className="h-9 rounded-lg px-2 text-xs text-slate-300 hover:bg-slate-800"
            onClick={clear}
          >
            Clear
          </button>
        </div>
      ) : null}
    </div>
  );
}
