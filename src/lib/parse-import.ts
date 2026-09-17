import type { ChoiceId, Difficulty, Question } from "./types";

const CHOICE_IDS: ChoiceId[] = ["A", "B", "C", "D"];
const DIFFICULTIES = new Set<Difficulty>(["Easy", "Medium", "Hard"]);

function isChoiceId(value: unknown): value is ChoiceId {
  return value === "A" || value === "B" || value === "C" || value === "D";
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeQuestion(raw: unknown, index: number): Question | null {
  if (!raw || typeof raw !== "object") return null;
  const q = raw as Record<string, unknown>;
  const id = asString(q.id) || `imported-${index + 1}`;
  const difficulty = asString(q.difficulty);
  const correctAnswer = asString(q.correctAnswer);
  const choicesRaw = Array.isArray(q.choices) ? q.choices : [];
  const explanationsRaw =
    q.explanations && typeof q.explanations === "object"
      ? (q.explanations as Record<string, unknown>)
      : {};

  if (!DIFFICULTIES.has(difficulty as Difficulty) || !isChoiceId(correctAnswer)) {
    return null;
  }

  const choices = CHOICE_IDS.map((choiceId, choiceIndex) => {
    const match = choicesRaw.find((choice) => {
      if (!choice || typeof choice !== "object") return false;
      return asString((choice as { id?: unknown }).id) === choiceId;
    }) as { text?: unknown } | undefined;
    const fallback = choicesRaw[choiceIndex] as { text?: unknown } | string | undefined;
    const text =
      asString(match?.text) ||
      (typeof fallback === "string" ? fallback : asString(fallback?.text));
    return { id: choiceId, text: text || `${choiceId}` };
  });

  const explanations = Object.fromEntries(
    CHOICE_IDS.map((choiceId) => [
      choiceId,
      asString(explanationsRaw[choiceId]) || "No explanation provided.",
    ]),
  ) as Question["explanations"];

  return {
    id,
    assessment: asString(q.assessment) || "SAT",
    test: asString(q.test) || "Reading and Writing",
    domain: asString(q.domain) || "Craft and Structure",
    skill: asString(q.skill) || "Words in Context",
    difficulty: difficulty as Difficulty,
    passage: asString(q.passage),
    prompt: asString(q.prompt) || "Which choice is best?",
    choices,
    correctAnswer,
    explanations,
  };
}

function flattenUnknown(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  const record = data as Record<string, unknown>;
  if (Array.isArray(record.questions)) return record.questions;

  const nested: unknown[] = [];
  for (const value of Object.values(record)) {
    if (Array.isArray(value)) {
      nested.push(...value);
    } else if (value && typeof value === "object") {
      nested.push(...flattenUnknown(value));
    }
  }
  return nested;
}

export function parseQuestionJson(text: string): Question[] {
  const data = JSON.parse(text) as unknown;
  return flattenUnknown(data)
    .map((item, index) => normalizeQuestion(item, index))
    .filter((item): item is Question => item !== null);
}

function joinMeta(lines: string[]) {
  return lines
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/Standard English Conventions/g, "Standard English Conventions")
    .trim();
}

function parseMeta(block: string) {
  const cleaned = block
    .replace(/^Assessment Test Domain Skill Difficulty\s*/i, "")
    .replace(/^SAT\s+Reading and Writing\s+/i, "")
    .trim();

  const difficultyMatch = cleaned.match(/\b(Easy|Medium|Hard)\s*$/);
  const difficulty = (difficultyMatch?.[1] ?? "Medium") as Difficulty;
  const withoutDiff = cleaned.replace(/\b(Easy|Medium|Hard)\s*$/, "").trim();

  const skills = [
    "Words in Context",
    "Text Structure and Purpose",
    "Cross-Text Connections",
    "Central Ideas and Details",
    "Inferences",
    "Command of Evidence",
    "Form, Structure, and Sense",
    "Rhetorical Synthesis",
    "Transitions",
    "Boundaries",
  ];
  const skill = skills.find((name) =>
    withoutDiff.toLowerCase().endsWith(name.toLowerCase()),
  );
  const domain = skill
    ? withoutDiff.slice(0, withoutDiff.length - skill.length).trim()
    : withoutDiff;

  return { domain: domain || "Craft and Structure", skill: skill || "Words in Context", difficulty };
}

