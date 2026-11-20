/* Token Launch Radar — renders the board, the filters and each protocol's detail view from data.js.
   No network, no framework: everything comes from window.RADAR, which main.ts wrote. */

const R = window.RADAR;
const $ = (sel, el) => (el || document).querySelector(sel);
const view = $('#view');

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
const maxImplied = Math.max(...R.rows.map((r) => r.implied_value_usd));
const minImplied = Math.min(...R.rows.map((r) => r.implied_value_usd));
const maxTvl = Math.max(...R.rows.map((r) => r.tvl_usd));
const LOG_SPAN = Math.log(maxImplied) - Math.log(minImplied);
/** The signal bar's width: implied value on a log scale against the board's leader. */
const sigW = (v) => 6 + 94 * (Math.log(v) - Math.log(minImplied)) / LOG_SPAN;
/** The watchlist floor's position on the same scale, clamped to the bar's left edge. */
const floorW = Math.max(0, 6 + 94 * (Math.log(Math.max(R.floor_usd, minImplied)) - Math.log(minImplied)) / LOG_SPAN);
const tick = `<span class="tick" style="left:${floorW.toFixed(1)}%"></span>`;
const signal = (v) => `<span class="track"><span class="fill" style="width:${sigW(v).toFixed(1)}%"></span>${tick}</span>`;
const dirPct = (v) => (v == null ? '—' : `<span class="${v >= 0 ? 'up' : 'down'}">${pct(v)}</span>`);

/** The desk's picks: watchlist rows with positive momentum, oldest no-token run first. */
const picks = new Set(
  R.rows.filter((r) => r.on_watchlist && (r.change_7d ?? -1) > 0).sort((a, b) => (b.age_days ?? 0) - (a.age_days ?? 0)).slice(0, 4).map((r) => r.slug),
);

/** The board's most common categories: three chips the desk reads most. */
const topCats = [...R.rows.reduce((m, r) => { if (r.category) m.set(r.category, (m.get(r.category) || 0) + 1); return m; }, new Map())]
  .sort((a, b) => b[1] - a[1]).slice(0, 3).map((e) => e[0]);

/* ---------- state and routing ---------- */
const FILTERS = [
  { key: 'watchlist', label: 'watchlist', n: R.watchlist_size, hot: true, on: true, test: (r) => r.on_watchlist },
  { key: 'early', label: 'below floor', n: R.early_size, hot: false, on: false, test: (r) => !r.on_watchlist },
  { key: 'floor', label: `TVL ≥ ${money(R.floor_usd)}`, n: null, hot: false, on: true, test: (r) => r.tvl_usd >= R.floor_usd },
  { key: 'growing', label: 'growing 7d', n: null, hot: false, on: false, test: (r) => (r.change_7d ?? -1) > 0 },
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
  if (r.model.momentum_capped) return 'momentum capped +99%';
  if (!r.on_watchlist) return 'below-floor find';
  if (r.model.comp_source === 'global') return `global comp ×${r.model.comp_multiple}`;
  if (r.model.age_multiplier >= 1.24) return `age premium ×${r.model.age_multiplier}`;
  if (r.model.comp_multiple >= 0.3) return `rich comp ×${r.model.comp_multiple}`;
  return '';
}

