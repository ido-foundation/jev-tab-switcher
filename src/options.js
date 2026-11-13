import { DEFAULT_SETTINGS, callJev } from "./jev.js";
import { buildJevRequest, extractChoice } from "./matcher.js";

const fields = Object.keys(DEFAULT_SETTINGS);
const $ = (id) => document.getElementById(id);
const msg = (t) => ($("msg").textContent = t);

function read() {
  const out = {};
  for (const f of fields) {
    const el = $(f);
    out[f] = el.type === "number" ? Number(el.value) : el.value.trim();
  }
  return out;
}

async function load() {
  const s = { ...DEFAULT_SETTINGS, ...(await chrome.storage.local.get(fields)) };
  for (const f of fields) $(f).value = s[f];
}

$("save").onclick = async () => {
  await chrome.storage.local.set(read());
  msg("Saved.");
};

$("test").onclick = async () => {
  const s = read();
  msg("Testing…");
  const fakeTabs = [
    { id: 1, title: "Q4 Board Meeting - Google Slides", url: "https://docs.google.com/presentation/d/abc/edit" },
    { id: 2, title: "Inbox (3) - Gmail", url: "https://mail.google.com/mail/u/0/#inbox" },
    { id: 3, title: "Fix login race · Pull Request #42", url: "https://github.com/acme/app/pull/42" },
  ];
  try {
    const t0 = performance.now();
    const res = await callJev(buildJevRequest("board slides", fakeTabs, s.model), s);
    const ans = extractChoice(res);
    const ms = Math.round(performance.now() - t0);
    msg(`OK in ${ms} ms: picked ${ans.choice} (confidence ${ans.confidence?.toFixed?.(2)})`);
  } catch (e) {
    msg(`Failed: ${e.message}`);
  }
};

load();
