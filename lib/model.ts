// The token radar's model, v2: every constant fitted to the snapshot and tested held-out.
//
// The snapshot itself provides the ground truth the model is fitted and judged against:
//
//   1. Launch value — the 144 protocols that already have tokens carry both a TVL and a market
//      cap today, so the value model is a log-linear fit on them:
//        log mcap = b0 + b1*log TVL + b2*momentum01 + b3*age01
//      fitted twice, once on each half of the tokened set sorted by slug, each fit tested on the
//      half it never saw; the board uses the full-sample fit. Both held-out errors are shown on
//      the page. Nothing is special-cased by name; the same function scores every protocol.
//   2. Token odds — a logistic fit over all 758 protocols (label: records a token today) on the
//      same figures, so the board can separate "a big token if it launches" from "likely to
//      launch at all". Expected launch value = launch value x odds; the board ranks expected.
//   3. Calibration — one multiplier, fitted on the watchlist alone, sets the watchlist's median
//      expected value to the snapshot's own $50M floor: the snapshot asserts these protocols are
//      worth at least the floor, so the scale is the snapshot's, not ours. The multiplier is
//      stated on the page.
//   4. Farm verdicts — each plan is netted: the plan's all-in dollar cost against the row's
//      expected value, one of four verdicts (core / worth it / thin / skip) with the arithmetic
//      in the text.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export const MOMENTUM_FLOOR_PCT = -60;
export const MOMENTUM_CAP_PCT = 99;
export const AGE_CAP_DAYS = 1095;
export const AGE_UNKNOWN_DAYS = 90;
export const IMPLIED_CAP_USD = 100_000_000_000_000;
export const ODDS_FLOOR = 0.02;
export const ODDS_CEIL = 0.97;

/** How many already-tokened protocols the Live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A protocol's features the fits read, from the snapshot's own figures only. */
export interface Features {
  logTvl: number;
  momentum01: number;
  age01: number;
}

export interface ValueFit {
  b0: number;
  b_tvl: number;
  b_mom: number;
  b_age: number;
  n: number;
}

export interface FoldResult {
  fit_n: number;
  test_n: number;
  median_abs_err_pct: number;
  log_r2: number;
}

export interface OddsFit {
  w0: number;
  w_tvl: number;
  w_age: number;
  w_mom: number;
  n: number;
  base_rate: number;
}

export interface ModelReport {
  fit: ValueFit;
  folds: [FoldResult, FoldResult];
  odds: OddsFit;
  calibration: {
    multiplier: number;
    watchlist_median_raw: number;
    floor_usd: number;
    watchlist_above_floor: number;
    watchlist_size: number;
  };
  counts: { scanned: number; no_token: number; tokened: number; board: number; early: number; live: number };
}

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

export type VerdictLabel = 'core' | 'worth it' | 'thin' | 'skip';

export interface FarmVerdict {
  label: VerdictLabel;
  cost_usd: number;
  multiple: number;
  text: string;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  launch_value_usd: number;
  token_odds: number;
  model: {
    tvl_exponent: number;
    momentum_mult: number;
    age_mult: number;
    age_days_used: number;
  };
  verdict: { label: VerdictLabel; cost_usd: number; multiple: number };
  farm_steps: string[];
}

export interface RadarRow extends Omit<BoardRow, 'farm_steps' | 'verdict'> {
  plan: FarmStep[];
  verdict: FarmVerdict;
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  mc_tvl: number;
}

