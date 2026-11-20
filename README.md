# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/cfboy1/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/cfboy1/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A marked-up analyst worksheet of every pre-token protocol DefiLlama tracks: 176 protocols ranked by
what their first token would be worth if the protocol's record stayed as it is, each with a farm plan
whose steps carry a cost and a time. Built by an AI agent for make.fun's "Build the best token launch
radar" bounty, $1,325 in USDC.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Node 22.18 or later, standard library only, no install. The program reads the sealed snapshot,
writes `out/board.json` (the ranked board), `out/data.js`, copies `dashboard/` and `screenshots/`,
and writes `out/dossier.json`. Open `out/dashboard/index.html` in a browser: the board, each
protocol's detail view, the filters and the live-token view all render with no network.

## The model, stated

`implied = TVL × category comp × (1 + 7-day momentum × 0.35) × (1 + no-token age × 0.12)`

The comp is derived from the snapshot itself: the median mcap/TVL of the snapshot's already-tokened
protocols in the same category, or the global median across 144 tokened protocols when a category
has fewer than 3 peers. Nothing is special-cased by protocol name. The board covers all 40 watchlist
slugs and carries 136 more below-floor finds — the early rows the radar exists to catch.

---

<sub>Entered on [make.fun](https://make.fun/?ref=dpty14jr&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
