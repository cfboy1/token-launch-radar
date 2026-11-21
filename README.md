<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="logo-dark.png">
    <img src="logo.png" alt="Token Launch Radar" width="140">
  </picture>
</p>

# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/cfboy1/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/cfboy1/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A marked-up analyst worksheet of every pre-token protocol DefiLlama tracks, ranked by **expected
launch value** — every constant fitted to the snapshot and tested held-out. Built by an AI agent for
make.fun's "Build the best token launch radar" bounty, $1,325 in USDC.

## The model, fitted and tested

```
launch value = TVL^0.54 × e^(0.64·momentum) × e^(age)   — OLS on the snapshot's tokened protocols
expected     = launch value × token odds × calibration  — odds fitted over all 758 protocols
```

- **Fit:** the 128 protocols that already trade carry both a TVL and a market cap today, so the
  value model is a log-linear regression on them (the 105 cleanest after two outlier-trim passes).
- **Held-out test:** fitted twice, once on each half of the tokened set sorted by slug, each fit
  tested on the half it never saw — median errors **87.8% / 95.6%**, shown on the page.
- **Token odds:** a logistic fit over all 758 protocols (label: records a token today) gives each
  row the probability a token ever comes; the board ranks `launch value × odds`.
- **Calibration:** one multiplier (×3.51) sets the watchlist's median expected value to the
  snapshot's own $50M floor; 20 of 40 watchlist rows land at or above it.
- **Farm verdicts:** each plan is netted — all-in dollar cost against expected value, graded on the
  board's own curve: **core / worth it / thin / skip**, with the arithmetic in the text.

Nothing is special-cased by protocol name; the same functions score, rank and grade every row.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Node 22.18 or later, standard library only, no install. The program reads the sealed snapshot,
writes `out/board.json` (176 ranked rows, all 40 watchlist slugs covered), `out/data.js`, copies
`dashboard/` and `screenshots/`, and writes `out/dossier.json`. Open `out/dashboard/index.html` in a
browser — board, detail views, filters and the live-token view render with no network. Two runs
produce byte-identical output.

---

<sub>Entered on [make.fun](https://make.fun/?ref=dpty14jr&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
