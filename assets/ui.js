/* ==========================================================================
   界面框架层：主题（明/暗） + 语言（中/英）
   - 状态落在 localStorage，首屏由 <head> 里的内联脚本先刷到 <html> 上，避免闪白
   - 只负责「静态文案」与「状态」；动态渲染由 app.js 监听 ui:change 后重跑
   ========================================================================== */
'use strict';

const WB = (() => {
  const DICT = {
    zh: {
      'app.title': '城市天气数据工作台 · 现场抓取',
      'app.h1': '城市天气', 'app.h1sub': '数据工作台',

      /* 报头 */
      'meta.source': '数据源', 'meta.source.v': 'Open-Meteo · ERA5',
      'meta.basis': '口径', 'meta.basis.v': '再分析网格值',
      'meta.tz': '时区', 'meta.tz.v': 'Asia/Shanghai',
      'meta.lic': '许可', 'meta.lic.v': 'CC BY 4.0',
      'ui.theme': '切换深浅色', 'ui.lang': '切换语言',

      /* 三段 */
      'stage.pick': '选', 'stage.fetch': '抓', 'stage.read': '看',

      /* ① */
      'field.presets': '预置城市',
      'field.search': '搜索城市',
      'field.selected': '已选',
      'field.map': '地图点选',
      'ph.search': '江门 / 佛山 / 东莞…',
      'btn.reset': '复位视图',
      'field.window': '时间窗口',
      'field.var': '主图变量',
      'unit.days': '{n} 天',
      'var.tmean': '日平均气温', 'var.tmax': '日最高气温', 'var.tmin': '日最低气温',
      'var.dtr': '日较差', 'var.prcp': '降水量',
      'vartitle.tmean': '日平均气温曲线', 'vartitle.tmax': '日最高气温曲线',
      'vartitle.tmin': '日最低气温曲线', 'vartitle.dtr': '日较差（最高−最低）',
      'vartitle.prcp': '逐日降水量',

      /* ② */
      'btn.fetch': '抓取数据', 'btn.force': '强制重抓',
      'status.none': '未选择',
      'status.max': '最多同时对比 5 个城市，先取消一个',
      'status.selected': '已选 {n} 城',
      'status.dirty': '选择已改 · 待抓取',
      'status.running': '请求接口中',
      'status.runningForce': '强制重抓：请求接口中',
      'status.done': '完成 · {n} 城 · {d} 天 · {age}',
      'status.cacheHit': '缓存命中（{m} 分钟前）',
      'status.live': '实时抓取',
      'status.fail': '失败：{msg}',

      /* ③ */
      'empty.msg': '选城市，然后按「抓取数据」',
      'chip.none': '还没选城市',
      'chip.remove': '点击移除',
      'search.loading': '搜索中…',
      'search.none': '没找到「{q}」，换个写法试试',
      'search.error': '搜索接口没响应',

      'panel.dtr': '日较差分布', 'panel.dtrMeta': '最高 − 最低',
      'panel.corr': '气温相关矩阵', 'panel.corrMeta': 'Pearson r',
      'panel.prcp': '累计降水', 'panel.prcpMeta': '{n} 天累计 · mm',
      'panel.table': '分城市统计',
      'panel.prov': '采集血缘',

      /* KPI */
      'kpi.cities': '对比城市', 'kpi.citiesSub': '{d} 天 · {start} 起',
      'kpi.warm': '最暖 / 最冷', 'kpi.warmSub': '{w} 最暖，{c} {v}℃',
      'kpi.spread': '同期最大温差', 'kpi.spreadSub': '{date} · {w} ↔ {c}',
      'kpi.cooling': '降温最快', 'kpi.coolingSub': '{c} · R² {r}',
      'kpi.anom': '较常年同期', 'kpi.anomSub': '{p} 基准 · {c} 最偏高 {v}℃',
      'kpi.anomSubNone': '1991–2020 同期均值',
      'kpi.calc': '计算中',
      'unit.city': '城', 'unit.per10d': '℃/10天',

      /* 图 */
      'tip.city': '城市', 'tip.value': '值', 'tip.delta': '较首日',
      'tip.sel': '已选（点击移除）', 'tip.unsel': '未选（点击加入）',
      'tip.dtr': '{name}<br/>最小 {min} · Q1 {q1}<br/>中位 {med} · Q3 {q3}<br/>最大 {max}',
      'tip.prcp': '{name}<br/>累计 {v} mm · 雨日 {d} 天',
      'main.meta': '{start} → {end} · {d} 天 · {n} 城 · ERA5 网格值 · {unit}',
      'main.capTemp': '{w} 30 天均温最高（{wv}℃），{f} 降温最快（{fv}℃/10 天，R²={fr}）。',
      'main.capRain': '柱状为逐日降水量（零基线）。30 天里 {list}。',

      /* 表 */
      'col.city': '城市', 'col.tmean': '平均', 'col.tmax': '最高均', 'col.tmin': '最低均',
      'col.dtr': '日较差', 'col.trend': '趋势/10天', 'col.r2': 'R²',
      'col.base': '常年', 'col.anom': '距平', 'col.prcp': '降水', 'col.rain': '雨日',

      /* 血缘 */
      'prov.source': '数据源', 'prov.model': '模型', 'prov.window': '时间窗口',
      'prov.fetched': '抓取时间', 'prov.elapsed': '本次耗时', 'prov.cache': '缓存',
      'prov.filled': '填补格数', 'prov.url': '请求 URL', 'prov.sha': '响应 sha256',
      'prov.raw': '原始报文', 'prov.attr': '署名',
      'prov.windowV': '{start} → {end}（{d} 天，{tz}）',
      'prov.elapsedV': '{ms} ms（服务端合计 {s} ms）',
      'prov.cacheHit': '命中（{m} 分钟前抓的）',
      'prov.cacheMiss': '未命中，本次实时抓取',
      'prov.filledV': '{n}（接口漏返回日期 {d} 天）',

      'foot.license': '数据 © <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo.com</a> / ERA5 · CC BY 4.0 · 再分析网格值，非气象站实测，适用于趋势与相对比较，不适用于单站极值认定。',
      'foot.mono': '后端 <code>server.py</code> · 零依赖标准库 · 原始报文落盘于 <code>cache/raw/</code>',
    },

    en: {
      'app.title': 'City Weather Workbench · Live Fetch',
      'app.h1': 'City weather', 'app.h1sub': 'data workbench',

      'meta.source': 'Source', 'meta.source.v': 'Open-Meteo · ERA5',
      'meta.basis': 'Basis', 'meta.basis.v': 'Reanalysis grid',
      'meta.tz': 'Timezone', 'meta.tz.v': 'Asia/Shanghai',
      'meta.lic': 'License', 'meta.lic.v': 'CC BY 4.0',
      'ui.theme': 'Toggle theme', 'ui.lang': 'Toggle language',

      'stage.pick': 'Pick', 'stage.fetch': 'Fetch', 'stage.read': 'Read',

      'field.presets': 'Preset cities',
      'field.search': 'Search city',
      'field.selected': 'Selected',
      'field.map': 'Pick on map',
      'ph.search': 'Jiangmen / Foshan / Dongguan…',
      'btn.reset': 'Reset view',
      'field.window': 'Time window',
      'field.var': 'Main variable',
      'unit.days': '{n} days',
      'var.tmean': 'Daily mean', 'var.tmax': 'Daily max', 'var.tmin': 'Daily min',
      'var.dtr': 'Diurnal range', 'var.prcp': 'Precipitation',
      'vartitle.tmean': 'Daily mean temperature', 'vartitle.tmax': 'Daily maximum temperature',
      'vartitle.tmin': 'Daily minimum temperature', 'vartitle.dtr': 'Diurnal range (max − min)',
      'vartitle.prcp': 'Daily precipitation',

      'btn.fetch': 'Fetch data', 'btn.force': 'Force refetch',
      'status.none': 'No city',
      'status.max': 'Up to 5 cities — remove one first',
      'status.selected': '{n} cities selected',
      'status.dirty': 'Selection changed · not fetched',
      'status.running': 'Requesting…',
      'status.runningForce': 'Force refetch: requesting…',
      'status.done': 'Done · {n} cities · {d} days · {age}',
      'status.cacheHit': 'cache hit ({m} min ago)',
      'status.live': 'live fetch',
      'status.fail': 'Failed: {msg}',

      'empty.msg': 'Pick cities, then press “Fetch data”',
      'chip.none': 'No city yet',
      'chip.remove': 'Click to remove',
      'search.loading': 'Searching…',
      'search.none': 'No match for “{q}”',
      'search.error': 'Geocoding service unavailable',

      'panel.dtr': 'Diurnal range', 'panel.dtrMeta': 'max − min',
      'panel.corr': 'Temperature correlation', 'panel.corrMeta': 'Pearson r',
      'panel.prcp': 'Accumulated rainfall', 'panel.prcpMeta': '{n}-day total · mm',
      'panel.table': 'Per-city statistics',
      'panel.prov': 'Provenance',

      'kpi.cities': 'Cities', 'kpi.citiesSub': '{d} days · from {start}',
      'kpi.warm': 'Warmest / coldest', 'kpi.warmSub': '{w} warmest, {c} {v}℃',
      'kpi.spread': 'Peak spread', 'kpi.spreadSub': '{date} · {w} ↔ {c}',
      'kpi.cooling': 'Fastest cooling', 'kpi.coolingSub': '{c} · R² {r}',
      'kpi.anom': 'vs. 1991–2020', 'kpi.anomSub': '{p} normal · {c} highest {v}℃',
      'kpi.anomSubNone': '1991–2020 seasonal mean',
      'kpi.calc': 'computing',
      'unit.city': 'cities', 'unit.per10d': '℃/10d',

      'tip.city': 'City', 'tip.value': 'Value', 'tip.delta': 'vs. day 1',
      'tip.sel': 'selected (click to remove)', 'tip.unsel': 'not selected (click to add)',
      'tip.dtr': '{name}<br/>min {min} · Q1 {q1}<br/>median {med} · Q3 {q3}<br/>max {max}',
      'tip.prcp': '{name}<br/>total {v} mm · {d} rainy days',
      'main.meta': '{start} → {end} · {d} days · {n} cities · ERA5 grid · {unit}',
      'main.capTemp': '{w} has the highest 30-day mean ({wv}℃); {f} cools fastest ({fv}℃/10 days, R²={fr}).',
      'main.capRain': 'Bars are daily precipitation on a zero baseline. 30-day totals: {list}.',

      'col.city': 'City', 'col.tmean': 'Mean', 'col.tmax': 'Max mean', 'col.tmin': 'Min mean',
      'col.dtr': 'Range', 'col.trend': 'Trend/10d', 'col.r2': 'R²',
      'col.base': 'Normal', 'col.anom': 'Anomaly', 'col.prcp': 'Rain', 'col.rain': 'Rain days',

      'prov.source': 'Source', 'prov.model': 'Model', 'prov.window': 'Window',
      'prov.fetched': 'Fetched at', 'prov.elapsed': 'Elapsed', 'prov.cache': 'Cache',
      'prov.filled': 'Filled cells', 'prov.url': 'Request URL', 'prov.sha': 'Response sha256',
      'prov.raw': 'Raw payload', 'prov.attr': 'Attribution',
      'prov.windowV': '{start} → {end} ({d} days, {tz})',
      'prov.elapsedV': '{ms} ms (server {s} ms)',
      'prov.cacheHit': 'hit ({m} min after fetch)',
      'prov.cacheMiss': 'miss — fetched live',
      'prov.filledV': '{n} (API returned no date for {d} days)',

      'foot.license': 'Data © <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo.com</a> / ERA5 · CC BY 4.0 · Reanalysis grid values, not station observations — suitable for trends and relative comparison, not for absolute extremes at a single site.',
      'foot.mono': 'Backend <code>server.py</code> · stdlib only · raw payloads stored in <code>cache/raw/</code>',
    },
  };

  const read = (k, d) => {
    try { return localStorage.getItem(k) || d; } catch { return d; }
  };
  const store = (k, v) => { try { localStorage.setItem(k, v); } catch { /* 隐私模式忽略 */ } };

  let lang = read('wb-lang', '') || (document.documentElement.lang === 'en' ? 'en' : 'zh');
  let theme = document.documentElement.dataset.theme
    || read('wb-theme', '')
    || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

  function t(key, vars) {
    let s = (DICT[lang] && DICT[lang][key]) ?? (DICT.zh[key] ?? key);
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
    return s;
  }

  /* 静态文案：[data-i18n] 文本、[data-i18n-ph] 占位、[data-i18n-title] 提示 */
  function applyStatic() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const k = el.dataset.i18n;
      if (k === 'foot.license' || k === 'foot.mono') el.innerHTML = t(k);   // 自带链接与 <code>
      else el.textContent = t(k);
    });
    document.querySelectorAll('[data-i18n-ph]').forEach(el => {
      el.placeholder = t(el.dataset.i18nPh);
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      el.title = t(el.dataset.i18nTitle);
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(el => {
      el.setAttribute('aria-label', t(el.dataset.i18nAria));
    });
    document.title = t('app.title');
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
  }

  function emit() {
    document.dispatchEvent(new CustomEvent('ui:change', { detail: { lang, theme } }));
  }

  function setLang(next) {
    lang = next === 'en' ? 'en' : 'zh';
    store('wb-lang', lang);
    applyStatic();
    emit();
  }

  function setTheme(next) {
    theme = next === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    store('wb-theme', theme);
    emit();
  }

  return {
    t,
    applyStatic,
    get lang() { return lang; },
    get theme() { return theme; },
    setLang,
    setTheme,
    toggleLang: () => setLang(lang === 'en' ? 'zh' : 'en'),
    toggleTheme: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
  };
})();

/* 切换按钮：文案与图标跟着状态走 */
function syncToggles() {
  const tb = document.getElementById('btn-theme');
  const lb = document.getElementById('btn-lang');
  if (tb) {
    tb.dataset.theme = WB.theme;       // 图标由 CSS 按 data-theme 切换
    tb.setAttribute('aria-label', WB.t('ui.theme'));
    tb.title = WB.t('ui.theme');
  }
  if (lb) {
    lb.textContent = WB.lang === 'en' ? 'EN' : '中';
    lb.setAttribute('aria-label', WB.t('ui.lang'));
    lb.title = WB.t('ui.lang');
  }
}

document.addEventListener('ui:change', syncToggles);
WB.applyStatic();
syncToggles();

document.addEventListener('DOMContentLoaded', () => {
  const tb = document.getElementById('btn-theme');
  const lb = document.getElementById('btn-lang');
  if (tb) tb.addEventListener('click', () => WB.toggleTheme());
  if (lb) lb.addEventListener('click', () => WB.toggleLang());
  WB.applyStatic();
  syncToggles();
});
