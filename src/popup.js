const $q = document.getElementById("q");
const $status = document.getElementById("status");
const $results = document.getElementById("results");

let candidates = [];
let selected = 0;
let typingTimer;
let answeredQuery = null; // query whose candidates came from Jev

function send(msg) {
  return chrome.runtime.sendMessage(msg);
}

function setStatus(text, thinking = false) {
  $status.textContent = text;
  $status.classList.toggle("thinking", thinking);
}

function render() {
  $results.replaceChildren(
    ...candidates.map((c, i) => {
      const li = document.createElement("li");
      li.className = i === selected ? "sel" : "";
      const img = document.createElement("img");
      img.src = c.favIconUrl || "";
      img.onerror = () => (img.style.visibility = "hidden");
      const text = document.createElement("div");
      const t = document.createElement("div");
      t.className = "t";
      t.textContent = c.title || "(untitled)";
      const u = document.createElement("div");
      u.className = "u";
      u.textContent = c.url;
      text.append(t, u);
      const p = document.createElement("span");
      p.className = "p";
      p.textContent = c.probability != null ? `${Math.round(c.probability * 100)}%` : "";
      li.append(img, text, p);
      li.onclick = () => focus(c.id);
      return li;
    })
  );
}

async function focus(tabId) {
  await send({ type: "focus", tabId });
  window.close();
}

async function localPreview() {
  const query = $q.value.trim();
  if (!query) {
    candidates = [];
    setStatus("");
    return render();
  }
  const { candidates: c } = await send({ type: "localRank", query });
  candidates = c || [];
  selected = 0;
  setStatus(candidates.length ? "Instant matches. Press Enter to ask Jev." : "Press Enter to ask Jev.");
  render();
}

async function askJev() {
  const query = $q.value.trim();
  if (!query) return;
  setStatus("Asking Jev", true);
  const res = await send({ type: "resolve", query });
  if (res.error) return setStatus(`Error: ${res.error}`);
  if (res.action === "switched") return window.close();

  candidates = res.candidates || [];
  selected = 0;
  answeredQuery = query;
  render();
  if (res.notice) setStatus(res.notice);
  else if (!candidates.length) setStatus("No matching tab.");
  else if (res.noneProbability > 0.5) setStatus("Jev doesn't think any tab matches. Closest guesses:");
  else setStatus("Not sure which one. Pick a tab:");
}

$q.addEventListener("input", () => {
  clearTimeout(typingTimer);
  answeredQuery = null;
  typingTimer = setTimeout(localPreview, 60);
});

$q.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (!candidates.length) return;
    selected = (selected + (e.key === "ArrowDown" ? 1 : -1) + candidates.length) % candidates.length;
    render();
  } else if (e.key === "Enter") {
    e.preventDefault();
    // Cmd/Ctrl+Enter, or Enter after moving the selection, opens the highlighted tab directly.
    const alreadyAsked = answeredQuery === $q.value.trim();
    if ((e.metaKey || e.ctrlKey || selected > 0 || alreadyAsked) && candidates[selected]) focus(candidates[selected].id);
    else askJev();
  } else if (e.key === "Escape") {
    window.close();
  }
});

document.getElementById("opts").onclick = (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
};

$q.focus();
