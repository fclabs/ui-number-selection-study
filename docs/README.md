# Number Selection Study

A small static web app for collecting UI-behaviour data: how long does a person take to find and click a number in a 10×10 grid?

No build step, no dependencies, no server. Data lives in the browser (`localStorage`) and moves in and out as CSV.

## Running it

Open `site/index.html` in a browser, or serve the folder:

```sh
npm start   # serves site/ at http://localhost:8000
```

## The experiment

1. The page opens with a blank 10×10 grid (light-cream cells, no numbers).
2. Click **Start**. The numbers 0–99 appear in random positions for **1 second**.
3. The grid then asks for one number at a time ("Click: 42"). Clicking the correct cell turns it dark blue with a white number, and the next not-yet-clicked number is requested. Targets come in random order.
4. After all 100 numbers are clicked the run is saved and the mean time is shown. Click **New experiment** to run again.

Rules:
- Numbers never move during a run; a new layout is generated only when a new experiment starts.
- Clicking a wrong cell does not advance. It is counted in the `errors` column for that target.
- Switching to Statistics during a run discards the unfinished run (after a confirmation). Only complete runs are stored.

## What is measured

For each of the 100 targets:

| Column | Meaning |
|---|---|
| `experiment_id` | Unique id of the run |
| `started_at` | ISO-8601 time the run started |
| `sequence` | Order in which the target was requested (1 = first, 100 = last) |
| `number` | The number requested (0–99) |
| `x` | Column of the number in the grid, 1 (left) to 10 (right) |
| `y` | Row of the number in the grid, 1 (top) to 10 (bottom) |
| `time_ms` | Milliseconds from the target being shown to the correct click |
| `errors` | Wrong clicks made before the correct one |
| `participant_id` | Optional id typed on the Experiment tab (remembered between runs) |
| `pointer_type` | `mouse`, `touch` or `pen`, from the pointer event |
| `cell_px` | Width of a grid cell in CSS pixels at the click (display size affects movement time) |
| `preview_ms` | Length of the initial preview |
| `seed` | Optional layout seed; the same seed gives the same grid and target order |
| `wrong_clicks` | Each wrong click as `number@ms` (ms after the target appeared), joined by `;` |

The last six columns are optional: old 8-column files still import, with those fields blank.

Timing uses `performance.now()`. The start time is taken after the browser has painted the new target (two `requestAnimationFrame` ticks), so rendering delay is not counted. The end time is the `pointerdown` event of the correct click.

**Practice** runs 10 targets with the same rules and saves nothing.

## Statistics view

Filters at the top apply to every number below:

- **Participant**: one person or all.
- **Skip first click** (default on): the first click of a run starts from wherever the pointer was, not from a previous target.
- **Exclude outliers** (default on): clicks more than 3 robust SDs (1.4826 × MAD) from the run's median, on a log-time scale.
- **Clean trials only** (default off): drop targets that had any wrong click.

The page states how many clicks each filter removed. Sections:

- **Overall**: median and mean with 95% confidence intervals, sample SD (n−1), IQR, P90, wrong clicks per 100 targets. Intervals are bootstrapped by resampling whole experiments, because clicks within a run are not independent (with one experiment, clicks are resampled).
- **Per participant / per experiment** tables, plus charts of median time and wrong clicks per experiment over time (practice vs. fatigue).
- **Distance to previous target vs. time**: for every click, the Euclidean distance (in cells) from the previous target of the same run. Shows a scatter plot with the median per distance (plus its 25th–75th percentile range and a bootstrap 95% CI) and a least-squares line; Pearson r (with Fisher 95% CI), Spearman ρ, r against log₂(distance+1) (Fitts), R², ms per extra cell, fitted time at distance 0, and the slope computed per experiment (with a t-based CI) which does not assume independent clicks.
- **Median time by sequence** over a 10-position moving window, with a shaded 25th–75th percentile band and a non-zero axis, to see learning or fatigue.
- **Median time by number range** (0–9, 10–19, …) as bars with n and a 95% CI error bar on each median.
- **Time by grid position**: raw mean time, and the same after subtracting the time expected from distance alone (the true positional effect). Colours are relative to the median (±25%); cells with fewer than 3 observations are grey.
- **Wrong clicks**: share of digit transpositions (12 → 21), off-by-one errors, median distance of the wrong click from the target, and the most frequent target → clicked pairs.

## CSV export and import

**Export CSV** downloads every stored trial as `number-selection-YYYY-MM-DD.csv`, with the header:

```
experiment_id,started_at,sequence,number,x,y,time_ms,errors,participant_id,pointer_type,cell_px,preview_ms,seed,wrong_clicks
```

**Import CSV** loads a file in the same format. Rows are merged with existing data; a row whose `experiment_id` + `sequence` already exists is skipped, so re-importing the same file is safe. A file missing a required column (the first 8), or with non-numeric values, is rejected without changing stored data. Commas and line breaks typed into free-text fields are replaced by spaces on export.

**Delete all data** clears `localStorage` for this app (asks for confirmation).

## Files

| File | Purpose |
|---|---|
| `site/index.html` | Page structure |
| `site/style.css` | Styling (cream `#fdf3d8` cells, dark blue `#0b2a6b` selected) |
| `site/app.js` | DOM wiring: experiment flow, storage, tabs, stats rendering |
| `site/lib.js` | Pure logic (CSV, statistics, correlation, chart SVG), unit-tested |
| `test/` | Node tests, run with `npm test` |
| `.github/workflows/` | `ci.yml` (tests) and `pages.yml` (deploy `site/` to GitHub Pages) |
| `docs/design.md` | Design decisions and limitations |

## Limitations

- Data is per browser and per origin: a different browser, device, or URL (e.g. `file://` vs `localhost`) has its own store. Export to move data.
- Clearing site data erases results, so export regularly.
- Participant ids are free text; use the same spelling every time.
- Timing resolution depends on the browser and display refresh rate (typically ±1 frame, ~16 ms).
