'use strict';

(() => {
  const chartKeys = ['main', 'dtr', 'corr', 'prcp'];
  const local = (zh, en) => WB.lang === 'en' ? en : zh;
  const title = key => key === 'main' ? varTitle(state.varKey) : T('panel.' + key);

  function csvText(data) {
    const keys = ['tmean', 'tmax', 'tmin', 'dtr', 'prcp'];
    const rows = [[T('col.city'), local('日期', 'Date'),
      ...keys.map(k => varLabel(k) + ' (' + VAR_META[k].unit + ')')]];
    for (const city of data.cities) {
      city.series.date.forEach((date, i) => {
        rows.push([dn(city.name), date, ...keys.map(k => city.series[k][i])]);
      });
    }
    function cell(value) {
      let s = String(value ?? '');
      if (typeof value === 'string' && /^[=+@\-\t\r]/.test(s)) s = "'" + s;
      return '"' + s.replaceAll('"', '""') + '"';
    }
    return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n');
  }

  function chartImage(key) {
    return state.charts[key].getDataURL({
      type: 'png', pixelRatio: 2,
      backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--surface').trim(),
    });
  }

  function report(data) {
    const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    const { start, end, days, source, timezone, quality, fetched_at, sha256 } = data.meta;
    const heading = local('城市天气数据采集实验报告', 'City weather data collection report');
    const cityList = data.cities.map(c => dn(c.name)).join(local('、', ', '));
    const rows = Array.from($('#table').rows, row =>
      '<tr>' + Array.from(row.cells, c => '<' + c.localName + '>' + esc(c.textContent.trim()) + '</' + c.localName + '>').join('') + '</tr>');
    const figures = chartKeys.map(k => '<figure><figcaption>' + esc(title(k)) +
      '</figcaption><img alt="' + k + '" src="' + chartImage(k) + '"></figure>');
    const maxRain = Math.max(...data.cities.map(c => c.summary.prcp_total));
    const wettest = data.cities.filter(c => c.summary.prcp_total === maxRain).map(c => dn(c.name)).join(local('、', ', '));
    return `<!doctype html><html lang="${WB.lang}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${heading}</title>
<style>body{max-width:1050px;margin:2em auto;padding:0 1rem;font:16px/1.6 system-ui;color:#172c3e}img{max-width:100%;height:auto}figure{margin:1rem 0;break-inside:avoid}figcaption{font-weight:600}.scroll{overflow:auto}td,th{padding:.35em;border-bottom:1px solid #aaa}table{border-collapse:collapse;font-size:.85em}footer{overflow-wrap:anywhere}@media print{@page{size:landscape}body{margin:0}img{max-height:55vh}}</style>
<h1>${heading}</h1><p>${esc(cityList)} · ${esc(start)} — ${esc(end)} · ${esc(timezone)}</p>
<h2>${local('实验方法','Method')}</h2><p>${esc(source)} · ${days} ${local('天。按城市整理逐日网格数据，统计气温、日较差与累计降水。','days. Daily gridded records are summarized by city for temperature, daily temperature range and total precipitation.')}</p>
<p>${local('填补单元格数','Filled cells')}: ${quality.filled_cells} · ${local('原始缺失日数（各城市合计）','Missing city-days')}: ${quality.missing_days}</p>
<h2>${local('结果','Results')}</h2><p>${local('所选城市中累计降水最多','Highest total precipitation among selected cities')}: ${esc(wettest)} (${maxRain} mm).</p>
<div class="scroll"><table>${rows.join('')}</table></div>${figures.join('')}
<footer>© Open-Meteo.com · CC BY 4.0 · ${esc(fetched_at)}<br>SHA-256: ${esc(sha256)}</footer></html>`;
  }

  $('#read').addEventListener('click', event => {
    const key = event.target.closest('[data-export]')?.dataset.export;
    const data = state.data;
    if (!key || !data) return;
    const link = document.createElement('a');
    const period = data.meta.start + '_' + data.meta.end;
    if (chartKeys.includes(key)) {
      link.href = chartImage(key);
      link.download = title(key) + '_' + period + '.png';
    } else {
      const csv = key === 'csv';
      const content = csv ? csvText(data) : report(data);
      link.href = URL.createObjectURL(new Blob([content], { type: csv ? 'text/csv;charset=utf-8' : 'text/html;charset=utf-8' }));
      link.download = 'weather_' + period + (csv ? '.csv' : '_report.html');
      setTimeout(() => URL.revokeObjectURL(link.href), 60000);
    }
    link.click();
  });
})();
