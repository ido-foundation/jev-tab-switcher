// Thin client for the Jev Decisions API (OpenRouter-compatible by default).

export const DEFAULT_SETTINGS = {
  apiKey: "",
  endpoint: "https://openrouter.ai/api/alpha/decisions",
  model: "typesafe/jev-1.14",
  minProb: 0.55,
  maxCandidates: 80,
};

export async function callJev(body, { apiKey, endpoint }, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Title": "Jev Tab Switcher",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Jev API ${res.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}
