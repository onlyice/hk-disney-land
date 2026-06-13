// Web 服务：提供静态前端 + 实时数据代理 + 历史分析 API。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config } from './config.js';
import { fetchQueueTimes } from './queueTimesClient.js';
import { startCollector } from './collector.js';
import {
  getCoverage,
  listRides,
  getRideProfile,
  getBestTimes,
  getRecommendations,
  getHeatmap,
} from './analysis.js';
import { planItinerary } from './planner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---- 实时数据（带 60 秒内存缓存，避免频繁打官方接口）----
let liveCache = { at: 0, data: null };
app.get('/api/live', async (req, res) => {
  try {
    if (Date.now() - liveCache.at < 60_000 && liveCache.data) {
      return res.json({ ...liveCache.data, cached: true });
    }
    const { rides, lastUpdated } = await fetchQueueTimes();
    const open = rides.filter((r) => r.is_open);
    const payload = {
      parkOpen: open.length > 0,
      lastUpdated,
      openCount: open.length,
      totalCount: rides.length,
      rides: rides
        .map((r) => ({ id: r.id, name: r.name, isOpen: r.is_open, waitTime: r.wait_time }))
        .sort((a, b) => Number(b.isOpen) - Number(a.isOpen) || b.waitTime - a.waitTime),
    };
    liveCache = { at: Date.now(), data: payload };
    res.json(payload);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ---- 历史分析 ----
app.get('/api/coverage', (req, res) => res.json(getCoverage()));

app.get('/api/rides', (req, res) => res.json(listRides()));

app.get('/api/rides/:id/profile', (req, res) => {
  const id = Number(req.params.id);
  const bucketMinutes = Number(req.query.bucket) || 30;
  const dayType = req.query.dayType || 'all';
  res.json(getRideProfile(id, { bucketMinutes, dayType }));
});

app.get('/api/rides/:id/best-times', (req, res) => {
  const id = Number(req.params.id);
  const bucketMinutes = Number(req.query.bucket) || 30;
  const dayType = req.query.dayType || 'all';
  res.json(getBestTimes(id, { bucketMinutes, dayType }));
});

app.get('/api/recommendations', (req, res) => {
  const time = req.query.time || '12:00';
  const bucketMinutes = Number(req.query.bucket) || 30;
  const dayType = req.query.dayType || 'all';
  res.json(getRecommendations(time, { bucketMinutes, dayType }));
});

app.get('/api/heatmap', (req, res) => {
  const dayType = req.query.dayType || 'all';
  res.json(getHeatmap({ dayType }));
});

// ---- 一日游路线规划 ----
app.post('/api/plan', (req, res) => {
  const result = planItinerary(req.body || {});
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

app.listen(config.port, () => {
  console.log(`Web 服务已启动：http://localhost:${config.port}`);
  if (config.collectInServer) {
    startCollector();
  } else {
    console.log('采集任务未在服务进程内运行（COLLECT_IN_SERVER=false），请单独运行 `npm run collect:loop`。');
  }
});
