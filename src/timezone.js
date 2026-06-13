// 把 UTC 时间转换为乐园本地时间的各个组成部分，用于按"本地时段/星期"分桶统计。
// 使用 Intl 而非简单加 8 小时，便于将来适配其他有夏令时的乐园。

const partsCache = new Map();

function formatterFor(timezone) {
  if (!partsCache.has(timezone)) {
    partsCache.set(
      timezone,
      new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        weekday: 'short',
      })
    );
  }
  return partsCache.get(timezone);
}

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * @param {Date} date
 * @param {string} timezone
 * @returns {{localDate:string, localTime:string, localMinutes:number, weekday:number}}
 */
export function toLocalParts(date, timezone) {
  const parts = formatterFor(timezone).formatToParts(date);
  const lookup = {};
  for (const p of parts) lookup[p.type] = p.value;

  let hour = lookup.hour;
  // Intl 在某些环境下会把午夜输出为 "24"，归一化为 "00"。
  if (hour === '24') hour = '00';

  const minute = lookup.minute;
  const localMinutes = Number(hour) * 60 + Number(minute);

  return {
    localDate: `${lookup.year}-${lookup.month}-${lookup.day}`,
    localTime: `${hour}:${minute}`,
    localMinutes,
    weekday: WEEKDAY_INDEX[lookup.weekday] ?? 0,
  };
}

export const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function isWeekend(weekday) {
  return weekday === 0 || weekday === 6;
}
