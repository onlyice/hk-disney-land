// 历史数据分析：按时段统计等候时间、推荐最佳游玩时段。
import { db } from './db.js';

// 周末/工作日筛选条件，拼进 SQL 的 WHERE。
function dayTypeClause(dayType) {
  if (dayType === 'weekend') return 'AND weekday IN (0, 6)';
  if (dayType === 'weekday') return 'AND weekday NOT IN (0, 6)';
  return '';
}

function median(sortedNumbers) {
  const n = sortedNumbers.length;
  if (n === 0) return null;
  const mid = Math.floor(n / 2);
  return n % 2 ? sortedNumbers[mid] : (sortedNumbers[mid - 1] + sortedNumbers[mid]) / 2;
}

function percentile(sortedNumbers, p) {
  const n = sortedNumbers.length;
  if (n === 0) return null;
  const idx = Math.min(n - 1, Math.floor((p / 100) * n));
  return sortedNumbers[idx];
}

// 数据覆盖范围概览。
export function getCoverage() {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS readings,
              COUNT(DISTINCT local_date) AS days,
              MIN(local_date) AS first_day,
              MAX(local_date) AS last_day
       FROM readings`
    )
    .get();
  const snapshots = db.prepare('SELECT COUNT(*) AS c FROM snapshots').get().c;
  return {
    totalReadings: row.readings,
    totalSnapshots: snapshots,
    daysCovered: row.days,
    firstDay: row.first_day,
    lastDay: row.last_day,
  };
}

// 设施列表：含已采集到的样本数与名称。按名称排序。
export function listRides() {
  return db
    .prepare(
      `SELECT ride_id AS id,
              ride_name AS name,
              COUNT(*) AS samples,
              SUM(CASE WHEN is_open = 1 THEN 1 ELSE 0 END) AS open_samples,
              MAX(local_date) AS last_seen
       FROM readings
       GROUP BY ride_id, ride_name
       ORDER BY ride_name COLLATE NOCASE`
    )
    .all();
}

/**
 * 某设施按时段（默认每 30 分钟一桶）的等候时间画像。
 * 仅统计设施开放的样本。
 * @param {number} rideId
 * @param {{bucketMinutes?:number, dayType?:'all'|'weekend'|'weekday'}} options
 */
export function getRideProfile(rideId, { bucketMinutes = 30, dayType = 'all' } = {}) {
  const rows = db
    .prepare(
      `SELECT local_minutes, wait_time
       FROM readings
       WHERE ride_id = ? AND is_open = 1 ${dayTypeClause(dayType)}
       ORDER BY local_minutes`
    )
    .all(rideId);

  const meta = db
    .prepare('SELECT ride_name FROM readings WHERE ride_id = ? LIMIT 1')
    .get(rideId);

  // 按桶聚合等候时间。
  const buckets = new Map();
  for (const { local_minutes, wait_time } of rows) {
    const bucketStart = Math.floor(local_minutes / bucketMinutes) * bucketMinutes;
    if (!buckets.has(bucketStart)) buckets.set(bucketStart, []);
    buckets.get(bucketStart).push(wait_time);
  }

  const profile = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([bucketStart, waits]) => {
      waits.sort((a, b) => a - b);
      const sum = waits.reduce((acc, w) => acc + w, 0);
      return {
        bucketStart,
        label: minutesToHHMM(bucketStart),
        samples: waits.length,
        avg: Math.round((sum / waits.length) * 10) / 10,
        median: median(waits),
        min: waits[0],
        max: waits[waits.length - 1],
        p90: percentile(waits, 90),
      };
    });

  return {
    rideId,
    rideName: meta?.ride_name ?? `#${rideId}`,
    bucketMinutes,
    dayType,
    totalSamples: rows.length,
    profile,
  };
}

/**
 * 某设施的最佳游玩时段（开放且等候时间中位数最低的若干个桶）。
 */
