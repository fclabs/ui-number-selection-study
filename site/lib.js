"use strict";
// Pure logic (no DOM): shared by the browser (global `NSS`) and the Node tests.
(function (root) {
  const SIZE = 10, TOTAL = SIZE * SIZE;
  const COLS = ["experiment_id", "started_at", "sequence", "number", "x", "y", "time_ms", "errors"];

  const shuffle = (a) => {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
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

  const api = { SIZE, TOTAL, COLS, shuffle, toCSV, parseCSV, mean, median, sd, f, esc, lineChart };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.NSS = api;
})(typeof self !== "undefined" ? self : globalThis);
