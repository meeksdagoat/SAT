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

function stripUnderlineTags(value) {
  return String(value || "").replace(/<\/?u>/gi, "");
}

function mergeUnderlineTags(value) {
  return String(value || "").replace(/<\/u>(\s*)<u>/g, "$1");
}

function hasUnderlineMarkup(value) {
  return /<u[\s>]|<\/u>/i.test(String(value || ""));
}

function wrapOnce(haystack, needle) {
  if (!needle || needle.length < 2) return null;
  const index = haystack.indexOf(needle);
  if (index < 0) return null;
  return `${haystack.slice(0, index)}<u>${needle}</u>${haystack.slice(index + needle.length)}`;
}

function sentencesOf(passage) {
  return String(passage).match(/[^.!?]+(?:[.!?]+|$)/g) || [passage];
}

function expandToSentence(passage, snippet) {
  const hit = sentencesOf(passage).find((sentence) => sentence.includes(snippet));
  return hit ? hit.trim() : snippet;
}

function quoteNearUnderlined(text) {
  const patterns = [
    /which is underlined[,:\s]+[^“"”]{0,180}[“"]([^"”]{3,240})[”"]/i,
    /[“"]([^"”]{3,240})[”"][^.]{0,40}(?:is|are) underlined/i,
  ];
  for (const pattern of patterns) {
    const match = String(text).match(pattern);
    if (match?.[1]) return match[1];
  }
  return "";
}

function wrapLiteraryOpening(passage) {
  if (!/^The following text is from\b/i.test(passage)) return null;
  const context = passage.match(
    /In the (?:poem|text|excerpt|passage|novel|play|essay|story|book)\b[^.?!]*[.?!]\s+/i,
  );
  if (!context) return null;
  const cut = context.index + context[0].length;
  const prefix = passage.slice(0, cut);
  const rest = passage.slice(cut);
  const clauseMatch = rest.match(/^.{8,}?(?:—|–|[.?!])/);
  const target = clauseMatch ? clauseMatch[0] : "";
  if (!target || target.length < 8 || target.length > rest.length * 0.9) return null;
  return `${prefix}<u>${target}</u>${rest.slice(target.length)}`;
}

function wrapUnderlinedPassage(question) {
  let passage = question.passage;
  if (hasUnderlineMarkup(passage)) {
    return { ...question, passage: mergeUnderlineTags(passage) };
  }
  if (/_{3,}/.test(passage)) {
    return {
      ...question,
      passage: passage.replace(/_{3,}/g, "<u>\u00a0\u00a0\u00a0\u00a0</u>"),
    };
  }

  const prompt = question.prompt || "";
  const wantsUnderline =
    /underlined/i.test(prompt) ||
    /completes the text so that it conforms/i.test(prompt) ||
    /most logical transition/i.test(prompt) ||
    /most logical and precise word/i.test(prompt);
  if (!wantsUnderline) return question;

  const literary = wrapLiteraryOpening(passage);
  if (literary) return { ...question, passage: literary };

  const rationale = Object.values(question.explanations || {}).join("\n");
  const quote = quoteNearUnderlined(rationale);
  if (quote && passage.includes(quote)) {
    const target = /sentence/i.test(prompt) ? expandToSentence(passage, quote) : quote;
    const wrapped = wrapOnce(passage, target);
    if (wrapped) return { ...question, passage: wrapped };
  }

  const word = prompt.match(/(?:word|phrase)\s+[“"]([^"”]+)[”"]/i)?.[1];
  if (word && passage.includes(word)) {
    const wrapped = wrapOnce(passage, word);
    if (wrapped) return { ...question, passage: wrapped };
  }

  if (/underlined/i.test(prompt) && /Text 1/i.test(prompt) && /\bText 2\b/.test(passage)) {
    const splitAt = passage.search(/\sText 2\b/);
    const text1 = passage.slice(0, splitAt).replace(/^Text 1\s*/, "");
    const last = sentencesOf(text1).at(-1)?.trim();
    if (last && last.length >= 20) {
      const wrapped = wrapOnce(passage, last);
      if (wrapped) return { ...question, passage: wrapped };
    }
  }

  if (
    /completes the text so that it conforms/i.test(prompt) ||
    /Form, Structure, and Sense|Boundaries/.test(question.skill || "")
  ) {
    const matches = (question.choices || [])
      .map((choice) => choice.text)
      .filter((text) => text && text.length >= 4 && passage.includes(text))
      .sort((a, b) => b.length - a.length);
    const unique = matches.filter((text) => passage.split(text).length === 2);
    const wrapped = wrapOnce(passage, unique[0] || matches[0]);
    if (wrapped) return { ...question, passage: wrapped };
  }

  return question;
}

function collectUnderlineBands(annotations) {
  const bands = [];
  for (const annotation of annotations || []) {
    if (!/underline|highlight/i.test(annotation.subtype || "")) continue;
    const rect = annotation.rect || [];
    if (rect.length < 4) continue;
    bands.push({
      x0: Math.min(rect[0], rect[2]),
      x1: Math.max(rect[0], rect[2]),
      y0: Math.min(rect[1], rect[3]),
      y1: Math.max(rect[1], rect[3]),
    });
  }
  return bands;
}

function itemIsUnderlined(item, bands) {
  if (!item?.str || !item.transform || !bands.length) return false;
  const x0 = item.transform[4];
  const x1 = x0 + (item.width || 0);
  const baseline = item.transform[5];
  const height = item.height || 10;
  return bands.some((band) => {
    const overlap = Math.min(x1, band.x1) - Math.max(x0, band.x0);
    if (overlap < Math.min(Math.max(item.width || 0, 4), band.x1 - band.x0) * 0.35) return false;
    return baseline >= band.y0 - 2 && baseline <= band.y1 + height * 0.85;
  });
}

async function pageTextWithUnderlines(pdfjs, page, pageNumber, totalPages) {
  const textContent = await page.getTextContent();
  let annotations = [];
  try {
    annotations = await page.getAnnotations({ intent: "display" });
  } catch {
    annotations = [];
  }
  const bands = collectUnderlineBands(annotations);
  const lineThreshold = 4.6;
  const cellThreshold = 7;
  const strBuf = [];
  let lastX;
  let lastY;
  let lineHeight = 0;
  const viewport = page.getViewport({ scale: 1 });

  for (const item of textContent.items) {
    if (!("str" in item)) continue;
    const tm = item.transform;
    const [x, y] = viewport.convertToViewportPoint(tm[4], tm[5]);
    const underlined = itemIsUnderlined(item, bands);
    let chunk = item.str;
    if (underlined && chunk.replace(/\s+/g, "")) {
      chunk = `<u>${chunk}</u>`;
    }
    if (lastY !== undefined && Math.abs(lastY - y) > lineThreshold) {
      const lastItem = strBuf.length ? strBuf[strBuf.length - 1] : undefined;
      const isCurrentItemHasNewLine = chunk.startsWith("\n") || (item.str.trim() === "" && item.hasEOL);
      if (lastItem?.endsWith("\n") === false && !isCurrentItemHasNewLine) {
        const ydiff = Math.abs(lastY - y);
        if (ydiff - 1 > lineHeight) {
          strBuf.push("\n");
          lineHeight = 0;
        }
      }
    }
    if (lastY !== undefined && Math.abs(lastY - y) < lineThreshold) {
      if (lastX !== undefined && Math.abs(lastX - x) > cellThreshold) {
        chunk = `\t${chunk}`;
      }
    }
    strBuf.push(chunk);
    lastX = x + item.width;
    lastY = y;
    lineHeight = Math.max(lineHeight, item.height);
    if (item.hasEOL) {
      strBuf.push("\n");
      lineHeight = 0;
    }
  }

  const text = `${mergeUnderlineTags(strBuf.join(""))}\n-- ${pageNumber} of ${totalPages} --`;
  return text;
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

    const meta = parseMeta(stripUnderlineTags(chunk.slice(0, questionIndex)));
    const body = chunk.slice(questionIndex + "\nQuestion\n".length, answerIndex).trim();
    const promptSplit = body.search(PROMPT_RE);
    const passage =
      promptSplit >= 0 ? body.slice(0, promptSplit).trim() : body.trim();
    const prompt =
      promptSplit >= 0
        ? collapseSpaces(stripUnderlineTags(body.slice(promptSplit)))
        : "Which choice is best?";
    const choices = parseChoices(stripUnderlineTags(chunk.slice(answerIndex + "\nAnswer\n".length, correctIndex)));
    const correctAnswer = chunk
      .slice(correctIndex)
      .match(/Correct Answer:\s*([A-D])/i)?.[1]
      ?.toUpperCase();
    if (!correctAnswer || choices.some((choice) => !choice.text)) {
      skipped += 1;
      continue;
    }

    const rationale = rationaleIndex >= 0 ? chunk.slice(rationaleIndex + "\nRationale\n".length) : "";
    questions.push(
      wrapUnderlinedPassage({
        id,
        assessment: "SAT",
        test: "Reading and Writing",
        domain: meta.domain,
        skill: meta.skill,
        difficulty: meta.difficulty,
        passage: mergeUnderlineTags(collapseSpaces(passage)),
        prompt,
        choices,
        correctAnswer,
        explanations: parseRationale(stripUnderlineTags(rationale)),
      }),
    );
  }

  return { questions, skipped };
}

let pdfjsLibPromise;

function loadPdfjs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import("pdfjs-dist/legacy/build/pdf.mjs").catch(() =>
      import("pdfjs-dist/build/pdf.mjs"),
    );
  }
  return pdfjsLibPromise;
}

async function extractPdfText(filePath) {
  const buffer = fs.readFileSync(filePath);
  try {
    const pdfjs = await loadPdfjs();
    const data = new Uint8Array(buffer);
    const loadingTask = pdfjs.getDocument({ data, verbosity: 0 });
    const doc = await loadingTask.promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      pages.push(await pageTextWithUnderlines(pdfjs, page, pageNumber, doc.numPages));
    }
    await doc.destroy();
    return pages.join("\n");
  } catch (error) {
    console.warn(`Underline-aware extract failed for ${path.basename(filePath)}: ${error.message}`);
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.text || "";
    } finally {
      await parser.destroy();
    }
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
  console.log(
    "Passages with underline markup:",
    questions.filter((question) => hasUnderlineMarkup(question.passage)).length,
  );
  console.log("By domain:", byDomain);
  console.log("Skipped incomplete blocks:", skipped);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
