// The token radar's model, v3: every constant fitted to the snapshot and tested held-out.
//
//   1. Launch value — the protocols that already have tokens carry both a TVL and a market cap
//      today, so the value model is a log-linear fit on them:
//        log mcap = b0 + b1*log TVL + b2*momentum01 + b3*age01 + b4*log comp
//      where comp is the median mcap/TVL of the row's category peers — for a tokened fit row,
//      computed WITHOUT itself (leave-one-out), so the term cannot leak the row's own answer.
//      Fitted twice, once on each half of the tokened set sorted by slug, each fit tested on the
//      half it never saw; the board uses the full-sample fit. Both held-out errors are shown.
//   2. Token odds — a logistic fit over all 758 protocols (label: records a token today) on the
//      same figures plus the category's own token rate (shrunk toward the global rate), so the
//      board separates "a big token if it launches" from "likely to launch at all".
//   3. Calibration — one multiplier, fitted on the watchlist alone, sets the watchlist's median
//      expected value to the snapshot's own $50M floor.
//   4. Farm verdicts — each plan is netted: all-in dollar cost against expected value, graded on
//      the board's own curve (core / worth it / thin / skip) with the arithmetic in the text.

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
export const COMP_FLOOR = 0.01;
export const COMP_CEIL = 10;
export const SHRINK_K = 3;
export const RATE_SHRINK_K = 10;

/** How many already-tokened protocols the Live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A protocol's features the fits read, from the snapshot's own figures only. */
export interface Features {
  logTvl: number;
  momentum01: number;
  age01: number;
  logComp: number;
  catRate: number;
}

export interface ValueFit {
  b0: number;
  b_tvl: number;
  b_mom: number;
  b_age: number;
  b_comp: number;
  n: number;
}

export interface FoldResult {
  fit_n: number;
  test_n: number;
  median_abs_err_pct: number;
  /** The same rows scored by a flat mcap/TVL multiple read off the fitting half. */
  baseline_median_abs_err_pct: number;
  log_r2: number;
  /** The flat multiple's log-space R² on the same rows — the honest space to compare the two. */
  baseline_log_r2: number;
}

export interface OddsFit {
  w0: number;
  w_tvl: number;
  w_age: number;
  w_mom: number;
  w_cat: number;
  n: number;
  base_rate: number;
}

export interface ModelReport {
  fit: ValueFit;
  folds: [FoldResult, FoldResult];
  /** Whether the leave-one-out comp term survived its own held-out test, and both variants' errors. */
  comp_term: { kept: boolean; errors_with: [number, number]; errors_without: [number, number] };
  odds: OddsFit;
  /** The odds fit's own two folds: Brier against the base rate, share called right. */
  odds_folds: OddsFold[];
  calibration: {
    multiplier: number;
    watchlist_median_raw: number;
    floor_usd: number;
    watchlist_above_floor: number;
    watchlist_size: number;
  };
  counts: { scanned: number; no_token: number; tokened: number; board: number; early: number; live: number; fit_kept: number; not_ranked: { tokened: number; no_tvl: number; derivative_or_exchange: number; banned_category: number; over_floor: number } };
}

export interface FarmStep {
  kind: string;
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
    comp_ratio: number;
    comp_exponent: number;
    momentum_mult: number;
    age_mult: number;
    age_days_used: number;
  };
  verdict: { label: VerdictLabel; cost_usd: number; multiple: number };
  farm_steps: string[];
  /** The row's rank band across 200 bootstrap refits of the value model. */
  rank_range?: [number, number];
}

export interface RadarRow extends Omit<BoardRow, 'farm_steps' | 'verdict'> {
  plan: FarmStep[];
  verdict: FarmVerdict;
}

/** One anchor: a tokened protocol the fit was built on, with its real market cap beside the fitted value. */
export interface Anchor {
  slug: string;
  name: string;
  category: string | null;
  pred_usd: number;
  mcap_usd: number;
}

export interface LiveRow {  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  age_days: number | null;
  mc_tvl: number;
  /** The same fitted model's launch value for this protocol, shown against its real market cap. */
  pred_usd: number;
}

