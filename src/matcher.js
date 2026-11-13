// Pure matching logic, shared by the service worker, popup and tests.
// No chrome.* APIs in here.

export const NONE_KEY = "none";

// Common ways people refer to web apps that don't appear literally in titles.
const SYNONYMS = {
  slides: ["presentation", "deck", "slides", "keynote", "pitch"],
  deck: ["presentation", "slides", "deck", "pitch"],
  doc: ["document", "docs", "doc"],
  docs: ["document", "docs", "doc"],
  sheet: ["spreadsheets", "sheet", "sheets", "xlsx"],
  sheets: ["spreadsheets", "sheet", "sheets"],
  spreadsheet: ["spreadsheets", "sheet", "sheets"],
  mail: ["gmail", "mail", "inbox", "outlook"],
  email: ["gmail", "mail", "inbox", "outlook"],
  inbox: ["gmail", "mail", "inbox"],
  calendar: ["calendar", "cal"],
  pr: ["pull", "pr", "merge"],
  repo: ["github", "gitlab", "repo"],
  video: ["youtube", "video", "loom", "vimeo"],
  chat: ["slack", "chat", "claude", "chatgpt", "messages"],
  ticket: ["linear", "jira", "issue", "ticket"],
  issue: ["linear", "jira", "issue", "issues"],
};

export function tokenize(text) {
  return (text || "")
    .toLowerCase()
    .split(/[^a-z0-9֐-׿]+/i)
    .filter((t) => t.length > 0);
}

function expand(token) {
  return SYNONYMS[token] || [token];
}

function describeUrl(url) {
  try {
    const u = new URL(url);
    return { host: u.hostname.replace(/^www\./, ""), path: u.pathname };
  } catch {
    return { host: "", path: url || "" };
  }
}

/**
 * Fast local relevance score. Used for (a) instant results while typing,
 * (b) narrowing the candidate set before calling Jev, and (c) the offline fallback.
 */
export function localScore(query, tab) {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return 0;
  const title = (tab.title || "").toLowerCase();
  const { host, path } = describeUrl(tab.url);
  const urlText = `${host} ${path}`.toLowerCase();
  const titleTokens = new Set(tokenize(title));
  const urlTokens = new Set(tokenize(urlText));

  let score = 0;
  for (const q of qTokens) {
    let best = 0;
    for (const variant of expand(q)) {
      if (titleTokens.has(variant)) best = Math.max(best, 3);
      else if (title.includes(variant)) best = Math.max(best, 2);
      if (urlTokens.has(variant)) best = Math.max(best, 2);
      else if (urlText.includes(variant)) best = Math.max(best, 1);
    }
    score += best;
  }
  // Whole phrase in title is a strong signal.
  if (qTokens.length > 1 && title.includes(qTokens.join(" "))) score += 3;
  return score;
}

/** Rank tabs locally; ties broken by most recently used. */
export function rankLocally(query, tabs) {
  return tabs
    .map((tab) => ({ tab, score: localScore(query, tab) }))
    .sort(
      (a, b) =>
        b.score - a.score || (b.tab.lastAccessed || 0) - (a.tab.lastAccessed || 0)
    );
}

/**
 * Pick at most `max` tabs to send to Jev: every locally matching tab first,
 * then the most recently used tabs to fill the remaining slots (so purely
 * semantic matches like "board slides" -> "Q4 Investor Update" still reach it).
 */
export function selectCandidates(query, tabs, max = 80) {
  if (tabs.length <= max) return tabs;
  const ranked = rankLocally(query, tabs);
  const hits = ranked.filter((r) => r.score > 0).map((r) => r.tab);
  const picked = new Set(hits.slice(0, max));
  const byRecency = [...tabs].sort(
    (a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0)
  );
  for (const t of byRecency) {
    if (picked.size >= max) break;
    picked.add(t);
  }
  return [...picked];
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export function optionKey(tab) {
  return `tab_${tab.id}`;
}

export function describeTab(tab) {
  const { host, path } = describeUrl(tab.url);
  const title = truncate(tab.title || "(untitled)", 140);
  const where = truncate(`${host}${path}`, 110);
  const flags = [tab.active ? "currently focused" : null, tab.pinned ? "pinned" : null]
    .filter(Boolean)
    .join(", ");
  return flags ? `${title} — ${where} (${flags})` : `${title} — ${where}`;
}

/** Build the Jev Decisions API request body. */
export function buildJevRequest(query, tabs, model) {
  const criteria = {};
  for (const tab of tabs) criteria[optionKey(tab)] = describeTab(tab);
  criteria[NONE_KEY] = "None of the open tabs is what the user is looking for.";

  return {
    model,
    state: {
      user_request: query,
      context:
        "The user typed a short, informal phrase to jump to one of their open " +
        "browser tabs. Each option is an open tab described as " +
        "'title — host/path'. Interpret the phrase semantically: e.g. 'slides' " +
        "can mean a Google Slides / presentation URL, 'the PR' a GitHub pull " +
        "request, a person's name an email thread or doc they own.",
    },
    questions: {
      tab: {
        type: "choice",
        instructions:
          "Which open tab is the user trying to switch to with `user_request`?",
        criteria,
      },
    },
  };
}

/** Pull the `tab` choice answer out of a Decisions API response. */
export function extractChoice(response) {
  const answers = response?.answers ?? response?.data?.answers;
  const ans = answers?.tab;
  if (!ans || !ans.probabilities) {
    throw new Error("Unexpected Jev response: " + JSON.stringify(response).slice(0, 300));
  }
  return ans;
}

/**
 * Turn Jev's answer into an action.
 *  - "switch": confident single tab
 *  - "choose": show ranked candidates for the user to confirm
 */
export function decide(answer, tabs, { minProb = 0.55, maxCandidates = 6 } = {}) {
  const byKey = new Map(tabs.map((t) => [optionKey(t), t]));
  const ranked = Object.entries(answer.probabilities)
    .filter(([k]) => k !== NONE_KEY && byKey.has(k))
    .sort((a, b) => b[1] - a[1])
    .map(([k, p]) => ({ tab: byKey.get(k), probability: p }));

  const noneProb = answer.probabilities[NONE_KEY] ?? 0;
  const top = ranked[0];
  if (top && answer.choice !== NONE_KEY && top.probability >= minProb) {
    return { action: "switch", tab: top.tab, probability: top.probability, ranked };
  }
  return {
    action: "choose",
    noneProbability: noneProb,
    ranked: ranked.filter((r) => r.probability > 0.01).slice(0, maxCandidates),
  };
}
