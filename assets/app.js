/* ==========================================================================
   城市天气数据工作台 · 前端
   三段式：① 选 → ② 抓（显式提交）→ ③ 看
   ========================================================================== */
'use strict';

const API = {
  health: '/api/health',
  weather: '/api/weather',
  baseline: '/api/baseline',
  geocode: '/api/geocode',
};

const CITY_COLORS = ['#C8553D', '#2E6F95', '#6A8E3A', '#8E5A9E', '#C08A2E', '#3F7F6E',
                     '#A0522D', '#4A6FA5', '#7D8C3A', '#9B5E8C', '#B5762E', '#2F6E6E'];

const VAR_META = {
  tmean: { unit: '℃', type: 'line' },
  tmax:  { unit: '℃', type: 'line' },
  tmin:  { unit: '℃', type: 'line' },
  dtr:   { unit: '℃', type: 'line' },
  prcp:  { unit: 'mm', type: 'bar' },
};

const varLabel = k => T(`var.${k}`);
const varTitle = k => T(`vartitle.${k}`);

const state = {
  presets: [],
  selected: [],          // [{name, group, lat, lon}]
  days: 30,
  varKey: 'tmean',
  data: null,
  baseline: null,
  sort: { key: 'tmean_mean', dir: 'desc' },
  busy: false,
  charts: {},
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const fmt = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v)) ? '—' : Number(v).toFixed(d);

const T = (k, v) => WB.t(k, v);

/* 城市显示名：英文界面查预置表的 en，查不到就回退中文（搜索加进来的城市常见） */
const dn = (name) => {
  if (WB.lang !== 'en') return name;
  const p = state.presets.find(x => x.name === name);
  return (p && p.en) || name;
};

/* 图表配色：跟随主题；切主题时整图重绘一次 */
const PAL = () => document.documentElement.dataset.theme === 'dark' ? {
  axis: 'rgba(222,231,239,.26)', label: 'rgba(222,231,239,.62)', labelStrong: 'rgba(222,231,239,.78)',
  grid: 'rgba(222,231,239,.06)', split: 'rgba(222,231,239,.05)',
  tipBg: 'rgba(20,29,38,.97)', tipBorder: 'rgba(222,231,239,.26)', tipText: '#DEE7EF',
  tipHead: 'rgba(222,231,239,.55)', tipSub: 'rgba(222,231,239,.42)',
  mapArea: '#18222C', mapBorder: 'rgba(222,231,239,.26)', mapAreaHi: '#20303D',
  scsArea: '#161F29', scsBorder: 'rgba(222,231,239,.2)',
  dotHollow: '#141D26', dotHollowBorder: 'rgba(222,231,239,.45)',
  frame: 'rgba(222,231,239,.32)',
  corr: ['#5B3A38', '#1B2631', '#2C4A5E', '#417C9E', '#7FB4D6'], corrBorder: '#141D26',
  boxFill: 'rgba(127,180,214,.15)', boxBorder: 'rgba(222,231,239,.48)',
  pos: '#E4735A', neg: '#7FB4D6', shadow: '2px 2px 0 rgba(0,0,0,.55)',
} : {
  axis: 'rgba(15,42,61,.22)', label: 'rgba(15,42,61,.6)', labelStrong: 'rgba(15,42,61,.75)',
  grid: 'rgba(15,42,61,.045)', split: 'rgba(15,42,61,.055)',
  tipBg: 'rgba(247,249,250,.98)', tipBorder: 'rgba(15,42,61,.55)', tipText: '#0F2A3D',
  tipHead: 'rgba(15,42,61,.55)', tipSub: 'rgba(15,42,61,.45)',
  mapArea: '#EFF3F6', mapBorder: 'rgba(15,42,61,.40)', mapAreaHi: '#E3EAEE',
  scsArea: '#F1F4F6', scsBorder: 'rgba(15,42,61,.34)',
  dotHollow: '#F7F9FA', dotHollowBorder: 'rgba(15,42,61,.5)',
  frame: 'rgba(15,42,61,.42)',
  corr: ['#E8D5CF', '#F2F5F7', '#BBD3E2', '#6E9FBF', '#2E6F95'], corrBorder: '#F7F9FA',
  boxFill: 'rgba(46,111,149,.16)', boxBorder: 'rgba(15,42,61,.55)',
  pos: '#C8553D', neg: '#2E6F95', shadow: '2px 2px 0 rgba(15,42,61,.14)',
};

/* ---------------------------------------------------------------- 启动 */
async function init() {
  bindEvents();
  buildSegments();

  try {
    const r = await fetch(API.health);
    const h = await r.json();
    state.presets = h.presets || [];
  } catch {
    state.presets = [
      { name: '广州', group: '华南', lat: 23.1291, lon: 113.2644 },
      { name: '深圳', group: '华南', lat: 22.5431, lon: 114.0579 },
      { name: '汕头', group: '华南', lat: 23.3540, lon: 116.6819 },
      { name: '上海', group: '华东', lat: 31.2304, lon: 121.4737 },
      { name: '北京', group: '华北', lat: 39.9042, lon: 116.4074 },
    ];
  }

  renderGroups();
  initMap();

  const params = new URLSearchParams(location.search);
  const urlCities = (params.get('cities') || '').split(/[,，]/).map(s => s.trim()).filter(Boolean);
  const urlDays = Number(params.get('days'));
  const urlVar = params.get('var');
  if ([7, 30, 90].includes(urlDays)) state.days = urlDays;
  if (VAR_META[urlVar]) state.varKey = urlVar;
  syncSegments();

  if (urlCities.length) {
    for (const n of urlCities.slice(0, 5)) {
      const p = state.presets.find(x => x.name === n);
      if (p) { addCity(p, true); continue; }
      // 非预置城市：查一次坐标，才能在地图上落点
      try {
        const d = await (await fetch(`${API.geocode}?q=${encodeURIComponent(n)}`)).json();
        const hit = (d.results || [])[0];
        addCity(hit
          ? { name: hit.name, group: '自选', lat: hit.lat, lon: hit.lon }
          : { name: n, group: '自选', lat: null, lon: null }, true);
      } catch {
        addCity({ name: n, group: '自选', lat: null, lon: null }, true);
      }
    }
  }

  renderChips();
  refreshFetchState();
  if (!state.selected.length) setStatus('idle', 'status.none');
  if (urlCities.length) fetchData(false);
}

