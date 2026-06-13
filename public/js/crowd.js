// 「最佳到访日」页面逻辑。
const WEEKDAY_CN = { Sun: '周日', Mon: '周一', Tue: '周二', Wed: '周三', Thu: '周四', Fri: '周五', Sat: '周六' };
const MONTH_CN = { Jan: '1月', Feb: '2月', Mar: '3月', Apr: '4月', May: '5月', Jun: '6月', Jul: '7月', Aug: '8月', Sep: '9月', Oct: '10月', Nov: '11月', Dec: '12月' };

const charts = {};
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// 按值高低着色：低=绿(人少)，高=红(人多)。
function colorsFor(values) {
  const max = Math.max(...values, 1);
  const min = Math.min(...values);
  return values.map((v) => {
    const ratio = max > min ? (v - min) / (max - min) : 0;
    const hue = (1 - ratio) * 130; // 130 绿 → 0 红
    return `hsl(${hue}, 65%, 45%)`;
  });
}

const axisStyle = {
  x: { ticks: { color: '#9aa0c7' }, grid: { color: '#2c3361' } },
  y: { ticks: { color: '#9aa0c7' }, grid: { color: '#2c3361' }, beginAtZero: true, suggestedMax: 100 },
};

function barChart(canvasId, labels, values, label) {
  if (charts[canvasId]) charts[canvasId].destroy();
  charts[canvasId] = new Chart(document.getElementById(canvasId), {
    type: 'bar',
    data: { labels, datasets: [{ label, data: values, backgroundColor: colorsFor(values) }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: axisStyle,
    },
  });
}

function minMaxLabel(pairs, mapper) {
  if (!pairs.length) return { best: null, worst: null };
  const sorted = [...pairs].sort((a, b) => a.value - b.value);
  return { best: mapper(sorted[0].label), worst: mapper(sorted[sorted.length - 1].label) };
}

async function load() {
  const data = await (await fetch('/api/crowd')).json();
  if (data.empty) {
    document.getElementById('empty').style.display = '';
    document.getElementById('content').style.display = 'none';
    return;
  }
  document.getElementById('empty').style.display = 'none';
  document.getElementById('content').style.display = '';
  if (data.fetchedAt) {
    document.getElementById('status').textContent =
      '上次更新：' + new Date(data.fetchedAt).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong', hour12: false });
  }

  // ① 星期
  const wd = data.byWeekday || [];
  barChart('weekday-chart', wd.map((p) => WEEKDAY_CN[p.label] || p.label), wd.map((p) => p.value), '拥挤指数');
  const wdMM = minMaxLabel(wd, (l) => WEEKDAY_CN[l] || l);
  document.getElementById('weekday-tip').innerHTML = wdMM.best
    ? `✅ 一周最空：<strong>${wdMM.best}</strong>　⛔ 最挤：<strong>${wdMM.worst}</strong>`
    : '';

  // ② 月份
  const mo = data.byMonth || [];
  barChart('month-chart', mo.map((p) => MONTH_CN[p.label] || p.label), mo.map((p) => p.value), '拥挤指数');
  const moMM = minMaxLabel(mo, (l) => MONTH_CN[l] || l);
  document.getElementById('month-tip').innerHTML = moMM.best
    ? `✅ 一年最空：<strong>${moMM.best}</strong>　⛔ 最挤：<strong>${moMM.worst}</strong>`
    : '';

  // ③ 每日
  const daily = data.daily || [];
  barChart('daily-chart', daily.map((d) => d.date.slice(5)), daily.map((d) => d.crowd_index), '每日拥挤指数');

  // ④ 历年
  const yr = data.byYear || [];
  if (charts['year-chart']) charts['year-chart'].destroy();
  charts['year-chart'] = new Chart(document.getElementById('year-chart'), {
    type: 'line',
    data: { labels: yr.map((p) => p.label), datasets: [{ label: '整体拥挤指数', data: yr.map((p) => p.value), borderColor: '#5b8cff', backgroundColor: 'rgba(91,140,255,0.15)', fill: true, tension: 0.3 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#e8eaf6' } } }, scales: axisStyle },
  });

  // ⑤ 最繁忙项目
  const busiest = data.busiestAvg || [];
  document.getElementById('busiest-body').innerHTML = busiest
    .map((r, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(r.label)}</td><td class="num">${r.value}</td></tr>`)
    .join('');
}

document.getElementById('refresh').addEventListener('click', async () => {
  const btn = document.getElementById('refresh');
  const status = document.getElementById('status');
  btn.disabled = true;
  status.textContent = '采集中…';
  try {
    const res = await fetch('/api/crowd/refresh', { method: 'POST' });
    const r = await res.json();
    if (!r.ok) throw new Error(r.error || '失败');
    status.textContent = `已更新：星期 ${r.weekdays} · 月份 ${r.months} · 每日 ${r.dailyDays} 天`;
    await load();
  } catch (err) {
    status.textContent = '采集失败：' + err.message;
  } finally {
    btn.disabled = false;
  }
});

load();