export interface ShrunkenComp {
  category: string;
  samples: number;
  median_mc_tvl: number;
  shrunken_mc_tvl: number;
  token_rate: number;
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
  anchors: Anchor[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

export const MODEL_VERSION = 'fitted-v3';

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

/* ------------------------------------------------------------------ */
/* comps: per-category mcap/TVL medians and token rates, from the data */
/* ------------------------------------------------------------------ */

export interface CompsContext {
  global: { samples: number; median_mc_tvl: number; rate: number };
  /** category -> the mcap/TVL ratios of its tokened protocols, each tagged with its slug (for leave-one-out) */
  ratios: Map<string, Array<{ slug: string; ratio: number }>>;
  /** category -> number of protocols in it (any token state, positive TVL) */
  members: Map<string, number>;
  /** category -> number of tokened protocols in it */
  tokenedMembers: Map<string, number>;
}

export function buildComps(snapshot: Snapshot): CompsContext {
  const ratios = new Map<string, Array<{ slug: string; ratio: number }>>();
  const members = new Map<string, number>();
  const tokenedMembers = new Map<string, number>();
  let gSamples = 0;
  let gTokened = 0;
  const gRatios: number[] = [];
  for (const p of snapshot.protocols) {
    const tvl = tvlOf(p);
    if (tvl <= 0) continue;
    const cat = p.category ?? '(uncategorized)';
    const toked = !isPreToken(p) && p.mcap_usd !== null && (p.mcap_usd as number) > 0;
    members.set(cat, (members.get(cat) ?? 0) + 1);
    gSamples++;
    if (toked) {
      tokenedMembers.set(cat, (tokenedMembers.get(cat) ?? 0) + 1);
      gTokened++;
      const list = ratios.get(cat) ?? [];
      list.push({ slug: p.slug, ratio: (p.mcap_usd as number) / tvl });
      ratios.set(cat, list);
      gRatios.push((p.mcap_usd as number) / tvl);
    }
  }
  return {
    global: { samples: gSamples, median_mc_tvl: median(gRatios), rate: gTokened / Math.max(1, gSamples) },
    ratios,
    members,
    tokenedMembers,
  };
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)] ?? 0;
}

/** The category's shrunken median mcap/TVL, computed without the row's own ratio when asked (leave-one-out). */
export function compRatioFor(ctx: CompsContext, p: SnapshotProtocol, excludeSlug: string | null): number {
  const cat = p.category ?? '(uncategorized)';
  const own = ctx.ratios.get(cat) ?? [];
  const list = excludeSlug === null ? own.map((e) => e.ratio) : own.filter((e) => e.slug !== excludeSlug).map((e) => e.ratio);
  const n = list.length;
  const raw = n >= 1 ? median(list) : ctx.global.median_mc_tvl;
  const shrunken = (n * raw + SHRINK_K * ctx.global.median_mc_tvl) / (n + SHRINK_K);
  return Math.min(COMP_CEIL, Math.max(COMP_FLOOR, shrunken));
}

/** A protocol's features; `excludeOwn` drops its own ratio from its comp (leave-one-out). */
export function featuresOf(p: SnapshotProtocol, asOf: string, ctx: CompsContext, excludeOwn: boolean): Features {
  const age = ageDays(asOf, p.listed_at);
  const cat = p.category ?? '(uncategorized)';
  const nAll = ctx.members.get(cat) ?? 0;
  const nTok = ctx.tokenedMembers.get(cat) ?? 0;
  const rate = (nTok + RATE_SHRINK_K * ctx.global.rate) / (nAll + RATE_SHRINK_K);
  return {
    logTvl: Math.log(Math.max(1, tvlOf(p))),
    momentum01: Math.min(MOMENTUM_CAP_PCT, Math.max(MOMENTUM_FLOOR_PCT, finite(p.change_7d, 0))) / 100,
    age01: Math.min(age ?? AGE_UNKNOWN_DAYS, AGE_CAP_DAYS) / AGE_CAP_DAYS,
    logComp: Math.log(compRatioFor(ctx, p, excludeOwn ? p.slug : null)),
    catRate: rate,
  };
}

/* ---------------------- fits ---------------------- */

/** Solve a dense linear system by Gaussian elimination with partial pivoting. */
function solve(matrix: number[][], rhs: number[]): number[] {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r]![col]!) > Math.abs(a[pivot]![col]!)) pivot = r;
    if (Math.abs(a[pivot]![col]!) < 1e-12) a[pivot]![col] = 1e-12;
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

const FIT_FEATURES = 5;

/** x vector for the value fit: [1, logTvl/10, momentum01, age01] or the same plus logComp. */
function fitX(f: Features, useComp: boolean): number[] {
  const base = [1, f.logTvl / 10, f.momentum01, f.age01];
  return useComp ? [...base, f.logComp] : base;
}

