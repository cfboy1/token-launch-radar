// The token radar's model: one sealed snapshot of the protocol universe in, one ranked board out.
//
// Every figure the board shows comes from the snapshot's own numbers. Nothing is special-cased by
// name; the same function scores every protocol.
//
//   comp      = median (mcap / tvl) of the snapshot's already-tokened protocols in the same
//               category, or the snapshot's global median when the category has too few peers
//   momentum  = change_7d clamped to [-60, +99], scaled by MOMENTUM_WEIGHT
//   age       = quarters run with no token, capped at three, scaled by AGE_WEIGHT
//   implied   = round(tvl x comp x (1 + momentum) x (1 + age))
//
// A protocol is pre-token when its DefiLlama record carries no market cap, no CoinGecko id and no
// symbol. "Records no token" is the snapshot's claim, never proof it has none: the board says so.

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

/** The model's constants, stated on the dashboard and changeable here in one place. */
export interface ModelConstants {
  momentum_weight: number;
  momentum_floor_pct: number;
  momentum_cap_pct: number;
  age_weight: number;
  age_cap_days: number;
  age_unknown_days: number;
  comp_min: number;
  comp_max: number;
  comp_min_samples: number;
}

export const MODEL: ModelConstants = {
  momentum_weight: 0.35,
  momentum_floor_pct: -60,
  momentum_cap_pct: 99,
  age_weight: 0.12,
  age_cap_days: 1095,
  age_unknown_days: 90,
  comp_min: 0.05,
  comp_max: 3,
  comp_min_samples: 3,
};

/** The model's version label; the dashboard names it. */
export const MODEL_VERSION = 'desk-comp-v1';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many already-tokened protocols the Live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** The value cap the gate puts on one row's implied value. */
export const IMPLIED_CAP_USD = 100_000_000_000_000;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. Extra keys are allowed by the gate. */
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
  model: {
    comp_multiple: number;
    comp_source: 'category' | 'global';
    comp_samples: number;
    momentum_pct: number;
    momentum_capped: boolean;
    momentum_multiplier: number;
    age_multiplier: number;
    age_days_used: number;
  };
  farm_steps: string[];
}

/** A row's compact form for data.js, with the farm plan kept structured for the page. */
export interface RadarRow extends Omit<BoardRow, 'farm_steps'> {
  plan: FarmStep[];
}

/** An already-tokened protocol: it trades today, and the board shows the market's own value. */
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

/** One category's derived comp multiple, shown on the dashboard so the model can be checked. */
export interface CompRow {
  category: string;
  samples: number;
  median_mc_tvl: number;
}

/** Everything the dashboard needs: the board, the live set, the comps, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  scanned: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  global_comp: { samples: number; median_mc_tvl: number };
  comps: CompRow[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
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

/** A finite positive TVL. */
function tvlOf(p: SnapshotProtocol): number {
  return finite(p.tvl_usd, 0) > 0 ? p.tvl_usd : 0;
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is a wrapped, staked or bridged product of a protocol whose token trades. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const EXCHANGE_NAMES = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)\b/i;
const DERIVATIVE_WORDS = /\b(wrapped|staked|staking)\b/i;

/** Whether a below-floor protocol may join the board: pre-token, and not a derivative of a tokened one. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (VERSIONED.test(p.name) || EXCHANGE_NAMES.test(p.name)) return false;
  if (DERIVATIVE_WORDS.test(p.name)) return false;
  const c = (p.category ?? '').toLowerCase();
  const banned = ['cex', 'bridge', 'canonical bridge', 'liquid staking', 'liquid restaking', 'restaked btc', 'staking pool', 'stablecoin wrapper'];
  return !banned.includes(c);
}

/** The median of a list of finite numbers. */
function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)] ?? 0;
}

/** The comps the model reads: a median mcap/tvl per category, and the global one. */
export function buildComps(snapshot: Snapshot, model: ModelConstants = MODEL): { global: { samples: number; median_mc_tvl: number }; comps: CompRow[] } {
  const ratios: Array<{ category: string; ratio: number }> = [];
  for (const p of snapshot.protocols) {
    const tvl = tvlOf(p);
    if (p.mcap_usd === null || tvl <= 0) continue;
    ratios.push({ category: p.category ?? '(uncategorized)', ratio: p.mcap_usd / tvl });
  }
  const global = { samples: ratios.length, median_mc_tvl: median(ratios.map((r) => r.ratio)) };
  const byCategory = new Map<string, number[]>();
  for (const r of ratios) {
    const list = byCategory.get(r.category) ?? [];
    list.push(r.ratio);
    byCategory.set(r.category, list);
  }
  const comps: CompRow[] = [...byCategory.entries()]
    .filter(([, list]) => list.length >= model.comp_min_samples)
    .map(([category, list]) => ({ category, samples: list.length, median_mc_tvl: median(list) }))
    .sort((a, b) => a.category < b.category ? -1 : a.category > b.category ? 1 : 0);
  return { global, comps };
}

/** The comp one protocol scores against: its category's median when the peers exist, else the global one. */
export function compFor(p: SnapshotProtocol, comps: Map<string, CompRow>, global: { samples: number; median_mc_tvl: number }, model: ModelConstants = MODEL): { multiple: number; source: 'category' | 'global'; samples: number } {
  const key = p.category ?? '(uncategorized)';
  const own = comps.get(key);
  const raw = own ? own.median_mc_tvl : global.median_mc_tvl;
  const multiple = Math.min(model.comp_max, Math.max(model.comp_min, raw));
  return own ? { multiple, source: 'category', samples: own.samples } : { multiple, source: 'global', samples: global.samples };
}