export function getBestTimes(rideId, options = {}) {
  const { profile, ...rest } = getRideProfile(rideId, options);
  // 样本太少的桶不可靠，至少要有 3 个样本。
  const reliable = profile.filter((b) => b.samples >= 3);
  const ranked = [...reliable].sort((a, b) => a.median - b.median);
  return {
    ...rest,
    rideId,
    best: ranked.slice(0, 5),
    worst: ranked.slice(-3).reverse(),
  };
}

/**
 * 给定某个本地时段，推荐当下等候时间最短的设施排名。
 * @param {string} time HH:MM
 * @param {{bucketMinutes?:number, dayType?:'all'|'weekend'|'weekday'}} options
 */
export function getRecommendations(time, { bucketMinutes = 30, dayType = 'all' } = {}) {
  const targetMinutes = hhmmToMinutes(time);
  const bucketStart = Math.floor(targetMinutes / bucketMinutes) * bucketMinutes;
  const bucketEnd = bucketStart + bucketMinutes;

  const rows = db
    .prepare(
      `SELECT ride_id, ride_name, wait_time
       FROM readings
       WHERE is_open = 1
         AND local_minutes >= ? AND local_minutes < ?
         ${dayTypeClause(dayType)}`
    )
    .all(bucketStart, bucketEnd);

  const byRide = new Map();
  for (const { ride_id, ride_name, wait_time } of rows) {
    if (!byRide.has(ride_id)) byRide.set(ride_id, { id: ride_id, name: ride_name, waits: [] });
    byRide.get(ride_id).waits.push(wait_time);
  }

  const result = [...byRide.values()]
    .map((r) => {
      r.waits.sort((a, b) => a - b);
      return {
        id: r.id,
        name: r.name,
        samples: r.waits.length,
        medianWait: median(r.waits),
        avgWait: Math.round((r.waits.reduce((s, w) => s + w, 0) / r.waits.length) * 10) / 10,
      };
    })
    .filter((r) => r.samples >= 2)
    .sort((a, b) => a.medianWait - b.medianWait);

  return {
    time,
    bucketLabel: `${minutesToHHMM(bucketStart)} - ${minutesToHHMM(bucketEnd)}`,
    dayType,
    rides: result,
  };
}

/**
 * 热力表数据：每个设施在各整点的平均等候时间。
 */
export function getHeatmap({ dayType = 'all' } = {}) {
  const rows = db
    .prepare(
      `SELECT ride_id, ride_name,
              (local_minutes / 60) AS hour,
              AVG(wait_time) AS avg_wait,
              COUNT(*) AS samples
       FROM readings
       WHERE is_open = 1 ${dayTypeClause(dayType)}
       GROUP BY ride_id, hour
       ORDER BY ride_name COLLATE NOCASE`
    )
    .all();

  const ridesMap = new Map();
  let minHour = 24;
  let maxHour = 0;
  for (const { ride_id, ride_name, hour, avg_wait, samples } of rows) {
    if (!ridesMap.has(ride_id)) {
      ridesMap.set(ride_id, { id: ride_id, name: ride_name, hours: {} });
    }
    ridesMap.get(ride_id).hours[hour] = {
      avg: Math.round(avg_wait * 10) / 10,
      samples,
    };
    minHour = Math.min(minHour, hour);
    maxHour = Math.max(maxHour, hour);
  }

  const hours = [];
  if (ridesMap.size > 0) {
    for (let h = minHour; h <= maxHour; h++) hours.push(h);
  }

  return {
    dayType,
    hours,
    rides: [...ridesMap.values()],
  };
}

function minutesToHHMM(minutes) {
  const h = String(Math.floor(minutes / 60) % 24).padStart(2, '0');
  const m = String(minutes % 60).padStart(2, '0');
  return `${h}:${m}`;
}

function hhmmToMinutes(time) {
  const [h, m] = String(time).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
