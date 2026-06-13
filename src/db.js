// SQLite 数据访问层。
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS readings (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    ride_id      INTEGER NOT NULL,
    ride_name    TEXT    NOT NULL,
    is_open      INTEGER NOT NULL,
    wait_time    INTEGER NOT NULL,
    recorded_at  TEXT    NOT NULL,  -- 本次采集时间 (UTC ISO)
    last_updated TEXT,              -- 官方数据的更新时间 (UTC ISO)
    local_date   TEXT    NOT NULL,  -- 香港本地日期 YYYY-MM-DD
    local_time   TEXT    NOT NULL,  -- 香港本地时间 HH:MM
    local_minutes INTEGER NOT NULL, -- 香港本地的当日分钟数 (0-1439)
    weekday      INTEGER NOT NULL   -- 0=周日 .. 6=周六 (香港本地)
  );

  CREATE INDEX IF NOT EXISTS idx_readings_ride   ON readings (ride_id);
  CREATE INDEX IF NOT EXISTS idx_readings_minute ON readings (local_minutes);
  CREATE INDEX IF NOT EXISTS idx_readings_date   ON readings (local_date);

  -- 记录每次成功采集的快照，便于去重与统计数据覆盖范围。
  CREATE TABLE IF NOT EXISTS snapshots (
    last_updated TEXT PRIMARY KEY,  -- 官方数据更新时间，作为去重键
    recorded_at  TEXT NOT NULL,
    local_date   TEXT NOT NULL,
    open_rides   INTEGER NOT NULL,
    total_rides  INTEGER NOT NULL
  );
`);

const insertReadingStmt = db.prepare(`
  INSERT INTO readings
    (ride_id, ride_name, is_open, wait_time, recorded_at, last_updated,
     local_date, local_time, local_minutes, weekday)
  VALUES
    (@ride_id, @ride_name, @is_open, @wait_time, @recorded_at, @last_updated,
     @local_date, @local_time, @local_minutes, @weekday)
`);

const insertSnapshotStmt = db.prepare(`
  INSERT OR IGNORE INTO snapshots
    (last_updated, recorded_at, local_date, open_rides, total_rides)
  VALUES (@last_updated, @recorded_at, @local_date, @open_rides, @total_rides)
`);

const snapshotExistsStmt = db.prepare(
  'SELECT 1 FROM snapshots WHERE last_updated = ?'
);

export function snapshotExists(lastUpdated) {
  if (!lastUpdated) return false;
  return Boolean(snapshotExistsStmt.get(lastUpdated));
}

export const insertSnapshot = db.transaction((snapshot, readings) => {
  insertSnapshotStmt.run(snapshot);
  for (const r of readings) insertReadingStmt.run(r);
});