export interface ShrunkenComp {
  category: string;
  samples: number;
  median_mc_tvl: number;
  shrunken_mc_tvl: number;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  scanned: number;
  model_version: string;
  report: ModelReport;
  comps: ShrunkenComp[];
  global_comp: { samples: number; median_mc_tvl: number };
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

export const MODEL_VERSION = 'fitted-v2';

const DAY_MS = 86_400_000;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from a listing date to the snapshot's `as_of`, clamped at zero; null when absent. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

function tvlOf(p: SnapshotProtocol): number {
  return finite(p.tvl_usd, 0) > 0 ? p.tvl_usd : 0;
}

/** Whether a protocol's record carries no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const EXCHANGE_NAMES = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)\b/i;
const DERIVATIVE_WORDS = /\b(wrapped|staked|staking)\b/i;
const BANNED_CATEGORIES = ['cex', 'bridge', 'canonical bridge', 'liquid staking', 'liquid restaking', 'restaked btc', 'staking pool', 'stablecoin wrapper'];

/** Whether a below-floor protocol may join the board: pre-token, and not a derivative of a tokened one. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (VERSIONED.test(p.name) || EXCHANGE_NAMES.test(p.name)) return false;
  if (DERIVATIVE_WORDS.test(p.name)) return false;
  return !BANNED_CATEGORIES.includes((p.category ?? '').toLowerCase());
}

export function featuresOf(p: SnapshotProtocol, asOf: string): Features {
  const age = ageDays(asOf, p.listed_at);
  return {
    logTvl: Math.log(Math.max(1, tvlOf(p))),
    momentum01: Math.min(MOMENTUM_CAP_PCT, Math.max(MOMENTUM_FLOOR_PCT, finite(p.change_7d, 0))) / 100,
    age01: Math.min(age ?? AGE_UNKNOWN_DAYS, AGE_CAP_DAYS) / AGE_CAP_DAYS,
  };
}

/** Solve a dense linear system by Gaussian elimination with partial pivoting. */
function solve(matrix: number[][], rhs: number[]): number[] {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r]![col]!) > Math.abs(a[pivot]![col]!)) pivot = r;
    if (Math.abs(a[pivot]![col]!) < 1e-12) { a[col]![col] = 1e-12; }
    [a[col], a[pivot]] = [a[pivot]!, a[col]!];
    for (let r = col + 1; r < n; r++) {
      const f = a[r]![col]! / a[col]![col]!;
      for (let c = col; c <= n; c++) a[r]![c] = a[r]![c]! - f * a[col]![c]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = a[r]![n]!;
    for (let c = r + 1; c < n; c++) s -= a[r]![c]! * x[c]!;
    x[r] = s / a[r]![r]!;
  }
  return x;
}

/** Ordinary least squares of log mcap on [1, logTvl/10, momentum01, age01], lightly ridged. */
function fitLogLinear(sample: Array<{ p: SnapshotProtocol; f: Features }>): ValueFit {
  const X = sample.map((s) => [1, s.f.logTvl / 10, s.f.momentum01, s.f.age01]);
  const y = sample.map((s) => Math.log(s.p.mcap_usd as number));
  const xtX = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  const xty = [0, 0, 0, 0];
  for (let i = 0; i < X.length; i++) {
    for (let r = 0; r < 4; r++) {
      xty[r]! += X[i]![r]! * y[i]!;
      for (let c = 0; c < 4; c++) xtX[r]![c]! += X[i]![r]! * X[i]![c]!;
    }
  }
  for (let r = 0; r < 4; r++) xtX[r]![r]! += 1e-9 * (r === 0 ? X.length : 1);
  const beta = solve(xtX, xty);
  return { b0: beta[0]!, b_tvl: beta[1]! / 10, b_mom: beta[2]!, b_age: beta[3]!, n: sample.length };
}

function quantileSorted(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))] ?? 0;
}

/**
 * A robust refit: the raw sample carries a few wild records (a $48K cap on a $5M book, a $2.6B cap
 * on a $6M book), and plain least squares lets them steer the whole line. So: fit, keep the 90% of
 * rows whose residual is not among the wildest, refit, and again. Deterministic, and the held-out
 * tests below still judge the result on data it never saw.
 */
function robustFit(sample: Array<{ p: SnapshotProtocol; f: Features }>): ValueFit {
  let fit = fitLogLinear(sample);
  let kept = sample;
  for (let pass = 0; pass < 2; pass++) {
    const residuals = kept.map((s) => Math.abs(Math.log(launchValueOf(s.f, fit)) - Math.log(s.p.mcap_usd as number))).sort((a, b) => a - b);
    const cut = quantileSorted(residuals, 0.9);
    kept = kept.filter((s) => Math.abs(Math.log(launchValueOf(s.f, fit)) - Math.log(s.p.mcap_usd as number)) <= cut);
    fit = fitLogLinear(kept);
  }
  return fit;
}

