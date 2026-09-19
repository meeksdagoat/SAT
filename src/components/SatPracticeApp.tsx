"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import seedQuestions from "@/data/questions.json";
import { HighlightableBlock, type TextHighlight } from "@/components/HighlightableBlock";
import { DIFFICULTIES, DOMAINS } from "@/lib/taxonomy";
import {
  appendAttempt,
  clearHistory,
  clearSkippedAttempts,
  excludedQuestionIds,
  latestMistakes,
  loadExcludeMode,
  loadHistory,
  loadImportedQuestions,
  loadIncludeSkipped,
  saveExcludeMode,
  saveIncludeSkipped,
} from "@/lib/storage";
import type { Attempt, ChoiceId, Difficulty, ExcludeMode, Question } from "@/lib/types";
import { Passage } from "@/components/Passage";
import { ensurePassageUnderlines } from "@/lib/underline";

const typedSeed = seedQuestions as Question[];
const SESSION_COUNTS = [10, 20, 50] as const;
const SESSION_MIN = 1;

type DifficultyFilter = Difficulty | "All";
type Screen = "setup" | "practice" | "errors";

function mergeQuestions(seed: Question[], imported: Question[]) {
  const byId = new Map<string, Question>();
  for (const question of seed) byId.set(question.id, ensurePassageUnderlines(question));
  for (const question of imported) byId.set(question.id, ensurePassageUnderlines(question));
  return Array.from(byId.values());
}

function shuffle<T>(items: T[]) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function difficultyTone(difficulty: Difficulty) {
  if (difficulty === "Easy") return "bg-emerald-950/60 text-emerald-200 border-emerald-800";
  if (difficulty === "Medium") return "bg-amber-950/60 text-amber-200 border-amber-800";
  return "bg-rose-950/60 text-rose-200 border-rose-800";
}

function skillsForDomain(domainName: string) {
  return DOMAINS.find((domain) => domain.name === domainName)?.skills ?? [];
}

const TAP =
  "min-h-11 min-h-touch touch-manipulation select-none [-webkit-tap-highlight-color:transparent]";
const NAV_BTN = `${TAP} rounded-xl border border-slate-700 bg-slate-800 px-4 text-sm hover:bg-slate-700 w-full md:w-auto`;
const CHIP = `${TAP} rounded-full border px-4 text-sm`;
const CHECK_LABEL = `${TAP} flex items-center gap-3 text-sm text-slate-300`;

function CompactHeader({
  kicker,
  title,
  subtitle,
  actions,
}: {
  kicker: string;
  title: string;
  subtitle?: string;
  actions: () => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-20 border-b border-slate-700 bg-slate-900/95 pt-safe">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400 sm:text-xs">{kicker}</p>
          <h1 className="truncate text-lg font-semibold sm:text-xl md:text-2xl">{title}</h1>
        </div>
        <div className="hidden items-center gap-2 md:flex">{actions()}</div>
        <button
          type="button"
          className={`${TAP} rounded-xl border border-slate-700 bg-slate-800 px-3 text-sm md:hidden`}
          aria-expanded={open}
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Close" : "Menu"}
        </button>
      </div>
      {subtitle ? (
        <p className="mx-auto max-w-5xl px-4 pb-3 text-sm leading-6 text-slate-300 sm:px-6">{subtitle}</p>
      ) : null}
      {open ? (
        <div className="flex flex-col gap-2 border-t border-slate-700 px-4 py-3 md:hidden">{actions()}</div>
      ) : null}
    </header>
  );
}

