// 实时面板逻辑。
function waitClass(minutes) {
  if (minutes <= 20) return 'low';
  if (minutes <= 45) return 'mid';
  return 'high';
}

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong', hour12: false });
}

async function loadLive() {
  const body = document.getElementById('live-body');
  try {
    const res = await fetch('/api/live');
    if (!res.ok) throw new Error('接口返回 ' + res.status);
    const data = await res.json();

    document.getElementById('park-status').textContent = data.parkOpen ? '开放中' : '已闭园';
    document.getElementById('open-count').textContent = `${data.openCount} / ${data.totalCount}`;
    document.getElementById('last-updated').textContent = fmtTime(data.lastUpdated);

    if (!data.rides.length) {
      body.innerHTML = '<tr><td colspan="3" class="empty">暂无数据</td></tr>';
      return;
    }

    body.innerHTML = data.rides
      .map((r) => {
        const status = r.isOpen
          ? '<span class="badge open">开放</span>'
          : '<span class="badge closed">关闭</span>';
        const wait = r.isOpen
          ? `<span class="wait ${waitClass(r.waitTime)}">${r.waitTime}</span>`
          : '<span class="muted">—</span>';
        return `<tr><td>${escapeHtml(r.name)}</td><td>${status}</td><td class="num">${wait}</td></tr>`;
      })
      .join('');
  } catch (err) {
    body.innerHTML = `<tr><td colspan="3" class="empty">加载失败：${escapeHtml(err.message)}</td></tr>`;
  }
}

async function loadCoverage() {
  try {
    const res = await fetch('/api/coverage');
    const c = await res.json();
    document.getElementById('days-covered').textContent = c.daysCovered ?? 0;
  } catch {
    /* 忽略 */
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

loadLive();
loadCoverage();
setInterval(loadLive, 60_000);