/** The fitted launch value for one protocol's features, in dollars. */
export function launchValueOf(f: Features, fit: ValueFit): number {
  return Math.exp(fit.b0 + fit.b_tvl * f.logTvl + fit.b_mom * f.momentum01 + fit.b_age * f.age01);
}

/** A fit's held-out error on a sample it never saw: median absolute percent error and log-space R^2. */
function testFit(fit: ValueFit, sample: Array<{ p: SnapshotProtocol; f: Features }>): FoldResult {
  const errs = sample.map((s) => {
    const pred = launchValueOf(s.f, fit);
    const actual = s.p.mcap_usd as number;
    return Math.abs(pred - actual) / Math.max(1, actual);
  }).sort((a, b) => a - b);
  const med = errs[Math.floor(errs.length / 2)] ?? 1;
  const logs = sample.map((s) => Math.log(s.p.mcap_usd as number));
  const preds = sample.map((s) => Math.log(launchValueOf(s.f, fit)));
  const meanLog = logs.reduce((a, b) => a + b, 0) / logs.length;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < logs.length; i++) { ssTot += (logs[i]! - meanLog) ** 2; ssRes += (logs[i]! - preds[i]!) ** 2; }
  return { fit_n: fit.n, test_n: sample.length, median_abs_err_pct: Math.round(med * 1000) / 10, log_r2: Math.round((1 - ssRes / Math.max(1e-9, ssTot)) * 1000) / 1000 };
}

/** Logistic fit (deterministic gradient descent) of has-token on the same figures. */
function fitOdds(rows: Array<{ p: SnapshotProtocol; f: Features; y: number }>): OddsFit {
  const w = [0, 0, 0, 0];
  const lr = 0.5;
  for (let it = 0; it < 600; it++) {
    const g = [0, 0, 0, 0];
    for (const r of rows) {
      const x = [1, r.f.logTvl / 10, r.f.age01, r.f.momentum01];
      let z = 0;
      for (let i = 0; i < 4; i++) z += w[i]! * x[i]!;
      const e = 1 / (1 + Math.exp(-z)) - r.y;
      for (let i = 0; i < 4; i++) g[i]! += e * x[i]!;
    }
    for (let i = 0; i < 4; i++) w[i] -= (lr / rows.length) * g[i]!;
  }
  const base = rows.reduce((a, r) => a + r.y, 0) / rows.length;
  return { w0: w[0]!, w_tvl: w[1]! / 10, w_age: w[2]!, w_mom: w[3]!, n: rows.length, base_rate: Math.round(base * 1000) / 1000 };
}

export function oddsOf(f: Features, odds: OddsFit): number {
  const z = odds.w0 + odds.w_tvl * f.logTvl + odds.w_age * f.age01 + odds.w_mom * f.momentum01;
  return Math.min(ODDS_CEIL, Math.max(ODDS_FLOOR, 1 / (1 + Math.exp(-z))));
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)] ?? 0;
}

/** Category mcap/TVL medians, shrunk toward the global median when a category has few peers. */
export function buildComps(snapshot: Snapshot, shrinkK = 3): { global: { samples: number; median_mc_tvl: number }; comps: ShrunkenComp[] } {
  const ratios: Array<{ category: string; ratio: number }> = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || tvlOf(p) <= 0) continue;
    ratios.push({ category: p.category ?? '(uncategorized)', ratio: p.mcap_usd / tvlOf(p) });
  }
  const global = { samples: ratios.length, median_mc_tvl: median(ratios.map((r) => r.ratio)) };
  const byCategory = new Map<string, number[]>();
  for (const r of ratios) {
    const list = byCategory.get(r.category) ?? [];
    list.push(r.ratio);
    byCategory.set(r.category, list);
  }
  const comps: ShrunkenComp[] = [...byCategory.entries()]
    .map(([category, list]) => {
      const med = median(list);
      return {
        category,
        samples: list.length,
        median_mc_tvl: Math.round(med * 1000) / 1000,
        shrunken_mc_tvl: Math.round(((list.length * med + shrinkK * global.median_mc_tvl) / (list.length + shrinkK)) * 1000) / 1000,
      };
    })
    .filter((c) => c.samples >= 3)
    .sort((a, b) => a.category < b.category ? -1 : 1);
  return { global, comps };
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 250;
  if (tvl >= 1_000_000_000) return 150;
  if (tvl >= 100_000_000) return 100;
  return 50;
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 180) return 60;
  if (age < 730) return 45;
  return 30;
}

