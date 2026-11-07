"use strict";
// Pure logic (no DOM): shared by the browser (global `NSS`) and the Node tests.
(function (root) {
  const SIZE = 10, TOTAL = SIZE * SIZE;
  // Columns every CSV must have, and optional ones added later (blank when absent).
  const REQUIRED = ["experiment_id", "started_at", "sequence", "number", "x", "y", "time_ms", "errors"];
  const EXTRA = ["participant_id", "pointer_type", "cell_px", "preview_ms", "seed", "wrong_clicks"];
  const COLS = REQUIRED.concat(EXTRA);

  /* ---------- randomness (seedable) ---------- */
  function rng(seed) { // mulberry32
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashSeed(str) { // FNV-1a
    let h = 2166136261;
    for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  const shuffle = (a, rand = Math.random) => {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  /* ---------- CSV ---------- */
  const cleanField = (v) => String(v ?? "").replace(/[,"\r\n]/g, " ").trim();
  const numOrBlank = (s) => (s === "" || !Number.isFinite(+s) ? "" : +s);

  function toCSV(trials) {
    return [COLS.join(",")].concat(trials.map((t) => COLS.map((c) => cleanField(t[c])).join(","))).join("\n") + "\n";
  }

  function parseCSV(text) {
    const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) throw new Error("File is empty");
    const head = lines[0].split(",").map((h) => h.trim());
    const miss = REQUIRED.filter((c) => !head.includes(c));
    if (miss.length) throw new Error("Missing columns: " + miss.join(", "));
    return lines.slice(1).map((l, i) => {
      const v = l.split(",");
      const r = {};
      head.forEach((h, k) => (r[h] = (v[k] ?? "").trim()));
      const t = {
        experiment_id: r.experiment_id, started_at: r.started_at,
        sequence: +r.sequence, number: +r.number, x: +r.x, y: +r.y, time_ms: +r.time_ms, errors: +r.errors || 0,
        participant_id: r.participant_id ?? "", pointer_type: r.pointer_type ?? "",
        cell_px: numOrBlank(r.cell_px ?? ""), preview_ms: numOrBlank(r.preview_ms ?? ""),
        seed: r.seed ?? "", wrong_clicks: r.wrong_clicks ?? "",
      };
      if (!t.experiment_id || [t.sequence, t.number, t.x, t.y, t.time_ms].some((n) => !Number.isFinite(n)))
        throw new Error("Invalid data on line " + (i + 2));
      return t;
    });
  }

  /* ---------- descriptive statistics ---------- */
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const quantile = (a, p) => {
    if (!a.length) return NaN;
    const s = a.slice().sort((x, y) => x - y), i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
    return s[lo] + (s[hi] - s[lo]) * (i - lo);
  };
  const median = (a) => quantile(a, 0.5);
  // sample standard deviation (n - 1)
  const sd = (a) => {
    if (a.length < 2) return 0;
    const m = mean(a);
    return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
  };
  const mad = (a) => { const m = median(a); return median(a.map((x) => Math.abs(x - m))); };
  const min = (a) => a.reduce((m, x) => (x < m ? x : m), Infinity);
  const max = (a) => a.reduce((m, x) => (x > m ? x : m), -Infinity);
  const f = (n) => (Number.isFinite(n) ? (Math.round(n) || 0).toLocaleString() : "–");
  const f1 = (n) => (Number.isFinite(n) ? (Math.round(n * 10) / 10).toLocaleString() : "–");
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // 95% CI of a statistic. With 2+ clusters (experiments) whole clusters are resampled, so correlated
  // clicks within one run do not make the interval overconfident; with one cluster, clicks are resampled.
  function bootCI(clusters, stat, rand = rng(12345), iters = 500) {
    clusters = clusters.filter((c) => c.length);
    const total = clusters.reduce((s, c) => s + c.length, 0);
    if (total < 2) return null;
    const out = [];
    for (let it = 0; it < iters; it++) {
      const sample = [];
      if (clusters.length >= 2) {
        for (let k = 0; k < clusters.length; k++) {
          const c = clusters[Math.floor(rand() * clusters.length)];
          for (let j = 0; j < c.length; j++) sample.push(c[j]);
        }
      } else {
        const c = clusters[0];
        for (let k = 0; k < c.length; k++) sample.push(c[Math.floor(rand() * c.length)]);
      }
      out.push(stat(sample));
    }
    return [quantile(out, 0.025), quantile(out, 0.975)];
  }

  function summary(times, clusters, rand) {
    if (!times.length) return null;
    const q1 = quantile(times, 0.25), q3 = quantile(times, 0.75);
    return {
      n: times.length, mean: mean(times), median: median(times), sd: sd(times), q1, q3, iqr: q3 - q1,
      p90: quantile(times, 0.9),
      meanCI: bootCI(clusters, mean, rand), medianCI: bootCI(clusters, median, rand),
    };
  }

  /* ---------- trial preparation ---------- */
  // Adds `dist` (Euclidean distance in cells from the previous target of the same run, null for the
  // first) and `fitts_id` (log2(dist + 1), the Fitts index of difficulty for constant target width).
  function annotate(trials) {
    const byExp = new Map();
    trials.forEach((t) => {
      if (!byExp.has(t.experiment_id)) byExp.set(t.experiment_id, new Map());
      byExp.get(t.experiment_id).set(t.sequence, t);
    });
    return trials.map((t) => {
      const p = byExp.get(t.experiment_id).get(t.sequence - 1);
      const dist = p ? Math.hypot(t.x - p.x, t.y - p.y) : null;
      return { ...t, dist, fitts_id: dist === null ? null : Math.log2(dist + 1) };
    });
  }

  // opts: skipFirst (drop sequence 1), cleanOnly (drop trials with errors), outliers (drop slow/fast
  // outliers, judged per experiment on log time: median ± k·1.4826·MAD).
  function prepare(trials, opts = {}) {
    const { skipFirst = true, cleanOnly = false, outliers = true, k = 3 } = opts;
    const all = annotate(trials);
    const counts = { total: all.length, warmup: 0, errors: 0, outliers: 0 };
    let rest = all.filter((t) => {
      if (skipFirst && t.sequence === 1) { counts.warmup++; return false; }
      if (cleanOnly && t.errors > 0) { counts.errors++; return false; }
      return true;
    });
    if (outliers) {
      const groups = new Map();
      rest.forEach((t) => { if (!groups.has(t.experiment_id)) groups.set(t.experiment_id, []); groups.get(t.experiment_id).push(t); });
      const kept = new Set();
      groups.forEach((g) => {
        const logs = g.map((t) => Math.log(Math.max(t.time_ms, 1)));
        const m = median(logs), s = 1.4826 * mad(logs);
        g.forEach((t, i) => {
          if (s > 0 && Math.abs(logs[i] - m) > k * s) counts.outliers++;
          else kept.add(t);
        });
      });
      rest = rest.filter((t) => kept.has(t));
    }
    return { kept: rest, counts };
  }

  const groupBy = (arr, key) => {
    const m = new Map();
    arr.forEach((t) => { const k = key(t); if (!m.has(k)) m.set(k, []); m.get(k).push(t); });
    return m;
  };

  /* ---------- correlation / regression ---------- */
  function linreg(xs, ys) {
    const n = xs.length;
    if (n < 3) return null;
    const mx = mean(xs), my = mean(ys);
    let sxx = 0, sxy = 0, syy = 0;
    for (let i = 0; i < n; i++) {
      const dx = xs[i] - mx, dy = ys[i] - my;
      sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
    }
    if (!sxx || !syy) return null;
    const slope = sxy / sxx, r = sxy / Math.sqrt(sxx * syy);
    return { n, slope, intercept: my - slope * mx, r, r2: r * r };
  }
  const ranks = (a) => {
    const idx = a.map((v, i) => i).sort((i, j) => a[i] - a[j]), out = new Array(a.length);
    for (let s = 0; s < idx.length;) {
      let e = s;
      while (e + 1 < idx.length && a[idx[e + 1]] === a[idx[s]]) e++;
      for (let k = s; k <= e; k++) out[idx[k]] = (s + e) / 2 + 1;
      s = e + 1;
    }
    return out;
  };
  const spearman = (xs, ys) => { const l = linreg(ranks(xs), ranks(ys)); return l ? l.r : NaN; };
  // Fisher-z 95% CI for a correlation (assumes independent observations).
  function fisherCI(r, n) {
    if (!Number.isFinite(r) || n < 4 || Math.abs(r) >= 1) return null;
    const z = Math.atanh(r), se = 1 / Math.sqrt(n - 3);
    return [Math.tanh(z - 1.96 * se), Math.tanh(z + 1.96 * se)];
  }
  const T95 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131,
    2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042];
  function meanCI(a) { // t-based 95% CI of a mean
    if (a.length < 2) return null;
    const h = (T95[a.length - 2] || 1.96) * sd(a) / Math.sqrt(a.length), m = mean(a);
    return [m - h, m + h];
  }

  // Relation between the distance to the previous target and the time to find/click the next one.
  function distanceAnalysis(kept, rand = rng(777)) {
    const pts = kept.filter((t) => t.dist !== null);
    if (pts.length < 10) return null;
    const xs = pts.map((t) => t.dist), ys = pts.map((t) => t.time_ms);
    const lin = linreg(xs, ys);
    if (!lin) return null;
    const linID = linreg(pts.map((t) => t.fitts_id), ys);
    const bins = [...groupBy(pts, (t) => Math.round(t.dist)).entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([d, g]) => {
        const ts = g.map((t) => t.time_ms);
        const cl = [...groupBy(g, (t) => t.experiment_id).values()].map((c) => c.map((t) => t.time_ms));
        return { d, n: g.length, median: median(ts), mean: mean(ts), q1: quantile(ts, 0.25), q3: quantile(ts, 0.75), medianCI: bootCI(cl, median, rand) };
      });
    const slopes = [];
    groupBy(pts, (t) => t.experiment_id).forEach((g) => {
      if (g.length < 15) return;
      const l = linreg(g.map((t) => t.dist), g.map((t) => t.time_ms));
      if (l) slopes.push(l.slope);
    });
    return {
      n: pts.length, lin, linID, rho: spearman(xs, ys), ci: fisherCI(lin.r, pts.length), bins,
      perExp: { k: slopes.length, mean: slopes.length ? mean(slopes) : NaN, ci: meanCI(slopes) },
    };
  }

  // Per grid cell: observations, mean time, and mean residual after removing the distance effect.
  function cellStats(kept, lin) {
    const times = Array.from({ length: TOTAL }, () => []), res = Array.from({ length: TOTAL }, () => []);
    kept.forEach((t) => {
      if (t.x < 1 || t.x > SIZE || t.y < 1 || t.y > SIZE) return;
      const c = (t.y - 1) * SIZE + t.x - 1;
      times[c].push(t.time_ms);
      if (lin && t.dist !== null) res[c].push(t.time_ms - (lin.intercept + lin.slope * t.dist));
    });
    const val = (g) => g.map((a) => (a.length ? mean(a) : null));
    return { time: val(times), timeN: times.map((a) => a.length), resid: val(res), residN: res.map((a) => a.length) };
  }

  const decadeLabel = (d) => `${d * 10}–${d * 10 + 9}`;

  /* ---------- error analysis ---------- */
  function parseWrong(s) {
    if (!s) return [];
    return String(s).split(";").filter(Boolean).map((p) => {
      const [n, ms] = p.split("@");
      return { number: +n, at: +ms };
    }).filter((w) => Number.isFinite(w.number));
  }
  const reverseDigits = (a) => (a % 10) * 10 + Math.floor(a / 10);
  const isTransposed = (a, b) => a !== b && reverseDigits(a) === b;

  function analyzeErrors(trials) {
    const layouts = new Map();
    trials.forEach((t) => {
      if (!layouts.has(t.experiment_id)) layouts.set(t.experiment_id, new Map());
      layouts.get(t.experiment_id).set(t.number, { x: t.x, y: t.y });
    });
    const pairs = new Map(), dists = [];
    let logged = 0, transposed = 0, offByOne = 0;
    trials.forEach((t) => parseWrong(t.wrong_clicks).forEach((w) => {
      logged++;
      const key = t.number + " → " + w.number;
      pairs.set(key, (pairs.get(key) || 0) + 1);
      if (isTransposed(t.number, w.number)) transposed++;
      if (Math.abs(t.number - w.number) === 1) offByOne++;
      const p = layouts.get(t.experiment_id).get(w.number);
      if (p) dists.push(Math.hypot(p.x - t.x, p.y - t.y));
    }));
    return {
      total: trials.reduce((s, t) => s + t.errors, 0), logged,
      top: [...pairs.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8),
      transposed, offByOne, medianDist: dists.length ? median(dists) : NaN,
    };
  }

  /* ---------- charts (inline SVG strings) ---------- */
  const X0 = 40, X1 = 480, YT = 10, YB = 110;

  // vals: array of numbers or null; first = label of the first x position.
  function linePlot(vals, first, label, o = {}) {
    const ok = (v) => v !== null && v !== undefined && Number.isFinite(v), n = vals.length, fmt = o.fmt || f;
    const band = o.band; // {lo: [...], hi: [...]} same length as vals
    const present = vals.filter(ok).concat(band ? band.lo.filter(ok).concat(band.hi.filter(ok)) : []);
    if (!vals.some(ok)) return "<p>No data.</p>";
    let hi = max(present), lo = 0;
    if (o.zero !== false) lo = 0;
    if (o.zero === false) { lo = min(present); const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad; } else if (!hi) hi = 1;
    const dx = n > 1 ? (X1 - X0) / (n - 1) : 0;
    const X = (i) => X0 + i * dx, Y = (v) => YB - ((v - lo) / (hi - lo || 1)) * (YB - YT);
    const idx = vals.map((v, i) => i).filter((i) => vals[i] !== null && Number.isFinite(vals[i]));
    const pts = idx.map((i) => `${X(i)},${Y(vals[i])}`).join(" ");
    const step = n > 20 ? 10 : 1;
    let ticks = "";
    for (let i = 0; i < n; i++) {
      const v = first + i;
      if (i !== 0 && i !== n - 1 && v % step !== 0) continue;
      ticks += `<line x1="${X(i)}" y1="${YB}" x2="${X(i)}" y2="${YB + 4}" stroke="#999"/><text x="${X(i)}" y="${YB + 14}" text-anchor="middle">${v}</text>`;
    }
    let area = "";
    if (band) {
      const bi = vals.map((v, i) => i).filter((i) => ok(band.lo[i]) && ok(band.hi[i]));
      if (bi.length > 1)
        area = `<polygon fill="rgba(11,42,107,.15)" stroke="none" points="${bi.map((i) => `${X(i)},${Y(band.hi[i])}`).concat(bi.slice().reverse().map((i) => `${X(i)},${Y(band.lo[i])}`)).join(" ")}"/>`;
    }
    const dots = n <= 30 ? idx.map((i) => `<circle cx="${X(i)}" cy="${Y(vals[i])}" r="2.5" fill="#0b2a6b"/>`).join("") : "";
    return `<svg viewBox="0 0 490 128" width="100%" role="img" aria-label="${esc(label)}">
      <line x1="${X0}" y1="${YB}" x2="${X1}" y2="${YB}" stroke="#999"/><line x1="${X0}" y1="${YT}" x2="${X0}" y2="${YB}" stroke="#999"/>
      <text x="${X0 - 4}" y="${YT + 4}" text-anchor="end">${fmt(hi)}</text><text x="${X0 - 4}" y="${YB}" text-anchor="end">${fmt(lo)}</text>${ticks}
      ${area}<polyline fill="none" stroke="#0b2a6b" stroke-width="1.5" points="${pts}"/>${dots}</svg>`;
  }

  // groups: array of arrays of times, one per x position. opts: stat (default mean), window (trailing
  // window: each point pools the clicks of the last `window` positions), band (draw the 25th–75th
  // percentile band), zero (y axis starts at 0, default true), fmt.
  function lineChart(groups, first, label, opts = {}) {
    const stat = opts.stat || mean, win = opts.window || 1;
    const pooled = groups.map((g, i) => {
      let p = g;
      if (win > 1) { p = []; for (let k = Math.max(0, i - win + 1); k <= i; k++) p = p.concat(groups[k]); }
      return p;
    });
    const vals = pooled.map((p) => (p.length ? stat(p) : null));
    const o = { ...opts };
    if (opts.band) o.band = { lo: pooled.map((p) => (p.length ? quantile(p, 0.25) : null)), hi: pooled.map((p) => (p.length ? quantile(p, 0.75) : null)) };
    return linePlot(vals, first, label, o);
  }

  // items: [{label, value, n, lo?, hi?}] (lo/hi = 95% CI error bar)
  function barChart(items, label, fmt = f) {
    const vals = items.filter((b) => b.value !== null && Number.isFinite(b.value));
    if (!vals.length) return "<p>No data.</p>";
    const hi = max(vals.map((b) => (Number.isFinite(b.hi) ? b.hi : b.value))) || 1, slot = (X1 - X0) / items.length, bw = slot * 0.7;
    const bars = items.map((b, i) => {
      const cx = X0 + slot * (i + 0.5);
      const bar = b.value === null || !Number.isFinite(b.value) ? "" :
        `<rect x="${cx - bw / 2}" y="${YB - (b.value / hi) * (YB - YT)}" width="${bw}" height="${(b.value / hi) * (YB - YT)}" fill="#0b2a6b"><title>${esc(b.label)}: ${fmt(b.value)} (n=${b.n})</title></rect>`;
      const Yv = (v) => YB - (v / hi) * (YB - YT);
      const err = Number.isFinite(b.lo) && Number.isFinite(b.hi) ?
        `<g stroke="#d66000" stroke-width="1.5"><line x1="${cx}" y1="${Yv(b.lo)}" x2="${cx}" y2="${Yv(b.hi)}"/><line x1="${cx - 4}" y1="${Yv(b.lo)}" x2="${cx + 4}" y2="${Yv(b.lo)}"/><line x1="${cx - 4}" y1="${Yv(b.hi)}" x2="${cx + 4}" y2="${Yv(b.hi)}"/></g>` : "";
      return bar + err + `<text x="${cx}" y="${YB + 13}" text-anchor="middle">${esc(b.label)}</text><text x="${cx}" y="${YB + 24}" text-anchor="middle" style="fill:#999">n=${b.n}</text>`;
    }).join("");
    return `<svg viewBox="0 0 490 140" width="100%" role="img" aria-label="${esc(label)}">
      <line x1="${X0}" y1="${YB}" x2="${X1}" y2="${YB}" stroke="#999"/><line x1="${X0}" y1="${YT}" x2="${X0}" y2="${YB}" stroke="#999"/>
      <text x="${X0 - 4}" y="${YT + 4}" text-anchor="end">${fmt(hi)}</text><text x="${X0 - 4}" y="${YB}" text-anchor="end">0</text>${bars}</svg>`;
  }

  // points: [{x, y}]; o: line {slope, intercept}, bins [{x, y, q1?, q3?, lo?, hi?}] (IQR whisker, CI bar), xLabel, yLabel
  function scatterChart(points, label, o = {}) {
    if (!points.length) return "<p>No data.</p>";
    const stride = Math.max(1, Math.ceil(points.length / 2500)), shown = points.filter((p, i) => i % stride === 0);
    const xs = points.map((p) => p.x), xMax = Math.ceil(max(xs)) || 1;
    const yMax = quantile(points.map((p) => p.y), 0.99) || 1; // clip the extreme tail so the cloud stays readable
    const X = (v) => X0 + (v / xMax) * (X1 - X0), Y = (v) => YB - (Math.min(v, yMax) / yMax) * (YB - YT);
    let ticks = "";
    for (let v = 0; v <= xMax; v += xMax > 15 ? 5 : 1)
      ticks += `<line x1="${X(v)}" y1="${YB}" x2="${X(v)}" y2="${YB + 4}" stroke="#999"/><text x="${X(v)}" y="${YB + 14}" text-anchor="middle">${v}</text>`;
    const dots = shown.filter((p) => p.y <= yMax).map((p) => `<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="1.6" fill="rgba(11,42,107,.18)"/>`).join("");
    const bins = (o.bins || []);
    const whisk = bins.map((b) => {
      let g = "";
      if (Number.isFinite(b.q1) && Number.isFinite(b.q3))
        g += `<line x1="${X(b.x)}" y1="${Y(b.q1)}" x2="${X(b.x)}" y2="${Y(b.q3)}" stroke="rgba(214,96,0,.35)" stroke-width="7" stroke-linecap="butt"><title>25th–75th percentile</title></line>`;
      if (Number.isFinite(b.lo) && Number.isFinite(b.hi))
        g += `<line x1="${X(b.x)}" y1="${Y(b.lo)}" x2="${X(b.x)}" y2="${Y(b.hi)}" stroke="#7a3500" stroke-width="1.5"/><line x1="${X(b.x) - 3}" y1="${Y(b.lo)}" x2="${X(b.x) + 3}" y2="${Y(b.lo)}" stroke="#7a3500"/><line x1="${X(b.x) - 3}" y1="${Y(b.hi)}" x2="${X(b.x) + 3}" y2="${Y(b.hi)}" stroke="#7a3500"/>`;
      return g;
    }).join("");
    const binLine = bins.length ? `<polyline fill="none" stroke="#d66000" stroke-width="1.5" points="${bins.map((b) => `${X(b.x)},${Y(b.y)}`).join(" ")}"/>` +
      bins.map((b) => `<circle cx="${X(b.x)}" cy="${Y(b.y)}" r="3" fill="#d66000"/>`).join("") : "";
    const fit = o.line ? `<line x1="${X(0)}" y1="${Y(o.line.intercept)}" x2="${X(xMax)}" y2="${Y(o.line.intercept + o.line.slope * xMax)}" stroke="#a00" stroke-width="1.5" stroke-dasharray="5 3"/>` : "";
    return `<svg viewBox="0 0 490 150" width="100%" role="img" aria-label="${esc(label)}">
      <line x1="${X0}" y1="${YB}" x2="${X1}" y2="${YB}" stroke="#999"/><line x1="${X0}" y1="${YT}" x2="${X0}" y2="${YB}" stroke="#999"/>
      <text x="${X0 - 4}" y="${YT + 4}" text-anchor="end">${f(yMax)}</text><text x="${X0 - 4}" y="${YB}" text-anchor="end">0</text>${ticks}
      ${dots}${whisk}${binLine}${fit}
      <text x="${(X0 + X1) / 2}" y="146" text-anchor="middle">${esc(o.xLabel || "")}</text>
      <text x="4" y="${(YT + YB) / 2}" transform="rotate(-90 4 ${(YT + YB) / 2})" text-anchor="middle">${esc(o.yLabel || "")}</text></svg>`;
  }

  // 10x10 diverging heatmap: blue = below `center`, orange = above; saturation reaches max at ±span.
  // Cells with fewer than minN observations are greyed out.
  function heatmap(vals, ns, o) {
    const { center, span, minN = 3, fmt = f, signed = false } = o;
    return `<div class="heat">` + vals.map((v, i) => {
      const n = ns[i], tip = `x=${(i % SIZE) + 1}, y=${Math.floor(i / SIZE) + 1}, n=${n}`;
      if (v === null || n < minN) return `<div class="low" title="${tip} (fewer than ${minN} observations)">${n ? "·" : ""}</div>`;
      const k = Math.max(-1, Math.min(1, (v - center) / (span || 1))), a = 0.08 + Math.abs(k) * 0.8;
      const bg = k >= 0 ? `rgba(214,96,0,${a.toFixed(2)})` : `rgba(11,42,107,${a.toFixed(2)})`;
      return `<div title="${tip}" style="background:${bg};color:${a > 0.5 ? "#fff" : "#000"}">${signed && v > 0 ? "+" : ""}${fmt(v)}</div>`;
    }).join("") + "</div>";
  }

  const api = {
    SIZE, TOTAL, COLS, REQUIRED, EXTRA, rng, hashSeed, shuffle, toCSV, parseCSV,
    mean, median, quantile, sd, mad, min, max, f, f1, esc, bootCI, summary, meanCI,
    annotate, prepare, groupBy, linreg, ranks, spearman, fisherCI, distanceAnalysis, cellStats, decadeLabel,
    parseWrong, isTransposed, analyzeErrors, linePlot, lineChart, barChart, scatterChart, heatmap,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.NSS = api;
})(typeof self !== "undefined" ? self : globalThis);