function parseRationale(text: string): Question["explanations"] {
  const explanations: Question["explanations"] = {
    A: "No explanation provided.",
    B: "No explanation provided.",
    C: "No explanation provided.",
    D: "No explanation provided.",
  };
  const parts = text.split(/\bChoice\s+([A-D])\s+is\b/i);
  for (let i = 1; i < parts.length; i += 2) {
    const id = parts[i]?.toUpperCase();
    const body = parts[i + 1]?.trim();
    if (isChoiceId(id) && body) {
      explanations[id] = `Choice ${id} is ${body}`.replace(/\s+/g, " ").trim();
    }
  }
  return explanations;
}

export function parseQuestionBankText(text: string): Question[] {
  const chunks = text.split(/Question ID:\s*/i).filter((chunk) => chunk.trim());
  const questions: Question[] = [];

  for (const chunk of chunks) {
    const id = chunk.match(/^([A-Za-z0-9-]+)/)?.[1] ?? `imported-${questions.length + 1}`;
    const questionIndex = chunk.search(/\nQuestion\n/i);
    const answerIndex = chunk.search(/\nAnswer\n/i);
    const correctIndex = chunk.search(/\nCorrect Answer:\s*/i);
    const rationaleIndex = chunk.search(/\nRationale\n/i);
    if (questionIndex < 0 || answerIndex < 0 || correctIndex < 0) continue;

    const meta = parseMeta(joinMeta(chunk.slice(0, questionIndex).split("\n").slice(1)));
    const body = chunk.slice(questionIndex + "\nQuestion\n".length, answerIndex).trim();
    const promptMatch = body.match(
      /\n(?=(?:Which choice|Which finding|Which quotation|Which of the following|Based on the texts?|The student wants|What does the text|According to the text|As used in the text|Which statement|Which claim)\b)/i,
    );
    const passage = (promptMatch && promptMatch.index != null ? body.slice(0, promptMatch.index) : body).trim();
    const prompt = (promptMatch && promptMatch.index != null
      ? body.slice(promptMatch.index)
      : "Which choice is best?").replace(/\s+/g, " ").trim();

    const answerBlock = chunk.slice(answerIndex + "\nAnswer\n".length, correctIndex);
    const choices = CHOICE_IDS.map((choiceId) => {
      const regex = new RegExp(`${choiceId}\\.\\s*([\\s\\S]*?)(?=\\n[A-D]\\.|$)`);
      const match = answerBlock.match(regex);
      return {
        id: choiceId,
        text: (match?.[1] ?? "").replace(/\s+/g, " ").trim(),
      };
    });

    const afterCorrect = chunk.slice(correctIndex);
    const correctAnswer = afterCorrect.match(/Correct Answer:\s*([A-D])/i)?.[1]?.toUpperCase();
    if (!isChoiceId(correctAnswer)) continue;

    const rationale =
      rationaleIndex >= 0
        ? chunk.slice(rationaleIndex + "\nRationale\n".length)
        : "";

    questions.push({
      id,
      assessment: "SAT",
      test: "Reading and Writing",
      domain: meta.domain,
      skill: meta.skill,
      difficulty: meta.difficulty,
      passage: passage.replace(/\s+/g, " ").trim(),
      prompt,
      choices,
      correctAnswer,
      explanations: parseRationale(rationale),
    });
  }

  return questions;
}

export function parseImportPayload(text: string): Question[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return parseQuestionJson(trimmed);
  }
  if (/Question ID:/i.test(trimmed)) {
    return parseQuestionBankText(trimmed);
  }
  return parseQuestionJson(trimmed);
}
