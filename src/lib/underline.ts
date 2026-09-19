import type { Question } from "./types";

export function hasUnderlineMarkup(value: string) {
  return /<u[\s>]|<\/u>/i.test(value || "");
}

function mergeUnderlineTags(value: string) {
  return String(value || "").replace(/<\/u>(\s*)<u>/g, "$1");
}

function wrapOnce(haystack: string, needle: string) {
  if (!needle || needle.length < 2) return null;
  const index = haystack.indexOf(needle);
  if (index < 0) return null;
  return `${haystack.slice(0, index)}<u>${needle}</u>${haystack.slice(index + needle.length)}`;
}

function sentencesOf(passage: string) {
  const marked = String(passage)
    .replace(/(\d)\.(\d)/g, "$1\u0000$2")
    .replace(/\b([A-Z])\.(?=\s*[a-z])/g, "$1\u0000");
  return (marked.match(/[^.!?]+(?:[.!?]+|$)/g) || [marked]).map((sentence) => sentence.replace(/\u0000/g, "."));
}

function stripAttributionAndSetup(passage: string) {
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

function wrapFromStructureClues(passage: string, rationale: string) {
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

function wrapLiteraryOpening(passage: string) {
  if (!/^The following text is from\b/i.test(passage)) return null;
  const context = passage.match(
    /In the (?:poem|text|excerpt|passage|novel|play|essay|story|book)\b[^.?!]*[.?!]\s+/i,
  );
  if (!context) return null;
  const cut = (context.index ?? 0) + context[0].length;
  const prefix = passage.slice(0, cut);
  const rest = passage.slice(cut);
  const clauseMatch = rest.match(/^.{8,}?(?:—|–|[.?!])/);
  const target = clauseMatch ? clauseMatch[0] : "";
  if (!target || target.length < 8 || target.length > rest.length * 0.9) return null;
  return `${prefix}<u>${target}</u>${rest.slice(target.length)}`;
}

function quoteNearUnderlined(text: string) {
  const patterns = [
    /which is underlined[,:\s]+[^“"”]{0,180}[“"]([^"”]{3,240})[”"]/i,
    /[“"]([^"”]{3,240})[”"][^.]{0,40}(?:is|are) underlined/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return "";
}

function wrapByKeywordOverlap(passage: string, rationale: string) {
  const windows = [...rationale.matchAll(/underlined (?:sentence|portion|claim)[^.!?]{0,420}/gi)].map(
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

function wrapUnderlinedQuestion(passage: string, prompt: string) {
  if (!/underlined question/i.test(prompt)) return null;
  const questions = sentencesOf(stripAttributionAndSetup(passage))
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.endsWith("?") && sentence.length >= 12);
  const target = questions.at(-1);
  return target ? wrapOnce(passage, target) : null;
}

function wrapTwoExampleQuestions(passage: string, rationale: string) {
  if (!/two such questions|poses two/i.test(rationale)) return null;
  const questions = passage.match(/What if[^?]{8,160}\?/g);
  if (!questions || questions.length < 2) return null;
  const start = passage.indexOf(questions[0]);
  const end = passage.indexOf(questions[1], start) + questions[1].length;
  return start >= 0 ? wrapOnce(passage, passage.slice(start, end)) : null;
}

function wrapParentheticalDefinition(passage: string, rationale: string) {
  if (!/set off with parentheses|provides a definition|parenthetical/i.test(rationale)) return null;
  const paren = stripAttributionAndSetup(passage).match(/\([^)]{8,120}\)/);
  return paren ? wrapOnce(passage, paren[0]) : null;
}

function wrapLikelyClaim(passage: string, prompt: string) {
  if (
    !/underlined (claim|conclusion|explanation|observation)|observation presented in the underlined/i.test(prompt)
  ) {
    return null;
  }
  const sentences = sentencesOf(stripAttributionAndSetup(passage))
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 24 && !/^\d+(?:\s+\d+){3,}/.test(sentence));
  const last = sentences.at(-1);
  return last ? wrapOnce(passage, last) : null;
}

function wrapFromQuotedRationale(passage: string, prompt: string, rationale: string) {
  const quotes = [...rationale.matchAll(/[\u201c"]([^"\u201d]{6,240})["\u201d]/g)].map((match) => match[1].trim());
  for (const quote of quotes.sort((a, b) => b.length - a.length)) {
    if (!passage.includes(quote)) continue;
    const target = /underlined (sentence|question|statement)/i.test(prompt)
      ? sentencesOf(passage).find((sentence) => sentence.includes(quote))?.trim() || quote
      : quote;
    const wrapped = wrapOnce(passage, target);
    if (wrapped) return wrapped;
  }
  return null;
}

export function ensurePassageUnderlines(question: Question): Question {
  let passage = question.passage || "";
  if (hasUnderlineMarkup(passage)) {
    return { ...question, passage: mergeUnderlineTags(passage) };
  }
  if (/_{3,}/.test(passage)) {
    return { ...question, passage: passage.replace(/_{3,}/g, "<u>\u00a0\u00a0\u00a0\u00a0</u>") };
  }

  const prompt = question.prompt || "";
  const wantsUnderline =
    /underlined/i.test(prompt) ||
    /completes the text so that it conforms/i.test(prompt) ||
    /most logical transition/i.test(prompt) ||
    /most logical and precise word/i.test(prompt);
  if (!wantsUnderline) return question;

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

  const fromQuotes = wrapFromQuotedRationale(passage, prompt, rationale);
  if (fromQuotes) return { ...question, passage: fromQuotes };

  const quote = quoteNearUnderlined(rationale);
  if (quote && passage.includes(quote)) {
    const target = /sentence/i.test(prompt) ? (sentencesOf(passage).find((s) => s.includes(quote))?.trim() || quote) : quote;
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

  const byKeywords = wrapByKeywordOverlap(passage, rationale);
  if (byKeywords) return { ...question, passage: byKeywords };

  const likelyClaim = wrapLikelyClaim(passage, prompt);
  if (likelyClaim) return { ...question, passage: likelyClaim };

  if (
    /completes the text so that it conforms/i.test(prompt) ||
    /Form, Structure, and Sense|Boundaries/.test(question.skill || "")
  ) {
    const matches = (question.choices || [])
      .map((choice) => choice.text)
      .filter((text) => text && text.length >= 4 && passage.includes(text))
      .sort((a, b) => b.length - a.length);
    const unique = matches.filter((text) => passage.split(text).length === 2);
    const wrapped = wrapOnce(passage, unique[0] || matches[0] || "");
    if (wrapped) return { ...question, passage: wrapped };
  }

  return question;
}
