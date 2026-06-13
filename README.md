# 香港迪士尼乐园排队时间采集与分析

带娃去香港迪士尼之前，先把各项游乐设施的排队时间「观察」一段时间，分析出
**什么时段适合玩什么项目**，到了乐园就能合理安排路线、少排队。

本项目会在乐园运营时段每 5 分钟采集一次官方实时排队数据，存进本地数据库，
并提供网页查看实时排队情况与历史分析。

> 数据来源：[Powered by Queue-Times.com](https://queue-times.com/en-US)。
> queue-times.com 免费开放该数据（每 5 分钟更新），按其要求页面已注明出处。

## 功能

- **实时面板**：当前各设施开放状态与等候时间，按等候时长排序，每 60 秒刷新。
- **采集器**：每 5 分钟拉取一次官方数据，仅在乐园开放时段写入，自动去重。
- **历史分析**：
  1. 单个设施在各时段（15/30/60 分钟粒度）的等候时间曲线（中位/平均/最长），并给出**最佳/最拥挤时段**；
  2. 指定一个时间点，推荐**当下等候最短的设施排名**；
  3. 全设施 × 各小时的**平均等候热力表**；
  4. 支持按「工作日 / 周末 / 全部」筛选。
- **一日游路线规划**：勾选想玩的项目、设置入园/离园时间，基于历史数据按时段预测等候，
  排出一条尽量少排队的游玩顺序——优先在低谷时段玩、把会变拥挤的项目提前、并在高峰时段
  建议自由活动/用餐，给出每个项目的预计到达、排队、上车与结束时间。

## 技术栈

Node.js + Express + better-sqlite3 + node-cron，前端为原生 HTML/JS + Chart.js（CDN），无需构建步骤。

## 快速开始

```bash
npm install
npm start
```

打开 http://localhost:3000 即可。默认情况下，Web 服务进程会**同时**每 5 分钟采集一次数据
（`COLLECT_IN_SERVER=true`），所以只要让这个进程一直运行，就会持续积累历史数据。

> ⚠️ 历史分析需要先积累数据。刚启动时分析页是空的，建议**提前几天到一两周**就开始采集，
> 覆盖工作日和周末、不同时段，分析结果才有参考价值。

### 只采集一次 / 独立采集

```bash
npm run collect        # 只采集一次（适合用系统 cron 调度）
npm run collect:loop   # 独立的常驻采集进程（不启 Web 服务）
```

若希望采集与 Web 服务分开（例如服务器跑采集、本地看网页），可设
`COLLECT_IN_SERVER=false` 启动 Web 服务，再单独运行 `npm run collect:loop`。

## 长期运行建议

采集需要一个「一直开着」的进程。几种常见方式：

### 1. Docker（推荐，最省心）

```bash
docker compose up -d --build
```

数据库持久化在 `./data`，容器重建也不丢历史。

### 2. 系统 cron + 一次性采集

在常开的机器（如 NAS、树莓派、云服务器）上：

```cron
*/5 * * * * cd /path/to/hk-disney-land && /usr/bin/node src/collector.js --once >> data/collect.log 2>&1
```

需要看网页时再 `npm start`。

### 3. 进程守护

用 `pm2`、`systemd` 等让 `npm start` 开机自启并崩溃自动重启。

## 配置（环境变量）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | Web 服务端口 |
| `PARK_ID` | `31` | queue-times.com 的乐园 ID（31 = 香港迪士尼） |
| `TIMEZONE` | `Asia/Hong_Kong` | 用于按本地时段/星期分桶 |
| `POLL_CRON` | `*/5 * * * *` | 采集频率（cron 表达式） |
| `DB_PATH` | `data/queue-times.sqlite` | 数据库文件路径 |
| `COLLECT_IN_SERVER` | `true` | Web 进程内是否一并采集 |

## 数据说明

- 数据存于 SQLite（`data/queue-times.sqlite`），`readings` 表为每次采集的逐设施记录，
  `snapshots` 表记录每个官方数据版本（用于去重与统计覆盖范围）。
- 时间统一以 UTC 存储，并额外记录香港本地的日期 / 时间 / 当日分钟数 / 星期，便于按时段分析。
- 仅在乐园开放（至少一个设施开放）时写入，避免闭园时段的 0 等候噪声。

## API

| 路径 | 说明 |
| --- | --- |
| `GET /api/live` | 实时排队（代理官方接口，60 秒缓存） |
| `GET /api/coverage` | 数据覆盖概览 |
| `GET /api/rides` | 已采集到的设施列表 |
| `GET /api/rides/:id/profile?bucket=30&dayType=all` | 单设施时段画像 |
| `GET /api/rides/:id/best-times?bucket=30&dayType=all` | 最佳/最拥挤时段 |
| `GET /api/recommendations?time=12:00&dayType=all` | 指定时段的设施推荐 |
| `GET /api/heatmap?dayType=all` | 全设施 × 小时热力表 |
| `POST /api/plan` | 一日游路线规划（见下） |

`dayType` 可取 `all` / `weekday` / `weekend`。

`POST /api/plan` 请求体：

```json
{
  "rideIds": [9012, 9018],
  "arrival": "10:00",
  "departure": "20:00",
  "dayType": "all",
  "rideMinutes": 8,
  "walkMinutes": 10
}
```

> 规划为可解释的启发式（贪心 + 高峰推迟），假设你在园内连续游玩；体验时长与步行时间为可调的估算值。
> 结果仅供行前参考，入园后请以官方 App 的实时等候为准。

## 许可

MIT。请保留页面上的 "Powered by Queue-Times.com" 出处标注。
