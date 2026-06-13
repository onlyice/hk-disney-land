// 一日游路线规划：基于历史等候数据，为选定的设施排出尽量少排队的游玩顺序。
//
// 算法为可解释的贪心模拟：从入园时刻起，每一步在剩余设施中挑选"此刻性价比最高"的一个——
// 既偏好当前预测等候短的，也优先安排"稍后会更拥挤"的设施（趁现在人少先玩）。
import { db } from './db.js';

const BUCKET = 30; // 预测用的时段粒度（分钟）

function dayTypeClause(dayType) {
  if (dayType === 'weekend') return 'AND weekday IN (0, 6)';
  if (dayType === 'weekday') return 'AND weekday NOT IN (0, 6)';
  return '';
}

function median(sorted) {
  const n = sorted.length;
  if (n === 0) return null;
  const mid = Math.floor(n / 2);
  return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function minutesToHHMM(minutes) {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function hhmmToMinutes(time) {
  const [h, m] = String(time).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * 为选定的设施建立"时段 → 中位等候"的查表，并提供带回退的预测函数。
 */
function buildPredictor(rideIds, dayType, defaultWait) {
  const placeholders = rideIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT ride_id, ride_name, local_minutes, wait_time
       FROM readings
       WHERE is_open = 1 AND ride_id IN (${placeholders}) ${dayTypeClause(dayType)}`
    )
    .all(...rideIds);

  // ride_id -> { name, buckets: Map<bucketStart, waits[]>, all: waits[] }
  const byRide = new Map();
  for (const id of rideIds) byRide.set(id, { name: `#${id}`, buckets: new Map(), all: [] });

  for (const { ride_id, ride_name, local_minutes, wait_time } of rows) {
    const entry = byRide.get(ride_id);
    if (!entry) continue;
    entry.name = ride_name;
    const b = Math.floor(local_minutes / BUCKET) * BUCKET;
    if (!entry.buckets.has(b)) entry.buckets.set(b, []);
    entry.buckets.get(b).push(wait_time);
    entry.all.push(wait_time);
  }

  // 预计算每个桶的中位与整体中位。
  const medians = new Map(); // ride_id -> { name, bucketMedian: Map, overall: number|null }
  for (const [id, entry] of byRide) {
    const bucketMedian = new Map();
    for (const [b, waits] of entry.buckets) {
      waits.sort((a, b2) => a - b2);
      bucketMedian.set(b, median(waits));
    }
    entry.all.sort((a, b2) => a - b2);
    medians.set(id, { name: entry.name, bucketMedian, overall: median(entry.all) });
  }

  /**
   * 预测某设施在某时刻的等候时间，带多级回退。
   * @returns {{wait:number, source:'exact'|'nearby'|'overall'|'default'}}
   */
  function predict(rideId, minutes) {
    const info = medians.get(rideId);
    if (!info) return { wait: defaultWait, source: 'default' };
    const b = Math.floor(minutes / BUCKET) * BUCKET;
    if (info.bucketMedian.has(b)) return { wait: info.bucketMedian.get(b), source: 'exact' };

    // 回退 1：在 ±90 分钟内找最近的有数据的桶。
    for (let step = BUCKET; step <= 90; step += BUCKET) {
      if (info.bucketMedian.has(b - step)) return { wait: info.bucketMedian.get(b - step), source: 'nearby' };
      if (info.bucketMedian.has(b + step)) return { wait: info.bucketMedian.get(b + step), source: 'nearby' };
    }
    // 回退 2：该设施的整体中位。
    if (info.overall != null) return { wait: info.overall, source: 'overall' };
    // 回退 3：默认估计值。
    return { wait: defaultWait, source: 'default' };
  }

  const name = (id) => medians.get(id)?.name ?? `#${id}`;

  return { predict, name };
}

/**
 * 生成游玩路线。
 * @param {object} opts
 * @param {number[]} opts.rideIds       想玩的设施 id
 * @param {string}   opts.arrival       入园时间 HH:MM
 * @param {string}   opts.departure     离园时间 HH:MM
 * @param {'all'|'weekday'|'weekend'} [opts.dayType]
 * @param {number}   [opts.rideMinutes] 每个项目的体验时长（分钟）
 * @param {number}   [opts.walkMinutes] 项目间的步行/缓冲时长（分钟）
 * @param {number}   [opts.defaultWait] 无历史数据时的等候估计
 */
export function planItinerary({
  rideIds,
  arrival,
  departure,
  dayType = 'all',
  rideMinutes = 8,
  walkMinutes = 10,
  defaultWait = 25,
}) {
  const ids = [...new Set((rideIds || []).map(Number).filter(Boolean))];
  if (ids.length === 0) {
    return { error: '请至少选择一个设施' };
  }

  const arrivalMin = hhmmToMinutes(arrival);
  const departureMin = hhmmToMinutes(departure);
  if (departureMin <= arrivalMin) {
    return { error: '离园时间需晚于入园时间' };
  }

  const { predict, name } = buildPredictor(ids, dayType, defaultWait);

  // 比"未来最低等候"贵这么多分钟时，倾向于推迟该设施，先做别的或留出自由时间。
  const WAIT_THRESHOLD = 20;

  // 某设施在 [from, departure] 内的最低预测等候。
  function futureMinWait(id, from) {
    let min = Infinity;
    for (let tt = from; tt < departureMin; tt += BUCKET) {
      min = Math.min(min, predict(id, tt).wait);
    }
    return Number.isFinite(min) ? min : predict(id, from).wait;
  }

  const remaining = new Set(ids);
  const steps = [];
  let t = arrivalMin;
  let totalWait = 0;
  const maxIterations = ids.length * 4 + Math.ceil((departureMin - arrivalMin) / BUCKET) + 4;

  for (let iter = 0; remaining.size > 0 && t < departureMin && iter < maxIterations; iter++) {
    const arriveRide = t + walkMinutes;

    const candidates = [...remaining].map((id) => {
      const cur = predict(id, arriveRide);
      const fmin = futureMinWait(id, arriveRide);
      return { id, cur, fmin, worthWaiting: cur.wait - fmin > WAIT_THRESHOLD };
    });

    // 优先做"此刻已接近其最低等候"的设施，其中选当前等候最短的。
    const pool = candidates.filter((c) => !c.worthWaiting);

    if (pool.length === 0) {
      // 剩余设施此刻都明显偏贵：把时间推进到最近一个会变便宜的时段，留出自由活动时间。
      let jumpTo = Infinity;
      for (const c of candidates) {
        for (let tt = t + BUCKET; tt < departureMin; tt += BUCKET) {
          if (predict(c.id, tt + walkMinutes).wait <= c.fmin + WAIT_THRESHOLD) {
            jumpTo = Math.min(jumpTo, tt);
            break;
          }
        }
      }
      if (!Number.isFinite(jumpTo) || jumpTo <= t) break; // 无法再改善，结束。
      steps.push({
        type: 'idle',
        fromAt: minutesToHHMM(t),
        toAt: minutesToHHMM(jumpTo),
        note: '自由活动 / 用餐 / 看表演（避开排队高峰）',
      });
      t = jumpTo;
      continue;
    }

    pool.sort((a, b) => a.cur.wait - b.cur.wait);
    const chosen = pool[0];
    const wait = chosen.cur.wait;
    const boardTime = arriveRide + wait;
    const doneTime = boardTime + rideMinutes;

    if (boardTime >= departureMin) break; // 排到队也来不及在离园前上。

    steps.push({
      type: 'ride',
      rideId: chosen.id,
      rideName: name(chosen.id),
      arriveAt: minutesToHHMM(arriveRide),
      predictedWait: Math.round(wait),
      waitSource: chosen.cur.source,
      boardAt: minutesToHHMM(boardTime),
      doneAt: minutesToHHMM(doneTime),
    });

    totalWait += wait;
    t = doneTime;
    remaining.delete(chosen.id);
  }

  const leftover = [...remaining].map((id) => ({ rideId: id, rideName: name(id) }));
  const rideSteps = steps.filter((s) => s.type === 'ride');

  return {
    arrival,
    departure,
    dayType,
    rideMinutes,
    walkMinutes,
    plannedCount: rideSteps.length,
    totalRequested: ids.length,
    estimatedTotalWait: Math.round(totalWait),
    finishAt: rideSteps.length ? rideSteps[rideSteps.length - 1].doneAt : arrival,
    steps,
    leftover,
  };
}
