# Number Selection Study

A small static web app for collecting UI-behaviour data: how long does a person take to find and click a number in a 10×10 grid?

No build step, no dependencies, no server. Results are stored in the browser (`localStorage`) and move in and out as CSV.

Live site: https://fclabs.github.io/ui-number-selection-study/ (deployed from `main` via GitHub Pages)

## Quick start

```sh
npm start   # serves site/ at http://localhost:8000
```

Or just open `site/index.html` in a browser. Requires Python 3 for `npm start` (it uses `http.server`).

## How it works

1. Click **Start**. Numbers 0–99 appear in random positions for 1 second.
2. The app asks for one number at a time ("Click: 42"). Correct clicks turn the cell dark blue.
3. After all 100 numbers are clicked, the run is saved and the mean time is shown.

Per trial it records the number, its grid position (`x`, `y`), time to correct click (`time_ms`) and wrong clicks (`errors`). The **Statistics** tab shows summary figures, per-experiment results and charts by sequence, number and grid position. Data can be exported and re-imported as CSV.

## Tests

```sh
npm test    # Node's built-in test runner, no install needed (Node 22 in CI)
```

## Project layout

| Path | Purpose |
|---|---|
| `site/` | The app: `index.html`, `style.css`, `app.js` (DOM wiring), `lib.js` (pure logic) |
| `test/` | Unit tests for `lib.js` |
| `.github/workflows/` | CI tests and GitHub Pages deploy |
| `docs/README.md` | Full user documentation: experiment rules, CSV format, statistics, limitations |
| `docs/design.md` | Design decisions, timing accuracy, possible extensions |

## License

MIT, see [LICENSE](LICENSE).
