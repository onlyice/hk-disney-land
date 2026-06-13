// 路线规划页逻辑。
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

const sourceMark = (src) => (src === 'exact' ? '' : '*');

async function loadRides() {
  const list = document.getElementById('ride-list');
  const rides = await (await fetch('/api/rides')).json();
  if (!rides.length) {
    list.innerHTML = '<p class="empty">暂无数据，请先采集一段时间。</p>';
    return;
  }
  // 只列出采集到过开放样本的设施（真正可玩的项目）。
  const playable = rides.filter((r) => r.open_samples > 0);
  list.innerHTML = playable
    .map(
      (r) => `<label style="display:block;break-inside:avoid;padding:4px 0;cursor:pointer;">
        <input type="checkbox" class="ride-cb" value="${r.id}" />
        ${escapeHtml(r.name)} <span class="muted">(${r.open_samples})</span>
      </label>`
    )
    .join('');
  updateHint();
}

function checkboxes() {
  return [...document.querySelectorAll('.ride-cb')];
}
function updateHint() {
  const n = checkboxes().filter((c) => c.checked).length;
  document.getElementById('select-hint').textContent = `已选 ${n} 项`;
}

document.getElementById('select-all').addEventListener('click', () => {
  checkboxes().forEach((c) => (c.checked = true));
  updateHint();
});
document.getElementById('select-none').addEventListener('click', () => {
  checkboxes().forEach((c) => (c.checked = false));
  updateHint();
});
document.getElementById('ride-list').addEventListener('change', updateHint);

document.getElementById('generate').addEventListener('click', async () => {
  const rideIds = checkboxes().filter((c) => c.checked).map((c) => Number(c.value));
  if (!rideIds.length) {
    alert('请至少勾选一个项目');
    return;
  }
  const body = {
    rideIds,
    arrival: document.getElementById('arrival').value,
    departure: document.getElementById('departure').value,
    dayType: document.getElementById('daytype').value,
    rideMinutes: Number(document.getElementById('ride-minutes').value),
    walkMinutes: Number(document.getElementById('walk-minutes').value),
  };

  const res = await fetch('/api/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.error) {
    alert(data.error);
    return;
  }
  render(data);
});

function render(data) {
  document.getElementById('result-panel').style.display = '';
  document.getElementById('r-count').textContent = `${data.plannedCount} / ${data.totalRequested}`;
  document.getElementById('r-wait').textContent = `${data.estimatedTotalWait} 分钟`;
  document.getElementById('r-finish').textContent = data.finishAt;

  let n = 0;
  document.getElementById('plan-body').innerHTML = data.steps
    .map((s) => {
      if (s.type === 'idle') {
        return `<tr style="color:var(--muted);font-style:italic;">
          <td>—</td><td>${s.fromAt}</td>
          <td colspan="4">🍵 ${escapeHtml(s.note)}（至 ${s.toAt}）</td>
        </tr>`;
      }
      n += 1;
      return `<tr>
        <td>${n}</td>
        <td>${s.arriveAt}</td>
        <td>${escapeHtml(s.rideName)}</td>
        <td class="num">${s.predictedWait}${sourceMark(s.waitSource)}</td>
        <td>${s.boardAt}</td>
        <td>${s.doneAt}</td>
      </tr>`;
    })
    .join('');

  const leftover = document.getElementById('leftover');
  if (data.leftover.length) {
    leftover.innerHTML =
      '<p style="margin-top:16px;"><strong>⚠️ 时间不够，未能排入：</strong>' +
      data.leftover.map((l) => `<span class="badge closed" style="margin:2px;">${escapeHtml(l.rideName)}</span>`).join(' ') +
      '</p>';
  } else {
    leftover.innerHTML = '<p style="margin-top:16px;" class="muted">✅ 所有选中项目都已排入路线。</p>';
  }
}

loadRides();
