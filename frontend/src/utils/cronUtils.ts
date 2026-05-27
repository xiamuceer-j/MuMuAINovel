/** Cron 表达式工具函数 */

export type CronFrequency = 'daily' | 'weekdays' | 'weekly' | 'every_30_minutes';
export type CronMode = 'visual' | 'advanced';

export const WEEKDAY_OPTIONS = [
  { value: '1', label: '周一' },
  { value: '2', label: '周二' },
  { value: '3', label: '周三' },
  { value: '4', label: '周四' },
  { value: '5', label: '周五' },
  { value: '6', label: '周六' },
  { value: '0', label: '周日' },
];

export const HOUR_OPTIONS = Array.from({ length: 24 }, (_, index) => ({
  value: index,
  label: `${String(index).padStart(2, '0')} 时`,
}));

export const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, index) => ({
  value: index,
  label: `${String(index).padStart(2, '0')} 分`,
}));

export interface CronParseResult {
  mode: CronMode;
  frequency: CronFrequency;
  hour: number;
  minute: number;
  weekday: string;
  cronExpr: string;
}

/** 从可视化参数生成 Cron 表达式 */
export function buildCronExpression(
  frequency: CronFrequency,
  hour: number,
  minute: number,
  weekday: string,
): string {
  if (frequency === 'every_30_minutes') {
    return '*/30 * * * *';
  }
  if (frequency === 'weekdays') {
    return `${minute} ${hour} * * 1-5`;
  }
  if (frequency === 'weekly') {
    return `${minute} ${hour} * * ${weekday}`;
  }
  return `${minute} ${hour} * * *`;
}

/** 从 Cron 表达式解析为可视化参数 */
export function parseCronExpression(cronExpr?: string | null): CronParseResult {
  const fallback: CronParseResult = {
    mode: 'visual',
    frequency: 'daily',
    hour: 9,
    minute: 0,
    weekday: '1',
    cronExpr: '0 9 * * *',
  };

  const rawExpr = (cronExpr || fallback.cronExpr).trim();
  const parts = rawExpr.split(/\s+/);
  if (parts.length !== 5) {
    return { ...fallback, mode: 'advanced', cronExpr: rawExpr || fallback.cronExpr };
  }

  const [minutePart, hourPart, dayOfMonth, month, dayOfWeek] = parts;

  if (
    (minutePart === '*/30' || minutePart === '0,30') &&
    hourPart === '*' &&
    dayOfMonth === '*' &&
    month === '*' &&
    dayOfWeek === '*'
  ) {
    return {
      mode: 'visual',
      frequency: 'every_30_minutes',
      hour: 0,
      minute: 0,
      weekday: '1',
      cronExpr: '*/30 * * * *',
    };
  }

  const minute = Number(minutePart);
  const hour = Number(hourPart);

  if (
    Number.isNaN(minute) ||
    Number.isNaN(hour) ||
    minute < 0 ||
    minute > 59 ||
    hour < 0 ||
    hour > 23 ||
    dayOfMonth !== '*' ||
    month !== '*'
  ) {
    return { ...fallback, mode: 'advanced', cronExpr: rawExpr };
  }

  if (dayOfWeek === '*') {
    return { mode: 'visual', frequency: 'daily', hour, minute, weekday: '1', cronExpr: rawExpr };
  }

  if (dayOfWeek === '1-5') {
    return { mode: 'visual', frequency: 'weekdays', hour, minute, weekday: '1', cronExpr: rawExpr };
  }

  if (
    WEEKDAY_OPTIONS.some(
      (option) => option.value === dayOfWeek || (dayOfWeek === '7' && option.value === '0'),
    )
  ) {
    return {
      mode: 'visual',
      frequency: 'weekly',
      hour,
      minute,
      weekday: dayOfWeek === '7' ? '0' : dayOfWeek,
      cronExpr: rawExpr,
    };
  }

  return { ...fallback, mode: 'advanced', cronExpr: rawExpr };
}
