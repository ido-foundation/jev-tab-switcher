<img src="icons/logo-512.png" width="96" alt="Jev Tab Switcher logo">

# Jev Tab Switcher

Type a vague phrase like **"board slides"** and Chrome jumps to the right tab.

The tab is picked by [Jev](https://openrouter.ai/docs/guides/community/jev), TypeSafe AI's *decision model*. Jev doesn't generate text. It answers a typed `choice` question with a probability for each option, typically in 70–500 ms. Every open tab is one option, so you get a calibrated "which tab?" answer instead of parsing LLM output.

## How it works

```
⌘⇧K → popup  ──type──▶  instant local matches (title/URL + synonyms)
             ──Enter─▶  service worker
                          1. chrome.tabs.query({}) across all windows
                          2. narrow to ≤80 candidates (keyword hits + most recent)
                          3. POST /api/alpha/decisions
                               state:     { user_request: "board slides", context }
                               questions: { tab: { type: "choice",
                                                   criteria: { tab_<id>: "title — host/path", …, none } } }
                          4. top tab prob ≥ 0.55 → focus tab + window
                             otherwise          → show ranked list with probabilities
```

* `src/matcher.js` holds the pure logic: candidate selection, request building, and the switch-or-ask decision. It's unit tested.
* `src/jev.js` is the HTTP client for the Decisions API.
* `src/background.js` is the service worker: tabs, omnibox, and messaging.
* `src/popup.*` is the search box UI. `src/options.*` holds settings and a connection test.

The `none` option lets Jev say "nothing matches", so it isn't forced to pick a wrong tab. If there's no API key, or the API fails, the extension falls back to local keyword matching.

## Install

1. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and select this folder.
2. The options page opens. Paste an **OpenRouter API key** and click **Test connection**.
3. Press **⌘⇧K** (Ctrl+Shift+K on other systems). If the shortcut is taken, rebind it at `chrome://extensions/shortcuts`.

## Use

| Action | Result |
|---|---|
| Type, then **Enter** | Ask Jev. Switches if it's confident, otherwise shows a ranked list |
| **↑/↓**, then **Enter** | Open the highlighted tab |
| **⌘Enter** | Open the top local match right away, skipping Jev |
| Address bar: `t` + space + phrase | Same as the popup. Always jumps to the best guess |

## Dev

```bash
npm test                                   # unit tests (no network)
OPENROUTER_API_KEY=sk-or-... npm run smoke # live calls to Jev 1.14 and 1.13
```

## Notes

* The API key lives in `chrome.storage.local`, on your machine only. That's fine for a personal tool. For a shared or published extension, put a small proxy in front of the key.
* Only tab titles and URLs are sent to Jev, not page contents.
