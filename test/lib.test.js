"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../site/lib.js");
const { SIZE, TOTAL, COLS, shuffle, toCSV, parseCSV, mean, median, sd, f, esc, lineChart } = L;

const trial = (o = {}) => ({
  experiment_id: "exp-1", started_at: "2026-01-01T00:00:00.000Z",
  sequence: 1, number: 42, x: 3, y: 5, time_ms: 512.3, errors: 0,
  participant_id: "", pointer_type: "", cell_px: "", preview_ms: "", seed: "", wrong_clicks: "", ...o,
});
// A run where time = 300 + 50 * distance exactly, walking along a row.
const linearRun = (id = "e", n = 20, base = 300, slope = 50) => {
  const out = [];
  let x = 1, dir = 1, prev = null;
  for (let i = 0; i < n; i++) {
    const step = (i % 4) + 1; // distances 1..4
    x = Math.min(SIZE, Math.max(1, x + dir * step));
    if (x === SIZE || x === 1) dir = -dir;
    const t = trial({ experiment_id: id, sequence: i + 1, number: i, x, y: 1 });
    if (prev) { const d = Math.abs(x - prev); t.time_ms = base + slope * d; }
    prev = x;
    out.push(t);
  }
  return out;
};

test("grid constants", () => {
  assert.equal(SIZE, 10);
  assert.equal(TOTAL, 100);
});

test("shuffle returns a permutation and does not mutate input", () => {
  const input = [...Array(TOTAL).keys()];
  const copy = input.slice();
  const out = shuffle(input);
  assert.deepEqual(input, copy);
  assert.deepEqual(out.slice().sort((a, b) => a - b), copy);
});

