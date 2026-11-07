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

Comma-separated, UTF-8, header row required, columns may appear in any order on import. No field contains commas or quotes, so no quoting is needed.

## Possible extensions

- Participant id / notes field per experiment.
- Fixed layouts or seeds, to compare participants on identical grids.
- Distance-from-previous-target analysis (Fitts-style); `x`, `y` and `sequence` already allow computing it offline.
- Configurable grid size and preview duration.