function bindEvents() {
  $('#btn-fetch').addEventListener('click', () => fetchData(false));
  $('#btn-map-reset').addEventListener('click', resetMapView);
  $('#btn-force').addEventListener('click', () => fetchData(true));

  $$('#seg-days button').forEach(b => b.addEventListener('click', () => {
    state.days = Number(b.dataset.days);
    syncSegments();
    markDirty();
  }));

  $$('#seg-var button').forEach(b => b.addEventListener('click', () => {
    state.varKey = b.dataset.var;
    syncSegments();
    if (state.data) renderMain();
    markDirty();
  }));

  const input = $('#city-search');
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) { hideResults(); return; }
    timer = setTimeout(() => searchCity(q), 280);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { hideResults(); input.blur(); }
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.search')) hideResults();
  });
}

function buildSegments() {
  const days = $('#seg-days');
  days.innerHTML = [7, 30, 90].map(d =>
    `<button data-days="${d}"${d === state.days ? ' class="is-on"' : ''}>${T('unit.days', { n: d })}</button>`).join('');
  days.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    state.days = Number(b.dataset.days);
    syncSegments();
    markDirty();
  }));

  const vars = $('#seg-var');
  vars.innerHTML = Object.entries(VAR_META).map(([k, v]) =>
    `<button data-var="${k}"${k === state.varKey ? ' class="is-on"' : ''}>${varLabel(k)}</button>`).join('');
  vars.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    state.varKey = b.dataset.var;
    syncSegments();
    if (state.data) renderMain();
    markDirty();
  }));
}

function syncSegments() {
  $$('#seg-days button').forEach(b => b.classList.toggle('is-on', Number(b.dataset.days) === state.days));
  $$('#seg-var button').forEach(b => b.classList.toggle('is-on', b.dataset.var === state.varKey));
}

/* ---------------------------------------------------------------- 城市 */
function renderGroups() {
  const groups = {};
  state.presets.forEach(p => (groups[p.group] ||= []).push(p));
  const el = $('#city-groups');
  el.innerHTML = Object.entries(groups).map(([g, list]) => {
    const gname = WB.lang === 'en' ? (list[0].group_en || g) : g;
    return `
    <div class="group">
      <span class="group__name">${gname}</span>
      ${list.map(p => `<button class="chip" data-city="${p.name}">${dn(p.name)}</button>`).join('')}
    </div>`;
  }).join('');
  el.querySelectorAll('.chip').forEach(b => b.addEventListener('click', () => {
    const p = state.presets.find(x => x.name === b.dataset.city);
    toggleCity(p);
  }));
}

function isSelected(name) { return state.selected.some(c => c.name === name); }

function addCity(city, silent = false) {
  if (isSelected(city.name)) return;
  if (state.selected.length >= 5) {
    setStatus('error', 'status.max');
    return;
  }
  state.selected.push({ ...city });
  renderChips();
  refreshFetchState();
  if (!silent) markDirty();
}

function removeCity(name) {
  state.selected = state.selected.filter(c => c.name !== name);
  renderChips();
  refreshFetchState();
  markDirty();
}

function toggleCity(city) {
  if (!city) return;
  isSelected(city.name) ? removeCity(city.name) : addCity(city);
}

function renderChips() {
  const el = $('#selected-chips');
  el.innerHTML = state.selected.length
    ? state.selected.map(c => `<button class="chip is-on" data-del="${c.name}" title="${T('chip.remove')}">${dn(c.name)}</button>`).join('')
    : `<span class="hint" style="border:0;padding:0">${T('chip.none')}</span>`;
  el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => removeCity(b.dataset.del)));

  $('#sel-count').textContent = `${state.selected.length} / 5`;
  $$('#city-groups .chip').forEach(b => b.classList.toggle('is-on', isSelected(b.dataset.city)));
  updateMap();
}

function refreshFetchState() {
  $('#btn-fetch').disabled = state.selected.length === 0 || state.busy;
  $('#btn-force').disabled = state.selected.length === 0 || state.busy;
  if (!state.data && state.selected.length) {
    setStatus('idle', 'status.selected', { n: state.selected.length });
  }
}

function markDirty() {
  if (!state.data) return;
  const same = state.data.meta.days === state.days &&
    state.data.cities.length === state.selected.length &&
    state.data.cities.every(c => isSelected(c.name));
  if (!same) setStatus('idle', 'status.dirty');
}