export default function SatPracticeApp() {
  const [imported, setImported] = useState<Question[]>([]);
  const [history, setHistory] = useState<Attempt[]>([]);
  const [excludeMode, setExcludeMode] = useState<ExcludeMode>("answered");
  const [includeSkipped, setIncludeSkipped] = useState(false);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [difficulty, setDifficulty] = useState<DifficultyFilter>("All");
  const [errorSkills, setErrorSkills] = useState<string[]>([]);
  const [errorDifficulty, setErrorDifficulty] = useState<DifficultyFilter>("All");
  const [questionCount, setQuestionCount] = useState(10);
  const [screen, setScreen] = useState<Screen>("setup");
  const [session, setSession] = useState<Question[]>([]);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<ChoiceId | null>(null);
  const [sessionAnswers, setSessionAnswers] = useState<Record<string, ChoiceId>>({});
  const [sessionSkipped, setSessionSkipped] = useState<Record<string, true>>({});
  const [sessionHighlights, setSessionHighlights] = useState<
    Record<string, { passage: TextHighlight[]; prompt: TextHighlight[] }>
  >({});
  const [sessionEliminated, setSessionEliminated] = useState<Record<string, ChoiceId[]>>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setImported(loadImportedQuestions());
    setHistory(loadHistory());
    setExcludeMode(loadExcludeMode());
    setIncludeSkipped(loadIncludeSkipped());
    setReady(true);
  }, []);

  const bank = useMemo(() => mergeQuestions(typedSeed, imported), [imported]);
  const blockedIds = useMemo(
    () => excludedQuestionIds(history, excludeMode, includeSkipped),
    [history, excludeMode, includeSkipped],
  );
  const mistakes = useMemo(() => latestMistakes(history), [history]);
  const filteredMistakes = useMemo(() => {
    return mistakes.filter((attempt) => {
      const item = attempt.question;
      const skillOk = errorSkills.length === 0 || errorSkills.includes(item.skill);
      const difficultyOk = errorDifficulty === "All" || item.difficulty === errorDifficulty;
      return skillOk && difficultyOk;
    });
  }, [mistakes, errorSkills, errorDifficulty]);

  const matching = useMemo(() => {
    return bank.filter((question) => {
      const skillOk = selectedSkills.length === 0 || selectedSkills.includes(question.skill);
      const difficultyOk = difficulty === "All" || question.difficulty === difficulty;
      return skillOk && difficultyOk;
    });
  }, [bank, selectedSkills, difficulty]);

  const remaining = useMemo(
    () => matching.filter((question) => !blockedIds.has(question.id)),
    [matching, blockedIds],
  );
  const totalMatchingQuestions = remaining.length;
  const sliderMax = Math.max(SESSION_MIN, totalMatchingQuestions);

  useEffect(() => {
    setQuestionCount((current) => {
      if (totalMatchingQuestions <= 0) return SESSION_MIN;
      return Math.min(Math.max(current, SESSION_MIN), totalMatchingQuestions);
    });
  }, [totalMatchingQuestions]);

  const question = session[index] ? ensurePassageUnderlines(session[index]) : null;
  const exhausted = selectedSkills.length > 0 && matching.length > 0 && remaining.length === 0;

  useEffect(() => {
    if (!question) {
      setPicked(null);
      return;
    }
    setPicked(sessionAnswers[question.id] ?? null);
  }, [question, sessionAnswers]);

  function toggleSkill(skill: string) {
    setSelectedSkills((current) =>
      current.includes(skill) ? current.filter((item) => item !== skill) : [...current, skill],
    );
  }

  function toggleDomain(domainName: string) {
    const skills = [...skillsForDomain(domainName)];
    const allOn = skills.every((skill) => selectedSkills.includes(skill));
    setSelectedSkills((current) => {
      if (allOn) return current.filter((skill) => !(skills as string[]).includes(skill));
      return Array.from(new Set([...current, ...skills]));
    });
  }

  function toggleErrorSkill(skill: string) {
    setErrorSkills((current) =>
      current.includes(skill) ? current.filter((item) => item !== skill) : [...current, skill],
    );
  }

  function toggleErrorDomain(domainName: string) {
    const skills = [...skillsForDomain(domainName)];
    const allOn = skills.every((skill) => errorSkills.includes(skill));
    setErrorSkills((current) => {
      if (allOn) return current.filter((skill) => !(skills as string[]).includes(skill));
      return Array.from(new Set([...current, ...skills]));
    });
  }

  function changeExcludeMode(mode: ExcludeMode) {
    setExcludeMode(mode);
    saveExcludeMode(mode);
  }

  function beginSession(pool: Question[]) {
    if (pool.length === 0) return;
    const limited = pool.slice(0, Math.min(questionCount, pool.length));
    setSession(limited);
    setIndex(0);
    setSessionAnswers({});
    setSessionSkipped({});
    setSessionHighlights({});
    setSessionEliminated({});
    setPicked(null);
    setScreen("practice");
  }

  function startSession() {
    beginSession(shuffle(remaining));
  }

  function retryMissed() {
    const pool = shuffle(filteredMistakes.map((attempt) => attempt.question));
    if (pool.length === 0) return;
    setSession(pool);
    setIndex(0);
    setSessionAnswers({});
    setSessionSkipped({});
    setSessionHighlights({});
    setSessionEliminated({});
    setPicked(null);
    setScreen("practice");
  }

  function submitChoice(choiceId: ChoiceId) {
    if (!question || picked) return;
    const isCorrect = choiceId === question.correctAnswer;
    const attempt: Attempt = {
      questionId: question.id,
      selectedAnswer: choiceId,
      isCorrect,
      skipped: false,
      timestamp: Date.now(),
      question,
    };
    setHistory((current) => appendAttempt(current, attempt));
    setSessionAnswers((current) => ({ ...current, [question.id]: choiceId }));
    setPicked(choiceId);
  }

  function skipQuestion() {
    if (!question || picked || sessionSkipped[question.id]) return;
    const attempt: Attempt = {
      questionId: question.id,
      selectedAnswer: null,
      isCorrect: false,
      skipped: true,
      timestamp: Date.now(),
      question,
    };
    setHistory((current) => appendAttempt(current, attempt));
    setSessionSkipped((current) => ({ ...current, [question.id]: true }));
    if (index < session.length - 1) {
      setIndex(index + 1);
    }
  }

  function go(delta: number) {
    setIndex((current) => Math.min(Math.max(current + delta, 0), session.length - 1));
  }

  function toggleEliminated(choiceId: ChoiceId) {
    if (!question) return;
    setSessionEliminated((current) => {
      const list = current[question.id] ?? [];
      const next = list.includes(choiceId)
        ? list.filter((id) => id !== choiceId)
        : [...list, choiceId];
      return { ...current, [question.id]: next };
    });
  }

  function updateHighlights(field: "passage" | "prompt", next: TextHighlight[]) {
    if (!question) return;
    setSessionHighlights((current) => ({
      ...current,
      [question.id]: {
        passage: current[question.id]?.passage ?? [],
        prompt: current[question.id]?.prompt ?? [],
        [field]: next,
      },
    }));
  }

  if (!ready) {
    return (
      <div className="min-h-dvh bg-slate-900 text-white flex items-center justify-center px-4">
        Loading practice set…
      </div>
    );
  }

  function errorLogButton() {
    return (
      <button
        type="button"
        onClick={() => setScreen("errors")}
        className={NAV_BTN}
      >
        Error Log{mistakes.length > 0 ? ` (${mistakes.length})` : ""}
      </button>
    );
  }

  if (screen === "errors") {
    return (
      <div className="min-h-dvh overflow-x-hidden bg-slate-900 text-white">
        <CompactHeader
          kicker="SAT Practice"
          title="Error log"
          actions={() => (
            <>
              <button
                type="button"
                onClick={() => {
                  clearHistory();
                  setHistory([]);
                }}
                className={NAV_BTN}
              >
                Clear History
              </button>
              <button
                type="button"
                disabled={filteredMistakes.length === 0}
                onClick={retryMissed}
                className={`${TAP} w-full rounded-xl bg-emerald-700 px-4 text-sm hover:bg-emerald-600 disabled:opacity-40 md:w-auto`}
              >
                Retry Missed Questions
              </button>
              <button
                type="button"
                onClick={() => setScreen(session.length ? "practice" : "setup")}
                className={NAV_BTN}
              >
                Back
              </button>
            </>
          )}
        />
        <main className="touch-scroll mx-auto max-w-4xl space-y-4 px-4 py-5 pb-safe sm:px-6 sm:py-6">
          {mistakes.length === 0 ? (
            <div className="rounded-2xl border border-slate-700 bg-slate-800 p-8 text-slate-300">
              No missed questions yet. Incorrect answers will appear here automatically.
            </div>
          ) : (
            <>
              <section className="rounded-2xl border border-slate-700 bg-slate-800 p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-semibold">Filter missed questions</h2>
                  <button
                    type="button"
                    className={`${TAP} rounded-xl px-3 text-sm text-slate-400 hover:text-white`}
                    onClick={() => {
                      setErrorSkills([]);
                      setErrorDifficulty("All");
                    }}
                  >
                    Reset filters
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:gap-4">
                  {DOMAINS.map((domain) => {
                    const skills = [...domain.skills];
                    const allOn = skills.every((skill) => errorSkills.includes(skill));
                    return (
                      <div key={domain.name} className="rounded-xl border border-slate-700 bg-slate-900/50 p-3 sm:p-4">
                        <label className={`${CHECK_LABEL} font-medium text-white`}>
                          <input
                            type="checkbox"
                            checked={allOn && skills.length > 0}
                            onChange={() => toggleErrorDomain(domain.name)}
                            className="h-5 w-5 shrink-0 accent-emerald-500"
                          />
                          <span className="break-words">{domain.name}</span>
                        </label>
                        <div className="space-y-1 pl-1">
                          {skills.map((skill) => (
                            <label key={skill} className={CHECK_LABEL}>
                              <input
                                type="checkbox"
                                checked={errorSkills.includes(skill)}
                                onChange={() => toggleErrorSkill(skill)}
                                className="h-5 w-5 shrink-0 accent-emerald-500"
                              />
                              <span className="break-words">{skill}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div>
                  <p className="mb-2 text-xs uppercase tracking-wide text-slate-400">Difficulty</p>
                  <div className="flex flex-wrap gap-2">
                    {(["All", ...DIFFICULTIES] as DifficultyFilter[]).map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setErrorDifficulty(option)}
                        className={`${CHIP} ${
                          errorDifficulty === option
                            ? "border-white bg-slate-700"
                            : "border-slate-600 text-slate-300"
                        }`}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="text-sm text-slate-300">
                  Showing {filteredMistakes.length} of {mistakes.length} missed questions
                </p>
              </section>
              {filteredMistakes.length === 0 ? (
                <div className="rounded-2xl border border-slate-700 bg-slate-800 p-8 text-slate-300">
                  No missed questions match your selected filters.
                </div>
              ) : (
                filteredMistakes.map((attempt) => {
                  const item = ensurePassageUnderlines(attempt.question);
                  return (
                    <article key={`${attempt.questionId}-${attempt.timestamp}`} className="rounded-2xl border border-slate-700 bg-slate-800 p-4 space-y-4 sm:p-6">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm uppercase tracking-wide text-slate-400 break-words">
                            {item.skill}: {item.difficulty}
                          </p>
                          <p className="text-sm text-slate-400 break-words">{item.domain}</p>
                        </div>
                        <span className={`rounded-full border px-3 py-1 text-xs ${difficultyTone(item.difficulty)}`}>
                          {item.difficulty}
                        </span>
                      </div>
                      <Passage
                        html={item.passage}
                        className="whitespace-pre-wrap break-words leading-7 text-slate-100 sm:leading-8"
                      />
                      <p className="font-medium leading-7">{item.prompt}</p>
                      <div className="space-y-3">
                        {item.choices.map((choice) => (
                          <div
                            key={choice.id}
                            className={`rounded-xl border p-4 ${
                              choice.id === item.correctAnswer
                                ? "bg-emerald-950/40 border-emerald-500 text-emerald-200"
                                : choice.id === attempt.selectedAnswer
                                  ? "border-rose-500/80 bg-rose-950/20"
                                  : "border-slate-700 bg-slate-900/40 text-slate-200"
                            }`}
                          >
                            <p className="text-lg font-bold leading-7">
                              {choice.id}. {choice.text}
                            </p>
                            <p className="mt-2 text-sm leading-7 opacity-90">{item.explanations[choice.id]}</p>
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-slate-500">
                        {new Date(attempt.timestamp).toLocaleString()}
                      </p>
                    </article>
                  );
                })
              )}
            </>
          )}
        </main>
      </div>
    );
  }

  if (screen === "setup") {
    const canStart = selectedSkills.length > 0 && remaining.length > 0;
    return (
      <div className="min-h-dvh overflow-x-hidden bg-slate-900 text-white">
        <CompactHeader
          kicker="SAT Reading and Writing"
          title="Practice setup"
          subtitle={`Choose domains, difficulty, and session length. ${bank.length.toLocaleString()} questions are loaded.`}
          actions={() => errorLogButton()}
        />

        <main className="touch-scroll mx-auto max-w-5xl space-y-5 px-4 py-5 pb-safe sm:px-6 sm:py-8 sm:space-y-6">
          <section className="rounded-2xl border border-slate-700 bg-slate-800 p-4 sm:p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Domains & skills</h2>
              <button
                type="button"
                className={`${TAP} rounded-xl px-3 text-sm text-slate-400 hover:text-white`}
                onClick={() => setSelectedSkills([])}
              >
                Clear skills
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:gap-4">
              {DOMAINS.map((domain) => {
                const skills = [...domain.skills];
                const allOn = skills.every((skill) => selectedSkills.includes(skill));
                return (
                  <div key={domain.name} className="rounded-xl border border-slate-700 bg-slate-900/50 p-3 sm:p-4">
                    <label className={`${CHECK_LABEL} font-medium text-white`}>
                      <input
                        type="checkbox"
                        checked={allOn}
                        onChange={() => toggleDomain(domain.name)}
                        className="h-5 w-5 shrink-0 accent-emerald-500"
                      />
                      <span className="break-words">{domain.name}</span>
                    </label>
                    <div className="space-y-1 pl-1">
                      {skills.map((skill) => (
                        <label key={skill} className={CHECK_LABEL}>
                          <input
                            type="checkbox"
                            checked={selectedSkills.includes(skill)}
                            onChange={() => toggleSkill(skill)}
                            className="h-5 w-5 shrink-0 accent-emerald-500"
                          />
                          <span className="break-words">{skill}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
            <div className="rounded-2xl border border-slate-700 bg-slate-800 p-4 sm:p-6">
              <h2 className="mb-4 text-lg font-semibold">Difficulty</h2>
              <div className="flex flex-wrap gap-2">
                {(["All", ...DIFFICULTIES] as DifficultyFilter[]).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setDifficulty(option)}
                    className={`${CHIP} ${
                      difficulty === option
                        ? "border-white bg-slate-700"
                        : "border-slate-600 text-slate-300"
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-700 bg-slate-800 p-4 sm:p-6">
              <h2 className="mb-4 text-lg font-semibold">Session length</h2>
              <div className="flex flex-wrap gap-2">
                {SESSION_COUNTS.map((count) => (
                  <button
                    key={count}
                    type="button"
                    onClick={() => setQuestionCount(Math.min(count, sliderMax))}
                    className={`${CHIP} ${
                      questionCount === count
                        ? "border-white bg-slate-700"
                        : "border-slate-600 text-slate-300"
                    }`}
                  >
                    {count}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setQuestionCount(sliderMax)}
                  className={`${CHIP} ${
                    totalMatchingQuestions > 0 && questionCount === sliderMax
                      ? "border-white bg-slate-700"
                      : "border-slate-600 text-slate-300"
                  }`}
                >
                  All matching
                </button>
              </div>
              <div className="mt-5 space-y-3">
                <div className="flex items-baseline justify-between gap-3">
                  <label htmlFor="session-length" className="text-sm text-slate-400">
                    Custom length
                  </label>
                  <p className="text-sm font-medium text-slate-100">
                    Selected:{" "}
                    {(totalMatchingQuestions === 0
                      ? 0
                      : Math.min(questionCount, sliderMax)
                    ).toLocaleString()}{" "}
                    / {totalMatchingQuestions.toLocaleString()} questions
                  </p>
                </div>
                <input
                  id="session-length"
                  type="range"
                  min={SESSION_MIN}
                  max={sliderMax}
                  value={Math.min(questionCount, sliderMax)}
                  disabled={totalMatchingQuestions === 0}
                  onChange={(event) => setQuestionCount(Number(event.target.value))}
                  className="sat-slider w-full"
                  aria-valuemin={SESSION_MIN}
                  aria-valuemax={sliderMax}
                  aria-valuenow={Math.min(questionCount, sliderMax)}
                  aria-label="Session question count"
                />
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-700 bg-slate-800 p-4 sm:p-6">
            <h2 className="mb-4 text-lg font-semibold">Exclude from new sessions</h2>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["answered", "All answered"],
                  ["correct", "Correct only"],
                  ["none", "Don't exclude"],
                ] as [ExcludeMode, string][]
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => changeExcludeMode(mode)}
                  className={`${CHIP} ${
                    excludeMode === mode
                      ? "border-white bg-slate-700"
                      : "border-slate-600 text-slate-300"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className={`${CHECK_LABEL} mt-4`}>
              <input
                type="checkbox"
                checked={includeSkipped}
                onChange={() => {
                  const next = !includeSkipped;
                  setIncludeSkipped(next);
                  saveIncludeSkipped(next);
                }}
                className="h-5 w-5 shrink-0 accent-emerald-500"
              />
              Include skipped questions
            </label>
            <button
              type="button"
              onClick={() => setHistory(clearSkippedAttempts(history))}
              className={`${TAP} mt-2 rounded-xl px-3 text-sm text-slate-400 hover:text-white`}
            >
              Clear skipped questions
            </button>
          </section>

          {exhausted && (
            <div className="rounded-2xl border border-amber-600/70 bg-amber-950/40 p-4 text-amber-100 sm:p-5">
              You have answered every matching question in this filter
              {excludeMode === "correct" ? " correctly" : ""}. Clear history, change the exclude setting, or pick another skill to continue.
            </div>
          )}

          <div className="flex flex-col gap-3 rounded-2xl border border-slate-700 bg-slate-800 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <p className="text-slate-300">
              {selectedSkills.length === 0
                ? "Select at least one skill to start."
                : exhausted
                  ? `${matching.length.toLocaleString()} matching · 0 remaining`
                  : `${remaining.length.toLocaleString()} remaining of ${matching.length.toLocaleString()} matching`}
            </p>
            <button
              type="button"
              disabled={!canStart}
              onClick={startSession}
              className={`${TAP} w-full rounded-xl bg-emerald-600 px-5 font-medium hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto`}
            >
              Start Practice Session
            </button>
          </div>
        </main>
      </div>
    );
  }

  const answeredCount = session.filter((item) => sessionAnswers[item.id]).length;
  const correctCount = session.filter(
    (item) => sessionAnswers[item.id] === item.correctAnswer,
  ).length;

  return (
    <div className="min-h-dvh overflow-x-hidden bg-slate-900 text-white">
      <CompactHeader
        kicker="SAT Practice"
        title="Reading and Writing"
        actions={() => (
          <>
            <span className="px-1 text-sm text-slate-300 md:px-0">
              {answeredCount}/{session.length} answered · {correctCount} correct
            </span>
            {errorLogButton()}
            <button
              type="button"
              onClick={() => setScreen("setup")}
              className={NAV_BTN}
            >
              Change Filters / Setup
            </button>
          </>
        )}
      />

      <main className="touch-scroll mx-auto max-w-4xl space-y-4 px-4 py-5 sm:px-6 sm:py-6">
        {!question ? (
          <div className="rounded-2xl border border-slate-700 bg-slate-800 p-6 text-slate-300 sm:p-8">
            No questions in this session.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm uppercase tracking-wide text-slate-400 break-words">
                  {question.skill}: {question.difficulty}
                </p>
                <p className="text-sm text-slate-400 break-words">{question.domain}</p>
              </div>
              <span className={`rounded-full border px-3 py-1 text-xs ${difficultyTone(question.difficulty)}`}>
                {question.difficulty}
              </span>
            </div>

            <article className="touch-scroll rounded-2xl border border-slate-700 bg-slate-800 p-4 shadow-lg shadow-black/20 sm:p-6">
              <p className="mb-3 text-xs text-slate-500">Select passage text to highlight</p>
              <HighlightableBlock
                text={question.passage}
                highlights={sessionHighlights[question.id]?.passage ?? []}
                onChange={(next) => updateHighlights("passage", next)}
                className="whitespace-pre-wrap break-words leading-7 text-slate-100 sm:leading-8"
              />
              <HighlightableBlock
                text={question.prompt}
                highlights={sessionHighlights[question.id]?.prompt ?? []}
                onChange={(next) => updateHighlights("prompt", next)}
                className="mt-5 font-medium leading-7 break-words text-white sm:mt-6"
              />
            </article>

            <div className="space-y-3">
              {question.choices.map((choice) => {
                const isCorrect = choice.id === question.correctAnswer;
                const isSelected = picked === choice.id;
                const revealed = Boolean(picked);
                const eliminated = (sessionEliminated[question.id] ?? []).includes(choice.id);
                let className = `choice-tap min-h-11 flex-1 text-left rounded-2xl border border-slate-700 bg-slate-800 p-4 transition hover:border-slate-500 ${TAP}`;
                if (revealed && isCorrect) {
                  className = `choice-tap min-h-11 flex-1 text-left rounded-2xl border bg-emerald-950/40 border-emerald-500 text-emerald-200 p-4 ${TAP}`;
                } else if (revealed && isSelected && !isCorrect) {
                  className = `choice-tap min-h-11 flex-1 text-left rounded-2xl border border-rose-500/80 bg-rose-950/30 text-rose-100 p-4 ${TAP}`;
                }
                return (
                  <div key={choice.id} className="flex items-stretch gap-2">
                    <button
                      type="button"
                      disabled={Boolean(picked)}
                      onClick={() => submitChoice(choice.id)}
                      className={className}
                    >
                      <div className="flex gap-3 items-start">
                        <span
                          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-current text-sm font-semibold ${
                            eliminated ? "opacity-40" : ""
                          }`}
                        >
                          {revealed && isCorrect ? "✓" : choice.id}
                        </span>
                        <span className={`leading-7 break-words pt-2 ${eliminated ? "line-through opacity-40" : ""}`}>
                          {choice.text}
                        </span>
                      </div>
                    </button>
                    <button
                      type="button"
                      aria-label={eliminated ? `Restore choice ${choice.id}` : `Eliminate choice ${choice.id}`}
                      aria-pressed={eliminated}
                      onClick={() => toggleEliminated(choice.id)}
                      className={`${TAP} w-11 shrink-0 rounded-xl border px-0 ${
                        eliminated
                          ? "border-slate-500 bg-slate-800 text-slate-400"
                          : "border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800"
                      }`}
                    >
                      <span className={`text-sm font-semibold ${eliminated ? "line-through opacity-70" : ""}`}>
                        {choice.id}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>

            {picked && (
              <section className="rounded-2xl border border-slate-700 bg-slate-800 p-4 space-y-4 sm:p-6">
                <h2 className="text-lg font-semibold">
                  {picked === question.correctAnswer ? "Correct" : "Incorrect"} · Why each choice
                </h2>
                {question.choices.map((choice) => (
                  <div
                    key={choice.id}
                    className={`rounded-xl border p-4 ${
                      choice.id === question.correctAnswer
                        ? "bg-emerald-950/40 border-emerald-500 text-emerald-200"
                        : picked === choice.id
                          ? "border-rose-500/80 bg-rose-950/20"
                          : "border-slate-700 bg-slate-900/40 text-slate-200"
                    }`}
                  >
                    <p className="mb-1 text-base font-bold leading-7 break-words">
                      {choice.id}. {choice.text}
                    </p>
                    <p className="text-sm leading-7">{question.explanations[choice.id]}</p>
                  </div>
                ))}
              </section>
            )}

            <div className="sticky bottom-0 z-10 -mx-4 mt-4 border-t border-slate-800 bg-slate-900/95 px-4 py-3 pb-safe sm:-mx-6 sm:px-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="order-first text-center text-sm text-slate-400 sm:order-none">
                  {index + 1} of {session.length}
                  {question && sessionSkipped[question.id] ? " · Skipped" : ""}
                </p>
                <button
                  type="button"
                  onClick={() => go(-1)}
                  disabled={index === 0}
                  className={`${NAV_BTN} order-2 sm:order-none`}
                >
                  Previous
                </button>
                <div className="order-1 grid grid-cols-2 gap-2 sm:order-none sm:flex">
                  <button
                    type="button"
                    onClick={skipQuestion}
                    disabled={!question || Boolean(picked) || Boolean(question && sessionSkipped[question.id])}
                    className={`${TAP} rounded-xl border border-slate-600 px-4 text-slate-300 hover:bg-slate-800 disabled:opacity-40`}
                  >
                    Skip
                  </button>
                  <button
                    type="button"
                    onClick={() => go(1)}
                    disabled={index >= session.length - 1}
                    className={NAV_BTN}
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
