// 历史分析页逻辑。
let profileChart = null;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function waitColor(minutes, max) {
  // 0 -> 绿, max -> 红
  if (minutes == null) return 'transparent';
  const ratio = max > 0 ? Math.min(1, minutes / max) : 0;
  const hue = (1 - ratio) * 130; // 130=绿, 0=红
  return `hsl(${hue}, 65%, 35%)`;
}

async function loadCoverage() {
  const c = await (await fetch('/api/coverage')).json();
  document.getElementById('c-days').textContent = c.daysCovered ?? 0;
  document.getElementById('c-readings').textContent = (c.totalReadings ?? 0).toLocaleString();
  document.getElementById('c-range').textContent =
    c.firstDay ? `${c.firstDay} ~ ${c.lastDay}` : '暂无数据';
}

// ---- ① 单设施画像 ----
async function loadRides() {
  const rides = await (await fetch('/api/rides')).json();
  const sel = document.getElementById('ride-select');
  if (!rides.length) {
    sel.innerHTML = '<option value="">（暂无数据，请先采集）</option>';
    return;
  }
  sel.innerHTML = rides
    .map((r) => `<option value="${r.id}">${escapeHtml(r.name)}（${r.open_samples} 样本）</option>`)
    .join('');
  loadProfile();
}

async function loadProfile() {
  const id = document.getElementById('ride-select').value;
  if (!id) return;
  const dayType = document.getElementById('daytype-1').value;
  const bucket = document.getElementById('bucket-1').value;

  const data = await (
    await fetch(`/api/rides/${id}/profile?dayType=${dayType}&bucket=${bucket}`)
  ).json();
  const best = await (
    await fetch(`/api/rides/${id}/best-times?dayType=${dayType}&bucket=${bucket}`)
  ).json();

  const labels = data.profile.map((b) => b.label);
  const median = data.profile.map((b) => b.median);
  const avg = data.profile.map((b) => b.avg);
  const max = data.profile.map((b) => b.max);

  if (profileChart) profileChart.destroy();
  const ctx = document.getElementById('profile-chart');

  if (!data.profile.length) {
    ctx.getContext('2d').clearRect(0, 0, ctx.width, ctx.height);
    document.getElementById('best-times').innerHTML =
      '<p class="empty">该设施暂无足够数据。</p>';
    return;
  }

  profileChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: '中位等候(分钟)', data: median, borderColor: '#5b8cff', backgroundColor: 'rgba(91,140,255,0.15)', fill: true, tension: 0.3 },
        { label: '平均等候', data: avg, borderColor: '#36c98e', tension: 0.3 },
        { label: '最长等候', data: max, borderColor: '#f0584e', borderDash: [5, 5], tension: 0.3, pointRadius: 0 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#e8eaf6' } } },
      scales: {
        x: { ticks: { color: '#9aa0c7' }, grid: { color: '#2c3361' } },
        y: { ticks: { color: '#9aa0c7' }, grid: { color: '#2c3361' }, title: { display: true, text: '分钟', color: '#9aa0c7' } },
      },
    },
  });

  const bestRows = best.best
    .map((b) => `<span class="badge open" style="margin:2px;">${b.label} · ${b.median}分钟</span>`)
    .join(' ');
  const worstRows = best.worst
    .map((b) => `<span class="badge closed" style="margin:2px;">${b.label} · ${b.median}分钟</span>`)
    .join(' ');
  document.getElementById('best-times').innerHTML = `
    <p style="margin-top:16px;"><strong>✅ 最佳时段：</strong>${bestRows || '<span class="muted">数据不足</span>'}</p>
    <p><strong>⛔ 最拥挤时段：</strong>${worstRows || '<span class="muted">数据不足</span>'}</p>`;
}

// ---- ② 时段推荐 ----
async function loadRecommendations() {
  const time = document.getElementById('rec-time').value || '12:00';
  const dayType = document.getElementById('daytype-2').value;
  const data = await (
    await fetch(`/api/recommendations?time=${time}&dayType=${dayType}`)
  ).json();
  const body = document.getElementById('rec-body');
  if (!data.rides.length) {
    body.innerHTML = `<tr><td colspan="5" class="empty">该时段（${data.bucketLabel}）暂无足够数据</td></tr>`;
    return;
  }
  body.innerHTML = data.rides
    .map(
      (r, i) =>
        `<tr><td>${i + 1}</td><td>${escapeHtml(r.name)}</td><td class="num">${r.medianWait}</td><td class="num">${r.avgWait}</td><td class="num">${r.samples}</td></tr>`
    )
    .join('');
}

// ---- ③ 热力表 ----
async function loadHeatmap() {
  const dayType = document.getElementById('daytype-3').value;
  const data = await (await fetch(`/api/heatmap?dayType=${dayType}`)).json();
  const table = document.getElementById('heatmap');

  if (!data.rides.length) {
    table.innerHTML = '<tr><td class="empty">暂无数据</td></tr>';
    return;
  }

  // 估算整体最大等候用于配色。
  let globalMax = 0;
  for (const r of data.rides) {
    for (const h of data.hours) {
      const cell = r.hours[h];
      if (cell) globalMax = Math.max(globalMax, cell.avg);
    }
  }

  const head =
    '<thead><tr><th class="name">设施 \\ 时段</th>' +
    data.hours.map((h) => `<th>${h}时</th>`).join('') +
    '</tr></thead>';

  const rows = data.rides
    .map((r) => {
      const cells = data.hours
        .map((h) => {
          const cell = r.hours[h];
          if (!cell) return '<td></td>';
          return `<td style="background:${waitColor(cell.avg, globalMax)};color:#fff;" title="${cell.samples} 样本">${Math.round(cell.avg)}</td>`;
        })
        .join('');
      return `<tr><td class="name" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</td>${cells}</tr>`;
    })
    .join('');

  table.innerHTML = head + '<tbody>' + rows + '</tbody>';
}

// ---- 事件绑定 ----
document.getElementById('ride-select').addEventListener('change', loadProfile);
document.getElementById('daytype-1').addEventListener('change', loadProfile);
document.getElementById('bucket-1').addEventListener('change', loadProfile);
document.getElementById('rec-time').addEventListener('change', loadRecommendations);
document.getElementById('daytype-2').addEventListener('change', loadRecommendations);
document.getElementById('daytype-3').addEventListener('change', loadHeatmap);

loadCoverage();
loadRides();
loadRecommendations();
loadHeatmap();
