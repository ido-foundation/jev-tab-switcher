// Live check against the Jev Decisions API. Run: OPENROUTER_API_KEY=... npm run smoke
import { buildJevRequest, extractChoice, decide } from "../src/matcher.js";
import { callJev } from "../src/jev.js";

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error("Set OPENROUTER_API_KEY");
  process.exit(1);
}
const endpoint = process.env.JEV_ENDPOINT || "https://openrouter.ai/api/alpha/decisions";

const tabs = [
  { id: 1, title: "Q4 Investor Update - Google Slides", url: "https://docs.google.com/presentation/d/x/edit" },
  { id: 2, title: "Board agenda - Google Docs", url: "https://docs.google.com/document/d/y/edit" },
  { id: 3, title: "Inbox (12) - Gmail", url: "https://mail.google.com/mail/u/0/" },
  { id: 4, title: "fix: tab race · Pull Request #7 · acme/app", url: "https://github.com/acme/app/pull/7" },
  { id: 5, title: "Deus forecasts dashboard", url: "http://localhost:3000/dashboard" },
];
const queries = ["board slides", "that PR I was reviewing", "forecast dashboard", "weather in tokyo"];

for (const model of ["typesafe/jev-1.14", "typesafe/jev-1.13"]) {
  for (const q of queries) {
    const t0 = Date.now();
    try {
      const res = await callJev(buildJevRequest(q, tabs, model), { apiKey, endpoint });
      const a = extractChoice(res);
      const d = decide(a, tabs);
      console.log(`${model}  ${JSON.stringify(q)} -> ${a.choice} (conf ${a.confidence}) ${d.action} ${Date.now() - t0}ms`);
      console.log("   ", JSON.stringify(a.probabilities));
    } catch (e) {
      console.log(`${model}  ${JSON.stringify(q)} ERROR ${e.message}`);
    }
  }
}
