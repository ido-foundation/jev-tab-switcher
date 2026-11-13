import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildJevRequest,
  decide,
  extractChoice,
  rankLocally,
  selectCandidates,
  NONE_KEY,
} from "../src/matcher.js";

const tabs = [
  { id: 11, title: "Q4 Investor Update - Google Slides", url: "https://docs.google.com/presentation/d/x/edit", lastAccessed: 5 },
  { id: 12, title: "Board agenda - Google Docs", url: "https://docs.google.com/document/d/y/edit", lastAccessed: 9 },
  { id: 13, title: "Inbox (12) - Gmail", url: "https://mail.google.com/mail/u/0/", lastAccessed: 7 },
  { id: 14, title: "fix: tab race by ido · Pull Request #7 · acme/app", url: "https://github.com/acme/app/pull/7", lastAccessed: 3 },
];

test("local ranking uses synonyms (slides -> presentation)", () => {
  const top = rankLocally("board slides", tabs)[0].tab;
  // "board" hits the Docs tab title, "slides" hits the Slides tab; both score > 0
  assert.ok([11, 12].includes(top.id));
  assert.equal(rankLocally("the pr", tabs)[0].tab.id, 14);
  assert.equal(rankLocally("email", tabs)[0].tab.id, 13);
});

test("selectCandidates keeps matches and fills with recent tabs", () => {
  const many = Array.from({ length: 200 }, (_, i) => ({
    id: 100 + i, title: `Random page ${i}`, url: `https://example.com/${i}`, lastAccessed: i,
  }));
  const picked = selectCandidates("board slides", [...many, ...tabs], 20);
  assert.equal(picked.length, 20);
  assert.ok(picked.some((t) => t.id === 11));
  assert.ok(picked.some((t) => t.id === 299)); // most recent filler
});

test("buildJevRequest produces a choice question with a none option", () => {
  const body = buildJevRequest("board slides", tabs, "typesafe/jev-1.14");
  const q = body.questions.tab;
  assert.equal(q.type, "choice");
  assert.equal(Object.keys(q.criteria).length, tabs.length + 1);
  assert.ok(q.criteria.tab_11.includes("docs.google.com/presentation"));
  assert.ok(q.criteria[NONE_KEY]);
  assert.equal(body.state.user_request, "board slides");
});

test("decide switches when confident, asks when not", () => {
  const confident = extractChoice({
    answers: { tab: { type: "choice", choice: "tab_11", confidence: 0.8, probabilities: { tab_11: 0.86, tab_12: 0.1, none: 0.04 } } },
  });
  const d1 = decide(confident, tabs);
  assert.equal(d1.action, "switch");
  assert.equal(d1.tab.id, 11);

  const split = { choice: "tab_11", probabilities: { tab_11: 0.48, tab_12: 0.45, none: 0.07 } };
  const d2 = decide(split, tabs);
  assert.equal(d2.action, "choose");
  assert.deepEqual(d2.ranked.map((r) => r.tab.id), [11, 12]);

  const none = { choice: "none", probabilities: { tab_11: 0.2, none: 0.8 } };
  assert.equal(decide(none, tabs).action, "choose");
});

test("extractChoice rejects malformed responses", () => {
  assert.throws(() => extractChoice({ error: "nope" }), /Unexpected Jev response/);
});
