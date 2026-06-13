// 采集任务：拉取实时排队数据并写入数据库。
// 既可被 server.js 以 cron 方式调用，也可独立运行：
//   node src/collector.js --once   只采集一次
//   node src/collector.js          按 cron 持续采集
import cron from 'node-cron';
import { config } from './config.js';
import { fetchQueueTimes } from './queueTimesClient.js';
import { snapshotExists, insertSnapshot } from './db.js';
import { toLocalParts } from './timezone.js';
import { refreshCrowdData } from './crowdCalendar.js';

/**
 * 执行一次采集。仅在乐园开放（至少一个设施 is_open）时写入，
 * 避免闭园时段大量等候时间为 0 的噪声数据。
 * @returns {Promise<{stored:boolean, reason?:string, openRides?:number, totalRides?:number}>}
 */
export async function collectOnce(now = new Date()) {
  const { rides, lastUpdated } = await fetchQueueTimes();

  if (rides.length === 0) {
    return { stored: false, reason: '接口未返回任何设施' };
  }

  const openRides = rides.filter((r) => r.is_open).length;
  if (openRides === 0) {
    return { stored: false, reason: '乐园未开放', openRides: 0, totalRides: rides.length };
  }

  // 官方数据每 5 分钟才更新一次，若该版本已采集过则跳过，避免重复。
  if (snapshotExists(lastUpdated)) {
    return { stored: false, reason: '数据未更新（已采集过该快照）', openRides, totalRides: rides.length };
  }

  const recordedAt = now.toISOString();
  const local = toLocalParts(now, config.timezone);

  const readingRows = rides.map((r) => ({
    ride_id: r.id,
    ride_name: r.name,
    is_open: r.is_open ? 1 : 0,
    wait_time: Number.isFinite(r.wait_time) ? r.wait_time : 0,
    recorded_at: recordedAt,
    last_updated: r.last_updated ?? lastUpdated,
    local_date: local.localDate,
    local_time: local.localTime,
    local_minutes: local.localMinutes,
    weekday: local.weekday,
  }));

  insertSnapshot(
    {
      last_updated: lastUpdated,
      recorded_at: recordedAt,
      local_date: local.localDate,
      open_rides: openRides,
      total_rides: rides.length,
    },
    readingRows
  );

  return { stored: true, openRides, totalRides: rides.length, localTime: local.localTime };
}

async function runWithLogging() {
  try {
    const result = await collectOnce();
    const ts = new Date().toISOString();
    if (result.stored) {
      console.log(
        `[${ts}] 已采集：开放 ${result.openRides}/${result.totalRides} 个设施（本地 ${result.localTime}）`
      );
    } else {
      console.log(`[${ts}] 跳过：${result.reason}`);
    }
  } catch (err) {
    console.error(`[${new Date().toISOString()}] 采集失败：`, err.message);
  }
}

async function refreshCrowdWithLogging() {
  try {
    const r = await refreshCrowdData();
    console.log(
      `[${new Date().toISOString()}] 已更新拥挤日历：星期 ${r.weekdays}、月份 ${r.months}、每日 ${r.dailyDays} 天`
    );
  } catch (err) {
    console.error(`[${new Date().toISOString()}] 拥挤日历更新失败：`, err.message);
  }
}

export function startCollector() {
  console.log(
    `采集任务已启动（cron: ${config.pollCron}，时区: ${config.timezone}，park: ${config.parkId}）`
  );
  // 启动时立即采集一次，随后按 cron 周期执行。
  runWithLogging();
  cron.schedule(config.pollCron, runWithLogging, { timezone: config.timezone });

  // 拥挤日历（最佳到访日）变化缓慢，每天刷新一次即可。
  refreshCrowdWithLogging();
  cron.schedule('0 4 * * *', refreshCrowdWithLogging, { timezone: config.timezone });
}

// 作为独立脚本运行时的入口。
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  if (process.argv.includes('--once')) {
    runWithLogging().then(() => process.exit(0));
  } else {
    startCollector();
  }
}
