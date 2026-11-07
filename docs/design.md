# Design notes

## Interpretations of the brief

The original request left a few points open. These are the choices made; each is a one-line change in `site/app.js` if you want otherwise.

| Question | Choice |
|---|---|
| Do numbers stay visible after the 1 s preview? | **Yes.** The task is a visual search; hiding them would turn it into a memory test. Cells are blank only before Start. |
| Order in which targets are requested | Random permutation of 0–99, independent of the layout. |
| What is `sequence`? | Position in the request order (1–100). |
| Coordinates | 1-based `x` = column, `y` = row, origin top-left. |
| Wrong clicks | Ignored for progression, counted in `errors`. |
| Unfinished runs | Discarded; only complete 100-trial runs are stored. |

## Architecture

Single page, three files, no framework.

- **Storage**: one `localStorage` key (`nss.trials.v1`) holding a flat JSON array of trial rows, the same shape as the CSV rows. Experiments are grouped on read by `experiment_id`. The `v1` suffix allows a future schema change.
- **State machine**: `blank → preview (1 s) → [target shown → correct click]×100 → saved`. While waiting for the target to paint, the grid is locked so clicks cannot be attributed to the previous target.
- **Statistics** are computed on demand from the stored rows when the Statistics tab opens.

## Timing accuracy

- Start: `performance.now()` inside the second `requestAnimationFrame` after the target text is updated, i.e. after the frame containing it was painted.
- End: `performance.now()` in the `pointerdown` handler (earlier than `click`, which fires after release).
- Lock/unlock around transitions prevents double counting on fast double clicks.

## CSV format

Comma-separated, UTF-8, header row required, columns may appear in any order on import. The first 8 columns are required; the rest are optional. Free-text fields have commas, quotes and newlines replaced by spaces, so no quoting is needed.

## Analysis choices

- **Robust first.** Click times are right-skewed, so the headline numbers are medians with bootstrap CIs; the mean is still shown. Outliers are flagged per run on log time (median ± 3 × 1.4826 × MAD) so a slow run does not hide a bad click in a fast one.
- **Clusters, not clicks.** The 100 clicks of one run share one person, device and mood. CIs resample whole experiments; the distance slope is also fitted per experiment and averaged, so the headline uncertainty does not rely on independent clicks.
- **Distance is derived, not stored.** `dist` = Euclidean distance between the previous and current target cell (unit = one cell), computed from `x`, `y`, `sequence` on read. Fitts' index of difficulty is `log2(dist + 1)`; target width is constant, so it is just a transform of distance. Spearman ρ is identical for both.
- **Position effect = residual.** Raw per-cell time mixes search time and travel. The second heatmap subtracts the pooled linear distance model, so it shows what position adds beyond distance.
- **Spread is shown as percentiles and CIs, not ±SD.** Times are skewed, so a symmetric SD band would misstate the slow side. Charts use the 25th–75th percentile range (spread of clicks) and bootstrap 95% CIs of the median (certainty of the estimate); CIs resample experiments.
- **Numbers are labels.** Number value is grouped by decade instead of drawn as a continuous line.
- **No false precision.** Heatmap cells with fewer than 3 observations are grey; all charts show n or say how many runs they pool.
- **Warm-up.** The first click of a run has no previous target and starts from the Start button, so it is skipped by default.

## Possible extensions

- Configurable grid size and preview duration.
- Mixed-effects model (participant and run as random effects) for the distance slope, if one participant ever has many runs.
- Per-participant comparison on identical seeded grids.
