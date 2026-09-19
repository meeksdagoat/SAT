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

function joinSoftWrappedLines(block) {
  const lines = String(block || "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);
  if (lines.length <= 1) return lines[0] || "";

  const paragraphs = [];
  let current = lines[0];
  for (let i = 1; i < lines.length; i += 1) {
    const next = lines[i];
    const poetry = current.length < 64 && next.length < 64;
    if (poetry) {
      paragraphs.push(current);
      current = next;
    } else {
      current = `${current} ${next}`.replace(/\s+/g, " ");
    }
  }
  paragraphs.push(current);
  return paragraphs.join("\n");
}

function insertStructuralBreaks(value) {
  let text = String(value || "").replace(/\r\n/g, "\n");
  const firstBlock = text.split(/\n\n+/)[0] || "";
  const needsIntroBreak =
    /The following texts?\b/i.test(firstBlock) && !/\n\n/.test(firstBlock.slice(0, 400));

  if ((needsIntroBreak || !/\n\n/.test(text)) && /^The following texts?\b/i.test(text)) {
    const attribution = [
      /^(The following texts?\b[\s\S]*?\([^)]+\)\s*[.?!])\s+/i,
      /^(The following texts?\b[\s\S]*?[“"][^”"]+[”"][.?!]?)\s+/,
      /^(The following texts?\b[\s\S]*?\d{4}[^.]*\.)\s+/i,
      /^(The following texts?\b[^.!?\n]{12,220}[.?!])\s+/i,
    ]
      .map((pattern) => text.match(pattern))
      .find(Boolean);
    if (attribution) {
      let rest = text.slice(attribution[0].length);
      const setup = rest.match(
        /^((?:The speaker|The narrator|The author|In the |Spars are)\b[\s\S]{8,240}?[.?!])\s+/,
      );
      if (setup) {
        rest = rest.slice(setup[0].length);
        text = `${attribution[1].replace(/\s+/g, " ").trim()} ${setup[1]}\n\n${rest}`;
      } else {
        text = `${attribution[1].replace(/\s+/g, " ").trim()}\n\n${rest}`;
      }
    }
  }

  text = text.replace(/([^\n])[ \t]+(Text [12])\b/g, "$1\n\n$2");
  text = text.replace(/^(Text [12])[ \t]+/gm, "$1\n");
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

function formatPassage(value) {
  const raw = String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
  const preserved = raw
    .split(/\n\n+/)
    .map((block) => joinSoftWrappedLines(block))
    .filter(Boolean)
    .join("\n\n");
  return mergeUnderlineTags(insertStructuralBreaks(preserved));
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

const RATIONALE_STOPWORDS = new Set(
  `choice incorrect answer best because underlined portion sentence phrase statement question claim claims text whole function functions describes describe accurately thus while which that this with from have been were their there about would could should most more than also into only such when then than after before being itself themselves itself the and for are was not but they them his her its our you your can may might does did done over under upon like just even very into onto across through during without within after before other another these those some any all each both few many much using used use into onto across`.split(
    /\s+/,
  ),
);

function normalizeMatch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stemToken(word) {
  return word.replace(/(?:ingly|edly|tion|ness|ment|ally|ing|edly|ed|ly|es|s)$/g, "");
}

function contentTokens(value) {
  return [
    ...new Set(
      normalizeMatch(value)
        .split(" ")
        .map(stemToken)
        .filter((word) => word.length >= 4 && !RATIONALE_STOPWORDS.has(word)),
    ),
  ];
}

function buildNormalizedIndex(text) {
  let out = "";
  const map = [];
  for (let i = 0; i < text.length; i += 1) {
    let ch = text[i];
    if (ch === "\u2018" || ch === "\u2019") ch = "'";
    const lower = ch.toLowerCase();
    if (/[a-z0-9']/.test(lower)) {
      map.push(i);
      out += lower;
    } else if (out.length && out[out.length - 1] !== " ") {
      map.push(i);
      out += " ";
    }
  }
  if (out.endsWith(" ")) {
    out = out.slice(0, -1);
    map.pop();
  }
  return { out, map };
}

function findNormalizedSpan(haystack, needle) {
  const target = normalizeMatch(needle);
  if (!target || target.length < 8) return null;
  const hay = buildNormalizedIndex(haystack);
  const index = hay.out.indexOf(target);
  if (index < 0 || !hay.map.length) return null;
  const start = hay.map[index];
  const end = hay.map[index + target.length - 1] + 1;
  const span = haystack.slice(start, end);
  return span.length >= 8 ? span : null;
}

function collectQuotedPhrases(text) {
  return [...String(text).matchAll(/[\u201c"]([^"\u201d]{4,280})["\u201d]/g)].map((match) => match[1].trim());
}

function clausesOf(passage) {
  const clauses = [];
  for (const sentence of sentencesOf(passage)) {
    const pieces = String(sentence)
      .split(/(?<=[;:!?]|—|–)\s+/)
      .map((piece) => piece.trim())
      .filter((piece) => piece.length >= 8);
    if (pieces.length) clauses.push(...pieces);
    else if (sentence.trim()) clauses.push(sentence.trim());
  }
  return clauses;
}

function wantsSentenceTarget(prompt) {
  return /underlined (sentence|question|statement|claim|explanation|conclusion|observation)/i.test(prompt);
}

function wantsPortionTarget(prompt) {
  return /underlined (portion|phrase|part|lines)/i.test(prompt);
}

function coverQuotes(passage, spans) {
  const located = spans
    .map((span) => ({ span, index: passage.indexOf(span) }))
    .filter((item) => item.index >= 0)
    .sort((a, b) => a.index - b.index);
  if (located.length === 0) return null;
  if (located.length === 1) return located[0].span;
  const start = located[0].index;
  const end = located[located.length - 1].index + located[located.length - 1].span.length;
  if (end - start <= 140) return passage.slice(start, end);
  return located.reduce((longest, item) => (item.span.length > longest.length ? item.span : longest), located[0].span);
}

function tokenizeWithSpans(text) {
  const tokens = [];
  const pattern = /[A-Za-z0-9']+/g;
  let match;
  while ((match = pattern.exec(String(text)))) {
    tokens.push({
      word: stemToken(match[0].toLowerCase()),
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return tokens;
}

function wordsAlign(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length >= 4 && right.length >= 4 && (left.startsWith(right) || right.startsWith(left))) return true;
  return false;
}

function findFuzzyPhrase(haystack, needle) {
  const hay = tokenizeWithSpans(haystack);
  const ned = tokenizeWithSpans(needle)
    .map((token) => token.word)
    .filter((word) => word.length >= 3 && !RATIONALE_STOPWORDS.has(word));
  if (ned.length < 3) return null;
  for (let i = 0; i < hay.length; i += 1) {
    let needleIndex = 0;
    let cursor = i;
    while (needleIndex < ned.length && cursor < hay.length && cursor - i <= ned.length + 4) {
      if (wordsAlign(hay[cursor].word, ned[needleIndex])) {
        needleIndex += 1;
        cursor += 1;
      } else if (RATIONALE_STOPWORDS.has(hay[cursor].word) || hay[cursor].word.length < 3) {
        cursor += 1;
      } else if (needleIndex > 0 && wordsAlign(hay[cursor].word, ned[0])) {
        break;
      } else {
        cursor += 1;
      }
    }
    if (needleIndex >= ned.length) {
      return haystack.slice(hay[i].start, hay[cursor - 1].end);
    }
  }
  return null;
}

function citedWindows(rationale) {
  const cleaned = String(rationale)
    .replace(/opening line[^.!?]{0,180}/gi, " ")
    .replace(/sentence that follows[^.!?]{0,200}/gi, " ");
  const windows = [...cleaned.matchAll(/underlined(?: sentence| portion| phrase| part| lines| claim| question| statement)?[^.!?]{0,400}/gi)].map(
    (match) => match[0],
  );
  return windows.length ? windows : [cleaned];
}

function wrapFromQuotedRationale(passage, prompt, rationale) {
  const hits = [];
  const sources = [rationale, ...citedWindows(rationale)];
  for (const window of sources) {
    for (const quote of collectQuotedPhrases(window)) {
      if (normalizeMatch(quote).length < 6) continue;
      const span = findNormalizedSpan(passage, quote) || findFuzzyPhrase(passage, quote);
      if (span && span.length >= 10) hits.push(span);
    }
  }
  if (hits.length === 0) return null;
  hits.sort((a, b) => b.length - a.length);
  let target = coverQuotes(passage, hits.slice(0, 3)) || hits[0];
  if (wantsSentenceTarget(prompt) || /underlined question/i.test(prompt)) {
    target = expandToSentence(passage, target);
  } else if (/underlined lines/i.test(prompt) && target.length < 48) {
    target = expandPoeticLines(passage, target);
  } else if (wantsPortionTarget(prompt) && target.length < 48) {
    target = expandToClause(passage, target);
  }
  return wrapOnce(passage, target);
}

function wrapUnderlinedQuestion(passage, prompt) {
  if (!/underlined question/i.test(prompt)) return null;
  const questions = sentencesOf(stripAttributionAndSetup(passage))
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.endsWith("?") && sentence.length >= 12);
  const target = questions.at(-1);
  return target ? wrapOnce(passage, target) : null;
}

function wrapTwoExampleQuestions(passage, rationale) {
  if (!/two such questions|poses two/i.test(rationale)) return null;
  const questions = passage.match(/What if[^?]{8,160}\?/g);
  if (!questions || questions.length < 2) return null;
  const start = passage.indexOf(questions[0]);
  const end = passage.indexOf(questions[1], start) + questions[1].length;
  return start >= 0 ? wrapOnce(passage, passage.slice(start, end)) : null;
}

function wrapStatesThatClause(passage, prompt, rationale) {
  const match = String(rationale).match(
    /underlined[^.!?]{0,120}(?:states? that|stating that|stating explicitly that|mentions? that|mentions)\s+(.{16,220}?)(?:\.|Thus,|The text|However|$)/i,
  );
  if (!match?.[1]) return null;
  const span = findNormalizedSpan(passage, match[1]) || findFuzzyPhrase(passage, match[1]);
  if (!span) return null;
  const target = wantsSentenceTarget(prompt) ? expandToSentence(passage, span) : span;
  return wrapOnce(passage, target);
}

function wrapUniqueCitedNgrams(passage, prompt, rationale) {
  for (const window of citedWindows(rationale)) {
    const tokens = tokenizeWithSpans(window);
    for (let size = 8; size >= 5; size -= 1) {
      for (let i = 0; i <= tokens.length - size; i += 1) {
        const phrase = window.slice(tokens[i].start, tokens[i + size - 1].end);
        if (/underlined|best answer|choice [a-d]|text as a whole/i.test(phrase)) continue;
        if (contentTokens(phrase).length < 4) continue;
        if ((phrase.match(/\d/g) || []).length >= 4) continue;
        const span = findNormalizedSpan(passage, phrase);
        if (!span || span.length < 24) continue;
        if (passage.split(span).length !== 2) continue;
        if (/the following text|in the text,|recalls how/i.test(span)) continue;
        let target = wantsSentenceTarget(prompt) ? expandToSentence(passage, span) : expandToClause(passage, span);
        if (target.length < 40) target = span;
        const wrapped = wrapOnce(passage, target);
        if (wrapped) return wrapped;
      }
    }
  }
  return null;
}

function expandToClause(passage, snippet) {
  const index = passage.indexOf(snippet);
  if (index >= 0) {
    const soAt = passage.lastIndexOf(" so ", index);
    if (soAt >= 0 && index - soAt < 100) {
      const stop = passage.indexOf(".", index);
      const clause = passage.slice(soAt + 1, stop >= 0 ? stop + 1 : index + snippet.length).trim();
      if (clause.length >= snippet.length) return clause;
    }
  }
  const clause = clausesOf(passage).find((item) => item.includes(snippet));
  return clause && clause.length <= Math.max(snippet.length * 3, 180) ? clause.trim() : snippet;
}

function expandPoeticLines(passage, snippet) {
  const index = passage.indexOf(snippet);
  if (index < 0) return snippet;
  const before = passage.slice(0, index);
  const start = Math.max(before.lastIndexOf("But "), before.lastIndexOf(". "));
  if (start < 0) return snippet;
  const from = before.lastIndexOf("But ") === start ? start : start + 2;
  return passage.slice(from).trim();
}

function wrapMechanismClause(passage, rationale) {
  if (!/how that mechanism could work|describes how that mechanism/i.test(rationale)) return null;
  const match = stripAttributionAndSetup(passage).match(/:\s*([^:]{24,280})\s*$/);
  return match ? wrapOnce(passage, match[1].trim()) : null;
}

function wrapLikelyClaim(passage, prompt) {
  if (
    !/underlined (claim|conclusion|explanation|observation)|observation presented in the underlined/i.test(
      prompt,
    )
  ) {
    return null;
  }
  const sentences = sentencesOf(stripAttributionAndSetup(passage))
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 24 && !/^\d+(?:\s+\d+){3,}/.test(sentence));
  const last = sentences.at(-1);
  if (last && /however|thus|therefore|overall|although|according to|claim|argue|fallen|durable|increased/i.test(last)) {
    return wrapOnce(passage, last);
  }
  return last ? wrapOnce(passage, last) : null;
}

function wrapParentheticalDefinition(passage, rationale) {
  if (!/set off with parentheses|provides a definition|parenthetical/i.test(rationale)) return null;
  const paren = stripAttributionAndSetup(passage).match(/\([^)]{8,120}\)/);
  return paren ? wrapOnce(passage, paren[0]) : null;
}

function focusRationale(rationale) {
  const windows = [...String(rationale).matchAll(/[^.!?]*underlined[^.!?]{0,420}/gi)].map((match) => match[0]);
  return [rationale, ...windows].join(" ");
}

function wrapByRationaleOverlap(passage, prompt, rationale) {
  const excerpt = stripAttributionAndSetup(passage);
  const units = wantsPortionTarget(prompt) ? clausesOf(excerpt) : sentencesOf(excerpt).map((item) => item.trim());
  const usable = units.filter((unit) => unit.length >= 12 && !/^\d+(?:\s+\d+){4,}/.test(unit));
  if (usable.length === 0) return null;

  const focusTokens = contentTokens(focusRationale(rationale));
  if (focusTokens.length < 3) return null;

  const scored = usable.map((unit, index) => {
    const tokens = contentTokens(unit);
    const overlap = tokens.filter((token) => focusTokens.includes(token));
    return {
      unit,
      index,
      score: overlap.length,
      ratio: overlap.length / Math.max(tokens.length, 1),
    };
  });
  scored.sort((a, b) => b.score - a.score || b.ratio - a.ratio);
  const best = scored[0];
  const second = scored[1];
  if (!best || best.score < 2) return null;

  if (wantsPortionTarget(prompt)) {
    const strong = scored.filter((item) => item.score >= Math.max(2, best.score - 1)).sort((a, b) => a.index - b.index);
    if (strong.length >= 2 && strong[strong.length - 1].index - strong[0].index <= 2) {
      const start = passage.indexOf(strong[0].unit);
      const last = strong[strong.length - 1].unit;
      const end = passage.indexOf(last, start) + last.length;
      if (start >= 0 && end > start && end - start <= 320) {
        return wrapOnce(passage, passage.slice(start, end));
      }
    }
  }

  if (second && best.score === second.score && Math.abs(best.ratio - second.ratio) < 0.04) return null;
  return wrapOnce(passage, best.unit);
}

function wrapFromRestDescribes(passage, rationale) {
  if (!/then the rest of the text describes/i.test(rationale)) return null;
  const sentences = sentencesOf(stripAttributionAndSetup(passage))
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  if (sentences.length < 2) return null;
  return wrapOnce(passage, sentences[1]);
}

function sentencesOf(passage) {
  const marked = String(passage)
    .replace(/(\d)\.(\d)/g, "$1\u0000$2")
    .replace(/\b([A-Z])\.(?=\s*[A-Za-z])/g, "$1\u0000");
  return (marked.match(/[^.!?]+(?:[.!?]+|$)/g) || [marked]).map((sentence) => sentence.replace(/\u0000/g, "."));
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

function stripAttributionAndSetup(passage) {
  let rest = String(passage);
  rest = rest.replace(/^The following texts? (?:is|are) from\b[\s\S]*?\d{4}[^.]*\.\s+/i, "");
  rest = rest.replace(/^The following text[\s\S]*?\.\s+/i, "");
  const setup = rest.match(/^(.{12,180}?\.)\s+/);
  if (setup) {
    const sentence = setup[1];
    const looksLikeSetup =
      /^(In the |The speaker |The narrator |The author )/i.test(sentence) ||
      /\b(walking through|companion|on a path|outdoor setting|the speaker is)\b/i.test(sentence);
    if (looksLikeSetup) rest = rest.slice(setup[0].length);
  }
  return rest;
}

function wrapFromStructureClues(passage, rationale) {
  const excerpt = stripAttributionAndSetup(passage);
  const sentences = sentencesOf(excerpt)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  if (sentences.length === 0) return null;

  let index = -1;
  if (/first two sentences[\s\S]{0,500}next sentence, which is underlined/i.test(rationale)) {
    index = 2;
  } else if (/first sentence[\s\S]{0,500}next sentence, which is underlined/i.test(rationale)) {
    index = 1;
  } else if (/(?:the )?(?:second|2nd) sentence, which is underlined/i.test(rationale)) {
    index = 1;
  } else if (/(?:the )?(?:third|3rd) sentence, which is underlined/i.test(rationale)) {
    index = 2;
  } else if (/(?:the )?first sentence(?: of the text)?, which is underlined/i.test(rationale)) {
    index = 0;
  } else if (/(?:the )?last sentence, which is underlined/i.test(rationale)) {
    index = sentences.length - 1;
  } else if (/next sentence, which is underlined/i.test(rationale)) {
    index = Math.min(1, sentences.length - 1);
  }
  if (index < 0 || index >= sentences.length) return null;
  return wrapOnce(passage, sentences[index]);
}

function wrapByKeywordOverlap(passage, rationale) {
  const windows = [...String(rationale).matchAll(/underlined (?:sentence|portion|claim)[^.!?]{0,420}/gi)].map(
    (match) => match[0].toLowerCase(),
  );
  if (windows.length === 0) return null;
  const excerpt = stripAttributionAndSetup(passage);
  const sentences = sentencesOf(excerpt)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 20);
  if (sentences.length < 2) return null;

  const scored = sentences.map((sentence) => {
    const tokens = [...new Set(sentence.toLowerCase().match(/\b[a-z]{5,}\b/g) || [])];
    const score = tokens.filter((token) => windows.some((window) => window.includes(token))).length;
    return { sentence, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const second = scored[1];
  if (!best || best.score < 2 || (second && best.score === second.score)) return null;
  return wrapOnce(passage, best.sentence);
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
  let passage = formatPassage(question.passage);
  if (hasUnderlineMarkup(passage)) {
    return { ...question, passage: mergeUnderlineTags(insertStructuralBreaks(passage)) };
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
  if (!wantsUnderline) return { ...question, passage };

  const allRationale = Object.values(question.explanations || {}).join("\n");
  const rationale = question.explanations?.[question.correctAnswer] || allRationale;
  const fromClues = wrapFromStructureClues(passage, rationale);
  if (fromClues) return { ...question, passage: fromClues };

  const literary = wrapLiteraryOpening(passage);
  if (literary) return { ...question, passage: literary };

  const questionMark = wrapUnderlinedQuestion(passage, prompt);
  if (questionMark) return { ...question, passage: questionMark };

  const twoQuestions = wrapTwoExampleQuestions(passage, rationale);
  if (twoQuestions) return { ...question, passage: twoQuestions };

  const parenthetical = wrapParentheticalDefinition(passage, rationale);
  if (parenthetical) return { ...question, passage: parenthetical };

  if (/underlined (observation|claim|conclusion)|observation presented in the underlined/i.test(prompt)) {
    const observation = wrapLikelyClaim(passage, prompt);
    if (observation) return { ...question, passage: observation };
  }

  const statesThat = wrapStatesThatClause(passage, prompt, rationale);
  if (statesThat) return { ...question, passage: statesThat };

  const mechanism = wrapMechanismClause(passage, rationale);
  if (mechanism) return { ...question, passage: mechanism };

  const fromQuotes = wrapFromQuotedRationale(passage, prompt, rationale);
  if (fromQuotes) return { ...question, passage: fromQuotes };

  const uniqueNgrams = wrapUniqueCitedNgrams(passage, prompt, rationale);
  if (uniqueNgrams) return { ...question, passage: uniqueNgrams };

  const quote = quoteNearUnderlined(rationale);
  if (quote && passage.includes(quote)) {
    const target = /sentence/i.test(prompt) ? expandToSentence(passage, quote) : quote;
    const wrapped = wrapOnce(passage, target);
    if (wrapped) return { ...question, passage: wrapped };
  }

  const restDescribes = wrapFromRestDescribes(passage, rationale);
  if (restDescribes) return { ...question, passage: restDescribes };

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

  const byKeywords = wrapByKeywordOverlap(passage, rationale);
  if (byKeywords) return { ...question, passage: byKeywords };

  const likelyClaim = wrapLikelyClaim(passage, prompt);
  if (likelyClaim) return { ...question, passage: likelyClaim };

  const byOverlap = wrapByRationaleOverlap(passage, prompt, rationale);
  if (byOverlap) return { ...question, passage: byOverlap };

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

  return { ...question, passage };
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

function multiplyCtm(left, right) {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

function applyCtm(ctm, x, y) {
  return {
    x: ctm[0] * x + ctm[2] * y + ctm[4],
    y: ctm[1] * x + ctm[3] * y + ctm[5],
  };
}

function bandFromHorizontal(x0, y0, x1, y1, pad) {
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const midY = (y0 + y1) / 2;
  if (Math.abs(y1 - y0) > 3.2 || maxX - minX < 8) return null;
  return { x0: minX, x1: maxX, y0: midY - pad, y1: midY + pad };
}

async function collectDrawnUnderlineBands(pdfjs, page) {
  const bands = [];
  let opList;
  try {
    opList = await page.getOperatorList();
  } catch {
    return bands;
  }
  const OPS = pdfjs.OPS || {};
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  let lineWidth = 1;
  let pathPts = [];

  const flushPath = () => {
    for (let i = 1; i < pathPts.length; i += 1) {
      const previous = pathPts[i - 1];
      const current = pathPts[i];
      const band = bandFromHorizontal(
        previous.x,
        previous.y,
        current.x,
        current.y,
        Math.max(2.2, lineWidth + 2),
      );
      if (band) bands.push(band);
    }
    pathPts = [];
  };

  for (let i = 0; i < opList.fnArray.length; i += 1) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i] || [];
    if (fn === OPS.save) stack.push(ctm.slice());
    else if (fn === OPS.restore) ctm = stack.pop() || ctm;
    else if (fn === OPS.transform && args.length >= 6) ctm = multiplyCtm(ctm, args);
    else if (fn === OPS.setLineWidth) lineWidth = Number(args[0]) || lineWidth;
    else if (fn === OPS.moveTo && args.length >= 2) pathPts.push(applyCtm(ctm, args[0], args[1]));
    else if (fn === OPS.lineTo && args.length >= 2) pathPts.push(applyCtm(ctm, args[0], args[1]));
    else if (fn === OPS.rectangle && args.length >= 4) {
      const [x, y, width, height] = args;
      if (Math.abs(height) <= 3.2 && Math.abs(width) >= 8) {
        const start = applyCtm(ctm, x, y);
        const end = applyCtm(ctm, x + width, y);
        const band = bandFromHorizontal(start.x, start.y, end.x, end.y, Math.max(2.2, Math.abs(height) + 2));
        if (band) bands.push(band);
      }
    } else if (fn === OPS.constructPath) {
      const ops = args[0];
      const coords = args[1] || [];
      if (Array.isArray(ops) && Array.isArray(coords)) {
        let cursor = 0;
        for (const op of ops) {
          if (op === OPS.moveTo || op === OPS.lineTo) {
            const x = coords[cursor];
            const y = coords[cursor + 1];
            cursor += 2;
            if (typeof x === "number" && typeof y === "number") pathPts.push(applyCtm(ctm, x, y));
          } else if (op === OPS.rectangle) {
            const x = coords[cursor];
            const y = coords[cursor + 1];
            const width = coords[cursor + 2];
            const height = coords[cursor + 3];
            cursor += 4;
            if (Math.abs(height) <= 3.2 && Math.abs(width) >= 8) {
              const start = applyCtm(ctm, x, y);
              const end = applyCtm(ctm, x + width, y);
              const band = bandFromHorizontal(start.x, start.y, end.x, end.y, 3);
              if (band) bands.push(band);
            }
          } else {
            cursor += 6;
          }
        }
      }
    } else if (fn === OPS.stroke || fn === OPS.closeStroke || fn === OPS.fill || fn === OPS.eoFill || fn === OPS.fillStroke) {
      flushPath();
    } else if (fn === OPS.endPath) {
      pathPts = [];
    }
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
  const drawn = await collectDrawnUnderlineBands(pdfjs, page);
  const bands = [...collectUnderlineBands(annotations), ...drawn];
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
        passage: formatPassage(passage),
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

function recoverExistingQuestions() {
  if (!fs.existsSync(OUTPUT)) {
    throw new Error(
      "No PDFs found and src/data/questions.json is missing. Place College Board question-bank exports next to package.json.",
    );
  }
  console.warn("No PDFs found in the project root. Recovering <u> tags on existing questions.json.");
  return JSON.parse(fs.readFileSync(OUTPUT, "utf8"));
}

async function main() {
  const pdfs = findPdfs();
  const byId = new Map();
  let skipped = 0;

  if (pdfs.length === 0) {
    for (const question of recoverExistingQuestions()) {
      byId.set(question.id, question);
    }
  } else {
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
  }

  const questions = Array.from(byId.values()).map(wrapUnderlinedPassage).sort((a, b) => {
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

module.exports = {
  wrapUnderlinedPassage,
  hasUnderlineMarkup,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
