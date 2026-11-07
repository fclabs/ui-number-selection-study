"use strict";
const SIZE = 10, TOTAL = SIZE * SIZE, PREVIEW_MS = 1000;
const STORE_KEY = "nss.trials.v1";
const COLS = ["experiment_id", "started_at", "sequence", "number", "x", "y", "time_ms", "errors"];

const $ = (id) => document.getElementById(id);
const gridEl = $("grid"), targetEl = $("target-box"), progressEl = $("progress"), startBtn = $("btn-start");

/* ---------- storage ---------- */
function loadTrials() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { return []; }
}
function saveTrials(t) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(t)); } catch (e) { alert("Could not save data: " + e.message); }
}

/* ---------- experiment ---------- */
let state = null; // { id, startedAt, layout[], order[], idx, shownAt, errors, trials[], locked }

const shuffle = (a) => {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

function buildGrid(layout) {
  gridEl.innerHTML = "";
  layout.forEach((num, i) => {
    const c = document.createElement("div");
    c.className = "cell";
    c.textContent = num;
    c.dataset.num = num;
    c.dataset.pos = i;
    c.setAttribute("role", "gridcell");
    gridEl.appendChild(c);
  });
}

function resetBlank() {
  gridEl.innerHTML = "";
  for (let i = 0; i < TOTAL; i++) {
    const c = document.createElement("div");
    c.className = "cell";
    gridEl.appendChild(c);
  }
  gridEl.classList.add("locked");
}

function startExperiment() {
  const layout = shuffle([...Array(TOTAL).keys()]); // layout[pos] = number, fixed until the end
  state = {
    id: "exp-" + Date.now().toString(36),
    startedAt: new Date().toISOString(),
    layout, order: shuffle(layout), idx: 0, shownAt: 0, errors: 0, trials: [], locked: true,
  };
  buildGrid(layout);
  gridEl.classList.add("locked");
  startBtn.disabled = true;
  targetEl.textContent = "Memorise…";
  progressEl.textContent = "";
  gridEl.querySelectorAll(".cell").forEach((c) => c.classList.add("show"));
  setTimeout(() => {
    // numbers stay visible after the preview (see docs/design.md)
    showNext();
  }, PREVIEW_MS);
}

function showNext() {
  const n = state.order[state.idx];
  targetEl.textContent = "Click: " + n;
  progressEl.textContent = `${state.idx + 1} / ${TOTAL}`;
  state.errors = 0;
  // timestamp taken after the browser paints the new target, so render delay is excluded
  requestAnimationFrame(() => requestAnimationFrame(() => {
    state.shownAt = performance.now();
    state.locked = false;
    gridEl.classList.remove("locked");
  }));
}

gridEl.addEventListener("pointerdown", (e) => {
  const cell = e.target.closest(".cell");
  if (!state || state.locked || !cell || !cell.dataset.num) return;
  const now = performance.now();
  const target = state.order[state.idx];
  if (cell.classList.contains("done")) return;
  if (+cell.dataset.num !== target) {
    state.errors++;
    cell.classList.remove("wrong"); void cell.offsetWidth; cell.classList.add("wrong");
    return;
  }
  state.locked = true;
  cell.classList.add("done");
  const pos = +cell.dataset.pos;
  state.trials.push({
    experiment_id: state.id, started_at: state.startedAt, sequence: state.idx + 1, number: target,
    x: (pos % SIZE) + 1, y: Math.floor(pos / SIZE) + 1,
    time_ms: Math.round((now - state.shownAt) * 10) / 10, errors: state.errors,
  });
  state.idx++;
  if (state.idx >= TOTAL) return finish();
  gridEl.classList.add("locked");
  showNext();
});

function finish() {
  saveTrials(loadTrials().concat(state.trials));
  const avg = state.trials.reduce((s, t) => s + t.time_ms, 0) / TOTAL;
  targetEl.textContent = `Done! Mean ${Math.round(avg)} ms`;
  progressEl.textContent = `${TOTAL} / ${TOTAL}`;
  startBtn.disabled = false;
  startBtn.textContent = "New experiment";
  state = null;
}

startBtn.addEventListener("click", startExperiment);

/* ---------- tabs ---------- */
function switchTab(stats) {
  $("view-exp").hidden = stats;
  $("view-stats").hidden = !stats;
  $("tab-exp").classList.toggle("active", !stats);
  $("tab-stats").classList.toggle("active", stats);
  if (stats) renderStats();
}
$("tab-exp").onclick = () => switchTab(false);
$("tab-stats").onclick = () => {
  if (state && !confirm("An experiment is running. Leaving will discard it. Continue?")) return;
  if (state) { state = null; startBtn.disabled = false; targetEl.textContent = "Press Start"; resetBlank(); }
  switchTab(true);
};

/* ---------- CSV ---------- */
function toCSV(trials) {
  return [COLS.join(",")].concat(trials.map((t) => COLS.map((c) => t[c]).join(","))).join("\n") + "\n";
}

function parseCSV(text) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new Error("File is empty");
  const head = lines[0].split(",").map((h) => h.trim());
  const miss = COLS.filter((c) => !head.includes(c));
  if (miss.length) throw new Error("Missing columns: " + miss.join(", "));
  return lines.slice(1).map((l, i) => {
    const v = l.split(",");
    const r = {};
    head.forEach((h, k) => (r[h] = (v[k] ?? "").trim()));
    const t = {
      experiment_id: r.experiment_id, started_at: r.started_at,
      sequence: +r.sequence, number: +r.number, x: +r.x, y: +r.y, time_ms: +r.time_ms, errors: +r.errors || 0,
    };
    if (!t.experiment_id || [t.sequence, t.number, t.x, t.y, t.time_ms].some((n) => !Number.isFinite(n)))
      throw new Error("Invalid data on line " + (i + 2));
    return t;
  });
}

