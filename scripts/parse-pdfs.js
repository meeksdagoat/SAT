const fs = require("fs");
const path = require("path");
const { PDFParse } = require("pdf-parse");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "src", "data", "questions.json");

const CHOICE_IDS = ["A", "B", "C", "D"];
const DOMAINS = [
  "Craft and Structure",
  "Information and Ideas",
  "Standard English Conventions",
  "Expression of Ideas",
];
const SKILLS = [
  "Text Structure and Purpose",
  "Cross-Text Connections",
  "Central Ideas and Details",
  "Command of Evidence",
  "Form, Structure, and Sense",
  "Words in Context",
  "Rhetorical Synthesis",
  "Inferences",
  "Transitions",
  "Boundaries",
];

const PROMPT_RE =
  /\n(?=(?:Which choice|Which finding|Which quotation|Which of the following|Based on the texts?|The student wants|What does the text|According to the text|As used in the text|Which statement|Which claim)\b)/i;

function fixRtLigatures(text) {
  const kept = [];
  const placeholders = text.replace(
    /\b(for|or|nor|your|their|after|over|under|near|whether|either|neither|however|later|earlier|greater|better|rather|other|further|another|her|our|were|are|number)\s+t/gi,
    (match) => {
      kept.push(match);
      return `<<RT${kept.length - 1}>>`;
    },
  );
  return placeholders.replace(/r t/g, "rt").replace(/<<RT(\d+)>>/g, (_, index) => kept[Number(index)]);
}

function cleanPdfText(text) {
  return fixRtLigatures(
    String(text)
      .replace(/\r\n/g, "\n")
      .replace(/\u0000/g, "")
      .replace(/--\s*\d+\s+of\s+\d+\s*--/g, "\n")
      .replace(/ﬁ/g, "fi")
      .replace(/ﬂ/g, "fl")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n"),
  );
}

