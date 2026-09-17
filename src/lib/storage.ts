import type { Attempt, ExcludeMode, Question } from "./types";

const IMPORTED_KEY = "sat-rw-imported-questions";
const HISTORY_KEY = "sat-rw-history";
const EXCLUDE_KEY = "sat-rw-exclude-mode";
const INCLUDE_SKIPPED_KEY = "sat-rw-include-skipped";

export function loadImportedQuestions(): Question[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(IMPORTED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Question[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveImportedQuestions(questions: Question[]) {
  localStorage.setItem(IMPORTED_KEY, JSON.stringify(questions));
}

export function clearImportedQuestions() {
  localStorage.removeItem(IMPORTED_KEY);
}

export function loadHistory(): Attempt[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Attempt[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveHistory(history: Attempt[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

export function appendAttempt(history: Attempt[], attempt: Attempt) {
  const next = [...history, attempt];
  saveHistory(next);
  return next;
}

export function clearHistory() {
  localStorage.removeItem(HISTORY_KEY);
}

export function loadExcludeMode(): ExcludeMode {
  if (typeof window === "undefined") return "answered";
  const value = localStorage.getItem(EXCLUDE_KEY);
  if (value === "answered" || value === "correct" || value === "none") return value;
  return "answered";
}

export function saveExcludeMode(mode: ExcludeMode) {
  localStorage.setItem(EXCLUDE_KEY, mode);
}

export function loadIncludeSkipped(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(INCLUDE_SKIPPED_KEY) === "true";
}

export function saveIncludeSkipped(value: boolean) {
  localStorage.setItem(INCLUDE_SKIPPED_KEY, String(value));
}

export function latestAttempts(history: Attempt[]) {
  const byId = new Map<string, Attempt>();
  for (const attempt of history) {
    byId.set(attempt.questionId, attempt);
  }
  return byId;
}

export function excludedQuestionIds(
  history: Attempt[],
  mode: ExcludeMode,
  includeSkipped = false,
) {
  const ids = new Set<string>();
  for (const attempt of latestAttempts(history).values()) {
    if (attempt.skipped) {
      if (!includeSkipped) ids.add(attempt.questionId);
      continue;
    }
    if (mode === "answered") ids.add(attempt.questionId);
    if (mode === "correct" && attempt.isCorrect) ids.add(attempt.questionId);
  }
  return ids;
}

export function latestMistakes(history: Attempt[]) {
  return Array.from(latestAttempts(history).values())
    .filter((attempt) => !attempt.skipped && !attempt.isCorrect)
    .sort((a, b) => b.timestamp - a.timestamp);
}

export function clearSkippedAttempts(history: Attempt[]) {
  const next = history.filter((attempt) => !attempt.skipped);
  saveHistory(next);
  return next;
}