/** Ordinary least squares of log mcap on the features, lightly ridged. */
function fitLogLinear(sample: Array<{ p: SnapshotProtocol; f: Features }>, useComp: boolean): ValueFit {
  const X = sample.map((s) => fitX(s.f, useComp));
  const y = sample.map((s) => Math.log(s.p.mcap_usd as number));
  const nf = useComp ? 5 : 4;
  const xtX = Array.from({ length: nf }, () => new Array<number>(nf).fill(0));
  const xty = new Array<number>(nf).fill(0);
  for (let i = 0; i < X.length; i++) {
    for (let r = 0; r < nf; r++) {
      xty[r]! += X[i]![r]! * y[i]!;
      for (let c = 0; c < nf; c++) xtX[r]![c]! += X[i]![r]! * X[i]![c]!;
    }
  }
  for (let r = 0; r < nf; r++) xtX[r]![r]! += 1e-9 * (r === 0 ? X.length : 1);
  const beta = solve(xtX, xty);
  return { b0: beta[0]!, b_tvl: beta[1]! / 10, b_mom: beta[2]!, b_age: beta[3]!, b_comp: useComp ? beta[4]! : 0, n: sample.length };
}

/** The fitted launch value for one protocol's features, in dollars. */
export function launchValueOf(f: Features, fit: ValueFit): number {
  return Math.exp(fit.b0 + fit.b_tvl * f.logTvl + fit.b_mom * f.momentum01 + fit.b_age * f.age01 + fit.b_comp * f.logComp);
}

function quantileSorted(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))] ?? 0;
}

/**
 * A robust refit: the raw sample carries a few wild records, and plain least squares lets them
 * steer the whole line. So: fit, keep the 90% of rows whose residual is not among the wildest,
 * refit, and again. Deterministic, and the held-out tests still judge the result on unseen data.
 */
function robustFit(sample: Array<{ p: SnapshotProtocol; f: Features }>, useComp: boolean): { fit: ValueFit; keptSlugs: string[] } {
  let fit = fitLogLinear(sample, useComp);
  let kept = sample;
  for (let pass = 0; pass < 2; pass++) {
    const residuals = kept.map((s) => Math.abs(Math.log(launchValueOf(s.f, fit)) - Math.log(s.p.mcap_usd as number))).sort((a, b) => a - b);
    const cut = quantileSorted(residuals, 0.9);
    kept = kept.filter((s) => Math.abs(Math.log(launchValueOf(s.f, fit)) - Math.log(s.p.mcap_usd as number)) <= cut);
    fit = fitLogLinear(kept, useComp);
  }
  return { fit, keptSlugs: kept.map((s) => s.p.slug) };
}

/** A fit's held-out error on a sample it never saw: median absolute percent error and log-space R^2. */
function testFit(fit: ValueFit, sample: Array<{ p: SnapshotProtocol; f: Features }>, flatRatio: number): FoldResult {
  const errs = sample.map((s) => {
    const pred = launchValueOf(s.f, fit);
    const actual = s.p.mcap_usd as number;
    return Math.abs(pred - actual) / Math.max(1, actual);
  }).sort((a, b) => a - b);
  const med = errs[Math.floor(errs.length / 2)] ?? 1;
  // The dumb model on the same rows: one flat mcap/TVL multiple, read off the fitting half.
  const flatErrs = sample.map((s) => Math.abs(flatRatio * tvlOf(s.p) - (s.p.mcap_usd as number)) / Math.max(1, s.p.mcap_usd as number)).sort((a, b) => a - b);
  const flatMed = flatErrs[Math.floor(flatErrs.length / 2)] ?? 1;
  const logs = sample.map((s) => Math.log(s.p.mcap_usd as number));
  const preds = sample.map((s) => Math.log(launchValueOf(s.f, fit)));
  const flatPreds = sample.map((s) => Math.log(Math.max(1, flatRatio * tvlOf(s.p))));
  const meanLog = logs.reduce((a, b) => a + b, 0) / logs.length;
  let ssTot = 0, ssRes = 0, ssFlat = 0;
  for (let i = 0; i < logs.length; i++) { ssTot += (logs[i]! - meanLog) ** 2; ssRes += (logs[i]! - preds[i]!) ** 2; ssFlat += (logs[i]! - flatPreds[i]!) ** 2; }
  return {
    fit_n: fit.n,
    test_n: sample.length,
    median_abs_err_pct: Math.round(med * 1000) / 10,
    baseline_median_abs_err_pct: Math.round(flatMed * 1000) / 10,
    log_r2: Math.round((1 - ssRes / Math.max(1e-9, ssTot)) * 1000) / 1000,
    baseline_log_r2: Math.round((1 - ssFlat / Math.max(1e-9, ssTot)) * 1000) / 1000,
  };
}

