/**
 * Calendar dates as `YYYY-MM-DD` strings and as integer day numbers (days since
 * 1970-01-01). Day numbers are timezone-free: they never pass through a local
 * `Date`, so the same inputs give the same schedule in the browser and on the server.
 */

export type ISODate = string;

const MS_PER_DAY = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad2 = (n: number) => String(n).padStart(2, "0");

export function toDayNum(date: ISODate): number {
  const m = ISO_DATE.exec(date);
  if (!m) throw new Error(`Invalid date: ${date}`);
  return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / MS_PER_DAY);
}

export function fromDayNum(day: number): ISODate {
  const d = new Date(day * MS_PER_DAY);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function isValidISODate(value: string): boolean {
  return ISO_DATE.test(value) && fromDayNum(toDayNum(value)) === value;
}

export function addDays(date: ISODate, days: number): ISODate {
  return fromDayNum(toDayNum(date) + days);
}

export function diffDays(later: ISODate, earlier: ISODate): number {
  return toDayNum(later) - toDayNum(earlier);
}

/**
 * The app's clock is Beijing time everywhere: "today" and which of 早/中/晚 have passed are
 * the same for every visitor and for the server, whatever their own time zone is.
 */
export const APP_TIME_ZONE = "Asia/Shanghai";

/** The wall-clock date and minute-of-day in `timeZone` (default: Beijing time). */
export function wallClock(now: Date = new Date(), timeZone: string = APP_TIME_ZONE): { date: ISODate; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

/** `2027-02-14` → `2027年02月14日` */
export function formatDateCN(date: ISODate): string {
  const [y, m, d] = date.split("-");
  return `${y}年${m}月${d}日`;
}

/** `2027-02-14` → `02-14` */
export function formatMonthDay(date: ISODate): string {
  return date.slice(5);
}
