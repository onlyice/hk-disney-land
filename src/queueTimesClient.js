// 封装对 queue-times.com 的访问。
import { config } from './config.js';

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'hk-disney-land/1.0 (queue time tracker)' },
  });
  if (!res.ok) {
    throw new Error(`请求 ${url} 失败: HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * 拉取乐园当前排队数据。
 * 该乐园 lands 为空，所有设施都在 rides 列表中；这里把可能存在的 lands 一并展平。
 * @returns {Promise<{rides: Array, lastUpdated: string|null}>}
 */
export async function fetchQueueTimes() {
  const data = await fetchJson(config.queueTimesUrl);
  const rides = [...(data.rides ?? [])];
  for (const land of data.lands ?? []) {
    for (const ride of land.rides ?? []) {
      rides.push({ ...ride, land: land.name });
    }
  }

  // 用所有设施中最新的 last_updated 作为本快照的版本标识。
  let lastUpdated = null;
  for (const ride of rides) {
    if (ride.last_updated && (!lastUpdated || ride.last_updated > lastUpdated)) {
      lastUpdated = ride.last_updated;
    }
  }

  return { rides, lastUpdated };
}

export async function fetchParks() {
  return fetchJson(config.parksUrl);
}
