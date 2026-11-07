"use strict";
const { SIZE, TOTAL, rng, hashSeed, shuffle, toCSV, parseCSV, esc } = NSS;
const PREVIEW_MS = 1000;
const STORE_KEY = "nss.trials.v1";
const PARTICIPANT_KEY = "nss.participant";
const PRACTICE_TOTAL = 10;

const $ = (id) => document.getElementById(id);
const gridEl = $("grid"), targetEl = $("target-box"), progressEl = $("progress"), startBtn = $("btn-start"), practiceBtn = $("btn-practice");
const participantEl = $("participant"), seedEl = $("seed");
try { participantEl.value = localStorage.getItem(PARTICIPANT_KEY) || ""; } catch {}

/* ---------- storage ---------- */
function loadTrials() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { return []; }
}
function saveTrials(t) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(t)); } catch (e) { alert("Could not save data: " + e.message); }
}

/* ---------- experiment ---------- */
let state = null; // { id, startedAt, layout[], order[], idx, shownAt, errors, trials[], locked }

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

function startExperiment(practice = false) {
  const seed = practice ? "" : seedEl.value.trim();
  const rand = seed ? rng(hashSeed(seed)) : Math.random;
  const layout = shuffle([...Array(TOTAL).keys()], rand); // layout[pos] = number, fixed until the end
  const participant = participantEl.value.trim();
  try { localStorage.setItem(PARTICIPANT_KEY, participant); } catch {}
  state = {
    id: "exp-" + Date.now().toString(36),
    startedAt: new Date().toISOString(),
    layout, order: shuffle(layout, rand), idx: 0, shownAt: 0, errors: 0, wrong: [], trials: [], locked: true,
    practice, total: practice ? PRACTICE_TOTAL : TOTAL, participant, seed,
  };
  buildGrid(layout);
  gridEl.classList.add("locked");
  startBtn.disabled = practiceBtn.disabled = true;
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
  progressEl.textContent = `${state.idx + 1} / ${state.total}`;
  state.errors = 0;
  state.wrong = [];
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
    state.wrong.push(cell.dataset.num + "@" + Math.round(now - state.shownAt));
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
    participant_id: state.participant, pointer_type: e.pointerType || "",
    cell_px: Math.round(cell.getBoundingClientRect().width), preview_ms: PREVIEW_MS,
    seed: state.seed, wrong_clicks: state.wrong.join(";"),
  });
  state.idx++;
  if (state.idx >= state.total) return finish();
  gridEl.classList.add("locked");
  showNext();
});

function finish() {
  const avg = state.trials.reduce((s, t) => s + t.time_ms, 0) / state.total;
  if (state.practice) {
    targetEl.textContent = `Practice done! Mean ${Math.round(avg)} ms (not saved)`;
    startBtn.textContent = "Start";
  } else {
    saveTrials(loadTrials().concat(state.trials));
    targetEl.textContent = `Done! Mean ${Math.round(avg)} ms`;
    startBtn.textContent = "New experiment";
  }
  progressEl.textContent = `${state.total} / ${state.total}`;
  startBtn.disabled = practiceBtn.disabled = false;
  state = null;
}

startBtn.addEventListener("click", () => startExperiment(false));
practiceBtn.addEventListener("click", () => startExperiment(true));

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
  if (state) { state = null; startBtn.disabled = practiceBtn.disabled = false; targetEl.textContent = "Press Start"; resetBlank(); }
  switchTab(true);
};

/* ---------- CSV ---------- */
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
const S = NSS; // statistics helpers
const { f, f1, mean, median } = S;
const pidOf = (t) => t.participant_id || "(unlabelled)";
const ci = (c, fmt = f) => (c ? ` <span class="ci">[${fmt(c[0])}–${fmt(c[1])}]</span>` : "");
const per100 = (ts) => (ts.length ? (ts.reduce((s, t) => s + t.errors, 0) / ts.length) * 100 : NaN);
const strength = (r) => { const a = Math.abs(r); return a < 0.1 ? "negligible" : a < 0.3 ? "weak" : a < 0.5 ? "moderate" : "strong"; };
const kv = (rows) => `<table class="kv">${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("")}</table>`;

