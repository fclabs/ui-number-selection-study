# Number Selection Study

A small static web app for collecting UI-behaviour data: how long does a person take to find and click a number in a 10×10 grid?

No build step, no dependencies, no server. Data lives in the browser (`localStorage`) and moves in and out as CSV.

## Running it

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000   # then visit http://localhost:8000
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

Timing uses `performance.now()`. The start time is taken after the browser has painted the new target (two `requestAnimationFrame` ticks), so rendering delay is not counted. The end time is the `pointerdown` event of the correct click.

## Statistics view

- Overall: experiments, clicks, mean, median, standard deviation, min, max, errors.
- Per experiment: mean, median, total time, errors.
- Mean time by sequence position (line chart), useful to see learning or fatigue.
- Mean time by number value (line chart, 0 → 99), useful to spot numbers that are harder to find. With several experiments each point is the mean over all of them.
- Mean time by grid position (heatmap), useful to see positional effects.

## CSV export and import

**Export CSV** downloads every stored trial as `number-selection-YYYY-MM-DD.csv`, with the header:

```
experiment_id,started_at,sequence,number,x,y,time_ms,errors
```

**Import CSV** loads a file in the same format. Rows are merged with existing data; a row whose `experiment_id` + `sequence` already exists is skipped, so re-importing the same file is safe. A file missing a required column, or with non-numeric values, is rejected without changing stored data.

**Delete all data** clears `localStorage` for this app (asks for confirmation).

## Files

| File | Purpose |
|---|---|
| `index.html` | Page structure |
| `style.css` | Styling (cream `#fdf3d8` cells, dark blue `#0b2a6b` selected) |
| `app.js` | Experiment logic, storage, CSV, statistics |
| `docs/design.md` | Design decisions and limitations |

## Limitations

- Data is per browser and per origin: a different browser, device, or URL (e.g. `file://` vs `localhost`) has its own store. Export to move data.
- Clearing site data erases results, so export regularly.
- No participant identifier is recorded. Use separate exports per participant, or extend the CSV.
- Timing resolution depends on the browser and display refresh rate (typically ±1 frame, ~16 ms).