/* ---------------------------------------------------------------- 搜索 */
async function searchCity(q) {
  const ul = $('#search-results');
  ul.hidden = false;
  ul.innerHTML = `<li class="none">${T('search.loading')}</li>`;
  try {
    const r = await fetch(`${API.geocode}?q=${encodeURIComponent(q)}&lang=${WB.lang}`);
    const d = await r.json();
    const list = d.results || [];
    if (!list.length) {
      ul.innerHTML = `<li class="none">${T('search.none', { q })}</li>`;
      return;
    }
    ul.innerHTML = list.map((x, i) => `
      <li data-i="${i}" role="option">
        <span>${x.name}</span>
        <small>${x.admin || ''} ${x.lat.toFixed(2)}, ${x.lon.toFixed(2)}</small>
      </li>`).join('');
    ul.querySelectorAll('li[data-i]').forEach(li => li.addEventListener('click', () => {
      const x = list[Number(li.dataset.i)];
      addCity({ name: x.name, group: '自选', lat: x.lat, lon: x.lon });
      $('#city-search').value = '';
      hideResults();
    }));
  } catch {
    ul.innerHTML = `<li class="none">${T('search.error')}</li>`;
  }
}

function hideResults() {
  const ul = $('#search-results');
  ul.hidden = true;
  ul.innerHTML = '';
}

/* ---------------------------------------------------------------- 地图 */
async function initMap() {
  const el = $('#map');
  state.charts.map = echarts.init(el, null, { renderer: 'canvas' });

  try {
    const [main, scs] = await Promise.all([
      fetch('assets/vendor/map_main.json').then(r => r.json()),
      fetch('assets/vendor/map_scs.json').then(r => r.json()),
    ]);
    echarts.registerMap('china_main', main);   // 34 个省级行政区（18°N 以北）
    echarts.registerMap('china_scs', scs);     // 南海诸岛 + 九段线（用于右下角插图）
    state.mapReady = true;
  } catch {
    state.mapReady = false;
  }

  drawMap();

  const relayout = () => {
    if (!state.charts.map) return;
    state.charts.map.resize();
    drawFrame();
  };
  window.addEventListener('resize', relayout);
  if (window.ResizeObserver) new ResizeObserver(relayout).observe(el);
}

/* 南海诸岛插图的边框：按 geo[1] 的实际像素位置画，窗口变化时重算 */
function drawFrame() {
  const c = state.charts.map;
  if (!c || !state.mapReady) return;
  const a = c.convertToPixel({ geoIndex: 1 }, [105.2, 25.0]);
  const b = c.convertToPixel({ geoIndex: 1 }, [124.0, 3.0]);
  if (!a || !b) return;
  const x = Math.min(a[0], b[0]);
  const y = Math.min(a[1], b[1]);
  c.setOption({
    graphic: [{
      type: 'rect',
      left: x - 1,
      top: y - 1,
      shape: { width: Math.abs(a[0] - b[0]) + 2, height: Math.abs(a[1] - b[1]) + 2 },
      style: { fill: 'none', stroke: PAL().frame, lineWidth: 0.8 },
      silent: true,
      z: 5,
    }],
  });
}

function drawMap() {
  const chart = state.charts.map;
  if (!chart) return;
  const ready = state.mapReady && !!echarts.getMap('china_main');

  // 所有预置城市都上图：已选实心，未选空心——地图本身就是选择器
  const LABEL_POS = { 广州: 'left', 深圳: 'bottom', 汕头: 'right', 上海: 'right', 北京: 'right', 香港: 'right', 澳门: 'bottom' };
  // 预置 36 城 + 搜索加进来但不在预置里的城市，都要落点
  const all = [...state.presets];
  state.selected.forEach(c => {
    if (c.lat !== null && c.lon !== null && !all.some(x => x.name === c.name)) all.push(c);
  });
  const points = all.map(p => {
    const on = isSelected(p.name);
    const idx = state.selected.findIndex(c => c.name === p.name);
    const color = on ? CITY_COLORS[idx % CITY_COLORS.length] : PAL().dotHollow;
    return {
      name: p.name,
      value: [p.lon, p.lat],
      symbolSize: on ? 10 : 6,
      itemStyle: {
        color,
        borderColor: on ? PAL().dotHollow : PAL().dotHollowBorder,
        borderWidth: on ? 1.5 : 1.1,
      },
      label: { show: on, position: LABEL_POS[p.name] || 'right' },
    };
  });

  chart.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      backgroundColor: PAL().tipBg,
      borderColor: PAL().tipBorder,
      borderWidth: 1,
      textStyle: { color: PAL().tipText, fontSize: 11, fontFamily: 'Plex Mono, monospace' },
      formatter: p => p.componentType === 'series'
        ? `${dn(p.name)}　${isSelected(p.name) ? T('tip.sel') : T('tip.unsel')}<br/>`
          + `${p.value[0].toFixed(2)}°E, ${p.value[1].toFixed(2)}°N`
        : p.name,
    },
    geo: ready ? [
      {
        map: 'china_main',
        roam: true,
        scaleLimit: { min: 0.8, max: 8 },
        center: [104.5, 36.5],
        zoom: 1.14,
        aspectScale: 0.78,
        itemStyle: { areaColor: PAL().mapArea, borderColor: PAL().mapBorder, borderWidth: 0.7 },
        emphasis: { itemStyle: { areaColor: PAL().mapAreaHi }, label: { show: false } },
        label: { show: false },
        silent: true,
      },
      {
        map: 'china_scs',
        roam: false,
        layoutCenter: ['88%', '86%'],
        layoutSize: '15%',
        itemStyle: { areaColor: PAL().scsArea, borderColor: PAL().scsBorder, borderWidth: 0.7 },
        label: { show: false },
        silent: true,
        z: 3,
      },
    ] : undefined,
    grid: ready ? undefined : { left: 40, right: 20, top: 20, bottom: 30 },
    xAxis: ready ? undefined : {
      type: 'value', min: 73, max: 135, axisLabel: { show: false },
      splitLine: { lineStyle: { color: 'rgba(15,42,61,.04)' } },
    },
    yAxis: ready ? undefined : {
      type: 'value', min: 17, max: 54, axisLabel: { show: false },
      splitLine: { lineStyle: { color: 'rgba(15,42,61,.04)' } },
    },
    series: [{
      type: 'scatter',
      coordinateSystem: ready ? 'geo' : 'cartesian2d',
      geoIndex: 0,
      data: points,
      label: {
        show: true,
        formatter: p => dn(p.name),
        position: 'right',
        distance: 5,
        fontSize: 10,
        fontFamily: 'Plex Mono, monospace',
        color: PAL().labelStrong,
      },
      labelLayout: { hideOverlap: true },
      emphasis: { scale: 1.5 },
      z: 10,
    }],
  }, true);

  chart.off('click');
  chart.on('click', p => {
    if (p.componentType !== 'series') return;
    const city = state.selected.find(c => c.name === p.name)
      || state.presets.find(c => c.name === p.name);
    if (city) toggleCity(city);
  });

  requestAnimationFrame(drawFrame);
}

