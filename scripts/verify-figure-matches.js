/**
 * Verify every local figureHtml matches the College Board figure for that question ID.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const QUESTIONS = path.join(ROOT, "src", "data", "questions.json");
const REPORT = path.join(ROOT, "scripts", "figure-match-report.json");

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

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`POST ${url} -> ${response.status}`);
  return response.json();
}

function normalizeFigure(html) {
  return String(html ?? "")
    .replace(/\s+/g, " ")
    .replace(/>\s+</g, "><")
    .trim()
    .toLowerCase();
}

function figureHash(html) {
  return crypto.createHash("sha256").update(normalizeFigure(html)).digest("hex").slice(0, 16);
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
  if (figures.length === 0) {
    const tableRe = /<table\b[\s\S]*?<\/table>/gi;
    while ((match = tableRe.exec(html))) {
      figures.push(`<figure class="table">${match[0]}</figure>`);
    }
  }
  return figures;
}

function figureKind(html) {
  if (/<table\b/i.test(html)) return "table";
  if (/<svg\b/i.test(html)) return "svg";
  if (/<img\b/i.test(html)) return "img";
  return "unknown";
}

function extractTitle(html) {
  const caption = html.match(/<caption\b[^>]*>([\s\S]*?)<\/caption>/i)?.[1];
  if (caption) {
    return caption.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  const aria = html.match(/aria-label=(?:"([^"]+)"|'([^']+)')/i);
  if (aria) return (aria[1] || aria[2] || "").trim();
  return "";
}

function significantTokens(text) {
  return new Set(
    String(text || "")
      .toLowerCase()
      .replace(/&[a-z]+;/g, " ")
      .match(/[a-z][a-z0-9'-]{3,}/g) || [],
  );
}

function tokenOverlap(a, b) {
  const A = significantTokens(a);
  const B = significantTokens(b);
  if (!A.size || !B.size) return { overlap: 0, shared: [] };
  const shared = [...A].filter((t) => B.has(t));
  const denom = Math.min(A.size, B.size);
  return { overlap: shared.length / denom, shared: shared.slice(0, 12) };
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
  const questions = JSON.parse(fs.readFileSync(QUESTIONS, "utf8"));
  const figured = questions.filter((q) => q.figureHtml);
  console.log(`Local questions with figures: ${figured.length}`);

  const list = await postJson(LIST, { asmtEventId: 99, test: 1, domain: "INI" });
  const coeMeta = list.filter((item) => item.skill_cd === "COE" || item.skill_desc === "Command of Evidence");
  const byId = new Map(coeMeta.map((item) => [item.questionId, item]));
  console.log(`College Board COE catalog: ${coeMeta.length}`);

  const missingInCatalog = figured.filter((q) => !byId.has(q.id));
  const results = [];

  await mapPool(figured, 8, async (question, index) => {
    const meta = byId.get(question.id);
    const row = {
      id: question.id,
      skill: question.skill,
      difficulty: question.difficulty,
      localKind: figureKind(question.figureHtml),
      localTitle: extractTitle(question.figureHtml),
      localHash: figureHash(question.figureHtml),
      status: "ok",
      issues: [],
    };

    if (!meta) {
      row.status = "missing_in_catalog";
      row.issues.push("Question ID not found in College Board COE catalog");
      results[index] = row;
      return;
    }

    try {
      const detail = await postJson(DETAIL, { external_id: meta.external_id });
      const apiFigures = extractFigures(detail.stimulus);
      const apiFigure = apiFigures.join("\n");
      row.apiKind = figureKind(apiFigure);
      row.apiTitle = extractTitle(apiFigure);
      row.apiHash = figureHash(apiFigure);
      row.apiFigureCount = apiFigures.length;

      if (!apiFigure) {
        row.status = "api_has_no_figure";
        row.issues.push("Local has figureHtml but API stimulus has no table/svg/img figure");
      } else if (normalizeFigure(question.figureHtml) !== normalizeFigure(apiFigure)) {
        row.status = "hash_mismatch";
        row.issues.push("Normalized figure HTML differs from live College Board stimulus");
      }

      // Prompt should mention table/graph consistently with figure type
      const prompt = `${question.prompt} ${detail.stem || ""}`.toLowerCase();
      if (row.localKind === "table" && !/\btable\b/.test(prompt) && !/\bdata from the table\b/.test(prompt)) {
        // soft warning only if neither local nor API stem mentions table
        if (!/\btable\b/i.test(detail.stem || "")) {
          row.issues.push("Table figure but prompt/stem does not mention table");
          if (row.status === "ok") row.status = "soft_mismatch";
        }
      }
      if ((row.localKind === "svg" || row.localKind === "img") && !/\b(graph|figure|chart)\b/.test(prompt)) {
        if (!/\b(graph|figure|chart)\b/i.test(detail.stem || "")) {
          row.issues.push("Graph figure but prompt/stem does not mention graph/figure/chart");
          if (row.status === "ok") row.status = "soft_mismatch";
        }
      }

      // Title tokens should appear in passage or prompt (semantic match)
      const title = row.apiTitle || row.localTitle;
      if (title) {
        const corpus = `${question.passage}\n${question.prompt}\n${detail.stimulus || ""}`;
        const { overlap, shared } = tokenOverlap(title, corpus);
        row.titleOverlap = Number(overlap.toFixed(3));
        row.sharedTitleTokens = shared;
        // For short titles, require decent overlap; long aria labels include axis text so overlap with passage may be lower.
        const titleTokens = significantTokens(title);
        if (titleTokens.size >= 4 && overlap < 0.15 && !shared.some((t) => /table|graph|chart/.test(t) === false)) {
          // Check if at least 2 distinctive title words appear in passage
          const distinctive = [...titleTokens].filter((t) => t.length >= 5);
          const passageTokens = significantTokens(question.passage + " " + question.prompt);
          const hit = distinctive.filter((t) => passageTokens.has(t));
          row.titleHitsInPassage = hit.slice(0, 10);
          if (hit.length < 2) {
            row.issues.push(`Weak title/passage token match (hits=${hit.length})`);
            if (row.status === "ok") row.status = "soft_mismatch";
          }
        }
      }

      // Cross-check: no other local question should share this exact figure hash unless identical content intentionally reused
      results[index] = row;
      if ((index + 1) % 25 === 0 || index === figured.length - 1) {
        console.log(`  checked ${index + 1}/${figured.length}`);
      }
    } catch (error) {
      row.status = "fetch_error";
      row.issues.push(error.message);
      results[index] = row;
    }
  });

  // Detect duplicate figure hashes mapped to different questions with different titles
  const byHash = new Map();
  for (const row of results.filter(Boolean)) {
    const listForHash = byHash.get(row.localHash) || [];
    listForHash.push(row.id);
    byHash.set(row.localHash, listForHash);
  }
  const duplicateHashes = [...byHash.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([hash, ids]) => ({ hash, ids, titles: ids.map((id) => results.find((r) => r.id === id)?.localTitle) }));

  const summary = {
    checked: results.length,
    ok: results.filter((r) => r.status === "ok").length,
    soft_mismatch: results.filter((r) => r.status === "soft_mismatch").length,
    hash_mismatch: results.filter((r) => r.status === "hash_mismatch").length,
    api_has_no_figure: results.filter((r) => r.status === "api_has_no_figure").length,
    missing_in_catalog: results.filter((r) => r.status === "missing_in_catalog").length,
    fetch_error: results.filter((r) => r.status === "fetch_error").length,
    missingInCatalogCount: missingInCatalog.length,
    duplicateFigureHashGroups: duplicateHashes.length,
  };

  const report = {
    generatedAt: new Date().toISOString(),
    summary,
    duplicateHashes,
    failures: results.filter((r) => r.status !== "ok"),
    all: results,
  };

  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  console.log("\nSUMMARY");
  console.log(summary);
  if (report.failures.length) {
    console.log("\nFAILURES / WARNINGS:");
    for (const fail of report.failures) {
      console.log(`- ${fail.id} [${fail.status}] ${fail.issues.join("; ")}`);
      console.log(`  local=${fail.localKind} "${fail.localTitle?.slice(0, 80)}"`);
      console.log(`  api=${fail.apiKind} "${fail.apiTitle?.slice(0, 80)}"`);
    }
  } else {
    console.log("\nAll figured questions exact-match College Board figures for their IDs.");
  }
  console.log(`\nWrote ${path.relative(ROOT, REPORT)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
