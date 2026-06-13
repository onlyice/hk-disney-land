// 全局配置，可通过环境变量覆盖。
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

export const config = {
  // queue-times.com 上香港迪士尼乐园的 park id。
  parkId: Number(process.env.PARK_ID ?? 31),

  // 乐园所在时区。香港全年 UTC+8，无夏令时。
  timezone: process.env.TIMEZONE ?? 'Asia/Hong_Kong',

  // 采集频率（cron 表达式），默认每 5 分钟，与官方数据更新频率一致。
  pollCron: process.env.POLL_CRON ?? '*/5 * * * *',

  // SQLite 数据库文件位置。
  dbPath: process.env.DB_PATH ?? path.join(rootDir, 'data', 'queue-times.sqlite'),

  // Web 服务端口。
  port: Number(process.env.PORT ?? 3000),

  // 是否在 Web 服务进程内一并运行采集任务（单进程方案）。
  // 设为 'false' 时，需另行运行 `npm run collect:loop`。
  collectInServer: (process.env.COLLECT_IN_SERVER ?? 'true') !== 'false',

  // queue-times API 地址。
  get parksUrl() {
    return 'https://queue-times.com/parks.json';
  },
  get queueTimesUrl() {
    return `https://queue-times.com/parks/${this.parkId}/queue_times.json`;
  },
};