function updateMap() { drawMap(); }

function resetMapView() {
  const chart = state.charts.map;
  if (!chart) return;
  chart.dispatchAction({ type: 'restore' });   // 回到 setOption 时的初始视图
  drawMap();
}

/* ---------------------------------------------------------------- 抓取 */
async function fetchData(force) {
  if (!state.selected.length || state.busy) return;
  state.busy = true;
  refreshFetchState();

  const t0 = performance.now();
  const timer = setInterval(() => {
    $('#status-timer').textContent = `${((performance.now() - t0) / 1000).toFixed(1)}s`;
  }, 100);
  setStatus('running', force ? 'status.runningForce' : 'status.running');

  const names = state.selected.map(c => c.name).join(',');
  const url = `${API.weather}?cities=${encodeURIComponent(names)}&days=${state.days}${force ? '&force=1' : ''}`;

  try {
    const r = await fetch(url);
    const d = await r.json();
    if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);
    state.data = d;
    state.baseline = null;
    render(d);
    fetchBaseline(d);          // 不阻塞主渲染，回来后再补 KPI 与表格
    const age = d.meta.cache_hit
      ? T('status.cacheHit', { m: Math.round((d.meta.cache_age_s || 0) / 60) })
      : null;
    setStatus('ok', 'status.done', { n: d.cities.length, d: d.meta.days },
      d.meta.cache_hit ? { cache: true, m: Math.round((d.meta.cache_age_s || 0) / 60) } : { cache: false });
    syncURL();
  } catch (e) {
    setStatus('error', 'status.fail', { msg: e.message });
  } finally {
    clearInterval(timer);
    $('#status-timer').textContent = '';
    state.busy = false;
    refreshFetchState();
  }
}

/* 常年值（1991–2020 同期）——慢一点，回来后再补一列 */
async function fetchBaseline(d) {
  const names = d.cities.map(c => c.name).join(',');
  try {
    const r = await fetch(`${API.baseline}?cities=${encodeURIComponent(names)}&days=${d.meta.days}`);
    const b = await r.json();
    if (!b.values) return;
    state.baseline = b;
    renderKpis(state.data);
    renderTable(state.data);
  } catch {
    /* 常年值拿不到就不显示这一列，不影响主流程 */
  }
}

function setStatus(kind, key, vars = {}, ageInfo = null) {
  state.status = { kind, key, vars, ageInfo };
  applyStatus();
}

/* 单独抽出来：语言切换时重译一次，不用重新抓数据 */
function applyStatus() {
  const s = state.status || { kind: 'idle', key: 'status.none', vars: {}, ageInfo: null };
  const el = $('#status');
  if (!el) return;
  el.dataset.state = s.kind;
  let vars = { ...s.vars };
  if (s.ageInfo) {
    vars.age = s.ageInfo.cache ? T('status.cacheHit', { m: s.ageInfo.m }) : T('status.live');
  }
  $('#status-text').textContent = T(s.key, vars);
}

function syncURL() {
  const p = new URLSearchParams();
  p.set('cities', state.selected.map(c => c.name).join(','));
  p.set('days', String(state.days));
  p.set('var', state.varKey);
  history.replaceState(null, '', `?${p.toString()}`);
}

/* ---------------------------------------------------------------- 渲染 */
function render(d) {
  $('#empty').hidden = true;
  $('#read').hidden = false;
  renderKpis(d);
  renderMain();
  renderDtr(d);
  renderCorr(d);
  renderPrcp(d);
  renderTable(d);
  renderProv(d);
}