/** Logistic fit (deterministic gradient descent) of has-token on the figures plus the category rate. */
function fitOdds(rows: Array<{ p: SnapshotProtocol; f: Features; y: number }>): OddsFit {
  const w = [0, 0, 0, 0, 0];
  const lr = 0.5;
  const xOf = (f: Features) => [1, f.logTvl / 10, f.age01, f.momentum01, f.catRate];
  for (let it = 0; it < 600; it++) {
    const g = [0, 0, 0, 0, 0];
    for (const r of rows) {
      const x = xOf(r.f);
      let z = 0;
      for (let i = 0; i < 5; i++) z += w[i]! * x[i]!;
      const e = 1 / (1 + Math.exp(-z)) - r.y;
      for (let i = 0; i < 5; i++) g[i]! += e * x[i]!;
    }
    for (let i = 0; i < 5; i++) w[i] -= (lr / rows.length) * g[i]!;
  }
  const base = rows.reduce((a, r) => a + r.y, 0) / rows.length;
  return { w0: w[0]!, w_tvl: w[1]! / 10, w_age: w[2]!, w_mom: w[3]!, w_cat: w[4]!, n: rows.length, base_rate: Math.round(base * 1000) / 1000 };
}

export function oddsOf(f: Features, odds: OddsFit): number {
  const z = odds.w0 + odds.w_tvl * f.logTvl + odds.w_age * f.age01 + odds.w_mom * f.momentum01 + odds.w_cat * f.catRate;
  return Math.min(ODDS_CEIL, Math.max(ODDS_FLOOR, 1 / (1 + Math.exp(-z))));
}

/** One odds fold's honest scorecard: Brier against the base rate alone, and the share called right. */
export interface OddsFold {
  n: number;
  brier: number;
  brier_base: number;
  share_right: number;
  share_right_base: number;
}

function testOdds(fit: OddsFit, sample: Array<{ p: SnapshotProtocol; f: Features; y: number }>, baseRate: number): OddsFold {
  let brier = 0, brierBase = 0, right = 0;
  for (const r of sample) {
    const p = oddsOf(r.f, fit);
    brier += (p - r.y) ** 2;
    brierBase += (baseRate - r.y) ** 2;
    if ((p >= 0.5) === (r.y === 1)) right++;
  }
  const n = Math.max(1, sample.length);
  return {
    n: sample.length,
    brier: Math.round((brier / n) * 1000) / 1000,
    brier_base: Math.round((brierBase / n) * 1000) / 1000,
    share_right: Math.round((right / n) * 1000) / 1000,
    share_right_base: Math.round(baseRate * 1000) / 1000,
  };
}

/* ---------------------- farm plans ---------------------- */

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

function walletFor(chain: string): string {
  const c = chain.toLowerCase();
  if (c === 'solana') return 'a fresh Phantom profile';
  if (c === 'bitcoin') return 'a fresh Bitcoin wallet';
  return 'a fresh browser wallet';
}

/** The plan: concrete steps that change with the protocol's own chains, category, TVL and age.
    Each step carries a verb name that states its job, and one step is an exit rule with a number. */
