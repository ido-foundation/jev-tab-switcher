import {
  buildJevRequest,
  decide,
  extractChoice,
  rankLocally,
  selectCandidates,
  describeTab,
} from "./matcher.js";
import { callJev, DEFAULT_SETTINGS } from "./jev.js";

async function getSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  return { ...DEFAULT_SETTINGS, ...stored };
}

async function allTabs() {
  const tabs = await chrome.tabs.query({});
  // Don't offer the extension's own pages.
  return tabs.filter((t) => !t.url?.startsWith(`chrome-extension://${chrome.runtime.id}`));
}

export async function focusTab(tabId) {
  const tab = await chrome.tabs.update(tabId, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  return tab;
}

function serialize(tab, probability) {
  return {
    id: tab.id,
    title: tab.title,
    url: tab.url,
    favIconUrl: tab.favIconUrl,
    description: describeTab(tab),
    probability,
  };
}

/**
 * End-to-end resolution: tabs -> candidates -> Jev -> decision.
 * Falls back to local ranking if there's no key or the API fails.
 */
async function resolve(query, { autoSwitch = true } = {}) {
  const settings = await getSettings();
  const tabs = await allTabs();
  const candidates = selectCandidates(query, tabs, settings.maxCandidates);

  if (!settings.apiKey) {
    return localFallback(query, tabs, "No API key set — using local matching. Add one in Options.");
  }

  let answer;
  try {
    const body = buildJevRequest(query, candidates, settings.model);
    const response = await callJev(body, settings);
    answer = extractChoice(response);
  } catch (err) {
    console.error("[jev-tabs]", err);
    return localFallback(query, tabs, `Jev unavailable (${err.message}). Using local matching.`);
  }

  const decision = decide(answer, candidates, { minProb: settings.minProb });
  if (decision.action === "switch" && autoSwitch) {
    await focusTab(decision.tab.id);
    return {
      action: "switched",
      tab: serialize(decision.tab, decision.probability),
      source: "jev",
    };
  }
  return {
    action: "choose",
    source: "jev",
    noneProbability: decision.noneProbability,
    candidates: (decision.ranked || []).map((r) => serialize(r.tab, r.probability)),
  };
}

function localFallback(query, tabs, notice) {
  const ranked = rankLocally(query, tabs).filter((r) => r.score > 0).slice(0, 6);
  return {
    action: "choose",
    source: "local",
    notice,
    candidates: ranked.map((r) => serialize(r.tab, null)),
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === "resolve") return sendResponse(await resolve(msg.query));
      if (msg.type === "focus") {
        await focusTab(msg.tabId);
        return sendResponse({ ok: true });
      }
      if (msg.type === "localRank") {
        const tabs = await allTabs();
        const ranked = rankLocally(msg.query, tabs)
          .filter((r) => r.score > 0)
          .slice(0, 6)
          .map((r) => serialize(r.tab, null));
        return sendResponse({ candidates: ranked });
      }
      sendResponse({ error: `unknown message ${msg.type}` });
    } catch (err) {
      sendResponse({ error: err.message });
    }
  })();
  return true; // async response
});

// Omnibox: type "t" + space in the address bar, then the phrase, then Enter.
chrome.omnibox.setDefaultSuggestion({ description: "Switch to tab matching: %s (via Jev)" });
chrome.omnibox.onInputEntered.addListener(async (text) => {
  const result = await resolve(text.trim());
  const nothingMatches = (result.noneProbability ?? 0) > 0.5;
  if (result.action === "choose" && result.candidates?.length && !nothingMatches) {
    // From the omnibox there's no UI to choose, so take the best guess.
    await focusTab(result.candidates[0].id);
  }
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === "install") chrome.runtime.openOptionsPage();
});