function renderKpis(d) {
  const cs = d.cities.map(c => ({ ...c, s: c.summary }));
  const warm = cs.reduce((a, b) => (b.s.tmean_mean > a.s.tmean_mean ? b : a));
  const cold = cs.reduce((a, b) => (b.s.tmean_mean < a.s.tmean_mean ? b : a));
  const fastest = cs.reduce((a, b) => (b.s.trend_per10d < a.s.trend_per10d ? b : a));

  // 同期最大温差
  let peak = { v: -1, date: '', warm: '', cold: '' };
  const n = d.cities[0].series.date.length;
  for (let i = 0; i < n; i++) {
    let hi = -Infinity, lo = Infinity, hiN = '', loN = '';
    d.cities.forEach(c => {
      const v = c.series.tmean[i];
      if (v === null) return;
      if (v > hi) { hi = v; hiN = c.name; }
      if (v < lo) { lo = v; loN = c.name; }
    });
    if (hi - lo > peak.v) peak = { v: hi - lo, date: d.cities[0].series.date[i], warm: hiN, cold: loN };
  }

  const b = state.baseline && state.baseline.values;
  const anomalies = b ? cs
    .map(c => ({ name: c.name, v: b[c.name] == null ? null : +(c.s.tmean_mean - b[c.name]).toFixed(1) }))
    .filter(x => x.v !== null) : [];
  const avgAnom = anomalies.length
    ? +(anomalies.reduce((a, x) => a + x.v, 0) / anomalies.length).toFixed(1) : null;
  const maxAnom = anomalies.length
    ? anomalies.reduce((a, x) => (x.v > a.v ? x : a)) : null;

  const kpis = [
    {
      label: T('kpi.cities'),
      value: `${cs.length}<small>${T('unit.city')}</small>`,
      sub: T('kpi.citiesSub', { d: d.meta.days, start: d.meta.start }),
    },
    {
      label: T('kpi.warm'),
      value: `${fmt(warm.s.tmean_mean)}<small>℃</small>`,
      sub: T('kpi.warmSub', { w: dn(warm.name), c: dn(cold.name), v: fmt(cold.s.tmean_mean) }),
      cls: 'kpi--warm',
    },
    {
      label: T('kpi.spread'),
      value: `${fmt(peak.v)}<small>℃</small>`,
      sub: T('kpi.spreadSub', { date: peak.date, w: dn(peak.warm), c: dn(peak.cold) }),
      cls: 'kpi--cool',
    },
    {
      label: T('kpi.cooling'),
      value: `${fmt(fastest.s.trend_per10d, 2)}<small>${T('unit.per10d')}</small>`,
      sub: T('kpi.coolingSub', { c: dn(fastest.name), r: fmt(fastest.s.trend_r2, 2) }),
      cls: fastest.s.trend_per10d < 0 ? 'kpi--cool' : 'kpi--warm',
    },
    {
      label: T('kpi.anom'),
      value: b
        ? `${avgAnom > 0 ? '+' : ''}${fmt(avgAnom)}<small>℃</small>`
        : `…<small>${T('kpi.calc')}</small>`,
      sub: b
        ? T('kpi.anomSub', { p: state.baseline.baseline_period, c: dn(maxAnom.name),
            v: `${maxAnom.v > 0 ? '+' : ''}${maxAnom.v}` })
        : T('kpi.anomSubNone'),
      cls: b ? (avgAnom >= 0 ? 'kpi--warm' : 'kpi--cool') : '',
    },
  ];

  $('#kpis').innerHTML = kpis.map(k => `
    <div class="kpi ${k.cls || ''}">
      <p class="kpi__label">${k.label}</p>
      <p class="kpi__value">${k.value}</p>
      <p class="kpi__sub">${k.sub}</p>
    </div>`).join('');
}

function colorOf(name) {
  const i = state.data ? state.data.cities.findIndex(c => c.name === name) : 0;
  return CITY_COLORS[(i < 0 ? 0 : i) % CITY_COLORS.length];
}