function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('curator') || c.includes('allocator') || c.includes('manager')) return `Deposit $${capital} into a ${n} vault on ${chain} and hold the receipt token.`;
  if (c.includes('lending') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${n} on ${chain} and borrow against it once.`;
  if (c.includes('dex') || c.includes('yield')) return `Provide $${capital} of liquidity to ${n}'s largest pool on ${chain} and stake the LP token.`;
  if (c.includes('basis')) return `Fund $${capital} on ${n} and run one basis trade, spot long against the perp, on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${n}'s yield-bearing asset on ${chain} and hold it in the same wallet.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${n} on ${chain} and renew it once before it lapses.`;
  if (c.includes('perp') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${n} and open one small position on its main market.`;
  if (c.includes('payments')) return `Settle $${capital} of payment volume through ${n} on ${chain} over two separate weeks.`;
  if (c.includes('chain') || c.includes('infrastructure')) return `Run $${capital} through ${n}'s apps on ${chain} — bridge, swap and stake once each.`;
  if (c.includes('governance')) return `Hold $${capital} of ${n}'s base asset on ${chain} and vote in one proposal each month.`;
  if (c.includes('launch') || c.includes('incubator')) return `Join one sale or quest on ${n} with $${capital} and finish every on-chain task it lists.`;
  return `Deposit $${capital} of USDC into ${n} on ${chain} and keep the position open.`;
}

export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const second = p.chains.length > 1 ? p.chains[1]! : null;
  const capital = capitalFor(tvlOf(p));
  const hold = holdDaysFor(age);
  return [
    {
      text: `Set up a fresh wallet that will only ever touch ${p.name}, and fund it from an exchange so the airdrop source is one hop, not ten.`,
      cost: '≤ $3 gas',
      time: '10 min',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} + ~$${capital >= 150 ? 8 : 4} gas`,
      time: '15 min',
    },
    second
      ? { text: `Repeat the deposit on ${second}, ${p.name}'s second chain, so activity spans more than one chain in the same week.`, cost: `$${capital} + bridge fee`, time: '20 min' }
      : { text: `Make one qualifying action each week — a deposit, a swap, a vote or a claim — on ${chain}, always through ${p.name}'s own app.`, cost: '~$2 gas/wk', time: '10 min/wk' },
    { text: `Hold the position for at least ${hold} days, across at least three separate weeks, so the wallet's activity shows in more than one monthly snapshot.`, cost: 'capital stays in', time: `${hold} days` },
    { text: `Check ${p.name}'s own points, rewards or docs page once a week and claim only from links published there — never from a DM, a reply or an ad.`, cost: 'free to check', time: '10 min/wk' },
    { text: `Log the wallet address, every date and every transaction hash in one running file, so a claim form, an eligibility check or an unwind takes minutes.`, cost: 'free', time: '5 min/wk' },
  ];
}

/** All-in dollar cost of the plan: deposit capital + one-off gas + weekly gas over the hold. */
export function planCostUsd(p: SnapshotProtocol, age: number | null): number {
  const capital = capitalFor(tvlOf(p));
  const gas = capital >= 150 ? 8 : 4;
  const weeks = Math.ceil(holdDaysFor(age) / 7);
  return capital + gas + 2 * weeks;
}

