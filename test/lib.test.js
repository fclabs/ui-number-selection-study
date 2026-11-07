"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { SIZE, TOTAL, COLS, shuffle, toCSV, parseCSV, mean, median, sd, f, esc, lineChart } = require("../site/lib.js");

const trial = (o = {}) => ({
  experiment_id: "exp-1", started_at: "2026-01-01T00:00:00.000Z",
  sequence: 1, number: 42, x: 3, y: 5, time_ms: 512.3, errors: 0, ...o,
});

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

test("mean / median / sd", () => {
  assert.equal(mean([1, 2, 3, 4]), 2.5);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(sd([2, 4, 4, 4, 5, 5, 7, 9]), 2);
});

test("esc escapes HTML special characters", () => {
  assert.equal(esc('<a href="x">&</a>'), "&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
});

test("f rounds to integer", () => {
  assert.equal(f(12.6), "13");
});

test("toCSV writes header and rows", () => {
  const lines = toCSV([trial(), trial({ sequence: 2 })]).trim().split("\n");
  assert.equal(lines[0], COLS.join(","));
  assert.equal(lines.length, 3);
  assert.equal(lines[1], "exp-1,2026-01-01T00:00:00.000Z,1,42,3,5,512.3,0");
});

test("CSV round-trips", () => {
  const trials = [trial(), trial({ sequence: 2, number: 7, errors: 2 })];
  assert.deepEqual(parseCSV(toCSV(trials)), trials);
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

test("lineChart renders an svg with a polyline and handles empty groups", () => {
  const groups = Array.from({ length: TOTAL }, (_, i) => (i % 2 ? [] : [100 + i]));
  const svg = lineChart(groups, 1, "label");
  assert.match(svg, /<svg/);
  assert.match(svg, /<polyline/);
  assert.match(svg, /aria-label="label"/);
});