/* 主图：多城曲线 + 竖向读数尺（十字准星 + 等宽读数牌） */
function renderMain() {
  const d = state.data;
  if (!d) return;
  const meta = VAR_META[state.varKey];
  const dates = d.cities[0].series.date;

  if (!state.charts.main) {
    state.charts.main = echarts.init($('#chart-main'), null, { renderer: 'canvas' });
    window.addEventListener('resize', () => state.charts.main && state.charts.main.resize());
  }

  // 末端标签去重叠：末端值太近的系列不标（只标最高、最低和孤立的那条），其余靠 tooltip
  const endVals = d.cities.map(c => {
    const arr = c.series[state.varKey] || [];
    for (let k = arr.length - 1; k >= 0; k--) if (arr[k] !== null) return arr[k];
    return null;
  });
  const order = endVals
    .map((v, i) => ({ v, i }))
    .filter(o => o.v !== null)
    .sort((a, b) => b.v - a.v);
  const showEnd = new Set();
  order.forEach((o, k) => {
    const prev = order[k - 1], next = order[k + 1];
    const gapUp = prev ? Math.abs(prev.v - o.v) : Infinity;
    const gapDown = next ? Math.abs(o.v - next.v) : Infinity;
    // 只标最高、最低两条；其余靠底部图例 + tooltip，避免南三城挤成一坨
    if (k === 0 || k === order.length - 1) showEnd.add(o.i);
  });

  const series = d.cities.map((c, i) => ({
    name: dn(c.name),
    type: meta.type,
    data: c.series[state.varKey],
    symbol: 'circle',
    symbolSize: meta.type === 'line' ? 4 : 0,
    showSymbol: meta.type === 'line' && d.meta.days <= 31,
    smooth: false,
    lineStyle: { width: 1.8, color: CITY_COLORS[i % CITY_COLORS.length] },
    itemStyle: { color: CITY_COLORS[i % CITY_COLORS.length] },
    barMaxWidth: 8,
    barGap: '12%',
    emphasis: { focus: 'series' },
    connectNulls: true,
    // 线末端直接标城市名（比图例少一次眼球往返）
    endLabel: {
      show: meta.type === 'line' && showEnd.has(i),
      formatter: dn(c.name),
      distance: 7,
      fontSize: 10,
      fontFamily: 'Plex Mono, monospace',
      color: CITY_COLORS[i % CITY_COLORS.length],
    },
  }));

  const base = d.cities.map(c => c.series[state.varKey].find(v => v !== null));

  state.charts.main.setOption({
    backgroundColor: 'transparent',
    animationDuration: 380,
    /* 右留白按最长城市名算，英文末端标签才不会被裁 */
    grid: { left: 52, right: Math.max(62, Math.max(...d.cities.map(c => dn(c.name).length)) * 6.4 + 16), top: 26, bottom: 74 },
    legend: {
      type: 'scroll',
      bottom: 4,
      left: 'center',
      itemWidth: 12,
      itemHeight: 2,
      itemGap: 16,
      textStyle: { fontFamily: 'Plex Mono, monospace', fontSize: 10.5, color: PAL().labelStrong },
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'line',
        lineStyle: { color: PAL().axis, width: 1, type: [4, 3] },
        label: { show: false },
      },
      backgroundColor: PAL().tipBg,
      borderColor: PAL().tipBorder,
      borderWidth: 1,
      padding: [9, 12],
      textStyle: { color: PAL().tipText, fontSize: 11, fontFamily: 'Plex Mono, monospace' },
      extraCssText: `box-shadow:${PAL().shadow};border-radius:0;`,
      formatter(params) {
        if (!params.length) return '';
        const idx = params[0].dataIndex;
        const rows = params.map((p, k) => {
          const v = p.value;
          const first = base[k];
          const delta = (v === null || first === null) ? null : v - first;
          const sign = delta === null ? '' : (delta >= 0 ? '+' : '') + delta.toFixed(1);
          return `<tr>
            <td style="padding:1px 10px 1px 0"><span style="display:inline-block;width:7px;height:7px;background:${p.color};margin-right:6px"></span>${p.seriesName}</td>
            <td style="text-align:right;font-variant-numeric:tabular-nums">${v === null ? '—' : v.toFixed(1)}</td>
            <td style="text-align:right;padding-left:10px;color:${delta >= 0 ? PAL().pos : PAL().neg};font-variant-numeric:tabular-nums">${sign}</td>
          </tr>`;
        }).join('');
        return `<div style="font-size:10.5px;letter-spacing:.08em;color:${PAL().tipHead};margin-bottom:5px">${dates[idx]} · ${varLabel(state.varKey)} / ${meta.unit}</div>
          <table style="border-collapse:collapse;font-size:11.5px">
            <tr style="color:${PAL().tipSub};font-size:9.5px;letter-spacing:.08em">
              <td>${T('tip.city')}</td><td style="text-align:right">${T('tip.value')}</td><td style="text-align:right;padding-left:10px">${T('tip.delta')}</td>
            </tr>${rows}</table>`;
      },
    },
    xAxis: {
      type: 'category',
      data: dates,
      boundaryGap: meta.type === 'bar',
      axisLine: { lineStyle: { color: PAL().axis } },
      axisTick: { show: false },
      axisLabel: {
        fontFamily: 'Plex Mono, monospace',
        fontSize: 10,
        color: PAL().label,
        formatter: v => v.slice(5),
        interval: Math.max(0, Math.floor(dates.length / 12)),
      },
      splitLine: { show: true, lineStyle: { color: PAL().split } },
    },
    yAxis: {
      type: 'value',
      name: meta.unit,
      nameTextStyle: { fontFamily: 'Plex Mono, monospace', fontSize: 10, color: PAL().label, padding: [0, 0, 4, 0] },
      axisLine: { show: false },
      axisLabel: { fontFamily: 'Plex Mono, monospace', fontSize: 10, color: PAL().label },
      splitLine: { lineStyle: { color: PAL().grid } },
      scale: meta.type === 'line',
    },
    series,
  }, true);

  $('#main-title').textContent = varTitle(state.varKey);
  $('#main-meta').textContent = T('main.meta', {
    start: d.meta.start, end: d.meta.end, d: d.meta.days,
    n: d.cities.length, unit: meta.unit,
  });

  const warmest = d.cities.reduce((a, b) => (b.summary.tmean_mean > a.summary.tmean_mean ? b : a));
  const fastest = d.cities.reduce((a, b) => (b.summary.trend_per10d < a.summary.trend_per10d ? b : a));
  const sep = WB.lang === 'en' ? ', ' : '、';
  $('#main-caption').textContent = state.varKey === 'prcp'
    ? T('main.capRain', {
        list: d.cities.map(c => `${dn(c.name)} ${fmt(c.summary.prcp_total)}mm`).join(sep),
      })
    : T('main.capTemp', {
        w: dn(warmest.name), wv: fmt(warmest.summary.tmean_mean),
        f: dn(fastest.name), fv: fmt(fastest.summary.trend_per10d, 2),
        fr: fmt(fastest.summary.trend_r2, 2),
      });
}