function filterRows() {
  const active = FILTERS.filter((f) => f.on && f.test);
  const cmp = {
    rank: (a, b) => (a.rank - b.rank) * state.dir,
    name: (a, b) => a.name.localeCompare(b.name) * state.dir,
    tvl: (a, b) => (a.tvl_usd - b.tvl_usd) * state.dir,
    ch7: (a, b) => ((a.change_7d ?? -999) - (b.change_7d ?? -999)) * state.dir,
    age: (a, b) => ((a.age_days ?? -1) - (b.age_days ?? -1)) * state.dir,
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
    <td><span class="iv">${money(r.implied_value_usd)}</span>${signal(r.implied_value_usd)}<span class="mult">×${(r.implied_value_usd / r.tvl_usd).toFixed(1)}</span></td>
    <td class="note">${esc(noteFor(r))}</td>
    <td class="num fm">${farmCell(r)}</td>
  </tr>`;
}

const HEADS = [
  ['rk', 'rk'], ['protocol', 'protocol'], ['tvl', 'tvl', 'num'], ['7d', 'ch7', 'num'],
  ['age', 'age', 'num'], ['implied value', 'implied'], ['model note', null], ['farm', null, 'num'],
];

function boardHtml() {
  const rows = filterRows();
  const leader = rows[0];
  const live = FILTERS.find((f) => f.key === 'live').on;
  const filters = FILTERS.map((f) =>
    `<button type="button" class="${f.hot ? 'hot' : ''}" aria-pressed="${f.on}" data-key="${f.key}">${f.label}${f.n != null ? ` <span class="n">×${f.n}</span>` : ''}</button>`).join('');
  const sortArrow = (key) => (state.sort === key ? `<span class="arr">${state.dir > 0 ? '▲' : '▼'}</span>` : '');
  const widths = [38, '', 92, 74, 74, 200, 128, 300];
  const thead = live
    ? '<tr><th>rk</th><th>protocol</th><th class="num">mcap</th><th class="num">tvl</th><th class="num">7d</th><th>mcap / tvl</th><th>what it is</th></tr>'
    : `<tr>${HEADS.map(([label, key, cls], i) => `<th${cls || key ? ` class="${[cls, key ? 'sortable' : ''].filter(Boolean).join(' ')}"` : ''}${key ? ` data-sort="${key}"` : ''}${widths[i] ? ` style="width:${widths[i]}px"` : ''}>${label}${key ? sortArrow(key) : ''}</th>`).join('')}</tr>`;
  const body = live
    ? R.live.map((p, i) => `<tr><td class="rk">${String(i + 1).padStart(2, '0')}</td><td><span class="nm">${esc(p.name)}</span><span class="ct">${esc((p.category || '—').toLowerCase())}</span></td><td class="num">${money(p.mcap_usd)}</td><td class="num">${money(p.tvl_usd)}</td><td class="num">${dirPct(p.change_7d)}</td><td><span class="iv">×${p.mc_tvl.toFixed(2)}</span>${signal(p.mc_tvl * 1e9)}</td><td class="fm">trades today — the market's own value, never the model's</td></tr>`).join('')
    : rows.slice(1).map(rowHtml).join('');
  return `
  ${leader ? leadHtml(leader, live) : '<div class="lead" style="display:none"></div>'}
  <div class="filters" role="group" aria-label="filters" style="grid-template-columns:repeat(${FILTERS.length},1fr)">${filters}</div>
  <table aria-label="the board">${thead}<tbody>${body}</tbody></table>
  <p class="count">${live ? `${R.live_size} protocols already trade — the board itself ranks only the pre-token ${R.board_size}.` : `${rows.length} of ${R.board_size} rows shown · every watchlist slug is on the board · ranks 1–${R.board_size} by implied value`}</p>`;
}

function leadHtml(leader, live) {
  if (live) return '';
  const m = leader.model;
  const compLab = m.comp_source === 'category' ? 'category comp' : 'global comp';
  return `<section class="lead" aria-label="the leader">
    <span class="leadkey">№ 1 — this view's sheet</span>
    <div class="who">
      <div class="nm"><a href="#/p/${encodeURIComponent(leader.slug)}">${esc(leader.name)}</a></div>
      <div class="ct">${esc((leader.category || '—').toLowerCase())} · ${leader.chains.slice(0, 2).map(esc).join(', ').toLowerCase()}${leader.chains.length > 2 ? `, +${leader.chains.length - 2} chains` : ''} · ${leader.on_watchlist ? 'watchlist' : 'our find'} · ${leader.age_days == null ? 'new' : leader.age_days + 'd'} with no token</div>
      <div class="big">${money(leader.implied_value_usd)}</div>
      <div class="biglab">IMPLIED LAUNCH VALUE · ×${(leader.implied_value_usd / leader.tvl_usd).toFixed(1)} TVL</div>
      <div class="model">
        <div class="mrow"><span>TVL base</span><span class="mtrack"><span class="mfill" style="width:${(leader.tvl_usd / maxTvl * 100).toFixed(1)}%"></span></span><span class="mval">${money(leader.tvl_usd)}</span></div>
        <div class="mrow"><span>${compLab}</span><span class="mtrack"><span class="mfill" style="width:${(m.comp_multiple / R.model.comp_max * 100).toFixed(1)}%"></span></span><span class="mval">×${m.comp_multiple}</span></div>
        <div class="mrow"><span>momentum, 7d</span><span class="mtrack"><span class="mfill v" style="width:${((m.momentum_pct - R.model.momentum_floor_pct) / (R.model.momentum_cap_pct - R.model.momentum_floor_pct) * 100).toFixed(1)}%"></span></span><span class="mval">${pct(leader.change_7d)}</span></div>
        <div class="mrow"><span>age premium</span><span class="mtrack"><span class="mfill v" style="width:${(m.age_days_used / R.model.age_cap_days * 100).toFixed(1)}%"></span></span><span class="mval">×${m.age_multiplier}</span></div>
      </div>
    </div>
    <div class="plan">
      <h2>Farm plan — before a token</h2>
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
  const compTable = R.comps.slice().sort((a, b) => b.samples - a.samples).slice(0, 5).map((c) =>
    `<div class="peer"><span>${esc(c.category.toLowerCase())}</span><span class="mtrack"><span class="mfill" style="width:${(c.median_mc_tvl / R.model.comp_max * 100).toFixed(1)}%"></span></span><span>×${c.median_mc_tvl.toFixed(2)}</span></div>`).join('');
  const compLine = m.comp_source === 'category'
    ? `${esc((r.category || 'this category').toLowerCase())} protocols already trade at a <b>×${m.comp_multiple}</b> mcap/TVL median (${m.comp_samples} tokened peers in the snapshot)`
    : `no tokened peer exists for ${esc((r.category || 'this category').toLowerCase())}, so the model reads the snapshot's global median <b>×${m.comp_multiple}</b> (${m.comp_samples} tokened protocols)`;
  const capLine = m.momentum_capped ? ' A >+99% week is capped, so one spike cannot carry the whole board.' : '';
  const boardNo = R.rows.findIndex((x) => x.slug === r.slug) + 1;
  return `
  <div class="crumb">
    <a href="#">← back to the board</a>
    <div class="pos">row <b>${boardNo} of ${R.board_size}</b> on the sheet · rank <b>${r.rank}</b> by implied value · ${r.on_watchlist ? 'on the watchlist' : 'our find, below the floor'}</div>
  </div>
  <div class="dhead">
    <div>
      <div class="nm">${esc(r.name)}<span class="tg ${r.on_watchlist ? 'wl' : 'ex'}">${r.on_watchlist ? 'WL' : 'FIND'}</span></div>
      <div class="ct">${esc((r.category || '—').toLowerCase())} · ${r.chains.slice(0, 3).map(esc).join(' · ').toLowerCase()}${r.chains.length > 3 ? ` · +${r.chains.length - 3}` : ''} · tracked ${r.age_days == null ? 'since an unknown date, no token recorded' : `${r.age_days} days, no token recorded`}</div>
    </div>
    <div class="statrow">
      <div><b>${money(r.tvl_usd)}</b>TVL</div>
      <div><b>${r.change_7d == null ? '—' : pct(r.change_7d)}</b>7-day</div>
      <div><b>${r.age_days == null ? 'new' : r.age_days + 'd'}</b>no-token age</div>
      <div class="v"><b>${money(r.implied_value_usd)}</b>implied launch value</div>
      <div><b>×${(r.implied_value_usd / r.tvl_usd).toFixed(1)}</b>value / TVL</div>
    </div>
  </div>
  <div class="cols">
    <section class="panel" aria-label="the value model">
      <h2>The value model — how ${money(r.implied_value_usd)} is built</h2>
      <div class="bd">
        <div class="formula">TVL <b>× comp ×</b> (1 + 7-day momentum × ${R.model.momentum_weight}) <b>× (1 + age × ${R.model.age_weight})</b> — inputs from the snapshot only</div>
        <div class="mrow"><span>TVL base</span><span class="mtrack"><span class="mfill" style="width:${(r.tvl_usd / maxTvl * 100).toFixed(1)}%"></span></span><span class="mval">${money(r.tvl_usd)}</span></div>
        <div class="mrow"><span>comp multiple</span><span class="mtrack"><span class="mfill" style="width:${(m.comp_multiple / R.model.comp_max * 100).toFixed(1)}%"></span></span><span class="mval">×${m.comp_multiple}</span></div>
        <div class="mrow"><span>momentum, 7d</span><span class="mtrack"><span class="mfill v" style="width:${((m.momentum_pct - R.model.momentum_floor_pct) / (R.model.momentum_cap_pct - R.model.momentum_floor_pct) * 100).toFixed(1)}%"></span></span><span class="mval">${pct(r.change_7d)}</span></div>
        <div class="mrow"><span>age premium</span><span class="mtrack"><span class="mfill v" style="width:${(m.age_days_used / R.model.age_cap_days * 100).toFixed(1)}%"></span></span><span class="mval">×${m.age_multiplier}</span></div>
        <p class="msum">${compLine}${capLine} Every input is this snapshot's own figure; nothing is special-cased by name.</p>
        <div class="peers" aria-label="peers">${peerRows}</div>
        <p class="msum" style="margin-top:14px">The comps the model reads — median mcap/TVL per category, ${R.global_comp.samples} tokened protocols in all:</p>
        <div class="peers" aria-label="comps" style="margin-top:4px">${compTable}</div>
      </div>
    </section>
    <section class="panel" aria-label="the farm plan">
      <h2>Farm plan — ${r.plan.length} steps, before a token</h2>
      <div class="bd">
        ${r.plan.map((s, i) => `<div class="dstep"><span class="sno">${String(i + 1).padStart(2, '0')}</span><span class="stx">${esc(s.text)}</span><span class="side"><span class="chip cost">${esc(s.cost)}</span> <span class="chip">${esc(s.time)}</span></span></div>`).join('')}
      </div>
    </section>
  </div>`;
}

/* ---------- the render ---------- */
function render() {
  const day = R.as_of.slice(8, 10);
  $('#mver').textContent = R.model_version;
  $('#meta').innerHTML = `SHEET <b>${day}</b> · SNAPSHOT ${R.as_of} · ${R.scanned} SCANNED · <b>${R.watchlist_size}</b> WATCHLIST · ${R.board_size} ROWS`;
  $('#meth').innerHTML =
    `<b>The model, stated.</b> implied = TVL × category comp × (1 + 7-day momentum × ${R.model.momentum_weight}) × (1 + no-token age × ${R.model.age_weight}). ` +
    `The comp is the snapshot's own median mcap/TVL per category — global ×${R.global_comp.median_mc_tvl} across ${R.global_comp.samples} tokened protocols when a category has fewer than ${R.model.comp_min_samples} peers. ` +
    `Nothing is special-cased by name; "pre-token" is what DefiLlama records today, never proof a token does not exist. Circled ranks are the desk's picks: watchlist rows with positive momentum, oldest run first. ` +
    `An estimate of a first token at today's fundamentals, never a claim that a launch comes.`;
  view.innerHTML = state.view === 'detail' ? detailHtml(R.rows.find((r) => r.slug === state.slug) || R.rows[0]) : boardHtml();

  for (const b of view.querySelectorAll('.filters button')) {
    b.addEventListener('click', () => {
      const f = FILTERS.find((x) => x.key === b.dataset.key);
      if (f.key === 'live') {
        f.on = !f.on;
      } else {
        f.on = !f.on;
        setFilters();
      }
      render();
    });
  }
  for (const th of view.querySelectorAll('th.sortable')) {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (state.sort === key) state.dir = -state.dir;
      else { state.sort = key; state.dir = key === 'rank' ? 1 : 1; }
      render();
    });
  }
}

route();
