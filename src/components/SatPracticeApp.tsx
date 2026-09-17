"use client";

import { useEffect, useMemo, useState } from "react";
import seedQuestions from "@/data/questions.json";
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

const typedSeed = seedQuestions as Question[];
const SESSION_COUNTS = [10, 20, 50] as const;

type DifficultyFilter = Difficulty | "All";
type QuestionCount = (typeof SESSION_COUNTS)[number] | "all";
type Screen = "setup" | "practice" | "errors";

function mergeQuestions(seed: Question[], imported: Question[]) {
  const byId = new Map<string, Question>();
  for (const question of seed) byId.set(question.id, question);
  for (const question of imported) byId.set(question.id, question);
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

export default function SatPracticeApp() {
  const [imported, setImported] = useState<Question[]>([]);
  const [history, setHistory] = useState<Attempt[]>([]);
  const [excludeMode, setExcludeMode] = useState<ExcludeMode>("answered");
  const [includeSkipped, setIncludeSkipped] = useState(false);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [difficulty, setDifficulty] = useState<DifficultyFilter>("All");
  const [errorSkills, setErrorSkills] = useState<string[]>([]);
  const [errorDifficulty, setErrorDifficulty] = useState<DifficultyFilter>("All");
  const [questionCount, setQuestionCount] = useState<QuestionCount>(10);
  const [screen, setScreen] = useState<Screen>("setup");
  const [session, setSession] = useState<Question[]>([]);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<ChoiceId | null>(null);
  const [sessionAnswers, setSessionAnswers] = useState<Record<string, ChoiceId>>({});
  const [sessionSkipped, setSessionSkipped] = useState<Record<string, true>>({});
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

  const question = session[index] ?? null;
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
    const limited = questionCount === "all" ? pool : pool.slice(0, questionCount);
    setSession(limited);
    setIndex(0);
    setSessionAnswers({});
    setSessionSkipped({});
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

  if (!ready) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
        Loading practice set…
      </div>
    );
  }

  const errorLogButton = (
    <button
      type="button"
      onClick={() => setScreen("errors")}
      className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm hover:bg-slate-700"
    >
      Error Log{mistakes.length > 0 ? ` (${mistakes.length})` : ""}
    </button>
  );

  if (screen === "errors") {
    return (
      <div className="min-h-screen bg-slate-900 text-white">
        <header className="sticky top-0 z-20 border-b border-slate-700 bg-slate-900/95">
          <div className="mx-auto max-w-4xl px-4 py-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">SAT Practice</p>
              <h1 className="text-xl font-semibold">Error log</h1>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  clearHistory();
                  setHistory([]);
                }}
                className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm hover:bg-slate-700"
              >
                Clear History
              </button>
              <button
                type="button"
                disabled={filteredMistakes.length === 0}
                onClick={retryMissed}
                className="rounded-xl bg-emerald-700 px-3 py-2 text-sm hover:bg-emerald-600 disabled:opacity-40"
              >
                Retry Missed Questions
              </button>
              <button
                type="button"
                onClick={() => setScreen(session.length ? "practice" : "setup")}
                className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm hover:bg-slate-700"
              >
                Back
              </button>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-4xl px-4 py-6 space-y-4">
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
                    className="text-sm text-slate-400 hover:text-white"
                    onClick={() => {
                      setErrorSkills([]);
                      setErrorDifficulty("All");
                    }}
                  >
                    Reset filters
                  </button>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {DOMAINS.map((domain) => {
                    const skills = [...domain.skills];
                    const allOn = skills.every((skill) => errorSkills.includes(skill));
                    return (
                      <div key={domain.name} className="rounded-xl border border-slate-700 bg-slate-900/50 p-3">
                        <label className="mb-2 flex items-center gap-2 text-sm font-medium">
                          <input
                            type="checkbox"
                            checked={allOn && skills.length > 0}
                            onChange={() => toggleErrorDomain(domain.name)}
                            className="accent-emerald-500"
                          />
                          {domain.name}
                        </label>
                        <div className="space-y-1 pl-1">
                          {skills.map((skill) => (
                            <label key={skill} className="flex items-center gap-2 text-sm text-slate-300">
                              <input
                                type="checkbox"
                                checked={errorSkills.includes(skill)}
                                onChange={() => toggleErrorSkill(skill)}
                                className="accent-emerald-500"
                              />
                              {skill}
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
                        className={`rounded-full border px-3 py-1.5 text-sm ${
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
                  const item = attempt.question;
                  return (
                    <article key={`${attempt.questionId}-${attempt.timestamp}`} className="rounded-2xl border border-slate-700 bg-slate-800 p-6 space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm uppercase tracking-wide text-slate-400">
                            {item.skill}: {item.difficulty}
                          </p>
                          <p className="text-sm text-slate-400">{item.domain}</p>
                        </div>
                        <span className={`rounded-full border px-3 py-1 text-xs ${difficultyTone(item.difficulty)}`}>
                          {item.difficulty}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap leading-8 text-slate-100">{item.passage}</p>
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
                              {choice.id === item.correctAnswer ? " · Correct" : ""}
                              {choice.id === attempt.selectedAnswer && choice.id !== item.correctAnswer
                                ? " · Your choice"
                                : ""}
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
      <div className="min-h-screen bg-slate-900 text-white">
        <header className="border-b border-slate-700">
          <div className="mx-auto max-w-5xl px-4 py-6 flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-slate-400">SAT Reading and Writing</p>
              <h1 className="mt-2 text-3xl font-semibold">Practice setup</h1>
              <p className="mt-2 max-w-2xl text-slate-300">
                Choose domains, difficulty, and session length. {bank.length.toLocaleString()} questions are loaded.
              </p>
            </div>
            {errorLogButton}
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-4 py-8 space-y-6">
          <section className="rounded-2xl border border-slate-700 bg-slate-800 p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Domains & skills</h2>
              <button
                type="button"
                className="text-sm text-slate-400 hover:text-white"
                onClick={() => setSelectedSkills([])}
              >
                Clear skills
              </button>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {DOMAINS.map((domain) => {
                const skills = [...domain.skills];
                const allOn = skills.every((skill) => selectedSkills.includes(skill));
                return (
                  <div key={domain.name} className="rounded-xl border border-slate-700 bg-slate-900/50 p-4">
                    <label className="mb-3 flex items-center gap-2 font-medium">
                      <input
                        type="checkbox"
                        checked={allOn}
                        onChange={() => toggleDomain(domain.name)}
                        className="accent-emerald-500"
                      />
                      {domain.name}
                    </label>
                    <div className="space-y-2 pl-1">
                      {skills.map((skill) => (
                        <label key={skill} className="flex items-center gap-2 text-sm text-slate-300">
                          <input
                            type="checkbox"
                            checked={selectedSkills.includes(skill)}
                            onChange={() => toggleSkill(skill)}
                            className="accent-emerald-500"
                          />
                          {skill}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="grid gap-6 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-700 bg-slate-800 p-6">
              <h2 className="mb-4 text-lg font-semibold">Difficulty</h2>
              <div className="flex flex-wrap gap-2">
                {(["All", ...DIFFICULTIES] as DifficultyFilter[]).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setDifficulty(option)}
                    className={`rounded-full border px-4 py-2 text-sm ${
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
            <div className="rounded-2xl border border-slate-700 bg-slate-800 p-6">
              <h2 className="mb-4 text-lg font-semibold">Session length</h2>
              <div className="flex flex-wrap gap-2">
                {SESSION_COUNTS.map((count) => (
                  <button
                    key={count}
                    type="button"
                    onClick={() => setQuestionCount(count)}
                    className={`rounded-full border px-4 py-2 text-sm ${
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
                  onClick={() => setQuestionCount("all")}
                  className={`rounded-full border px-4 py-2 text-sm ${
                    questionCount === "all"
                      ? "border-white bg-slate-700"
                      : "border-slate-600 text-slate-300"
                  }`}
                >
                  All matching
                </button>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-700 bg-slate-800 p-6">
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
                  className={`rounded-full border px-4 py-2 text-sm ${
                    excludeMode === mode
                      ? "border-white bg-slate-700"
                      : "border-slate-600 text-slate-300"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="mt-4 flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={includeSkipped}
                onChange={() => {
                  const next = !includeSkipped;
                  setIncludeSkipped(next);
                  saveIncludeSkipped(next);
                }}
                className="accent-emerald-500"
              />
              Include skipped questions
            </label>
            <button
              type="button"
              onClick={() => setHistory(clearSkippedAttempts(history))}
              className="mt-3 text-sm text-slate-400 hover:text-white"
            >
              Clear skipped questions
            </button>
          </section>

          {exhausted && (
            <div className="rounded-2xl border border-amber-600/70 bg-amber-950/40 p-5 text-amber-100">
              You have answered every matching question in this filter
              {excludeMode === "correct" ? " correctly" : ""}. Clear history, change the exclude setting, or pick another skill to continue.
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-700 bg-slate-800 p-6">
            <p className="text-slate-300">
              {selectedSkills.length === 0
                ? "Select at least one skill to start."
                : exhausted
                  ? `${matching.length.toLocaleString()} matching · 0 remaining`
                  : `${remaining.length.toLocaleString()} remaining of ${matching.length.toLocaleString()} matching`}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!canStart}
                onClick={startSession}
                className="rounded-xl bg-emerald-600 px-5 py-3 font-medium hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Start Practice Session
              </button>
            </div>
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
    <div className="min-h-screen bg-slate-900 text-white">
      <header className="sticky top-0 z-20 border-b border-slate-700 bg-slate-900/95">
        <div className="mx-auto max-w-4xl px-4 py-4 flex flex-wrap items-center gap-3 justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">SAT Practice</p>
            <h1 className="text-xl font-semibold">Reading and Writing</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-slate-300">
              {answeredCount}/{session.length} answered · {correctCount} correct
            </span>
            {errorLogButton}
            <button
              type="button"
              onClick={() => setScreen("setup")}
              className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm hover:bg-slate-700"
            >
              Change Filters / Setup
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6 space-y-4">
        {!question ? (
          <div className="rounded-2xl border border-slate-700 bg-slate-800 p-8 text-slate-300">
            No questions in this session.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm uppercase tracking-wide text-slate-400">
                  {question.skill}: {question.difficulty}
                </p>
                <p className="text-sm text-slate-400">{question.domain}</p>
              </div>
              <span className={`rounded-full border px-3 py-1 text-xs ${difficultyTone(question.difficulty)}`}>
                {question.difficulty}
              </span>
            </div>

            <article className="rounded-2xl border border-slate-700 bg-slate-800 p-6 shadow-lg shadow-black/20">
              <p className="whitespace-pre-wrap leading-8 text-slate-100">{question.passage}</p>
              <p className="mt-6 font-medium leading-7 text-white">{question.prompt}</p>
            </article>

            <div className="space-y-3">
              {question.choices.map((choice) => {
                const isCorrect = choice.id === question.correctAnswer;
                const isSelected = picked === choice.id;
                const revealed = Boolean(picked);
                let className =
                  "w-full text-left rounded-2xl border border-slate-700 bg-slate-800 p-4 transition hover:border-slate-500";
                if (revealed && isCorrect) {
                  className =
                    "w-full text-left rounded-2xl border bg-emerald-950/40 border-emerald-500 text-emerald-200 p-4";
                } else if (revealed && isSelected && !isCorrect) {
                  className =
                    "w-full text-left rounded-2xl border border-rose-500/80 bg-rose-950/30 text-rose-100 p-4";
                }
                return (
                  <button
                    key={choice.id}
                    type="button"
                    disabled={Boolean(picked)}
                    onClick={() => submitChoice(choice.id)}
                    className={className}
                  >
                    <div className="flex gap-3 items-start">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-current text-sm font-semibold">
                        {revealed && isCorrect ? "✓" : choice.id}
                      </span>
                      <span className="leading-7">{choice.text}</span>
                    </div>
                  </button>
                );
              })}
            </div>

            {picked && (
              <section className="rounded-2xl border border-slate-700 bg-slate-800 p-6 space-y-4">
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
                    <p className="mb-1 font-medium">
                      {choice.id}
                      {choice.id === question.correctAnswer ? " · Correct" : ""}
                      {picked === choice.id && choice.id !== question.correctAnswer ? " · Your choice" : ""}
                    </p>
                    <p className="text-sm leading-7">{question.explanations[choice.id]}</p>
                  </div>
                ))}
              </section>
            )}

            <div className="flex items-center justify-between gap-3 pt-2">
              <button
                type="button"
                onClick={() => go(-1)}
                disabled={index === 0}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 disabled:opacity-40"
              >
                Previous
              </button>
              <p className="text-sm text-slate-400">
                {index + 1} of {session.length}
                {question && sessionSkipped[question.id] ? " · Skipped" : ""}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={skipQuestion}
                  disabled={!question || Boolean(picked) || Boolean(question && sessionSkipped[question.id])}
                  className="rounded-xl border border-slate-600 px-4 py-2 text-slate-300 hover:bg-slate-800 disabled:opacity-40"
                >
                  Skip
                </button>
                <button
                  type="button"
                  onClick={() => go(1)}
                  disabled={index >= session.length - 1}
                  className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