/** The multipliers and the implied value one protocol gets under the model. */
export function impliedValue(p: SnapshotProtocol, ctx: { snapshot: Snapshot; comps: Map<string, CompRow>; global: { samples: number; median_mc_tvl: number } }, model: ModelConstants = MODEL): {
  implied: number;
  comp: { multiple: number; source: 'category' | 'global'; samples: number };
  momentumPct: number;
  momentumCapped: boolean;
  momentumMult: number;
  ageMult: number;
  age: number | null;
  ageUsed: number;
} {
  const age = ageDays(ctx.snapshot.as_of, p.listed_at);
  const raw = finite(p.change_7d, 0);
  const momentumPct = Math.min(model.momentum_cap_pct, Math.max(model.momentum_floor_pct, raw));
  const momentumCapped = raw > model.momentum_cap_pct;
  const momentumMult = 1 + (momentumPct / 100) * model.momentum_weight;
  const ageUsed = age ?? model.age_unknown_days;
  const quarters = Math.min(ageUsed, model.age_cap_days) / 365;
  const ageMult = 1 + quarters * model.age_weight;
  const comp = compFor(p, ctx.comps, ctx.global, model);
  const tvl = tvlOf(p);
  const implied = Math.min(IMPLIED_CAP_USD, Math.max(1, Math.round(tvl * comp.multiple * momentumMult * ageMult)));
  return { implied, comp, momentumPct, momentumCapped, momentumMult, ageMult, age, ageUsed };
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  const tvl = tvlOf(p);
  if (tvl >= 5_000_000_000) return 250;
  if (tvl >= 1_000_000_000) return 150;
  if (tvl >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 180) return 60;
  if (age < 730) return 45;
  return 30;
}

/** The category's one action, in words a reader can follow, with the protocol's own chain named. */
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

/** A step as one string, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan: six concrete steps, each an action with a cost and a time, derived from
 * the protocol's own record — its category, chains, TVL and age — never from a hand-written list.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const second = p.chains.length > 1 ? p.chains[1]! : null;
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  return [
    {
      text: `Set up a fresh wallet that will only ever touch ${p.name}, and fund it from an exchange so the airdrop source is one hop, not ten.`,
      cost: '≤ $3 gas',
      time: '10 min',
    },
    {
      text: action,
      cost: `$${capital} + ~$${capital >= 150 ? 8 : 4} gas`,
      time: '15 min',
    },
    second
      ? {
          text: `Repeat the deposit on ${second}, ${p.name}'s second chain, so activity spans more than one chain in the same week.`,
          cost: `$${capital} + bridge fee`,
          time: '20 min',
        }
      : {
          text: `Make one qualifying action each week — a deposit, a swap, a vote or a claim — on ${chain}, always through ${p.name}'s own app.`,
          cost: '~$2 gas/wk',
          time: '10 min/wk',
        },
    {
      text: `Hold the position for at least ${hold} days, across at least three separate weeks, so the wallet's activity shows in more than one monthly snapshot.`,
      cost: 'capital stays in',
      time: `${hold} days`,
    },
    {
      text: `Check ${p.name}'s own points, rewards or docs page once a week and claim only from links published there — never from a DM, a reply or an ad.`,
      cost: 'free to check',
      time: '10 min/wk',
    },
    {
      text: `Log the wallet address, every date and every transaction hash in one running file, so a claim form, an eligibility check or an unwind takes minutes.`,
      cost: 'free',
      time: '5 min/wk',
    },
  ];
}

/** The already-tokened protocols, by market cap, for the dashboard's Live view. */
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

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor, never a ceiling: every slug on it goes in, whatever its TVL.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: the strongest pre-token protocols below the floor, the rows the radar exists to find.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && tvlOf(p) < snapshot.floor_usd)
    .sort((a, b) => tvlOf(b) - tvlOf(a) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const { global, comps: compList } = buildComps(snapshot, model);
  const comps = new Map(compList.map((c) => [c.category, c]));
  const ctx = { snapshot, comps, global };
  const scored = [...chosen.values()].map((p) => ({ p, v: impliedValue(p, ctx, model) }));
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const watchlistSet = new Set(snapshot.watchlist);
  return scored.map((s, i) => ({
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
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      comp_multiple: Math.round(s.v.comp.multiple * 100) / 100,
      comp_source: s.v.comp.source,
      comp_samples: s.v.comp.samples,
      momentum_pct: s.v.momentumPct,
      momentum_capped: s.v.momentumCapped,
      momentum_multiplier: Math.round(s.v.momentumMult * 1000) / 1000,
      age_multiplier: Math.round(s.v.ageMult * 1000) / 1000,
      age_days_used: s.v.ageUsed,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

/** A row's compact form for data.js. */
function radarRow(row: BoardRow, plan: FarmStep[]): RadarRow {
  return { ...row, plan };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const { global, comps } = buildComps(snapshot, model);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const plans = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    scanned: snapshot.protocols.length,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    global_comp: { samples: global.samples, median_mc_tvl: Math.round(global.median_mc_tvl * 1000) / 1000 },
    comps: comps.map((c) => ({ ...c, median_mc_tvl: Math.round(c.median_mc_tvl * 1000) / 1000 })),
    rows: board.map((r) => radarRow(r, farmSteps(plans.get(r.slug) as SnapshotProtocol, r.age_days))),
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