function collapseSpaces(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDomain(value) {
  const haystack = collapseSpaces(value).toLowerCase();
  const match = DOMAINS.find((domain) => haystack.includes(domain.toLowerCase()));
  return match || collapseSpaces(value);
}

function normalizeSkill(value) {
  const haystack = collapseSpaces(value).toLowerCase();
  const match = SKILLS.find((skill) => haystack.includes(skill.toLowerCase()));
  return match || collapseSpaces(value);
}

function parseMeta(raw) {
  const cleaned = collapseSpaces(raw)
    .replace(/^Assessment Test Domain Skill Difficulty/i, "")
    .replace(/^SAT Reading and Writing/i, "")
    .trim();
  const difficultyMatch = cleaned.match(/\b(Easy|Medium|Hard)\s*$/i);
  const difficulty = difficultyMatch
    ? difficultyMatch[1][0].toUpperCase() + difficultyMatch[1].slice(1).toLowerCase()
    : "Medium";
  const withoutDiff = cleaned.replace(/\b(Easy|Medium|Hard)\s*$/i, "").trim();
  return {
    domain: normalizeDomain(withoutDiff),
    skill: normalizeSkill(withoutDiff),
    difficulty,
  };
}

function parseRationale(text) {
  const explanations = {
    A: "No explanation provided.",
    B: "No explanation provided.",
    C: "No explanation provided.",
    D: "No explanation provided.",
  };
  const parts = String(text).split(/\bChoice\s+([A-D])\s+is\b/i);
  for (let i = 1; i < parts.length; i += 2) {
    const id = String(parts[i] || "").toUpperCase();
    const body = collapseSpaces(parts[i + 1] || "");
    if (CHOICE_IDS.includes(id) && body) {
      explanations[id] = `Choice ${id} is ${body}`;
    }
  }
  return explanations;
}

function parseChoices(block) {
  return CHOICE_IDS.map((id, index) => {
    const next = CHOICE_IDS[index + 1];
    const regex = next
      ? new RegExp(`${id}\\.\\s*([\\s\\S]*?)(?=\\n?${next}\\.|$)`)
      : new RegExp(`${id}\\.\\s*([\\s\\S]*)$`);
    const match = block.match(regex);
    return { id, text: collapseSpaces(match?.[1] || "") };
  });
}

function parseQuestionBankText(text) {
  const cleaned = cleanPdfText(text);
  const chunks = cleaned.split(/Question ID:\s*/i).filter((chunk) => chunk.trim());
  const questions = [];
  let skipped = 0;

  for (const chunk of chunks) {
    const id = chunk.match(/^([A-Za-z0-9-]+)/)?.[1];
    const questionIndex = chunk.search(/\nQuestion\n/i);
    const answerIndex = chunk.search(/\nAnswer\n/i);
    const correctIndex = chunk.search(/\nCorrect Answer:\s*/i);
    const rationaleIndex = chunk.search(/\nRationale\n/i);
    if (!id || questionIndex < 0 || answerIndex < 0 || correctIndex < 0) {
      skipped += 1;
      continue;
    }

    const meta = parseMeta(chunk.slice(0, questionIndex));
    const body = chunk.slice(questionIndex + "\nQuestion\n".length, answerIndex).trim();
    const promptSplit = body.search(PROMPT_RE);
    const passage =
      promptSplit >= 0 ? body.slice(0, promptSplit).trim() : body.trim();
    const prompt =
      promptSplit >= 0
        ? collapseSpaces(body.slice(promptSplit))
        : "Which choice is best?";
    const choices = parseChoices(chunk.slice(answerIndex + "\nAnswer\n".length, correctIndex));
    const correctAnswer = chunk
      .slice(correctIndex)
      .match(/Correct Answer:\s*([A-D])/i)?.[1]
      ?.toUpperCase();
    if (!correctAnswer || choices.some((choice) => !choice.text)) {
      skipped += 1;
      continue;
    }

    const rationale = rationaleIndex >= 0 ? chunk.slice(rationaleIndex + "\nRationale\n".length) : "";
    questions.push({
      id,
      assessment: "SAT",
      test: "Reading and Writing",
      domain: meta.domain,
      skill: meta.skill,
      difficulty: meta.difficulty,
      passage: collapseSpaces(passage),
      prompt,
      choices,
      correctAnswer,
      explanations: parseRationale(rationale),
    });
  }

  return { questions, skipped };
}

async function extractPdfText(filePath) {
  const buffer = fs.readFileSync(filePath);
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text || "";
  } finally {
    await parser.destroy();
  }
}

function findPdfs() {
  return fs
    .readdirSync(ROOT)
    .filter((name) => name.toLowerCase().endsWith(".pdf"))
    .map((name) => path.join(ROOT, name))
    .sort();
}

async function main() {
  const pdfs = findPdfs();
  if (pdfs.length === 0) {
    throw new Error("No PDFs found in the project root. Place College Board question-bank exports next to package.json.");
  }

  const byId = new Map();
  let skipped = 0;

  for (const filePath of pdfs) {
    console.log(`Extracting ${path.basename(filePath)}...`);
    const text = await extractPdfText(filePath);
    const parsed = parseQuestionBankText(text);
    skipped += parsed.skipped;
    for (const question of parsed.questions) {
      byId.set(question.id, question);
    }
    console.log(`  parsed ${parsed.questions.length} questions (${parsed.skipped} skipped)`);
  }

  const questions = Array.from(byId.values()).sort((a, b) => {
    const domain = a.domain.localeCompare(b.domain);
    if (domain !== 0) return domain;
    const skill = a.skill.localeCompare(b.skill);
    if (skill !== 0) return skill;
    return a.id.localeCompare(b.id);
  });

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(questions, null, 2)}\n`);

  const byDomain = {};
  for (const question of questions) {
    byDomain[question.domain] = (byDomain[question.domain] || 0) + 1;
  }

  console.log(`Wrote ${questions.length} unique questions to ${path.relative(ROOT, OUTPUT)}`);
  console.log("By domain:", byDomain);
  console.log("Skipped incomplete blocks:", skipped);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