export function verdictFor(expected: number, costUsd: number, odds: number, rank: number, boardSize: number): FarmVerdict {
  const multiple = Math.round((expected / Math.max(1, costUsd)) * 10) / 10;
  const frac = rank / Math.max(1, boardSize);
  let label: VerdictLabel;
  if (frac <= 0.25 && odds >= 0.5) label = 'core';
  else if (frac <= 0.6) label = 'worth it';
  else if (frac <= 0.85) label = 'thin';
  else label = 'skip';
  const verdictWord = label === 'core' ? 'Core farm' : label === 'worth it' ? 'Worth it' : label === 'thin' ? 'Thin' : 'Skip';
  const multipleTxt = multiple >= 1000 ? Math.round(multiple).toLocaleString('en-US') : String(multiple);
  const text = `${verdictWord}: row ${rank} of ${boardSize} on expected value, ${(odds * 100).toFixed(0)}% fitted odds, an all-in plan cost of about $${Math.round(costUsd)} — ${multipleTxt}x the cost if it pays.`;
  return { label, cost_usd: Math.round(costUsd), multiple, text };
}

export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null && tvlOf(p) > 0 && (p.category ?? '') !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd as number,
      change_7d: p.change_7d,
      mc_tvl: Math.round(((p.mcap_usd as number) / tvlOf(p)) * 100) / 100,
    }));
}

/** The whole model: fits, folds, odds, calibration, counts — the page shows all of it. */
export function fitModel(snapshot: Snapshot): { report: ModelReport; launch: ValueFit; oddsFit: OddsFit; calib: number } {
  const tokened = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && (p.mcap_usd as number) > 0 && tvlOf(p) > 0 && Number.isFinite(Math.log(tvlOf(p))))
    .map((p) => ({ p, f: featuresOf(p, snapshot.as_of) }))
    .sort((a, b) => (a.p.slug < b.p.slug ? -1 : 1));
  const evens = tokened.filter((_, i) => i % 2 === 0);
  const odds_ = tokened.filter((_, i) => i % 2 === 1);
  const foldA = testFit(robustFit(evens), odds_);
  const foldB = testFit(robustFit(odds_), evens);
  const fit = robustFit(tokened);

  const labelled = snapshot.protocols
    .filter((p) => tvlOf(p) > 0)
    .map((p) => ({ p, f: featuresOf(p, snapshot.as_of), y: isPreToken(p) ? 0 : 1 }));
  const oddsFit = fitOdds(labelled);

  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const watchlist = snapshot.watchlist.map((s) => index.get(s)).filter((p): p is SnapshotProtocol => p !== undefined);
  const watchlistRaw = watchlist.map((p) => {
    const f = featuresOf(p, snapshot.as_of);
    return launchValueOf(f, fit) * oddsOf(f, oddsFit);
  }).sort((a, b) => a - b);
  const watchlistMedian = watchlistRaw[Math.floor(watchlistRaw.length / 2)] ?? 1;
  const calib = snapshot.floor_usd / Math.max(1, watchlistMedian);

  const boardCount = watchlist.length + snapshot.protocols.filter((p) => !snapshot.watchlist.includes(p.slug) && isRankable(p) && tvlOf(p) < snapshot.floor_usd).length;
  const live = liveRows(snapshot);
  const report: ModelReport = {
    fit: { b0: Math.round(fit.b0 * 1000) / 1000, b_tvl: Math.round(fit.b_tvl * 1000) / 1000, b_mom: Math.round(fit.b_mom * 1000) / 1000, b_age: Math.round(fit.b_age * 1000) / 1000, n: fit.n },
    folds: [foldA, foldB],
    odds: { w0: Math.round(oddsFit.w0 * 1000) / 1000, w_tvl: Math.round(oddsFit.w_tvl * 1000) / 1000, w_age: Math.round(oddsFit.w_age * 1000) / 1000, w_mom: Math.round(oddsFit.w_mom * 1000) / 1000, n: oddsFit.n, base_rate: oddsFit.base_rate },
    calibration: {
      multiplier: Math.round(calib * 1000) / 1000,
      watchlist_median_raw: Math.round(watchlistMedian),
      floor_usd: snapshot.floor_usd,
      watchlist_above_floor: 0,
      watchlist_size: watchlist.length,
    },
    counts: {
      scanned: snapshot.protocols.length,
      no_token: snapshot.protocols.filter(isPreToken).length,
      tokened: snapshot.protocols.length - snapshot.protocols.filter(isPreToken).length,
      board: boardCount,
      early: boardCount - watchlist.length,
      live: live.length,
    },
  };
  return { report, launch: fit, oddsFit, calib };
}