test("seeded rng / shuffle are reproducible", () => {
  const a = shuffle([...Array(50).keys()], L.rng(L.hashSeed("abc")));
  const b = shuffle([...Array(50).keys()], L.rng(L.hashSeed("abc")));
  const c = shuffle([...Array(50).keys()], L.rng(L.hashSeed("abd")));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test("mean / median / sample sd / quantile / mad", () => {
  assert.equal(mean([1, 2, 3, 4]), 2.5);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.ok(Math.abs(sd([2, 4, 4, 4, 5, 5, 7, 9]) - Math.sqrt(32 / 7)) < 1e-12);
  assert.equal(sd([5]), 0);
  assert.equal(L.quantile([1, 2, 3, 4, 5], 0.9), 4.6);
  assert.equal(L.mad([1, 2, 3, 4, 100]), 1);
  assert.ok(Number.isNaN(L.quantile([], 0.5)));
});

test("esc escapes HTML special characters", () => {
  assert.equal(esc('<a href="x">&</a>'), "&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
});

test("f rounds to integer and tolerates NaN / -0", () => {
  assert.equal(f(12.6), "13");
  assert.equal(f(NaN), "–");
  assert.equal(f(-0.2), "0");
});

test("toCSV writes header and rows, blanks for missing extras", () => {
  const lines = toCSV([trial(), trial({ sequence: 2 })]).trim().split("\n");
  assert.equal(lines[0], COLS.join(","));
  assert.equal(lines.length, 3);
  assert.equal(lines[1], "exp-1,2026-01-01T00:00:00.000Z,1,42,3,5,512.3,0,,,,,,");
});

test("toCSV strips commas/newlines so rows stay parseable", () => {
  const out = toCSV([trial({ participant_id: "a,b\nc" })]);
  assert.equal(parseCSV(out)[0].participant_id, "a b c");
});

test("CSV round-trips including extra columns", () => {
  const trials = [
    trial(),
    trial({ sequence: 2, number: 7, errors: 2, participant_id: "p1", pointer_type: "mouse", cell_px: 48, preview_ms: 1000, seed: "s", wrong_clicks: "12@300;21@800" }),
  ];
  assert.deepEqual(parseCSV(toCSV(trials)), trials);
});

test("parseCSV accepts the original 8-column format", () => {
  const rows = parseCSV("experiment_id,started_at,sequence,number,x,y,time_ms,errors\nA,2026-01-01,1,5,2,3,400,1\n");
  assert.equal(rows[0].participant_id, "");
  assert.equal(rows[0].cell_px, "");
  assert.equal(rows[0].errors, 1);
});

test("parseCSV handles BOM and CRLF", () => {
  const text = "﻿" + toCSV([trial()]).replace(/\n/g, "\r\n");
  assert.equal(parseCSV(text).length, 1);
});

test("parseCSV rejects empty files, missing columns and bad rows", () => {
  assert.throws(() => parseCSV(""), /empty/);
  assert.throws(() => parseCSV("a,b\n1,2"), /Missing columns/);
  const bad = toCSV([trial()]).replace("512.3", "abc");
  assert.throws(() => parseCSV(bad), /Invalid data on line 2/);
});

test("annotate computes distance to the previous target of the same run", () => {
  const a = L.annotate([
    trial({ experiment_id: "A", sequence: 1, x: 1, y: 1 }),
    trial({ experiment_id: "A", sequence: 2, x: 4, y: 5 }),
    trial({ experiment_id: "B", sequence: 2, x: 9, y: 9 }), // no sequence 1 in run B
  ]);
  assert.equal(a[0].dist, null);
  assert.equal(a[1].dist, 5);
  assert.equal(a[1].fitts_id, Math.log2(6));
  assert.equal(a[2].dist, null);
});

test("prepare drops warm-up, error trials and outliers, and reports counts", () => {
  const run = linearRun("A", 30);
  run[10].errors = 1;
  run[20].time_ms = 60000; // absurd outlier
  const r = L.prepare(run, { skipFirst: true, cleanOnly: true, outliers: true });
  assert.equal(r.counts.warmup, 1);
  assert.equal(r.counts.errors, 1);
  assert.equal(r.counts.outliers, 1);
  assert.equal(r.kept.length, 30 - 3);
  const loose = L.prepare(run, { skipFirst: false, cleanOnly: false, outliers: false });
  assert.equal(loose.kept.length, 30);
});

test("linreg / correlations recover a known linear relation", () => {
  const xs = [1, 2, 3, 4, 5], ys = xs.map((x) => 10 + 3 * x);
  const l = L.linreg(xs, ys);
  assert.ok(Math.abs(l.slope - 3) < 1e-9 && Math.abs(l.intercept - 10) < 1e-9 && Math.abs(l.r - 1) < 1e-9);
  assert.equal(L.linreg([1, 1, 1], [1, 2, 3]), null);
  assert.ok(Math.abs(L.spearman([1, 2, 3, 4], [1, 8, 27, 1000]) - 1) < 1e-9); // monotone, not linear
  assert.deepEqual(L.ranks([10, 20, 20, 30]), [1, 2.5, 2.5, 4]);
});

test("fisherCI brackets r and is null for tiny n", () => {
  const [lo, hi] = L.fisherCI(0.5, 100);
  assert.ok(lo < 0.5 && hi > 0.5 && lo > 0.3 && hi < 0.7);
  assert.equal(L.fisherCI(0.5, 3), null);
});

test("distanceAnalysis finds the slope of time versus distance", () => {
  const { kept } = L.prepare(linearRun("A", 40), { outliers: false });
  const da = L.distanceAnalysis(kept);
  assert.ok(Math.abs(da.lin.slope - 50) < 1e-6);
  assert.ok(Math.abs(da.lin.intercept - 300) < 1e-6);
  assert.ok(da.lin.r > 0.999 && da.rho > 0.9);
  assert.equal(da.perExp.k, 1);
  assert.ok(da.bins.every((b) => Math.abs(b.median - (300 + 50 * b.d)) < 1e-6));
  assert.equal(L.distanceAnalysis(kept.slice(0, 5)), null);
});

test("distanceAnalysis aggregates per-experiment slopes", () => {
  const trials = linearRun("A", 40, 300, 40).concat(linearRun("B", 40, 300, 60), linearRun("C", 40, 300, 50));
  const da = L.distanceAnalysis(L.prepare(trials, { outliers: false }).kept);
  assert.equal(da.perExp.k, 3);
  assert.ok(Math.abs(da.perExp.mean - 50) < 1e-6);
  assert.ok(da.perExp.ci[0] < 50 && da.perExp.ci[1] > 50);
});

test("cellStats separates raw time from distance-adjusted residuals", () => {
  const { kept } = L.prepare(linearRun("A", 40), { outliers: false });
  const da = L.distanceAnalysis(kept);
  const cs = L.cellStats(kept, da.lin);
  const i = cs.timeN.findIndex((n) => n > 0);
  assert.ok(cs.time[i] > 0);
  const r = cs.resid.find((v) => v !== null);
  assert.ok(Math.abs(r) < 1e-6); // perfect fit, no positional effect
});

test("bootCI is deterministic and brackets the statistic", () => {
  const clusters = [[100, 110, 120], [200, 210, 220], [150, 160, 170]];
  const a = L.bootCI(clusters, mean), b = L.bootCI(clusters, mean);
  assert.deepEqual(a, b);
  assert.ok(a[0] <= mean([].concat(...clusters)) && a[1] >= mean([].concat(...clusters)));
  assert.ok(L.bootCI([[1, 2, 3, 4, 5]], mean)[1] > L.bootCI([[1, 2, 3, 4, 5]], mean)[0]);
  assert.equal(L.bootCI([[1]], mean), null);
});

test("summary reports robust and classical statistics", () => {
  const s = L.summary([1, 2, 3, 4, 100], [[1, 2, 3, 4, 100]]);
  assert.equal(s.n, 5);
  assert.equal(s.median, 3);
  assert.equal(s.iqr, 2);
  assert.ok(s.mean > s.median);
  assert.equal(L.summary([], []), null);
});

test("analyzeErrors finds transpositions, off-by-one and distances", () => {
  const trials = [
    trial({ sequence: 1, number: 12, x: 1, y: 1, errors: 1, wrong_clicks: "21@300" }),
    trial({ sequence: 2, number: 21, x: 4, y: 5 }),
    trial({ sequence: 3, number: 47, x: 2, y: 2, errors: 2, wrong_clicks: "48@100;12@250" }),
  ];
  const e = L.analyzeErrors(trials);
  assert.equal(e.total, 3);
  assert.equal(e.logged, 3);
  assert.equal(e.transposed, 1);
  assert.equal(e.offByOne, 1);
  assert.equal(e.top[0][1], 1);
  assert.ok(Number.isFinite(e.medianDist));
  assert.equal(L.isTransposed(11, 11), false);
  assert.equal(L.isTransposed(69, 96), true);
});

test("lineChart renders an svg with a polyline and handles empty groups", () => {
  const groups = Array.from({ length: TOTAL }, (_, i) => (i % 2 ? [] : [100 + i]));
  const svg = lineChart(groups, 1, "label");
  assert.match(svg, /<svg/);
  assert.match(svg, /<polyline/);
  assert.match(svg, /aria-label="label"/);
});

test("lineChart supports median + moving average + non-zero axis", () => {
  const groups = Array.from({ length: TOTAL }, (_, i) => [1000 + i, 1000 + i + 2, 1000 + i + 4]);
  const svg = lineChart(groups, 1, "m", { stat: median, window: 10, zero: false });
  assert.match(svg, /<polyline/);
  assert.doesNotMatch(svg, />0<\/text>/);
});

test("barChart, scatterChart and heatmap render", () => {
  const bars = L.barChart([{ label: "0–9", value: 500, n: 4 }, { label: "10–19", value: null, n: 0 }], "bars");
  assert.match(bars, /<rect/);
  assert.match(bars, /n=4/);
  const sc = L.scatterChart([{ x: 1, y: 300 }, { x: 5, y: 600 }, { x: 9, y: 900 }], "sc", {
    line: { slope: 75, intercept: 225 }, bins: [{ x: 1, y: 300 }], xLabel: "d", yLabel: "ms",
  });
  assert.match(sc, /<circle/);
  assert.match(sc, /stroke-dasharray/);
  const vals = Array(100).fill(null), ns = Array(100).fill(0);
  vals[0] = 600; ns[0] = 5; vals[1] = 400; ns[1] = 1;
  const hm = L.heatmap(vals, ns, { center: 500, span: 100 });
  assert.equal((hm.match(/class="low"/g) || []).length, 99); // sparse cells greyed
  assert.match(hm, /rgba\(214,96,0/);
});

test("lineChart band draws a 25th–75th percentile polygon and pools the moving window", () => {
  const groups = Array.from({ length: TOTAL }, (_, i) => [1000 + i, 1100 + i, 1200 + i, 1300 + i]);
  const svg = lineChart(groups, 1, "b", { stat: median, window: 10, zero: false, band: true });
  assert.match(svg, /<polygon/);
  assert.doesNotMatch(lineChart(groups, 1, "b", { stat: median }), /<polygon/);
});

test("distanceAnalysis bins carry IQR and a CI of the median", () => {
  const trials = linearRun("A", 40).concat(linearRun("B", 40, 320, 45));
  const da = L.distanceAnalysis(L.prepare(trials, { outliers: false }).kept);
  const b = da.bins.find((x) => x.n > 4);
  assert.ok(b.q1 <= b.median && b.median <= b.q3);
  assert.ok(b.medianCI[0] <= b.median && b.median <= b.medianCI[1]);
});

test("scatter and bar charts draw IQR whiskers and CI error bars", () => {
  const sc = L.scatterChart([{ x: 1, y: 300 }, { x: 5, y: 600 }], "s", { bins: [{ x: 1, y: 300, q1: 250, q3: 350, lo: 280, hi: 320 }] });
  assert.match(sc, /25th–75th percentile/);
  assert.match(sc, /#7a3500/);
  const bar = L.barChart([{ label: "a", value: 500, n: 3, lo: 450, hi: 550 }], "b");
  assert.match(bar, /stroke="#d66000"/);
});