export function farmSteps(p: SnapshotProtocol, age: number | null, exitPct: number): FarmStep[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const second = p.chains.length > 1 ? p.chains[1]! : null;
  const tvl = tvlOf(p);
  const capital = capitalFor(tvl);
  const hold = holdDaysFor(age);
  const wallet = walletFor(chain);
  const small = tvl < 10_000_000 ? ' The book is small, so a steady position is what gets remembered, not size.' : '';
  const young = age !== null && age < 180;
  const cat = (p.category ?? '').toLowerCase();
  const check = cat.includes('rwa')
    ? `Check ${p.name}'s eligibility and yield docs once a week and claim only from links published there — never from a DM, a reply or an ad.`
    : cat.includes('curator') || cat.includes('allocator')
      ? `Read ${p.name}'s vault strategy note once a week and act only on links published there — never from a DM, a reply or an ad.`
      : `Check ${p.name}'s own points, rewards or docs page once a week and claim only from links published there — never from a DM, a reply or an ad.`;
  const exitLevel = tvl * (1 + exitPct / 100);
  const own = p.change_7d == null ? 'no week recorded' : `${p.change_7d >= 0 ? '+' : ''}${p.change_7d!.toFixed(1)}% last week`;
  return [
    {
      kind: 'setup',
      text: `Set up ${wallet} that will only ever touch ${p.name}, and fund it from an exchange so the airdrop source is one hop, not ten.`,
      cost: '≤ $3 gas',
      time: '10 min',
    },
    {
      kind: 'verify',
      text: `Reach ${p.name} from its page on defillama.com (protocol/${p.slug}) or its official accounts, bookmark the app and match the contract addresses against its docs. Never sign an approval from a link sent in a DM.`,
      cost: 'free',
      time: '10 min',
    },
    {
      kind: 'core',
      text: actionFor(p, capital, chain) + small,
      cost: `$${capital} + ~$${capital >= 150 ? 8 : 4} gas`,
      time: '15 min',
    },
    second
      ? {
          kind: 'deepen',
          text: `Repeat the deposit on ${second}, ${p.name}'s second chain, so activity spans more than one chain in the same week.`,
          cost: `$${capital} + bridge fee`,
          time: '20 min',
        }
      : {
          kind: 'deepen',
          text: `Make one qualifying action each week — a deposit, a swap, a vote or a claim — on ${chain}, always through ${p.name}'s own app.`,
          cost: '~$2 gas/wk',
          time: '10 min/wk',
        },
    {
      kind: 'cadence',
      text: young
        ? `Hold the position for at least ${hold} days, across at least ${Math.ceil(hold / 7)} separate weeks — ${p.name} is young (${age} days), and early consistency is what a launch snapshot catches.`
        : `Hold the position for at least ${hold} days, across at least three separate weeks, so the wallet's activity shows in more than one monthly snapshot.`,
      cost: 'capital stays in',
      time: `${hold} days`,
    },
    {
      kind: 'watch',
      text: check,
      cost: 'free to check',
      time: '10 min/wk',
    },
    {
      kind: 'exit',
      text: `Exit rule, checked weekly: withdraw if ${p.name}'s TVL points below ${usd(exitLevel)} — that is ${exitPct.toFixed(1)}% in a week, worse than 95% of this snapshot's protocols (${own}) — and also if withdrawals pause or the team hints a snapshot has already been taken.`,
      cost: 'free to check',
      time: '5 min/wk',
    },
    {
      kind: 'record',
      text: `Log the wallet address, every date and every transaction hash in one running file, so a claim form, an eligibility check or an unwind takes minutes. A claim may ask the wallet to prove its history, and a drop is taxable income in many places at its value on the day it arrives.`,
      cost: 'free',
      time: '5 min/wk',
    },
  ];
}

/** All-in dollar cost of the plan: deposit capital + one-off gas + weekly gas over the hold. */
export function planCostUsd(p: SnapshotProtocol, age: number | null): number {
  const capital = capitalFor(tvlOf(p));
  const gas = capital >= 150 ? 8 : 4;
  const weeks = Math.ceil(holdDaysFor(age) / 7);
  return capital + gas + 2 * weeks;
}

export function verdictFor(expected: number, costUsd: number, odds: number, rank: number, boardSize: number, holdDays: number): FarmVerdict {
  const multiple = Math.round((expected / Math.max(1, costUsd)) * 10) / 10;
  const frac = rank / Math.max(1, boardSize);
  let label: VerdictLabel;
  if (frac <= 0.25 && odds >= 0.5) label = 'core';
  else if (frac <= 0.6) label = 'worth it';
  else if (frac <= 0.85) label = 'thin';
  else label = 'skip';
  const verdictWord = label === 'core' ? 'Core farm' : label === 'worth it' ? 'Worth it' : label === 'thin' ? 'Thin' : 'Skip';
  const multipleTxt = multiple >= 1000 ? Math.round(multiple).toLocaleString('en-US') : String(multiple);
  const perHour = expected / Math.max(1, holdDays * 24);
  const tbill = Math.max(1, Math.round(costUsd * 0.04 * (holdDays / 365)));
  const text = `${verdictWord}: row ${rank} of ${boardSize} on expected value, ${(odds * 100).toFixed(0)}% fitted odds, an all-in plan cost of about $${Math.round(costUsd)} — ${multipleTxt}× the cost if it pays, about ${usd(perHour)} an hour if it pays across the ${holdDays}-day hold, while the same money earns about $${tbill} in a 4% T-bill.`;
  return { label, cost_usd: Math.round(costUsd), multiple, text };
}

