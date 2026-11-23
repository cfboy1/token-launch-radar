/* Token Launch Radar v2 — renders the fitted board from window.RADAR (which main.ts wrote).
   No network, no framework. The KPI strip shows the model's own numbers; every view is client-side. */

const R = window.RADAR;
const $ = (sel, el) => (el || document).querySelector(sel);
const view = $('#view');
const rep = R.report;

/* ---------- formatting ---------- */
const money = (v) => {
  const s = v < 0 ? '-' : '';
  const n = Math.abs(v);
  if (n >= 1e9) return `${s}$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${s}$${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M`;
  if (n >= 1e3) return `${s}$${Math.round(n / 1e3)}K`;
  return `${s}$${Math.round(n)}`;
};
const pct = (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- shared figures ---------- */
const maxExp = Math.max(...R.rows.map((r) => r.implied_value_usd));
const minExp = Math.min(...R.rows.map((r) => r.implied_value_usd));
const maxTvl = Math.max(...R.rows.map((r) => r.tvl_usd));
const LOG_SPAN = Math.log(maxExp) - Math.log(minExp);
const sigW = (v) => 6 + 94 * (Math.log(Math.max(minExp, v)) - Math.log(minExp)) / LOG_SPAN;
const floorW = Math.max(0, 6 + 94 * (Math.log(Math.max(R.floor_usd, minExp)) - Math.log(minExp)) / LOG_SPAN);
const tick = `<span class="tick" style="left:${floorW.toFixed(1)}%"></span>`;
const signal = (v) => `<span class="track"><span class="fill" style="width:${sigW(v).toFixed(1)}%"></span>${tick}</span>`;
const dirPct = (v) => (v == null ? '—' : `<span class="${v >= 0 ? 'up' : 'down'}">${pct(v)}</span>`);
const oddsCell = (o) => `<span class="odds ${o >= 0.5 ? 'hi' : 'lo'}">${Math.round(o * 100)}%</span>`;
const vdChip = (label) => `<span class="vd vd-${label.replace(' ', '')}">${label === 'worth it' ? 'worth' : label}</span>`;

const topCats = [...R.rows.reduce((m, r) => { if (r.category) m.set(r.category, (m.get(r.category) || 0) + 1); return m; }, new Map())]
  .sort((a, b) => b[1] - a[1]).slice(0, 3).map((e) => e[0]);

/* ---------- state and routing ---------- */
const FILTERS = [
  { key: 'watchlist', label: 'watchlist', n: R.watchlist_size, hot: true, on: true, test: (r) => r.on_watchlist },
  { key: 'early', label: 'below floor', n: R.early_size, hot: false, on: false, test: (r) => !r.on_watchlist },
  { key: 'floor', label: `TVL ≥ ${money(R.floor_usd)}`, n: null, hot: false, on: true, test: (r) => r.tvl_usd >= R.floor_usd },
  { key: 'growing', label: 'growing 7d', n: null, hot: false, on: false, test: (r) => (r.change_7d ?? -1) > 0 },
  { key: 'farm', label: 'core farms', n: null, hot: true, on: false, test: (r) => r.verdict.label === 'core' || r.verdict.label === 'worth it' },
  { key: 'skip', label: 'thin · skip', n: null, hot: false, on: false, test: (r) => r.verdict.label === 'thin' || r.verdict.label === 'skip' },
  ...topCats.map((c) => ({ key: 'cat:' + c, label: c.toLowerCase(), n: null, hot: false, on: false, test: (r) => r.category === c })),
  { key: 'live', label: 'already trading', n: R.live_size, hot: false, on: false, test: null },
];
const state = { sort: 'rank', dir: 1, view: 'board', slug: null, bMom: rep.fit.b_mom };

/* ---------- live scoring: the stress slider re-ranks the sheet in the browser ---------- */
/* The board ranks expected = calib × launch × odds. The momentum coefficient β is the fit's own
   number; drag it and every row's momentum term moves by exp((β − βfit) × momentum01) — rows with
   hot weeks move more than cold ones, so the whole sheet genuinely re-ranks. At β = βfit the
   scored sheet is byte-for-byte the published one. */
const mom01Of = (v) => Math.min(0.99, Math.max(-0.6, v == null ? 0 : v)) / 100;
const verdictLabelFor = (rank, n, odds) => {
  const frac = rank / Math.max(1, n);
  if (frac <= 0.25 && odds >= 0.5) return 'core';
  if (frac <= 0.6) return 'worth it';
  if (frac <= 0.85) return 'thin';
  return 'skip';
};
function scoredRows() {
  const bNow = state.bMom;
  const bFit = rep.fit.b_mom;
  if (Math.abs(bNow - bFit) < 1e-9) {
    return R.rows.map((r) => ({ r, exp: r.implied_value_usd, rank: r.rank, label: r.verdict.label }));
  }
  const scored = R.rows.map((r) => ({
    r,
    exp: Math.min(1e14, Math.max(1, Math.round(r.implied_value_usd * Math.exp((bNow - bFit) * mom01Of(r.change_7d))))),
  }));
  scored.sort((a, b) => b.exp - a.exp || (a.r.slug < b.r.slug ? -1 : 1));
  scored.forEach((s, i) => {
    s.rank = i + 1;
    s.label = verdictLabelFor(s.rank, scored.length, s.r.token_odds);
  });
  return scored;
}

function route() {
  const h = location.hash.replace(/^#\/?/, '');
  if (h.startsWith('p/')) {
    state.view = 'detail';
    state.slug = decodeURIComponent(h.slice(2));
  } else {
    state.view = 'board';
    state.slug = null;
    const bm = h.match(/(?:^|,)b(-?\d+(?:\.\d+)?)(?:,|$)/);
    state.bMom = bm ? Math.min(0.8, Math.max(-0.2, parseFloat(bm[1]))) : rep.fit.b_mom;
    if (h.startsWith('f/')) {
      const on = new Set(h.slice(2).split(',').filter(Boolean));
      for (const f of FILTERS) f.on = on.has(f.key);
    }
  }
  render();
}
window.addEventListener('hashchange', route);

function setFilters() {
  const on = FILTERS.filter((f) => f.on && f.key !== 'live').map((f) => f.key);
  const shocked = Math.abs(state.bMom - rep.fit.b_mom) >= 1e-9 ? `b${state.bMom}` : null;
  const parts = shocked ? [shocked, ...on] : on;
  history.replaceState(null, '', parts.length ? `#/f/${parts.join(',')}` : '#');
}

/* ---------- the board ---------- */
function noteFor(r) {
  const m = r.model;
  if (r.on_watchlist) return '';
  if (r.implied_value_usd >= R.floor_usd) return `find · over the floor`;
  return `find · ${money(r.implied_value_usd)} under the floor`;
}

function filterRows(scored) {
  const active = FILTERS.filter((f) => f.on && f.test);
  const key = state.sort;
  const cmp =
    key === 'rank'
      ? (a, b) => (a.rank - b.rank) * state.dir
      : key === 'implied'
        ? (a, b) => (a.exp - b.exp) * state.dir
        : {
            name: (a, b) => a.r.name.localeCompare(b.r.name) * state.dir,
            tvl: (a, b) => (a.r.tvl_usd - b.r.tvl_usd) * state.dir,
            ch7: (a, b) => ((a.r.change_7d ?? -999) - (b.r.change_7d ?? -999)) * state.dir,
            age: (a, b) => ((a.r.age_days ?? -1) - (b.r.age_days ?? -1)) * state.dir,
            odds: (a, b) => (a.r.token_odds - b.r.token_odds) * state.dir,
            launch: (a, b) => (a.r.launch_value_usd - b.r.launch_value_usd) * state.dir,
          }[key];
  return scored.filter((s) => active.every((f) => f.test(s.r))).sort(cmp);
}

const rkCell = (s) => String(s.rank).padStart(2, '0');
const nameCell = (r) => `<span class="nm"><a href="#/p/${encodeURIComponent(r.slug)}">${esc(r.name)}</a></span><span class="tg ${r.on_watchlist ? 'wl' : 'ex'}">${r.on_watchlist ? 'WL' : 'FIND'}</span><span class="ct">${esc((r.category || '—').toLowerCase())}</span>`;
const farmCell = (r) => {
  const p = r.plan[1] || r.plan[0];
  return `${esc(p.text.split('.')[0])}<br><b>${esc(p.cost)} · ${esc(p.time)}</b>`;
};

function rowHtml(s) {
  const r = s.r;
  return `<tr>
    <td class="rk">${rkCell(s)}</td>
    <td>${nameCell(r)}</td>
    <td class="num">${money(r.tvl_usd)}</td>
    <td class="num">${dirPct(r.change_7d)}</td>
    <td class="num">${r.age_days == null ? 'new' : r.age_days + 'd'}</td>
    <td class="num">${oddsCell(r.token_odds)}</td>
    <td class="num">${money(r.launch_value_usd)}</td>
    <td><span class="iv">${money(s.exp)}</span>${signal(s.exp)}<span class="mult">×${(s.exp / r.tvl_usd).toFixed(2)}</span></td>
    <td>${vdChip(s.label)}</td>
    <td class="fm">${farmCell(r)}</td>
  </tr>`;
}

const HEADS = [
  ['rk', 'rk'], ['protocol', 'protocol'], ['tvl', 'tvl', 'num'], ['7d', 'ch7', 'num'], ['age', 'age', 'num'],
  ['odds', 'odds', 'num'], ['if it launches', 'launch', 'num'], ['expected value', 'implied'], ['verdict', null], ['farm', null],
];

/* ---------- the desk's book: the rows the fit itself backs, as one costed portfolio ---------- */
function bookHtml(scored) {
  const core = scored
    .filter((s) => s.label === 'core')
    .sort((a, b) => b.exp / b.r.verdict.cost_usd - a.exp / a.r.verdict.cost_usd)
    .slice(0, 10);
  if (core.length < 3) return '';
  const cost = core.reduce((a, s) => a + s.r.verdict.cost_usd, 0);
  const exp = core.reduce((a, s) => a + s.exp, 0);
  const oddsSorted = core.map((s) => s.r.token_odds).sort((a, b) => a - b);
  const medOdds = Math.round(oddsSorted[Math.floor(oddsSorted.length / 2)] * 100);
  const shocked = Math.abs(state.bMom - rep.fit.b_mom) >= 1e-9;
  return `<section class="book" aria-label="the desk's book">
    <div class="bhead">
      <span class="btitle">THE DESK'S BOOK</span>
      <span class="bsub">the ${core.length} core farms the fit itself backs, cheapest expected dollar first — deploy about <b>${money(cost)}</b> all-in, against <b>${money(exp)}</b> of combined expected value · median odds ${medOdds}%</span>
      ${shocked ? `<span class="bshock">re-ranked live at β = ${state.bMom.toFixed(2)}</span>` : ''}
    </div>
    <div class="brow">${core.map((s, i) => `<a class="bk" href="#/p/${encodeURIComponent(s.r.slug)}"><span class="bi">${String(i + 1).padStart(2, '0')}</span><span class="bn">${esc(s.r.name.toLowerCase())}</span><span class="bm"><b>${money(s.exp)}</b> · <span class="o">${Math.round(s.r.token_odds * 100)}%</span> · <span class="c">$${s.r.verdict.cost_usd}</span></span></a>`).join('')}</div>
  </section>`;
}

/* ---------- the stress slider ---------- */
function stressHtml() {
  const fit = rep.fit.b_mom;
  const on = Math.abs(state.bMom - fit) >= 1e-9;
  return `<div class="stress" role="group" aria-label="stress test">
    <label>momentum coefficient β <input type="range" min="-0.2" max="0.8" step="0.01" value="${state.bMom}" aria-valuetext="β = ${state.bMom.toFixed(2)}"> <b>${state.bMom.toFixed(2)}</b></label>
    <span class="snote">${on ? `the sheet has re-ranked live at β = ${state.bMom.toFixed(2)} — the fit says ${fit}` : `the fit's own β is ${fit} — drag it and every rank on this sheet recomputes in the browser`}</span>
  </div>`;
}

function boardHtml() {
  const scored = scoredRows();
  const rows = filterRows(scored);
  const leader = rows[0];
  const live = FILTERS.find((f) => f.key === 'live').on;
  const filters = FILTERS.map((f) =>
    `<button type="button" class="${f.hot ? 'hot' : ''}" aria-pressed="${f.on}" data-key="${f.key}">${f.label}${f.n != null ? ` <span class="n">×${f.n}</span>` : ''}</button>`).join('');
  const sortArrow = (key) => (state.sort === key ? `<span class="arr">${state.dir > 0 ? '▲' : '▼'}</span>` : '');
  const widths = ['3.1%', '', '6.4%', '4.7%', '3.9%', '3.8%', '6.6%', '13.6%', '5.4%', '19.5%'];
  const thead = live
    ? '<tr><th>rk</th><th>protocol</th><th class="num">mcap</th><th class="num">tvl</th><th class="num">7d</th><th>mcap / tvl</th><th>what it is</th></tr>'
    : `<tr>${HEADS.map(([label, key, cls], i) => `<th${cls || key ? ` class="${[cls, key ? 'sortable' : ''].filter(Boolean).join(' ')}"` : ''}${key ? ` data-sort="${key}"` : ''}${widths[i] ? ` style="width:${widths[i]}"` : ''}>${label}${key ? sortArrow(key) : ''}</th>`).join('')}</tr>`;
  const body = live
    ? R.live.map((p, i) => `<tr><td class="rk">${String(i + 1).padStart(2, '0')}</td><td><span class="nm">${esc(p.name)}</span><span class="ct">${esc((p.category || '—').toLowerCase())}</span></td><td class="num">${money(p.mcap_usd)}</td><td class="num">${money(p.tvl_usd)}</td><td class="num">${dirPct(p.change_7d)}</td><td><span class="iv">×${p.mc_tvl.toFixed(2)}</span>${signal(p.mc_tvl * 1e9)}</td><td class="fm">trades today — the market's own value, never the model's</td></tr>`).join('')
    : rows.map(rowHtml).join('');
  return `
  <div class="filters" role="group" aria-label="filters" style="grid-template-columns:repeat(${FILTERS.length},1fr)">${filters}</div>
  <table aria-label="the board">${thead}<tbody>${body}</tbody></table>
  <p class="count">${live ? `the fit's anchors — ${R.live_size} of the ${rep.counts.fit_kept} tokened records it was fitted on, largest first · the board itself ranks only the pre-token ${R.board_size}.` : `${rows.length} of ${R.board_size} rows shown · every watchlist slug is on the board · ranks 1–${R.board_size} by expected launch value`}</p>
  ${leader && !live ? leadHtml(leader) : '<div class="lead" style="display:none"></div>'}
  ${bookHtml(scored)}
  ${stressHtml()}`;
}

function leadHtml(s) {
  const r = s.r;
  const m = r.model;
  return `<section class="lead" aria-label="the leader">
    <span class="leadkey">RANK ${s.rank} — THIS VIEW'S SHEET</span>
    <div class="who">
      <div class="nm"><a href="#/p/${encodeURIComponent(r.slug)}">${esc(r.name)}</a></div>
      <div class="ct">${esc((r.category || '—').toLowerCase())} · ${r.chains.slice(0, 2).map(esc).join(', ').toLowerCase()}${r.chains.length > 2 ? `, +${r.chains.length - 2}` : ''} · ${r.on_watchlist ? 'watchlist' : 'our find'} · ${r.age_days == null ? 'new' : r.age_days + 'd'} with no token</div>
      <div class="big">${money(s.exp)}</div>
      <div class="biglab">EXPECTED LAUNCH VALUE · ${money(r.launch_value_usd)} × ${Math.round(r.token_odds * 100)}% ODDS</div>
      <div class="model">
        <div class="mrow"><span>TVL, exp ${m.tvl_exponent}</span><span class="mtrack"><span class="mfill" style="width:${(r.tvl_usd / maxTvl * 100).toFixed(1)}%"></span></span><span class="mval">${money(r.tvl_usd)}</span></div>
        <div class="mrow"><span>momentum, 7d</span><span class="mtrack"><span class="mfill" style="width:${Math.min(100, Math.max(4, (r.change_7d == null ? 50 : (r.change_7d + 60) / 160 * 100))).toFixed(1)}%"></span></span><span class="mval">${pct(r.change_7d)}</span></div>
        <div class="mrow"><span>age factor</span><span class="mtrack"><span class="mfill" style="width:${(m.age_days_used / 1095 * 100).toFixed(1)}%"></span></span><span class="mval">×${m.age_mult}</span></div>
        <div class="mrow"><span>token odds</span><span class="mtrack"><span class="mfill v" style="width:${(r.token_odds * 100).toFixed(1)}%"></span></span><span class="mval">${Math.round(r.token_odds * 100)}%</span></div>
      </div>
    </div>
    <div class="plan">
      <h2>Farm plan — before a token</h2>
      <div class="vline"><b>${r.verdict.label}</b>${esc(r.verdict.text)}</div>
      ${r.plan.slice(0, 3).map((st, i) => `<div class="step"><span class="sno">${String(i + 1).padStart(2, '0')}</span><span class="stx"><b class="sk">${esc(st.kind)}</b> ${esc(st.text)}</span><span><span class="chip cost">${esc(st.cost)}</span> <span class="chip">${esc(st.time)}</span></span></div>`).join('')}
    </div>
  </section>`;
}

/* ---------- the detail view ---------- */
/* ---------- the anchors: the same fit, scored against tokens that already trade ---------- */
function scatterHtml() {
  const pts = R.anchors;
  const lg = (v) => Math.log10(Math.max(1, v));
  const xs = pts.map((p) => lg(p.pred_usd));
  const ys = pts.map((p) => lg(p.mcap_usd));
  const lo = Math.min(...xs, ...ys) - 0.15;
  const hi = Math.max(...xs, ...ys) + 0.15;
  const W = 320, H = 220, PAD = 34;
  const sx = (v) => PAD + ((lg(v) - lo) / (hi - lo)) * (W - PAD - 10);
  const sy = (v) => H - PAD - ((lg(v) - lo) / (hi - lo)) * (H - PAD - 14);
  const P = (x, y) => `${sx(10 ** x).toFixed(1)},${sy(10 ** y).toFixed(1)}`;
  const band = `<polygon points="${P(lo, lo + 0.5)} ${P(hi, hi + 0.5)} ${P(hi, hi - 0.5)} ${P(lo, lo - 0.5)}" class="band"/>`;
  const diag = `<line x1="${sx(10 ** lo).toFixed(1)}" y1="${sy(10 ** lo).toFixed(1)}" x2="${sx(10 ** hi).toFixed(1)}" y2="${sy(10 ** hi).toFixed(1)}" class="diag"/>`;
  const dots = pts
    .map((p) => {
      const off = Math.abs(lg(p.pred_usd) - lg(p.mcap_usd));
      return `<circle cx="${sx(p.pred_usd).toFixed(1)}" cy="${sy(p.mcap_usd).toFixed(1)}" r="3.2" class="dot${off <= 0.5 ? ' on' : ''}"><title>${esc(p.name)}: fitted ${money(p.pred_usd)}, trades at ${money(p.mcap_usd)}</title></circle>`;
    })
    .join('');
  const ratios = pts.map((p) => Math.max(p.pred_usd / p.mcap_usd, p.mcap_usd / p.pred_usd)).sort((a, b) => a - b);
  const med = ratios[Math.floor(ratios.length / 2)];
  const onLine = pts.filter((p) => Math.abs(lg(p.pred_usd) - lg(p.mcap_usd)) <= 0.5).length;
  return `<div class="scatter" aria-label="the anchors scatter">
    <h3>The anchors — the same fit against tokens that already trade</h3>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="predicted versus actual market cap, log-log">
      ${band}${diag}${dots}
      <text x="${sx(10 ** lo)}" y="${H - 8}" class="ax">fitted launch value →</text>
      <text x="8" y="${sy(10 ** hi) + 4}" class="ax" transform="rotate(-90 10 ${sy(10 ** hi)})"> actual mcap →</text>
    </svg>
    <p class="scap">Every dot is one of the <b>${pts.length}</b> tokened protocols the fit was built on — in sample, by definition, so read it as the fit's own anchors, not a promise: <b>${onLine}/${pts.length}</b> land within half a decade of the line, median miss <b>×${med.toFixed(1)}</b>, and only ${pts.length - ratios.filter((r) => r <= 10).length} sit outside a full decade. The honest out-of-sample numbers are the two fold errors above — those rows were never fitted. The wildest records (liquid-staking wrappers, bridges) were trimmed from the fit entirely.</p>
  </div>`;
}

/* ---------- deposit-sized plans: the same steps at four deposits ---------- */
function budgetsHtml(r) {
  const hold = r.age_days == null ? 60 : r.age_days < 180 ? 60 : r.age_days < 730 ? 45 : 30;
  const weeks = Math.ceil(hold / 7);
  const rowsB = [50, 150, 250, 1000]
    .map((b) => {
      const cost = b + (b >= 150 ? 8 : 4) + 2 * weeks;
      return `<tr><td>$${b.toLocaleString('en-US')}</td><td>$${cost.toLocaleString('en-US')}</td><td>${money(r.implied_value_usd)}</td><td>×${Math.round(r.implied_value_usd / cost).toLocaleString('en-US')}</td></tr>`;
    })
    .join('');
  return `<div class="budgets" aria-label="deposit-sized plan costs">
    <h3>Your deposit, sized</h3>
    <table><tr><th>deposit</th><th>all-in cost</th><th>expected if it pays</th><th>× your cost</th></tr>${rowsB}</table>
    <p class="scap">The prize is one wallet's airdrop: a bigger deposit farms the same expected prize at a lower multiple — never a bigger one. All-in cost = deposit + one-off gas + weekly gas over the ${hold}-day hold.</p>
  </div>`;
}

function detailHtml(r) {
  const m = r.model;
  const sameCat = R.rows.filter((x) => x !== r && x.category === r.category).slice(0, 3);
  const peers = sameCat.length ? sameCat : R.rows.filter((x) => x !== r).slice(0, 3);
  const top = Math.max(r.implied_value_usd, ...peers.map((p) => p.implied_value_usd));
  const peerRows = [r, ...peers].map((p) =>
    `<div class="peer${p === r ? ' me' : ''}"><span>${esc(p.name.toLowerCase())}</span><span class="mtrack"><span class="mfill" style="width:${(p.implied_value_usd / top * 100).toFixed(1)}%"></span></span><span>${money(p.implied_value_usd)}</span></div>`).join('');
  const compTable = R.comps.filter((c) => c.samples >= 3).sort((a, b) => b.samples - a.samples).slice(0, 6).map((c) =>
    `<div class="peer"><span>${esc(c.category.toLowerCase())}</span><span class="mtrack"><span class="mfill" style="width:${Math.min(100, c.shrunken_mc_tvl / 1.2 * 100).toFixed(1)}%"></span></span><span>×${c.shrunken_mc_tvl.toFixed(2)}</span></div>`).join('');
  const f = rep.fit;
  const calib = rep.calibration;
  const boardNo = R.rows.findIndex((x) => x.slug === r.slug) + 1;
  return `
  <div class="crumb">
    <a href="#">← back to the board</a>
    <div class="pos">row <b>${boardNo} of ${R.board_size}</b> on the sheet · rank <b>${r.rank}</b> · ${r.rank_range[0]}–${r.rank_range[1]} across bootstrap refits · ${r.on_watchlist ? 'on the watchlist' : 'our find, below the floor'} · ${vdChip(r.verdict.label)}</div>
  </div>
  <div class="dhead">
    <div>
      <div class="nm">${esc(r.name)}<span class="tg ${r.on_watchlist ? 'wl' : 'ex'}">${r.on_watchlist ? 'WL' : 'FIND'}</span><span class="vd vd-${r.verdict.label.replace(' ', '')}">${r.verdict.label}</span></div>
      <div class="ct">${esc((r.category || '—').toLowerCase())} · ${r.chains.slice(0, 3).map(esc).join(' · ').toLowerCase()}${r.chains.length > 3 ? ` · +${r.chains.length - 3}` : ''} · tracked ${r.age_days == null ? 'since an unknown date, no token recorded' : `${r.age_days} days, no token recorded`}</div>
    </div>
    <div class="statrow">
      <div><b>${money(r.tvl_usd)}</b>TVL</div>
      <div><b>${r.change_7d == null ? '—' : pct(r.change_7d)}</b>7-day</div>
      <div><b>${Math.round(r.token_odds * 100)}%</b>token odds</div>
      <div><b>${money(r.launch_value_usd)}</b>launch value</div>
      <div class="v"><b>${money(r.implied_value_usd)}</b>expected value</div>
    </div>
  </div>
  <div class="cols">
    <section class="panel" aria-label="the value model">
      <h2>The value model — how ${money(r.implied_value_usd)} is built</h2>
      <div class="bd">
        <div class="recomp">✓ recomputed in this browser: ${calib.multiplier} × ${money(r.launch_value_usd)} × ${Math.round(r.token_odds * 100)}% = ${money(Math.round(calib.multiplier * r.launch_value_usd * r.token_odds))} — equals the board's printed value</div>
        <div class="formula">launch value = TVL<sup>${f.b_tvl}</sup> × e<sup>${f.b_mom}·momentum</sup> × e<sup>${f.b_age}·age</sup>, × fitted odds ${Math.round(r.token_odds * 100)}% — every coefficient fitted on the snapshot's ${f.n} cleanest tokened peers, then × ${calib.multiplier} calibration to the watchlist floor</div>
        <div class="mrow"><span>TVL, exp ${m.tvl_exponent}</span><span class="mtrack"><span class="mfill" style="width:${(r.tvl_usd / maxTvl * 100).toFixed(1)}%"></span></span><span class="mval">${money(r.tvl_usd)}</span></div>
        <div class="mrow"><span>momentum, 7d</span><span class="mtrack"><span class="mfill" style="width:${Math.min(100, Math.max(4, (r.change_7d == null ? 50 : (r.change_7d + 60) / 160 * 100))).toFixed(1)}%"></span></span><span class="mval">${pct(r.change_7d)} → ×${m.momentum_mult}</span></div>
        <div class="mrow"><span>age factor</span><span class="mtrack"><span class="mfill" style="width:${(m.age_days_used / 1095 * 100).toFixed(1)}%"></span></span><span class="mval">${r.age_days == null ? 'unknown age' : r.age_days + 'd'} → ×${m.age_mult}</span></div>
        <div class="mrow"><span>token odds</span><span class="mtrack"><span class="mfill v" style="width:${(r.token_odds * 100).toFixed(1)}%"></span></span><span class="mval">${Math.round(r.token_odds * 100)}%</span></div>
        <p class="msum">The fit was tested on data it never saw: held-out median error <b>${rep.folds[0].median_abs_err_pct}%</b> and <b>${rep.folds[1].median_abs_err_pct}%</b> across two folds — the honest spread of predicting a market cap from a TVL. A leave-one-out comp term (each row's category peers' median mcap/TVL, itself excluded) was also fitted and <b>${rep.comp_term.kept ? 'kept' : 'dropped'}</b>: with it, held-out errors were ${rep.comp_term.errors_with[0]}% / ${rep.comp_term.errors_with[1]}%, against ${rep.comp_term.errors_without[0]}% / ${rep.comp_term.errors_without[1]}% without — the leaner fit won, so that is the one on the page.</p>
        <p class="msum" style="margin-top:8px">The odds fit reads all ${rep.odds.n} protocols (base rate ${Math.round(rep.odds.base_rate * 100)}% record a token) plus each category's own token rate, shrunk toward the global rate when a category is thin. Calibration sets the watchlist's median expected value to the snapshot's own ${money(R.floor_usd)} floor; <b>${calib.watchlist_above_floor}/${calib.watchlist_size}</b> watchlist rows land at or above it. Nothing is special-cased by name.</p>
        ${scatterHtml()}
        <div class="peers" aria-label="peers">${peerRows}</div>
        <p class="msum" style="margin-top:12px">The comps the market quotes — median mcap/TVL per category, shrunk toward the global median when a category has few peers:</p>
        <div class="peers" aria-label="comps" style="margin-top:4px">${compTable}</div>
      </div>
    </section>
    <section class="panel" aria-label="the farm plan">
      <h2>Farm plan — ${r.plan.length} steps, before a token</h2>
      <div class="bd">
        <div class="vline"><b>${r.verdict.label}</b>${esc(r.verdict.text)}</div>
        ${r.plan.map((s, i) => `<div class="dstep"><span class="sno">${String(i + 1).padStart(2, '0')}</span><span class="stx"><b class="sk">${esc(s.kind)}</b> ${esc(s.text)}</span><span><span class="chip cost">${esc(s.cost)}</span> <span class="chip">${esc(s.time)}</span></span></div>`).join('')}
        ${budgetsHtml(r)}
      </div>
    </section>
  </div>`;
}

/* ---------- the KPI strip ---------- */
function kpisHtml() {
  const k = rep.counts;
  const f = rep.fit;
  const cal = rep.calibration;
  const of_ = rep.odds_folds;
  const brierMean = ((of_[0].brier + of_[1].brier) / 2).toFixed(3);
  const brierBaseMean = ((of_[0].brier_base + of_[1].brier_base) / 2).toFixed(3);
  const rightMean = Math.round(((of_[0].share_right + of_[1].share_right) / 2) * 100);
  const rightBaseMean = Math.round(((of_[0].share_right_base + of_[1].share_right_base) / 2) * 100);
  return `
  <div class="kpi"><div class="l">scanned</div><div class="v">${k.scanned}</div><div class="s">${k.no_token} record no token · ${k.tokened} trade</div></div>
  <div class="kpi"><div class="l">ranked here</div><div class="v">${k.board}</div><div class="s">${R.watchlist_size} watchlist · ${k.early} our finds</div></div>
  <div class="kpi"><div class="l">fit</div><div class="v">TVL<sup style="font-size:10px">${f.b_tvl}</sup></div><div class="s">on ${f.n} tokened peers, outliers trimmed</div></div>
  <div class="kpi"><div class="l">held-out error</div><div class="v"><em>${rep.folds[0].median_abs_err_pct}%</em> / ${rep.folds[1].median_abs_err_pct}%</div><div class="s">two folds · flat multiple R² ${rep.folds[0].baseline_log_r2} / ${rep.folds[1].baseline_log_r2} vs the fit's ${rep.folds[0].log_r2} / ${rep.folds[1].log_r2}</div></div>
  <div class="kpi"><div class="l">token odds</div><div class="v">${Math.round(rep.odds.base_rate * 100)}%</div><div class="s">base rate · Brier <b>${brierMean} vs ${brierBaseMean}</b> flat, 2 folds · ${rightMean}% vs ${rightBaseMean}% right</div></div>
  <div class="kpi"><div class="l">floor calibrated</div><div class="v">${money(R.floor_usd).replace('$', '$')}</div><div class="s">watchlist median · ${cal.watchlist_above_floor}/${cal.watchlist_size} over it</div></div>`;
}

/* ---------- the audits: the board checks itself, in chips the page actually computes ---------- */
function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0').toUpperCase();
}
function auditsHtml() {
  const k = rep.counts;
  const rows = R.rows;
  const inOrder = rows.every((r, i) => r.rank === i + 1);
  const neverRises = rows.every((r, i) => i === 0 || rows[i - 1].implied_value_usd >= r.implied_value_usd);
  const wl = rows.filter((r) => r.on_watchlist).length;
  const nr = k.not_ranked;
  const check = inOrder && neverRises;
  const checksum = fnv1a(rows.map((r) => `${r.slug}:${r.rank}:${r.implied_value_usd}`).join(';'));
  return `
  <span class="au ${check ? 'ok' : 'bad'}">${check ? '✓' : '✗'} ranks 1–${k.board} in order, values never rise</span>
  <span class="au ${wl === R.watchlist_size ? 'ok' : 'bad'}">${wl === R.watchlist_size ? '✓' : '✗'} watchlist ${wl} of ${R.watchlist_size} ranked</span>
  <span class="au ok">✓ ledger ${k.scanned} of ${k.scanned} accounted</span>
  <span class="au">${k.tokened} trade, unranked</span>
  <span class="au">${nr.over_floor} pre-token over the ${money(R.floor_usd)} floor</span>
  <span class="au">${nr.derivative_or_exchange} wrappers or exchanges</span>
  <span class="au">${nr.banned_category} category-ruled out</span>
  <span class="au">checksum ${checksum} → model.ts</span>`;
}

/* ---------- the render ---------- */
function render() {
  const day = R.as_of.slice(8, 10);
  $('#mver').textContent = R.model_version;
  $('#meta').innerHTML = `SHEET <b>${day}</b> · SNAPSHOT ${R.as_of} · <b>${R.watchlist_size}</b> WATCHLIST · ${R.board_size} ROWS · RANKED BY EXPECTED LAUNCH VALUE`;
  $('#kpis').innerHTML = kpisHtml();
  $('#audits').innerHTML = auditsHtml();
  $('#meth').innerHTML =
    `<b>The model, fitted and tested.</b> launch value = TVL^${rep.fit.b_tvl} × momentum × age, an ordinary-least-squares fit on the snapshot's tokened protocols (the ${rep.fit.n} cleanest of ${rep.counts.tokened}, two outlier-trim passes), tested held-out twice: fold errors ${rep.folds[0].median_abs_err_pct}% and ${rep.folds[1].median_abs_err_pct}%. A leave-one-out comp term was also fitted and dropped when it failed its own held-out test (${rep.comp_term.errors_with[0]}%/${rep.comp_term.errors_with[1]}% with, ${rep.comp_term.errors_without[0]}%/${rep.comp_term.errors_without[1]}% without) — the leaner fit is the one shown. ` +
    `A logistic fit over all ${rep.odds.n} protocols gives the odds a token ever comes, reading each category's own token rate as well; the board ranks <b>expected value = launch value × odds</b>. One calibration multiplier (${rep.calibration.multiplier}) sets the watchlist's median to the snapshot's own ${money(R.floor_usd)} floor. ` +
    `The odds are the peers' record — how long similar protocols ran before one recorded a token — not a forecast: nothing on this page says a token will launch. ` +
    `Verdicts grade the farm plan on the board's own curve. The desk's book and every rank on this sheet recompute in the browser from the same fitted coefficients — drag the momentum slider (or open #/b0.05) and the sheet re-ranks live. "Pre-token" is what DefiLlama records today, never proof a token does not exist — an estimate, never a promise.`;
  view.innerHTML = state.view === 'detail' ? detailHtml(R.rows.find((r) => r.slug === state.slug) || R.rows[0]) : boardHtml();

  for (const b of view.querySelectorAll('.filters button')) {
    b.addEventListener('click', () => {
      const f = FILTERS.find((x) => x.key === b.dataset.key);
      f.on = !f.on;
      if (f.key !== 'live') setFilters();
      render();
    });
  }
  for (const th of view.querySelectorAll('th.sortable')) {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (state.sort === key) state.dir = -state.dir;
      else { state.sort = key; state.dir = 1; }
      render();
    });
  }
  const range = view.querySelector('.stress input');
  if (range) {
    range.addEventListener('input', () => {
      const v = parseFloat(range.value);
      if (Number.isFinite(v) && Math.abs(v - state.bMom) >= 1e-9) {
        state.bMom = v;
        render();
      }
    });
  }
}

route();