/** The ranked board: every watchlist slug plus every rankable pre-token protocol below the floor. */
export function buildBoard(snapshot: Snapshot, model: { report: ModelReport; launch: ValueFit; oddsFit: OddsFit; calib: number }): BoardRow[] {
  const { launch, oddsFit, calib, report } = model;
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p) && tvlOf(p) < snapshot.floor_usd) chosen.set(p.slug, p);
  }

  const watchlistSet = new Set(snapshot.watchlist);
  const scored = [...chosen.values()].map((p) => {
    const f = featuresOf(p, snapshot.as_of);
    const launchUsd = launchValueOf(f, launch);
    const odds = oddsOf(f, oddsFit);
    const expected = Math.min(IMPLIED_CAP_USD, Math.max(1, Math.round(calib * launchUsd * odds)));
    const age = ageDays(snapshot.as_of, p.listed_at);
    const rawMom = finite(p.change_7d, 0);
    return {
      p, f, launchUsd, odds, expected, age,
      momMult: Math.exp(launch.b_mom * (Math.min(MOMENTUM_CAP_PCT, Math.max(MOMENTUM_FLOOR_PCT, rawMom)) / 100)),
      ageMult: Math.exp(launch.b_age * f.age01),
      capped: rawMom > MOMENTUM_CAP_PCT,
    };
  });
  scored.sort((a, b) => b.expected - a.expected || (a.p.slug < b.p.slug ? -1 : 1));
  const rows = scored.map((s, i) => {
    const cost = planCostUsd(s.p, s.age);
    const verdict = verdictFor(s.expected, cost, s.odds, i + 1, scored.length);
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: tvlOf(s.p),
      change_7d: s.p.change_7d,
      listed_at: s.p.listed_at,
      token_status: 'pre-token' as const,
      on_watchlist: watchlistSet.has(s.p.slug),
      age_days: s.age,
      implied_value_usd: s.expected,
      launch_value_usd: Math.round(s.launchUsd),
      token_odds: Math.round(s.odds * 1000) / 1000,
      model: {
        tvl_exponent: Math.round(launch.b_tvl * 100) / 100,
        momentum_mult: Math.round(s.momMult * 1000) / 1000,
        age_mult: Math.round(s.ageMult * 1000) / 1000,
        age_days_used: Math.min(s.age ?? AGE_UNKNOWN_DAYS, AGE_CAP_DAYS),
      },
      verdict: { label: verdict.label, cost_usd: verdict.cost_usd, multiple: verdict.multiple },
      farm_steps: farmSteps(s.p, s.age).map(stepText),
    };
  });
  const above = rows.filter((r) => r.on_watchlist && r.implied_value_usd >= snapshot.floor_usd).length;
  report.calibration.watchlist_above_floor = above;
  return rows;
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const model = fitModel(snapshot);
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const { global, comps } = buildComps(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    scanned: snapshot.protocols.length,
    model_version: MODEL_VERSION,
    report: model.report,
    comps,
    global_comp: { samples: global.samples, median_mc_tvl: Math.round(global.median_mc_tvl * 1000) / 1000 },
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((r) => {
      const p = bySlug.get(r.slug) as SnapshotProtocol;
      const cost = planCostUsd(p, r.age_days);
      return { ...r, plan: farmSteps(p, r.age_days), verdict: verdictFor(r.implied_value_usd, cost, r.token_odds, r.rank, board.length) };
    }),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source line');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} came out as ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > IMPLIED_CAP_USD) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