function refreshParticipants(trials) {
  const sel = $("f-participant"), cur = sel.value;
  const ids = [...new Set(trials.map(pidOf))].sort();
  sel.innerHTML = `<option value="">All (${ids.length})</option>` + ids.map((id) => `<option value="${esc(id)}">${esc(id)}</option>`).join("");
  sel.value = ids.includes(cur) ? cur : "";
}

function renderStats() {
  const all = loadTrials(), el = $("stats");
  refreshParticipants(all);
  if (!all.length) { el.innerHTML = "<p>No experiments recorded yet.</p>"; return; }
  const who = $("f-participant").value;
  const trials = who ? all.filter((t) => pidOf(t) === who) : all;
  const { kept, counts } = S.prepare(trials, {
    skipFirst: $("f-warmup").checked, outliers: $("f-outliers").checked, cleanOnly: $("f-clean").checked,
  });
  const byExp = S.groupBy(trials, (t) => t.experiment_id);
  const keptByExp = S.groupBy(kept, (t) => t.experiment_id);
  const clusters = [...keptByExp.values()].map((g) => g.map((t) => t.time_ms));
  const times = kept.map((t) => t.time_ms);
  const rand = S.rng(12345);
  const sum = S.summary(times, clusters, rand);

  let h = `<p class="note">Using ${f(kept.length)} of ${f(counts.total)} clicks (excluded: ${counts.warmup} first clicks, ${counts.errors} with errors, ${counts.outliers} outliers).
    Outliers are clicks more than 3 robust SDs from the run's median on a log-time scale. Confidence intervals resample whole experiments (clicks within a run are correlated); with a single experiment they resample clicks.</p>`;
  if (!sum) { el.innerHTML = h + "<p>No clicks left after filtering.</p>"; return; }

  const errTrials = trials.filter((t) => t.errors > 0).length;
  h += `<h2>Overall</h2>` + kv([
    ["Experiments / clicks analysed", `${byExp.size} / ${f(sum.n)}`],
    ["Median time (ms), 95% CI", `${f(sum.median)}${ci(sum.medianCI)}`],
    ["Mean time (ms), 95% CI", `${f(sum.mean)}${ci(sum.meanCI)}`],
    ["Std deviation (n−1) / IQR (ms)", `${f(sum.sd)} / ${f(sum.iqr)}`],
    ["90th percentile (ms)", f(sum.p90)],
    ["Wrong clicks per 100 targets", f1(per100(trials))],
    ["Targets with ≥1 wrong click", `${f1((errTrials / trials.length) * 100)}%`],
  ]);

  // participants
  const byP = S.groupBy(trials, pidOf);
  if (byP.size > 1) {
    h += `<h2>Per participant</h2><table><tr><th>Participant</th><th>Experiments</th><th>Clicks used</th><th>Median ms</th><th>P90 ms</th><th>Wrong / 100</th></tr>`;
    [...byP.entries()].sort().forEach(([id, g]) => {
      const kt = kept.filter((t) => pidOf(t) === id).map((t) => t.time_ms);
      h += `<tr><td>${esc(id)}</td><td>${new Set(g.map((t) => t.experiment_id)).size}</td><td>${kt.length}</td><td>${f(median(kt))}</td><td>${f(S.quantile(kt, 0.9))}</td><td>${f1(per100(g))}</td></tr>`;
    });
    h += "</table>";
  }

  // experiments
  const exps = [...byExp.values()].sort((a, b) => a[0].started_at.localeCompare(b[0].started_at));
  h += `<h2>Per experiment</h2><table><tr><th>Started</th><th>Participant</th><th>Clicks used</th><th>Median ms</th><th>Mean ms</th><th>SD</th><th>P90</th><th>Wrong / 100</th><th>Total s</th></tr>`;
  exps.slice().reverse().forEach((g) => {
    const kt = (keptByExp.get(g[0].experiment_id) || []).map((t) => t.time_ms);
    h += `<tr><td>${esc(new Date(g[0].started_at).toLocaleString())}</td><td>${esc(pidOf(g[0]))}</td><td>${kt.length}</td><td>${f(median(kt))}</td><td>${f(mean(kt))}</td>
      <td>${f(S.sd(kt))}</td><td>${f(S.quantile(kt, 0.9))}</td><td>${f1(per100(g))}</td><td>${(g.reduce((s, t) => s + t.time_ms, 0) / 1000).toFixed(1)}</td></tr>`;
  });
  h += "</table>";
  if (exps.length > 1) {
    const med = exps.map((g) => { const k = keptByExp.get(g[0].experiment_id); return k && k.length ? median(k.map((t) => t.time_ms)) : null; });
    h += `<h2>Median time per experiment, oldest → newest (ms)</h2>` + S.linePlot(med, 1, "Median time per experiment", { zero: false }) +
      `<h2>Wrong clicks per 100 targets, oldest → newest</h2>` + S.linePlot(exps.map(per100), 1, "Wrong clicks per experiment", { zero: false, fmt: f1 }) +
      `<p class="note">A downward trend is practice; an upward one is fatigue or loss of attention.</p>`;
  }

  // distance ↔ time
  const da = S.distanceAnalysis(kept);
  h += `<h2>Distance to previous target vs. time</h2>`;
  if (!da) h += `<p class="note">Not enough clicks with a previous target to analyse.</p>`;
  else {
    const L = da.lin, rc = da.ci;
    h += S.scatterChart(kept.filter((t) => t.dist !== null).map((t) => ({ x: t.dist, y: t.time_ms })), "Time versus distance to previous target", {
      line: L, bins: da.bins.map((b) => ({ x: b.d, y: b.median, q1: b.q1, q3: b.q3, lo: b.medianCI && b.medianCI[0], hi: b.medianCI && b.medianCI[1] })), xLabel: "distance from previous target (cells)", yLabel: "ms",
    }) + `<p class="note">Dots: clicks (y axis clipped at the 99th percentile). Orange: median per whole-cell distance, with the 25th–75th percentile range (wide pale bar) and the 95% CI of the median (thin dark bar). Dashed: least-squares line.</p>` + kv([
      ["Pearson r (linear distance)", `${L.r.toFixed(2)} (${strength(L.r)})${rc ? ` <span class="ci">[${rc[0].toFixed(2)}–${rc[1].toFixed(2)}]</span>` : ""}`],
      ["Spearman ρ (rank, robust to skew)", `${da.rho.toFixed(2)} (${strength(da.rho)})`],
      ["Pearson r with log₂(distance+1) (Fitts)", da.linID ? da.linID.r.toFixed(2) : "–"],
      ["R² (variance explained by distance)", `${(L.r2 * 100).toFixed(1)}%`],
      ["Cost per extra cell of distance", `${f1(L.slope)} ms`],
      ["Time at distance 0 (fitted)", `${f(L.intercept)} ms`],
      ["Per-experiment slope (ms/cell)", da.perExp.k ? `${f1(da.perExp.mean)}${ci(da.perExp.ci, f1)} over ${da.perExp.k} experiments` : "needs ≥1 experiment with 15+ clicks"],
    ]) + `<p class="note">${L.slope > 0 ? "Farther jumps take longer" : "No slowdown with distance"}: each extra cell adds about ${f1(L.slope)} ms, and distance explains ${(L.r2 * 100).toFixed(0)}% of the variation in click time
      (${strength(L.r)} relationship). The correlation interval treats clicks as independent, so prefer the per-experiment slope when there are several experiments.
      Distance is measured between cell centres, in cells; the first click of each run has no previous target.</p>`;
  }

  // sequence
  const bySeq = Array.from({ length: TOTAL }, () => []);
  kept.forEach((t) => { if (t.sequence >= 1 && t.sequence <= TOTAL) bySeq[t.sequence - 1].push(t.time_ms); });
  h += `<h2>Median time by sequence (10-click moving average)</h2>` + S.lineChart(bySeq, 1, "Median time by sequence", { stat: median, window: 10, zero: false, band: true }) +
    `<p class="note">Line = median, shaded band = 25th–75th percentile, both over the last 10 positions. Falling = learning, rising = fatigue. Each point pools ${byExp.size} experiment(s); the axis does not start at 0.</p>`;

  // number value, grouped by decade
  const dec = Array.from({ length: 10 }, () => []);
  kept.forEach((t) => { if (t.number >= 0 && t.number < TOTAL) dec[Math.floor(t.number / 10)].push(t); });
  const decBars = dec.map((g, d) => {
    const cl = [...S.groupBy(g, (t) => t.experiment_id).values()].map((c) => c.map((t) => t.time_ms));
    const c = g.length ? S.bootCI(cl, median, rand) : null;
    return { label: S.decadeLabel(d), value: g.length ? median(g.map((t) => t.time_ms)) : null, n: g.length, lo: c && c[0], hi: c && c[1] };
  });
  h += `<h2>Median time by number range (ms)</h2>` + S.barChart(decBars, "Median time by number range") +
    `<p class="note">Orange bars are 95% CIs of the median. Numbers are labels, not a scale, so they are grouped (0–9 are single digits, the rest two digits). Layouts are random each run, so range effects only emerge with many runs.</p>`;

  // grid position
  const cs = S.cellStats(kept, da && da.lin), cen = median(times);
  h += `<h2>Time by grid position</h2><div class="heat-wrap"><div><h3>Mean time (ms)</h3>` +
    S.heatmap(cs.time, cs.timeN, { center: cen, span: cen * 0.25 }) + `</div>`;
  if (da) h += `<div><h3>After removing the distance effect (ms vs. expected)</h3>` + S.heatmap(cs.resid, cs.residN, { center: 0, span: cen * 0.25, signed: true }) + `</div>`;
  h += `</div><p class="note">Orange = slower, blue = faster than the overall median (left) or than the distance-based expectation (right); full colour at ±25% of the median.
    Grey cells have fewer than 3 observations. The right map shows the real positional effect, because the left one also reflects how far the previous target was. Columns are x (left→right), rows are y (top→bottom).</p>`;

  // errors
  const ea = S.analyzeErrors(trials);
  h += `<h2>Wrong clicks</h2>`;
  if (!ea.total) h += `<p class="note">No wrong clicks recorded.</p>`;
  else {
    h += kv([
      ["Wrong clicks (total / individually logged)", `${ea.total} / ${ea.logged}`],
      ["Digit transpositions (e.g. 12 → 21)", ea.logged ? `${f1((ea.transposed / ea.logged) * 100)}%` : "–"],
      ["Off by one (e.g. 47 → 48)", ea.logged ? `${f1((ea.offByOne / ea.logged) * 100)}%` : "–"],
      ["Median distance of wrong click from target (cells)", f1(ea.medianDist)],
    ]);
    if (ea.top.length) h += `<table><tr><th>Target → clicked</th><th>Count</th></tr>${ea.top.map(([k, n]) => `<tr><td>${esc(k)}</td><td>${n}</td></tr>`).join("")}</table>`;
    if (ea.logged < ea.total) h += `<p class="note">Older imported data has error counts without per-click logs.</p>`;
  }

  el.innerHTML = h;
}
["f-participant", "f-warmup", "f-outliers", "f-clean"].forEach((id) => ($(id).onchange = renderStats));

resetBlank();