export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

export function liveRows(snapshot: Snapshot, ctx: CompsContext, fit: ValueFit, kept: Set<string>): LiveRow[] {
  return snapshot.protocols
    .filter((p) => kept.has(p.slug) && p.mcap_usd !== null && tvlOf(p) > 0 && (p.category ?? '') !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => {
      const pred = launchValueOf(featuresOf(p, snapshot.as_of, ctx, false), fit);
      return {
        slug: p.slug,
        name: p.name,
        category: p.category,
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        mcap_usd: p.mcap_usd as number,
        change_7d: p.change_7d,
        age_days: ageDays(snapshot.as_of, p.listed_at),
        mc_tvl: Math.round(((p.mcap_usd as number) / tvlOf(p)) * 100) / 100,
        pred_usd: Math.round(pred),
      };
    });
}

/* ---------------------- the whole model ---------------------- */

export function fitModel(snapshot: Snapshot): { report: ModelReport; launch: ValueFit; oddsFit: OddsFit; calib: number; ctx: CompsContext } {
  const ctx = buildComps(snapshot);

  const tokened = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && (p.mcap_usd as number) > 0 && tvlOf(p) > 0 && Number.isFinite(Math.log(tvlOf(p))))
    .sort((a, b) => (a.slug < b.slug ? -1 : 1))
    .map((p) => ({ p, f: featuresOf(p, snapshot.as_of, ctx, true) }));
  const evens = tokened.filter((_, i) => i % 2 === 0);
  const odds_ = tokened.filter((_, i) => i % 2 === 1);
  // The comp term is a candidate, not an assumption: fit both variants, keep the one whose
  // held-out errors are lower on average, and record both on the page.
  const variants = [false, true].map((useComp) => {
    const fitEvens = robustFit(evens, useComp);
    const fitOdds = robustFit(odds_, useComp);
    const ratioOf = (half, kept) => {
      const keptHalf = half.filter((s) => kept.has(s.p.slug));
      return median(keptHalf.map((s) => (s.p.mcap_usd as number) / tvlOf(s.p))) ?? 1;
    };
    const folds: [FoldResult, FoldResult] = [
      testFit(fitEvens.fit, odds_, ratioOf(evens, new Set(fitEvens.keptSlugs))),
      testFit(fitOdds.fit, evens, ratioOf(odds_, new Set(fitOdds.keptSlugs))),
    ];
    return { useComp, folds, avg: (folds[0].median_abs_err_pct + folds[1].median_abs_err_pct) / 2 };
  });
  const chosen = variants[0].avg <= variants[1].avg ? variants[0] : variants[1];
  const foldA = chosen.folds[0];
  const foldB = chosen.folds[1];
  const full = robustFit(tokened, chosen.useComp);
  const fit = full.fit;
  const keptSlugs = new Set(full.keptSlugs);
  const anchors: Anchor[] = snapshot.protocols
    .filter((p) => keptSlugs.has(p.slug) && p.mcap_usd !== null)
    .sort((a, b) => (b.mcap_usd as number) - (a.mcap_usd as number) || (a.slug < b.slug ? -1 : 1))
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      pred_usd: Math.round(launchValueOf(featuresOf(p, snapshot.as_of, ctx, true), fit)),
      mcap_usd: p.mcap_usd as number,
    }));

  const labelled = snapshot.protocols
    .filter((p) => tvlOf(p) > 0)
    .map((p) => ({ p, f: featuresOf(p, snapshot.as_of, ctx, false), y: isPreToken(p) ? 0 : 1 }));
  const oddsFit = fitOdds(labelled);
  // The odds fit scored the way the value fit is: fitted on one half, Brier-scored on the other,
  // both ways, each against a constant base rate on the same rows.
  const oddsEvens = labelled.filter((_, i) => i % 2 === 0);
  const oddsOdds = labelled.filter((_, i) => i % 2 === 1);
  const oddsFolds: OddsFold[] = [];
  for (const [train, test] of [[oddsEvens, oddsOdds], [oddsOdds, oddsEvens]] as const) {
    const foldFit = fitOdds(train);
    const base = train.reduce((a, r) => a + r.y, 0) / Math.max(1, train.length);
    oddsFolds.push(testOdds(foldFit, test, base));
  }

  const watchlist = snapshot.watchlist
    .map((s) => snapshot.protocols.find((p) => p.slug === s))
    .filter((p): p is SnapshotProtocol => p !== undefined);
  const watchlistRaw = watchlist.map((p) => {
    const f = featuresOf(p, snapshot.as_of, ctx, false);
    return launchValueOf(f, fit) * oddsOf(f, oddsFit);
  }).sort((a, b) => a - b);
  const watchlistMedian = watchlistRaw[Math.floor(watchlistRaw.length / 2)] ?? 1;
  const calib = snapshot.floor_usd / Math.max(1, watchlistMedian);

  const boardCount = watchlist.length + snapshot.protocols.filter((p) => !snapshot.watchlist.includes(p.slug) && isRankable(p) && tvlOf(p) < snapshot.floor_usd).length;
  const live = liveRows(snapshot, ctx, fit, keptSlugs);
  const report: ModelReport = {
    fit: { b0: round3(fit.b0), b_tvl: round3(fit.b_tvl), b_mom: round3(fit.b_mom), b_age: round3(fit.b_age), b_comp: round3(fit.b_comp), n: fit.n },
    folds: [foldA, foldB],
    comp_term: {
      kept: chosen.useComp,
      errors_with: [variants[1].folds[0].median_abs_err_pct, variants[1].folds[1].median_abs_err_pct],
      errors_without: [variants[0].folds[0].median_abs_err_pct, variants[0].folds[1].median_abs_err_pct],
    },
    odds: { w0: round3(oddsFit.w0), w_tvl: round3(oddsFit.w_tvl), w_age: round3(oddsFit.w_age), w_mom: round3(oddsFit.w_mom), w_cat: round3(oddsFit.w_cat), n: oddsFit.n, base_rate: oddsFit.base_rate },
    odds_folds: oddsFolds,
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
      fit_kept: keptSlugs.size,
      not_ranked: (() => {
        const tally = { tokened: 0, no_tvl: 0, derivative_or_exchange: 0, banned_category: 0, over_floor: 0 };
        const listed = new Set(snapshot.watchlist);
        for (const p of snapshot.protocols) {
          if (listed.has(p.slug) || isRankable(p) && tvlOf(p) < snapshot.floor_usd) continue;
          if (!isPreToken(p)) tally.tokened++;
          else if (tvlOf(p) <= 0) tally.no_tvl++;
          else if (EXCHANGE_NAMES.test(p.name) || VERSIONED.test(p.name) || DERIVATIVE_WORDS.test(p.name)) tally.derivative_or_exchange++;
          else if (BANNED_CATEGORIES.includes((p.category ?? '').toLowerCase())) tally.banned_category++;
          else tally.over_floor++;
        }
        return tally;
      })(),
    },
  };
  return { report, launch: fit, oddsFit, calib, ctx, keptSlugs, anchors, compUsed: chosen.useComp, exitPct: quantileSorted(snapshot.protocols.map((p) => p.change_7d ?? null).filter((v): v is number => v !== null).sort((a, b) => a - b), 0.05) };
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** Compact dollars, same shape as the dashboard's money(). */
function usd(v: number): string {
  const n = Math.abs(v);
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

/** A seeded PRNG, so the bootstrap's two runs pick the same resamples. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The ranked board: every watchlist slug plus every rankable pre-token protocol below the floor. */
export function buildBoard(snapshot: Snapshot, model: { launch: ValueFit; oddsFit: OddsFit; calib: number; ctx: CompsContext }): BoardRow[] {
  const { launch, oddsFit, calib, ctx } = model;
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
    const f = featuresOf(p, snapshot.as_of, ctx, false);
    const launchUsd = launchValueOf(f, launch);
    const odds = oddsOf(f, oddsFit);
    const expected = Math.min(IMPLIED_CAP_USD, Math.max(1, Math.round(calib * launchUsd * odds)));
    const age = ageDays(snapshot.as_of, p.listed_at);
    const rawMom = finite(p.change_7d, 0);
    return {
      p, f, launchUsd, odds, expected, age,
      compRatio: Math.round(Math.exp(f.logComp) * 100) / 100,
      momMult: Math.exp(launch.b_mom * (Math.min(MOMENTUM_CAP_PCT, Math.max(MOMENTUM_FLOOR_PCT, rawMom)) / 100)),
      ageMult: Math.exp(launch.b_age * f.age01),
    };
  });
  scored.sort((a, b) => b.expected - a.expected || (a.p.slug < b.p.slug ? -1 : 1));
  const exitPct = quantileSorted(snapshot.protocols.map((p) => p.change_7d ?? null).filter((v): v is number => v !== null).sort((a, b) => a - b), 0.05);
  const rows = scored.map((s, i) => {
    const cost = planCostUsd(s.p, s.age);
    const verdict = verdictFor(s.expected, cost, s.odds, i + 1, scored.length, holdDaysFor(s.age));
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
        comp_ratio: s.compRatio,
        comp_exponent: Math.round(launch.b_comp * 100) / 100,
        momentum_mult: Math.round(s.momMult * 1000) / 1000,
        age_mult: Math.round(s.ageMult * 1000) / 1000,
        age_days_used: Math.min(s.age ?? AGE_UNKNOWN_DAYS, AGE_CAP_DAYS),
      },
      verdict: { label: verdict.label, cost_usd: verdict.cost_usd, multiple: verdict.multiple },
      farm_steps: farmSteps(s.p, s.age, exitPct).map(stepText),
    };
  });
  const above = rows.filter((r) => r.on_watchlist && r.implied_value_usd >= snapshot.floor_usd).length;
  model.report.calibration.watchlist_above_floor = above;
  return rows;
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const model = fitModel(snapshot);
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot, model.ctx, model.launch, model.keptSlugs);
  const ctx = model.ctx;
  const comps: ShrunkenComp[] = [...ctx.ratios.entries()]
    .map(([category, entries]) => {
      const n = entries.length;
      const med = median(entries.map((e) => e.ratio));
      return {
        category,
        samples: n,
        median_mc_tvl: Math.round(med * 1000) / 1000,
        shrunken_mc_tvl: Math.round(((n * med + SHRINK_K * ctx.global.median_mc_tvl) / (n + SHRINK_K)) * 1000) / 1000,
        token_rate: Math.round(((ctx.tokenedMembers.get(category) ?? 0) + RATE_SHRINK_K * ctx.global.rate) / ((ctx.members.get(category) ?? 0) + RATE_SHRINK_K) * 1000) / 1000,
      };
    })
    .filter((c) => c.samples >= 3)
    .sort((a, b) => a.category < b.category ? -1 : 1);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  // Rank uncertainty: refit the value model on 200 bootstrap resamples of the kept tokened rows
  // (seeded, so two runs agree), re-rank the board each time, and record each row's rank band.
  const tokened = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && (p.mcap_usd as number) > 0 && tvlOf(p) > 0)
    .sort((a, b) => (a.slug < b.slug ? -1 : 1))
    .map((p) => ({ p, f: featuresOf(p, snapshot.as_of, ctx, true) }));
  const boardFeat = board.map((r) => {
    const p = bySlug.get(r.slug) as SnapshotProtocol;
    return { f: featuresOf(p, snapshot.as_of, ctx, false), odds: r.token_odds };
  });
  const rnd = mulberry32(20261114);
  const tally: number[][] = board.map(() => []);
  for (let it = 0; it < 200; it++) {
    const sample: typeof tokened = [];
    for (let i = 0; i < tokened.length; i++) sample.push(tokened[Math.floor(rnd() * tokened.length)]!);
    const bs = robustFit(sample, model.compUsed).fit;
    const vals = boardFeat.map((bf) => model.calib * launchValueOf(bf.f, bs) * bf.odds);
    const order = vals.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v || (a.i < b.i ? -1 : 1));
    order.forEach((o, place) => tally[o.i]!.push(place + 1));
  }
  const rankRange = (t: number[]): [number, number] => {
    const s = [...t].sort((a, b) => a - b);
    return [s[Math.floor(0.1 * s.length)] ?? 0, s[Math.floor(0.9 * s.length)] ?? 0];
  };
  board.forEach((r, i) => { r.rank_range = rankRange(tally[i]!); });
  const exitPct = model.exitPct;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    scanned: snapshot.protocols.length,
    model_version: MODEL_VERSION,
    report: model.report,
    comps,
    global_comp: { samples: ctx.global.samples, median_mc_tvl: Math.round(ctx.global.median_mc_tvl * 1000) / 1000 },
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((r) => {
      const p = bySlug.get(r.slug) as SnapshotProtocol;
      const cost = planCostUsd(p, r.age_days);
      return { ...r, plan: farmSteps(p, r.age_days, exitPct), verdict: verdictFor(r.implied_value_usd, cost, r.token_odds, r.rank, board.length, holdDaysFor(r.age_days)) };
    }),
    live,
    anchors: model.anchors,
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
