// 「最佳到访日」数据：从 queue-times 的 stats 页面与每日拥挤接口获取并解析。
//
// 注意：queue-times 免费 API 不提供历史数据；这里读取的是其网站统计页内嵌的
// Chartkick 数据，以及 stats 页用到的每日拥挤指数接口（均为公开页面渲染所用）。
// 仅为聚合的"拥挤指数"（0-100，越高越拥挤），用于判断"哪天/哪月去人少"，
// 不含按时段（小时/分钟）的日内历史。解析依赖页面结构，若官方改版可能失效。
import { config } from './config.js';
import { saveCrowdData } from './db.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) hk-disney-land/1.0 (crowd calendar)';

function statsUrl() {
  return `https://queue-times.com/en-US/parks/${config.parkId}/stats`;
}
function dailyCrowdUrl() {
  return `https://queue-times.com/en-US/parks/${config.parkId}/crowd_rank_by_day`;
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/json' } });
  if (!res.ok) throw new Error(`请求 ${url} 失败: HTTP ${res.status}`);
  return res.text();
}

/**
 * 从 HTML 中提取某个 Chartkick 图表的内联数据参数并解析为 JSON。
 * 形如：  new Chartkick["ColumnChart"]("chart-6", [["Sun",52],...], {...});
 * 若该图表的数据是 URL 字符串（而非内联数组/对象），返回 null。
 * @returns {any|null}
 */
function extractChartData(html, chartId) {
  const marker = `"${chartId}",`;
  const at = html.indexOf(marker);
  if (at === -1) return null;

  // 跳过 marker 与其后的空白，定位数据参数的起始字符。
  let i = at + marker.length;
  while (i < html.length && /\s/.test(html[i])) i++;
  const open = html[i];
  if (open !== '[' && open !== '{') return null; // 多半是 URL 字符串，跳过。

  const close = open === '[' ? ']' : '}';
  let depth = 0;
  let inStr = false;
  for (let j = i; j < html.length; j++) {
    const ch = html[j];
    if (inStr) {
      if (ch === '\\') j++; // 跳过转义字符
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        const json = html.slice(i, j + 1);
        try {
          return JSON.parse(json);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// 把 [["Sun",52],...] 这类数组转成 [{label, value}]。
function toPairs(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((x) => Array.isArray(x) && x.length >= 2)
    .map(([label, value]) => ({ label, value: Number(value) }));
}

/**
 * 拉取并解析"最佳到访日"相关数据。
 * @returns {Promise<{payload:object, dailyRows:Array<{date,crowd_index}>}>}
 */
export async function fetchCrowdData() {
  const [html, dailyText] = await Promise.all([
    fetchText(statsUrl()),
    fetchText(dailyCrowdUrl()).catch(() => null),
  ]);

  // chart-5: 按月份；chart-6: 按星期；chart-7: 按年份；chart-1/2: 设施等候排行。
  const byMonth = toPairs(extractChartData(html, 'chart-5'));
  const byWeekday = toPairs(extractChartData(html, 'chart-6'));
  const byYearRaw = extractChartData(html, 'chart-7');
  const busiestAvg = toPairs(extractChartData(html, 'chart-1')).slice(0, 15);
  const busiestMax = toPairs(extractChartData(html, 'chart-2')).slice(0, 15);

  // chart-7 形如 [{name, data:[[2020,43],...]}]，取"Entire year"系列。
  let byYear = [];
  if (Array.isArray(byYearRaw)) {
    const series = byYearRaw.find((s) => /entire/i.test(s?.name)) ?? byYearRaw[0];
    if (series?.data) {
      byYear = series.data
        .filter((d) => Array.isArray(d) && d[1] != null)
        .map(([year, value]) => ({ label: String(year), value: Number(value) }));
    }
  }

  // 每日拥挤接口： [{"name":"Actual","data":{"2026-05-15":"23.0",...}}, ...]
  let dailyRows = [];
  if (dailyText) {
    try {
      const series = JSON.parse(dailyText);
      const actual = (Array.isArray(series) ? series : []).find((s) => /actual/i.test(s?.name))
        ?? (Array.isArray(series) ? series[0] : null);
      if (actual?.data && typeof actual.data === 'object') {
        dailyRows = Object.entries(actual.data)
          .map(([date, value]) => ({ date, crowd_index: Number(value) }))
          .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number.isFinite(r.crowd_index));
      }
    } catch {
      /* 忽略解析失败 */
    }
  }

  const payload = {
    source: statsUrl(),
    byWeekday,
    byMonth,
    byYear,
    busiestAvg,
    busiestMax,
  };

  return { payload, dailyRows };
}

/**
 * 拉取并存入数据库，返回采集摘要。
 */
export async function refreshCrowdData() {
  const { payload, dailyRows } = await fetchCrowdData();
  const fetchedAt = new Date().toISOString();
  saveCrowdData(payload, fetchedAt, dailyRows);
  return {
    fetchedAt,
    weekdays: payload.byWeekday.length,
    months: payload.byMonth.length,
    years: payload.byYear.length,
    dailyDays: dailyRows.length,
    busiestRides: payload.busiestAvg.length,
  };
}