/* 小图一：日较差箱线 */
function renderDtr(d) {
  if (!state.charts.dtr) {
    state.charts.dtr = echarts.init($('#chart-dtr'), null, { renderer: 'canvas' });
    window.addEventListener('resize', () => state.charts.dtr && state.charts.dtr.resize());
  }
  const names = d.cities.map(c => dn(c.name));
  const nameMax = Math.max(...names.map(n => n.length));
  const boxes = d.cities.map(c => {
    const arr = c.series.dtr.filter(v => v !== null).slice().sort((a, b) => a - b);
    const q = p => {
      const pos = (arr.length - 1) * p, b = Math.floor(pos), r = pos - b;
      return arr[b + 1] !== undefined ? arr[b] + r * (arr[b + 1] - arr[b]) : arr[b];
    };
    return [arr[0], q(0.25), q(0.5), q(0.75), arr[arr.length - 1]];
  });

  state.charts.dtr.setOption({
    backgroundColor: 'transparent',
    animationDuration: 320,
    grid: { left: 40, right: 14, top: 16, bottom: 28 },
    tooltip: {
      trigger: 'item',
      backgroundColor: PAL().tipBg,
      borderColor: PAL().tipBorder,
      textStyle: { fontFamily: 'Plex Mono, monospace', fontSize: 11, color: PAL().tipText },
      formatter: p => T('tip.dtr', {
        name: p.name, min: p.value[1], q1: p.value[2],
        med: p.value[3], q3: p.value[4], max: p.value[5],
      }),
    },
    xAxis: {
      type: 'category',
      data: names,
      axisLine: { lineStyle: { color: PAL().axis } },
      axisTick: { show: false },
      axisLabel: {
        fontFamily: 'Plex Mono, monospace',
        fontSize: nameMax > 7 ? 9 : 10,   /* 英文名长，降一档避免挤在一起 */
        color: PAL().labelStrong,
        interval: 0,                      /* 5 个城市全显示，不然会隔一个藏一个 */
      },
    },
    yAxis: {
      type: 'value',
      name: '℃',
      nameTextStyle: { fontSize: 9, color: PAL().label },
      axisLabel: { fontFamily: 'Plex Mono, monospace', fontSize: 9.5, color: PAL().label },
      splitLine: { lineStyle: { color: PAL().grid } },
    },
    series: [{
      type: 'boxplot',
      data: boxes,
      itemStyle: { borderColor: PAL().boxBorder, borderWidth: 1, color: PAL().boxFill },
      emphasis: { itemStyle: { borderColor: PAL().pos } },
    }],
  }, true);
}

/* 小图二：相关矩阵 */
function renderCorr(d) {
  if (!state.charts.corr) {
    state.charts.corr = echarts.init($('#chart-corr'), null, { renderer: 'canvas' });
    window.addEventListener('resize', () => state.charts.corr && state.charts.corr.resize());
  }
  const names = d.corr.names;   // 内部键保持中文，显示时过 dn()
  const disp = names.map(dn);
  const nameMax = Math.max(...disp.map(n => n.length));
  const labelFont = nameMax > 7 ? 9 : 10.5;
  const cells = [];
  d.corr.matrix.forEach((row, i) => row.forEach((v, j) => cells.push([j, i, v])));

  state.charts.corr.setOption({
    backgroundColor: 'transparent',
    animationDuration: 320,
    grid: { left: Math.max(56, nameMax * 6.6 + 10), right: 20, top: 14, bottom: 62 },
    tooltip: {
      backgroundColor: PAL().tipBg,
      borderColor: PAL().tipBorder,
      textStyle: { fontFamily: 'Plex Mono, monospace', fontSize: 11, color: PAL().tipText },
      formatter: p => `${dn(names[p.value[1]])} ↔ ${dn(names[p.value[0]])}<br/>r = ${p.value[2].toFixed(2)}`,
    },
    xAxis: {
      type: 'category', data: disp, splitArea: { show: false },
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { fontFamily: 'Plex Mono, monospace', fontSize: labelFont, color: PAL().labelStrong, rotate: 0, interval: 0 },
    },
    yAxis: {
      type: 'category', data: disp, inverse: true,
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { fontFamily: 'Plex Mono, monospace', fontSize: labelFont, color: PAL().labelStrong },
    },
    visualMap: {
      min: -0.3, max: 1, calculable: false, show: false,
      inRange: { color: PAL().corr },
    },
    series: [{
      type: 'heatmap',
      data: cells,
      label: {
        show: true,
        fontFamily: 'Plex Mono, monospace',
        fontSize: 10.5,
        color: PAL().tipText,
        formatter: p => p.value[2].toFixed(2),
      },
      itemStyle: { borderColor: PAL().corrBorder, borderWidth: 1.5 },
      emphasis: { itemStyle: { borderColor: PAL().pos, borderWidth: 1.5 } },
    }],
  }, true);
}

/* 小图三：累计降水（横向条形，零基线，按量排序） */
function renderPrcp(d) {
  if (!state.charts.prcp) {
    state.charts.prcp = echarts.init($('#chart-prcp'), null, { renderer: 'canvas' });
    window.addEventListener('resize', () => state.charts.prcp && state.charts.prcp.resize());
  }
  $('#prcp-meta').textContent = T('panel.prcpMeta', { n: d.meta.days });
  const rows = d.cities
    .map(c => ({ name: c.name, total: c.summary.prcp_total, days: c.summary.rain_days }))
    .sort((a, b) => a.total - b.total);

  state.charts.prcp.setOption({
    backgroundColor: 'transparent',
    animationDuration: 320,
    /* 英文城市名比中文长，左轴按最长标签算宽度，避免被裁 */
    grid: { left: Math.max(46, Math.max(...rows.map(r => dn(r.name).length)) * 6.4 + 12), right: 54, top: 12, bottom: 26 },
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(247,249,250,.98)',
      borderColor: 'rgba(15,42,61,.5)',
      textStyle: { fontFamily: 'Plex Mono, monospace', fontSize: 11, color: '#0F2A3D' },
      formatter: p => T('tip.prcp', { name: p.name, v: p.value, d: rows[p.dataIndex].days }),
    },
    xAxis: {
      type: 'value',
      name: 'mm',
      nameTextStyle: { fontSize: 9, color: PAL().label },
      axisLabel: { fontFamily: 'Plex Mono, monospace', fontSize: 9.5, color: PAL().label },
      splitLine: { lineStyle: { color: PAL().grid } },
    },
    yAxis: {
      type: 'category',
      data: rows.map(r => dn(r.name)),
      axisLine: { lineStyle: { color: PAL().axis } },
      axisTick: { show: false },
      axisLabel: { fontFamily: 'Plex Mono, monospace', fontSize: 10, color: PAL().labelStrong },
    },
    series: [{
      type: 'bar',
      data: rows.map(r => ({
        value: r.total,
        itemStyle: { color: colorOf(r.name), opacity: 0.88 },
      })),
      barMaxWidth: 14,
      label: {
        show: true,
        position: 'right',
        distance: 6,
        fontFamily: 'Plex Mono, monospace',
        fontSize: 9.5,
        color: PAL().labelStrong,
        formatter: p => `${p.value}`,
      },
    }],
  }, true);
}