$("btn-export").onclick = () => {
  const trials = loadTrials();
  if (!trials.length) return flash("No data to export.");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([toCSV(trials)], { type: "text/csv" }));
  a.download = "number-selection-" + new Date().toISOString().slice(0, 10) + ".csv";
  a.click();
  URL.revokeObjectURL(a.href);
};

$("file-import").onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  try {
    const incoming = parseCSV(await f.text());
    const cur = loadTrials();
    const seen = new Set(cur.map((t) => t.experiment_id + "|" + t.sequence));
    const add = incoming.filter((t) => !seen.has(t.experiment_id + "|" + t.sequence));
    saveTrials(cur.concat(add));
    flash(`Imported ${add.length} rows (${incoming.length - add.length} duplicates skipped).`);
    renderStats();
  } catch (err) { flash("Import failed: " + err.message); }
};

$("btn-clear").onclick = () => {
  if (confirm("Delete all stored experiments? Export first if you need them.")) { saveTrials([]); renderStats(); flash("Data deleted."); }
};
function flash(m) { $("msg").textContent = m; }

/* ---------- statistics ---------- */
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const median = (a) => { const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const f = (n) => Math.round(n).toLocaleString();
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// groups: array of 100 arrays of times; first = label of the first x position
function lineChart(groups, first, label) {
  const means = groups.map((a) => (a.length ? mean(a) : null));
  const max = Math.max(...means.filter((v) => v !== null)) || 1;
  const pts = means.map((v, i) => (v === null ? null : `${30 + i * 4.5},${110 - (v / max) * 100}`)).filter(Boolean).join(" ");
  // x ticks: first, every multiple of 10, and last
  let ticks = "";
  for (let i = 0; i < TOTAL; i++) {
    const v = first + i;
    if (i !== 0 && i !== TOTAL - 1 && v % 10 !== 0) continue;
    const x = 30 + i * 4.5;
    ticks += `<line x1="${x}" y1="110" x2="${x}" y2="114" stroke="#999"/><text x="${x}" y="124" text-anchor="middle">${v}</text>`;
  }
  return `<svg viewBox="0 0 490 128" width="100%" role="img" aria-label="${label}">
    <line x1="30" y1="110" x2="480" y2="110" stroke="#999"/><line x1="30" y1="10" x2="30" y2="110" stroke="#999"/>
    <text x="2" y="14">${f(max)}</text><text x="12" y="110">0</text>${ticks}
    <polyline fill="none" stroke="#0b2a6b" stroke-width="1.5" points="${pts}"/></svg>`;
}

function renderStats() {
  const trials = loadTrials(), el = $("stats");
  if (!trials.length) { el.innerHTML = "<p>No experiments recorded yet.</p>"; return; }
  const byExp = new Map();
  trials.forEach((t) => { if (!byExp.has(t.experiment_id)) byExp.set(t.experiment_id, []); byExp.get(t.experiment_id).push(t); });
  const times = trials.map((t) => t.time_ms);

  let h = `<h2>Overall</h2><table>
    <tr><th>Experiments</th><th>Clicks</th><th>Mean ms</th><th>Median ms</th><th>Std dev</th><th>Min</th><th>Max</th><th>Errors</th></tr>
    <tr><td>${byExp.size}</td><td>${trials.length}</td><td>${f(mean(times))}</td><td>${f(median(times))}</td><td>${f(sd(times))}</td>
    <td>${f(Math.min(...times))}</td><td>${f(Math.max(...times))}</td><td>${trials.reduce((s, t) => s + t.errors, 0)}</td></tr></table>`;

  h += `<h2>Per experiment</h2><table><tr><th>Started</th><th>Clicks</th><th>Mean ms</th><th>Median ms</th><th>Total s</th><th>Errors</th></tr>`;
  [...byExp.values()].sort((a, b) => b[0].started_at.localeCompare(a[0].started_at)).forEach((g) => {
    const ts = g.map((t) => t.time_ms);
    h += `<tr><td>${esc(new Date(g[0].started_at).toLocaleString())}</td><td>${g.length}</td><td>${f(mean(ts))}</td><td>${f(median(ts))}</td>
      <td>${(ts.reduce((s, x) => s + x, 0) / 1000).toFixed(1)}</td><td>${g.reduce((s, t) => s + t.errors, 0)}</td></tr>`;
  });
  h += "</table>";

  // mean time per sequence position (learning/fatigue curve)
  const bySeq = Array.from({ length: TOTAL }, () => []);
  trials.forEach((t) => { if (t.sequence >= 1 && t.sequence <= TOTAL) bySeq[t.sequence - 1].push(t.time_ms); });
  h += `<h2>Mean time by sequence (1 → 100)</h2>` + lineChart(bySeq, 1, "Mean time by sequence");

  // mean time per number value
  const byNum = Array.from({ length: TOTAL }, () => []);
  trials.forEach((t) => { if (t.number >= 0 && t.number < TOTAL) byNum[t.number].push(t.time_ms); });
  h += `<h2>Mean time by number value (0 → 99)</h2>` + lineChart(byNum, 0, "Mean time by number value");

  // mean time per grid cell
  const cell = Array.from({ length: TOTAL }, () => []);
  trials.forEach((t) => { if (t.x >= 1 && t.x <= SIZE && t.y >= 1 && t.y <= SIZE) cell[(t.y - 1) * SIZE + t.x - 1].push(t.time_ms); });
  const cm = cell.map((a) => (a.length ? mean(a) : null)), vals = cm.filter((v) => v !== null);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  h += `<h2>Mean time by grid position (ms)</h2><div class="heat">` + cm.map((v) => {
    if (v === null) return "<div></div>";
    const k = hi === lo ? 0 : (v - lo) / (hi - lo);
    return `<div style="background:rgba(11,42,107,${0.1 + k * 0.85});color:${k > 0.45 ? "#fff" : "#000"}">${f(v)}</div>`;
  }).join("") + "</div><p>Darker = slower. Columns are x (left→right), rows are y (top→bottom).</p>";

  el.innerHTML = h;
}

resetBlank();
