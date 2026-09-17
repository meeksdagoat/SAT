"use client";

import { useEffect, useRef, useState } from "react";

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

function segments(text: string, highlights: TextHighlight[]) {
  const points = new Set<number>([0, text.length]);
  for (const item of highlights) {
    points.add(Math.max(0, Math.min(text.length, item.start)));
    points.add(Math.max(0, Math.min(text.length, item.end)));
  }
  const sorted = Array.from(points).sort((a, b) => a - b);
  const parts: { text: string; color?: HighlightColor }[] = [];
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (end <= start) continue;
    const match = [...highlights].reverse().find((item) => item.start <= start && item.end >= end);
    parts.push({ text: text.slice(start, end), color: match?.color });
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
        className={`select-text ${className ?? ""}`}
      >
        {segments(text, highlights).map((part, index) =>
          part.color ? (
            <mark key={`${index}-${part.text.slice(0, 8)}`} className={`${COLOR_CLASS[part.color]} rounded-sm`}>
              {part.text}
            </mark>
          ) : (
            <span key={`${index}-${part.text.slice(0, 8)}`}>{part.text}</span>
          ),
        )}
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