/* 表格 */
const COLS = [
  ['city', 'col.city', null],
  ['tmean_mean', 'col.tmean', 1],
  ['tmax_mean', 'col.tmax', 1],
  ['tmin_mean', 'col.tmin', 1],
  ['dtr_mean', 'col.dtr', 1],
  ['trend_per10d', 'col.trend', 2],
  ['trend_r2', 'col.r2', 2],
  ['baseline', 'col.base', 1],
  ['anomaly', 'col.anom', 1],
  ['prcp_total', 'col.prcp', 1],
  ['rain_days', 'col.rain', 0],
];

function renderTable(d) {
  const bv = (state.baseline && state.baseline.values) || {};
  const rows = d.cities.map(c => {
    const base = bv[c.name] ?? null;
    return {
      city: c.name,
      ...c.summary,
      baseline: base,
      anomaly: base == null ? null : +(c.summary.tmean_mean - base).toFixed(1),
    };
  });
  const { key, dir } = state.sort;
  rows.sort((a, b) => {
    const av = a[key], bv = b[key];
    if (typeof av === 'string') return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    return dir === 'asc' ? av - bv : bv - av;
  });

  const head = COLS.map(([k, lk]) =>
    `<th data-key="${k}"${k === key ? ` data-sorted="${dir}"` : ''}>${T(lk)}</th>`).join('');
  const body = rows.map(r => `
    <tr>
      <td><span class="swatch" style="background:${colorOf(r.city)}"></span>${dn(r.city)}</td>
      <td>${fmt(r.tmean_mean)}</td>
      <td>${fmt(r.tmax_mean)}</td>
      <td>${fmt(r.tmin_mean)}</td>
      <td>${fmt(r.dtr_mean)}</td>
      <td style="color:${r.trend_per10d < 0 ? PAL().neg : PAL().pos}">${fmt(r.trend_per10d, 2)}</td>
      <td>${fmt(r.trend_r2, 2)}</td>
      <td>${fmt(r.baseline)}</td>
      <td style="color:${r.anomaly > 0 ? PAL().pos : r.anomaly < 0 ? PAL().neg : 'inherit'}">${r.anomaly == null ? '—' : (r.anomaly > 0 ? '+' : '') + r.anomaly.toFixed(1)}</td>
      <td>${fmt(r.prcp_total)}</td>
      <td>${r.rain_days}</td>
    </tr>`).join('');

  const t = $('#table');
  t.innerHTML = `<thead><tr>${head}</tr></thead><tbody>${body}</tbody>`;
  t.querySelectorAll('th').forEach(th => th.addEventListener('click', () => {
    const k = th.dataset.key;
    state.sort = { key: k, dir: state.sort.key === k && state.sort.dir === 'desc' ? 'asc' : 'desc' };
    renderTable(state.data);
  }));
}

function renderProv(d) {
  const m = d.meta;
  const rows = [
    [T('prov.source'), m.source],
    [T('prov.model'), m.model],
    [T('prov.window'), T('prov.windowV', { start: m.start, end: m.end, d: m.days, tz: m.timezone })],
    [T('prov.fetched'), m.fetched_at],
    [T('prov.elapsed'), T('prov.elapsedV', { ms: m.elapsed_ms, s: m.server_ms ?? '—' })],
    [T('prov.cache'), m.cache_hit
      ? T('prov.cacheHit', { m: Math.round((m.cache_age_s || 0) / 60) })
      : T('prov.cacheMiss')],
    [T('prov.filled'), T('prov.filledV', { n: m.quality.filled_cells, d: m.quality.missing_days })],
    [T('prov.url'), m.request_url],
    [T('prov.sha'), m.sha256],
    [T('prov.raw'), (m.raw_files || []).join(WB.lang === 'en' ? ', ' : '、')],
    [T('prov.attr'), m.attribution],
  ];
  $('#prov').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v ?? '—'}</dd>`).join('');
}

/* ---------------------------------------------------------------- 语言 / 主题
   静态文案由 ui.js 处理；这里重跑所有动态渲染（图表配色来自 PAL()） */
document.addEventListener('ui:change', () => {
  buildSegments();
  syncSegments();
  renderGroups();
  renderChips();
  if (state.data) render(state.data);
  else if (state.selected.length) setStatus('idle', 'status.selected', { n: state.selected.length });
  else setStatus('idle', 'status.none');
  applyStatus();
});

/* ---------------------------------------------------------------- go */
init();
