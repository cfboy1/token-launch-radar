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

/** The desk's picks: watchlist rows with positive momentum, oldest run first. */
const picks = new Set(
  R.rows.filter((r) => r.on_watchlist && (r.change_7d ?? -1) > 0).sort((a, b) => (b.age_days ?? 0) - (a.age_days ?? 0)).slice(0, 4).map((r) => r.slug),
);

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
const state = { sort: 'rank', dir: 1, view: 'board', slug: null };

function route() {
  const h = location.hash.replace(/^#\/?/, '');
  if (h.startsWith('p/')) {
    state.view = 'detail';
    state.slug = decodeURIComponent(h.slice(2));
  } else {
    state.view = 'board';
    state.slug = null;
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
  history.replaceState(null, '', on.length ? `#/f/${on.join(',')}` : '#');
}

/* ---------- the board ---------- */
function noteFor(r) {
  const m = r.model;
  if (r.on_watchlist) return '';
  if (r.implied_value_usd >= R.floor_usd) return `find · over the floor`;
  return `find · ${money(r.implied_value_usd)} under the floor`;
}

function filterRows() {
  const active = FILTERS.filter((f) => f.on && f.test);
  const cmp = {
    rank: (a, b) => (a.rank - b.rank) * state.dir,
    name: (a, b) => a.name.localeCompare(b.name) * state.dir,
    tvl: (a, b) => (a.tvl_usd - b.tvl_usd) * state.dir,
    ch7: (a, b) => ((a.change_7d ?? -999) - (b.change_7d ?? -999)) * state.dir,
    age: (a, b) => ((a.age_days ?? -1) - (b.age_days ?? -1)) * state.dir,
    odds: (a, b) => (a.token_odds - b.token_odds) * state.dir,
    launch: (a, b) => (a.launch_value_usd - b.launch_value_usd) * state.dir,
    implied: (a, b) => (a.implied_value_usd - b.implied_value_usd) * state.dir,
  }[state.sort];
  return R.rows.filter((r) => active.every((f) => f.test(r))).sort(cmp);
}

const rkCell = (r) => (picks.has(r.slug) ? `<span class="circ">${String(r.rank).padStart(2, '0')}</span>` : String(r.rank).padStart(2, '0'));
const nameCell = (r) => `<span class="nm"><a href="#/p/${encodeURIComponent(r.slug)}">${esc(r.name)}</a></span><span class="tg ${r.on_watchlist ? 'wl' : 'ex'}">${r.on_watchlist ? 'WL' : 'FIND'}</span><span class="ct">${esc((r.category || '—').toLowerCase())}</span>`;
const farmCell = (r) => {
  const p = r.plan[1] || r.plan[0];
  return `${esc(p.text.split('.')[0])}<br><b>${esc(p.cost)} · ${esc(p.time)}</b>`;
};

function rowHtml(r) {
  return `<tr>
    <td class="rk">${rkCell(r)}</td>
    <td>${nameCell(r)}</td>
    <td class="num">${money(r.tvl_usd)}</td>
    <td class="num">${dirPct(r.change_7d)}</td>
    <td class="num">${r.age_days == null ? 'new' : r.age_days + 'd'}</td>
    <td class="num">${oddsCell(r.token_odds)}</td>
    <td class="num">${money(r.launch_value_usd)}</td>
    <td><span class="iv">${money(r.implied_value_usd)}</span>${signal(r.implied_value_usd)}<span class="mult">×${(r.implied_value_usd / r.tvl_usd).toFixed(2)}</span></td>
    <td>${vdChip(r.verdict.label)}</td>
    <td class="num fm">${farmCell(r)}</td>
  </tr>`;
}

const HEADS = [
  ['rk', 'rk'], ['protocol', 'protocol'], ['tvl', 'tvl', 'num'], ['7d', 'ch7', 'num'], ['age', 'age', 'num'],
  ['odds', 'odds', 'num'], ['launch val', 'launch', 'num'], ['expected value', 'implied'], ['verdict', null], ['farm', null, 'num'],
];

function boardHtml() {
  const rows = filterRows();
  const leader = rows[0];
  const live = FILTERS.find((f) => f.key === 'live').on;
  const filters = FILTERS.map((f) =>
    `<button type="button" class="${f.hot ? 'hot' : ''}" aria-pressed="${f.on}" data-key="${f.key}">${f.label}${f.n != null ? ` <span class="n">×${f.n}</span>` : ''}</button>`).join('');
  const sortArrow = (key) => (state.sort === key ? `<span class="arr">${state.dir > 0 ? '▲' : '▼'}</span>` : '');
  const widths = [40, '', 84, 62, 52, 50, 80, 188, 72, 260];
  const thead = live
    ? '<tr><th>rk</th><th>protocol</th><th class="num">mcap</th><th class="num">tvl</th><th class="num">7d</th><th>mcap / tvl</th><th>what it is</th></tr>'
    : `<tr>${HEADS.map(([label, key, cls], i) => `<th${cls || key ? ` class="${[cls, key ? 'sortable' : ''].filter(Boolean).join(' ')}"` : ''}${key ? ` data-sort="${key}"` : ''}${widths[i] ? ` style="width:${widths[i]}px"` : ''}>${label}${key ? sortArrow(key) : ''}</th>`).join('')}</tr>`;
  const body = live
    ? R.live.map((p, i) => `<tr><td class="rk">${String(i + 1).padStart(2, '0')}</td><td><span class="nm">${esc(p.name)}</span><span class="ct">${esc((p.category || '—').toLowerCase())}</span></td><td class="num">${money(p.mcap_usd)}</td><td class="num">${money(p.tvl_usd)}</td><td class="num">${dirPct(p.change_7d)}</td><td><span class="iv">×${p.mc_tvl.toFixed(2)}</span>${signal(p.mc_tvl * 1e9)}</td><td class="fm">trades today — the market's own value, never the model's</td></tr>`).join('')
    : rows.slice(1).map(rowHtml).join('');
  return `
  ${leader && !live ? leadHtml(leader) : '<div class="lead" style="display:none"></div>'}
  <div class="filters" role="group" aria-label="filters" style="grid-template-columns:repeat(${FILTERS.length},1fr)">${filters}</div>
  <table aria-label="the board">${thead}<tbody>${body}</tbody></table>
  <p class="count">${live ? `${R.live_size} protocols already trade — the board itself ranks only the pre-token ${R.board_size}.` : `${rows.length} of ${R.board_size} rows shown · every watchlist slug is on the board · ranks 1–${R.board_size} by expected launch value`}</p>`;
}

function leadHtml(leader) {
  const m = leader.model;
  return `<section class="lead" aria-label="the leader">
    <span class="leadkey">№ 1 — this view's sheet</span>
    <div class="who">
      <div class="nm"><a href="#/p/${encodeURIComponent(leader.slug)}">${esc(leader.name)}</a></div>
      <div class="ct">${esc((leader.category || '—').toLowerCase())} · ${leader.chains.slice(0, 2).map(esc).join(', ').toLowerCase()}${leader.chains.length > 2 ? `, +${leader.chains.length - 2}` : ''} · ${leader.on_watchlist ? 'watchlist' : 'our find'} · ${leader.age_days == null ? 'new' : leader.age_days + 'd'} with no token</div>
      <div class="big">${money(leader.implied_value_usd)}</div>
      <div class="biglab">EXPECTED LAUNCH VALUE · ${money(leader.launch_value_usd)} × ${Math.round(leader.token_odds * 100)}% ODDS</div>
      <div class="model">
        <div class="mrow"><span>TVL, exp ${m.tvl_exponent}</span><span class="mtrack"><span class="mfill" style="width:${(leader.tvl_usd / maxTvl * 100).toFixed(1)}%"></span></span><span class="mval">${money(leader.tvl_usd)}</span></div>
        <div class="mrow"><span>momentum, 7d</span><span class="mtrack"><span class="mfill" style="width:${Math.min(100, Math.max(4, (leader.change_7d == null ? 50 : (leader.change_7d + 60) / 160 * 100))).toFixed(1)}%"></span></span><span class="mval">${pct(leader.change_7d)}</span></div>
        <div class="mrow"><span>age factor</span><span class="mtrack"><span class="mfill" style="width:${(m.age_days_used / 1095 * 100).toFixed(1)}%"></span></span><span class="mval">×${m.age_mult}</span></div>
        <div class="mrow"><span>token odds</span><span class="mtrack"><span class="mfill v" style="width:${(leader.token_odds * 100).toFixed(1)}%"></span></span><span class="mval">${Math.round(leader.token_odds * 100)}%</span></div>
      </div>
    </div>
    <div class="plan">
      <h2>Farm plan — before a token</h2>
      <div class="vline"><b>${leader.verdict.label}</b>${esc(leader.verdict.text)}</div>
      ${leader.plan.slice(0, 3).map((s, i) => `<div class="step"><span class="sno">${String(i + 1).padStart(2, '0')}</span><span class="stx">${esc(s.text)}</span><span><span class="chip cost">${esc(s.cost)}</span> <span class="chip">${esc(s.time)}</span></span></div>`).join('')}
    </div>
  </section>`;
}

/* ---------- the detail view ---------- */
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
    <div class="pos">row <b>${boardNo} of ${R.board_size}</b> on the sheet · rank <b>${r.rank}</b> by expected value · ${r.on_watchlist ? 'on the watchlist' : 'our find, below the floor'} · ${vdChip(r.verdict.label)}</div>
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
        <div class="formula">launch value = TVL<sup>${f.b_tvl}</sup> × e<sup>${f.b_mom}·momentum</sup> × e<sup>${f.b_age}·age</sup>, × fitted odds ${Math.round(r.token_odds * 100)}% — every coefficient fitted on the snapshot's ${f.n} cleanest tokened peers, then × ${calib.multiplier} calibration to the watchlist floor</div>
        <div class="mrow"><span>TVL, exp ${m.tvl_exponent}</span><span class="mtrack"><span class="mfill" style="width:${(r.tvl_usd / maxTvl * 100).toFixed(1)}%"></span></span><span class="mval">${money(r.tvl_usd)}</span></div>
        <div class="mrow"><span>momentum, 7d</span><span class="mtrack"><span class="mfill" style="width:${Math.min(100, Math.max(4, (r.change_7d == null ? 50 : (r.change_7d + 60) / 160 * 100))).toFixed(1)}%"></span></span><span class="mval">${pct(r.change_7d)} → ×${m.momentum_mult}</span></div>
        <div class="mrow"><span>age factor</span><span class="mtrack"><span class="mfill" style="width:${(m.age_days_used / 1095 * 100).toFixed(1)}%"></span></span><span class="mval">${r.age_days == null ? 'unknown age' : r.age_days + 'd'} → ×${m.age_mult}</span></div>
        <div class="mrow"><span>token odds</span><span class="mtrack"><span class="mfill v" style="width:${(r.token_odds * 100).toFixed(1)}%"></span></span><span class="mval">${Math.round(r.token_odds * 100)}%</span></div>
        <p class="msum">The fit was tested on data it never saw: held-out median error <b>${rep.folds[0].median_abs_err_pct}%</b> and <b>${rep.folds[1].median_abs_err_pct}%</b> across two folds — the honest spread of predicting a market cap from a TVL. The odds fit reads all ${rep.odds.n} protocols (base rate ${Math.round(rep.odds.base_rate * 100)}% record a token). Calibration sets the watchlist's median expected value to the snapshot's own ${money(R.floor_usd)} floor; <b>${calib.watchlist_above_floor}/${calib.watchlist_size}</b> watchlist rows land at or above it. Nothing is special-cased by name.</p>
        <div class="peers" aria-label="peers">${peerRows}</div>
        <p class="msum" style="margin-top:12px">The comps the market quotes — median mcap/TVL per category, shrunk toward the global median when a category has few peers:</p>
        <div class="peers" aria-label="comps" style="margin-top:4px">${compTable}</div>
      </div>
    </section>
    <section class="panel" aria-label="the farm plan">
      <h2>Farm plan — ${r.plan.length} steps, before a token</h2>
      <div class="bd">
        <div class="vline"><b>${r.verdict.label}</b>${esc(r.verdict.text)}</div>
        ${r.plan.map((s, i) => `<div class="dstep"><span class="sno">${String(i + 1).padStart(2, '0')}</span><span class="stx">${esc(s.text)}</span><span><span class="chip cost">${esc(s.cost)}</span> <span class="chip">${esc(s.time)}</span></span></div>`).join('')}
      </div>
    </section>
  </div>`;
}

/* ---------- the KPI strip ---------- */
function kpisHtml() {
  const k = rep.counts;
  const f = rep.fit;
  const cal = rep.calibration;
  return `
  <div class="kpi"><div class="l">scanned</div><div class="v">${k.scanned}</div><div class="s">${k.no_token} record no token · ${k.tokened} trade</div></div>
  <div class="kpi"><div class="l">ranked here</div><div class="v">${k.board}</div><div class="s">${R.watchlist_size} watchlist · ${k.early} our finds</div></div>
  <div class="kpi"><div class="l">fit</div><div class="v">TVL<sup style="font-size:10px">${f.b_tvl}</sup></div><div class="s">on ${f.n} tokened peers, outliers trimmed</div></div>
  <div class="kpi"><div class="l">held-out error</div><div class="v"><em>${rep.folds[0].median_abs_err_pct}%</em> / ${rep.folds[1].median_abs_err_pct}%</div><div class="s">two folds, median abs, never seen in fit</div></div>
  <div class="kpi"><div class="l">token odds</div><div class="v">${Math.round(rep.odds.base_rate * 100)}%</div><div class="s">base rate · logistic fit, all ${rep.odds.n}</div></div>
  <div class="kpi"><div class="l">floor calibrated</div><div class="v">${money(R.floor_usd).replace('$', '$')}</div><div class="s">watchlist median · ${cal.watchlist_above_floor}/${cal.watchlist_size} over it</div></div>`;
}

/* ---------- the render ---------- */
function render() {
  const day = R.as_of.slice(8, 10);
  $('#mver').textContent = R.model_version;
  $('#meta').innerHTML = `SHEET <b>${day}</b> · SNAPSHOT ${R.as_of} · <b>${R.watchlist_size}</b> WATCHLIST · ${R.board_size} ROWS · RANKED BY EXPECTED LAUNCH VALUE`;
  $('#kpis').innerHTML = kpisHtml();
  $('#meth').innerHTML =
    `<b>The model, fitted and tested.</b> launch value = TVL^${rep.fit.b_tvl} × momentum × age, an ordinary-least-squares fit on the snapshot's tokened protocols (the ${rep.fit.n} cleanest of ${rep.counts.tokened}, two outlier-trim passes), tested held-out twice: fold errors ${rep.folds[0].median_abs_err_pct}% and ${rep.folds[1].median_abs_err_pct}%. ` +
    `A logistic fit over all ${rep.odds.n} protocols gives the odds a token ever comes; the board ranks <b>expected value = launch value × odds</b>. One calibration multiplier (${rep.calibration.multiplier}) sets the watchlist's median to the snapshot's own ${money(R.floor_usd)} floor. ` +
    `Circled ranks are the desk's picks. Verdicts grade the farm plan on the board's own curve. "Pre-token" is what DefiLlama records today, never proof a token does not exist — an estimate, never a promise.`;
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
}

route();
