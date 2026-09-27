/**
 * Enrich Command of Evidence questions with official table/graph HTML
 * from the College Board Educator Question Bank API, and clean the
 * mangled figure text out of the passage body.
 *
 * Usage: node scripts/enrich-figures.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "src", "data", "questions.json");
const LOOKUP =
  "https://qbank-api.collegeboard.org/msreportingquestionbank-prod/questionbank/lookup";
const LIST =
  "https://qbank-api.collegeboard.org/msreportingquestionbank-prod/questionbank/digital/get-questions";
const DETAIL =
  "https://qbank-api.collegeboard.org/msreportingquestionbank-prod/questionbank/digital/get-question";

const HEADERS = {
  "Content-Type": "application/json",
  Origin: "https://satsuiteeducatorquestionbank.collegeboard.org",
  Referer: "https://satsuiteeducatorquestionbank.collegeboard.org/",
  Accept: "application/json",
};

async function getJson(url) {
  const response = await fetch(url, { headers: HEADERS });
  if (!response.ok) throw new Error(`GET ${url} -> ${response.status}`);
  return response.json();
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`POST ${url} -> ${response.status}`);
  return response.json();
}

function decodeEntities(value) {
  return String(value ?? "")
    .replace(/&nbsp;/gi, "\u00a0")
    .replace(/&rsquo;/gi, "’")
    .replace(/&lsquo;/gi, "‘")
    .replace(/&rdquo;/gi, "”")
    .replace(/&ldquo;/gi, "“")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–")
    .replace(/&hellip;/gi, "…")
    .replace(/&eacute;/gi, "é")
    .replace(/&aacute;/gi, "á")
    .replace(/&iacute;/gi, "í")
    .replace(/&oacute;/gi, "ó")
    .replace(/&uacute;/gi, "ú")
    .replace(/&ntilde;/gi, "ñ")
    .replace(/&uuml;/gi, "ü")
    .replace(/&ouml;/gi, "ö")
    .replace(/&auml;/gi, "ä")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function extractFigures(stimulus) {
  const html = String(stimulus ?? "");
  const figures = [];
  const figureRe = /<figure\b[\s\S]*?<\/figure>/gi;
  let match;
  while ((match = figureRe.exec(html))) {
    const block = match[0];
    if (/<table\b/i.test(block) || /<svg\b/i.test(block) || /<img\b/i.test(block)) {
      figures.push(block);
    }
  }
  // Some stimuli wrap a bare table without <figure>
  if (figures.length === 0) {
    const tableRe = /<table\b[\s\S]*?<\/table>/gi;
    while ((match = tableRe.exec(html))) {
      figures.push(`<figure class="table">${match[0]}</figure>`);
    }
  }
  return figures;
}

function stripFigures(stimulus) {
  return String(stimulus ?? "")
    .replace(/<figure\b[\s\S]*?<\/figure>/gi, "")
    .replace(/<table\b[\s\S]*?<\/table>/gi, "")
    // Screen-reader long descriptions for graphs (not meant as passage text)
    .replace(/<div\b[^>]*class="[^"]*\bsr-only\b[^"]*"[^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<div\b[^>]*class="[^"]*\bvisually-hidden\b[^"]*"[^>]*>[\s\S]*?<\/div>/gi, "");
}

function htmlToPassage(html) {
  let text = String(html ?? "");

  // Preserve College Board underline spans as <u>
  text = text.replace(
    /<span\b([^>]*)>([\s\S]*?)<\/span>/gi,
    (full, attrs, inner) => {
      if (/text-decoration\s*:\s*underline/i.test(attrs) || /\bunderline\b/i.test(attrs)) {
        return `<u>${inner}</u>`;
      }
      if (/sr-only/i.test(attrs)) return "";
      if (/aria-hidden/i.test(attrs)) return inner;
      return inner;
    },
  );

  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n\n");
  text = text.replace(/<\/div>/gi, "\n");
  text = text.replace(/<\/h[1-6]>/gi, "\n\n");
  text = text.replace(/<(?:p|div|h[1-6])\b[^>]*>/gi, "");
  // Drop remaining tags except <u>
  text = text.replace(/<\/?(?!u\b)[a-z][^>]*>/gi, "");
  text = decodeEntities(text);
  text = text.replace(/[ \t]+\n/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.replace(/[ \t]{2,}/g, " ");
  return text.trim();
}

function htmlToPlain(html) {
  return htmlToPassage(html).replace(/<\/?u>/gi, "").trim();
}

function cleanFigureHtml(figureHtml) {
  return String(figureHtml ?? "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(href|xlink:href)\s*=\s*("|')\s*javascript:[^"']*\2/gi, "")
    .trim();
}

async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
  return results;
}

async function main() {
  const questions = JSON.parse(fs.readFileSync(OUTPUT, "utf8"));
  console.log(`Loaded ${questions.length} questions`);

  const list = await postJson(LIST, {
    asmtEventId: 99,
    test: 1,
    domain: "INI",
  });
  const coeMeta = list.filter((item) => item.skill_cd === "COE" || item.skill_desc === "Command of Evidence");
  console.log(`College Board COE catalog: ${coeMeta.length}`);

  const byId = new Map(coeMeta.map((item) => [item.questionId, item]));
  const targets = questions.filter(
    (q) => q.skill === "Command of Evidence" && byId.has(q.id),
  );
  console.log(`Local COE questions matched to catalog: ${targets.length}`);

  let withFigures = 0;
  let updated = 0;
  let failed = 0;

  await mapPool(targets, 8, async (question, index) => {
    const meta = byId.get(question.id);
    try {
      const detail = await postJson(DETAIL, { external_id: meta.external_id });
      const figures = extractFigures(detail.stimulus).map(cleanFigureHtml).filter(Boolean);
      const passageHtml = stripFigures(detail.stimulus);
      const passage = htmlToPassage(passageHtml);
      const prompt = htmlToPlain(detail.stem) || question.prompt;

      if (figures.length > 0) {
        question.figureHtml = figures.join("\n");
        withFigures += 1;
      } else if (question.figureHtml) {
        delete question.figureHtml;
      }

      if (passage) question.passage = passage;
      if (prompt) question.prompt = prompt;
      updated += 1;

      if ((index + 1) % 25 === 0 || index === targets.length - 1) {
        console.log(`  processed ${index + 1}/${targets.length} (figures: ${withFigures})`);
      }
    } catch (error) {
      failed += 1;
      console.warn(`  failed ${question.id}: ${error.message}`);
    }
  });

  // Keep stable sort
  questions.sort((a, b) => {
    const domain = String(a.domain).localeCompare(String(b.domain));
    if (domain !== 0) return domain;
    const skill = String(a.skill).localeCompare(String(b.skill));
    if (skill !== 0) return skill;
    return String(a.id).localeCompare(String(b.id));
  });

  fs.writeFileSync(OUTPUT, `${JSON.stringify(questions, null, 2)}\n`);
  console.log(
    `Wrote ${OUTPUT}\n  updated=${updated} withFigures=${withFigures} failed=${failed}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
