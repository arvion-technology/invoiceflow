/**
 * Calendar dates for invoiceflow.
 *
 * An invoice date is a *calendar date*, not an instant: "2026-10-28" means the
 * same day for a client in Kathmandu and a client in Toronto. Storing those as
 * epoch milliseconds invites the classic bug where an invoice issued at 00:15
 * local time is filed under the previous UTC day, and then a due date lands a
 * day early. So dates live as `YYYY-MM-DD` strings and every helper here does
 * arithmetic in UTC midnight space, where no timezone can shift them.
 */

export const DAY_MS = 86_400_000;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Milliseconds at UTC midnight for a date key. Throws on invalid input. */
export function toUTC(key) {
  if (typeof key !== "string" || !DATE_RE.test(key)) {
    throw new TypeError(`invalid date key: ${key}`);
  }
  const [, y, m, d] = DATE_RE.exec(key).map(Number);
  const ms = Date.UTC(y, m - 1, d);
  const check = new Date(ms);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    throw new RangeError(`not a real date: ${key}`);
  }
  return ms;
}

/** True when `key` is a well-formed, existing calendar date. */
export function isValidDateKey(key) {
  try {
    toUTC(key);
    return true;
  } catch {
    return false;
  }
}

/** The UTC date key containing a timestamp. */
export function dateKey(ts) {
  const d = new Date(ts);
  if (Number.isNaN(+d)) throw new TypeError(`invalid timestamp: ${ts}`);
  return d.toISOString().slice(0, 10);
}

/** Last millisecond of a calendar date, the moment an invoice becomes overdue. */
export function endOfDay(key) {
  return toUTC(key) + DAY_MS - 1;
}

/** Add (or subtract) whole days to a date key. */
export function addDays(key, days) {
  if (!Number.isInteger(days)) throw new TypeError("days must be an integer");
  return dateKey(toUTC(key) + days * DAY_MS);
}

/** Whole days from `b` to `a` (positive when `a` is later). */
export function diffDays(a, b) {
  return Math.round((toUTC(a) - toUTC(b)) / DAY_MS);
}

export function todayKey(now = Date.now()) {
  return dateKey(now);
}

export function dayOf(key) {
  return new Date(toUTC(key)).getUTCDate();
}

export function monthOf(key) {
  return new Date(toUTC(key)).getUTCMonth() + 1;
}

export function yearOf(key) {
  return new Date(toUTC(key)).getUTCFullYear();
}

/** Number of days in a 1-indexed month. */
export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Add months while keeping the original anchor day. This is the rule invoicing
 * actually needs: a retainer anchored on the 31st bills Feb 28 (or 29), then
 * returns to the 31st in March instead of drifting to the 28th forever.
 */
export function addMonthsClamped(key, months, anchorDay = dayOf(key)) {
  if (!Number.isInteger(months)) throw new TypeError("months must be an integer");
  if (!Number.isInteger(anchorDay) || anchorDay < 1 || anchorDay > 31) {
    throw new RangeError("anchorDay must be 1..31");
  }
  const year = yearOf(key);
  const month = monthOf(key);
  const total = year * 12 + (month - 1) + months;
  const ty = Math.floor(total / 12);
  const tm = (total % 12 + 12) % 12 + 1;
  const day = Math.min(anchorDay, daysInMonth(ty, tm));
  return `${String(ty).padStart(4, "0")}-${String(tm).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** ISO weekday for a date key: Monday = 1 … Sunday = 7. */
export function weekdayOf(key) {
  return ((new Date(toUTC(key)).getUTCDay() + 6) % 7) + 1;
}

/** Monday of the week containing `key`. */
export function startOfWeek(key, startsOn = 1) {
  const shift = (weekdayOf(key) - startsOn + 7) % 7;
  return addDays(key, -shift);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Human date, e.g. "28 Oct 2026". */
export function formatDate(key, { withYear = true } = {}) {
  const d = new Date(toUTC(key));
  const base = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return withYear ? `${base} ${d.getUTCFullYear()}` : base;
}

/** Short month label for chart axes, e.g. "Oct". */
export function monthLabel(key) {
  return MONTHS[monthOf(key) - 1];
}

/** First and last date key of a month, from any key inside it. */
export function monthRange(key) {
  const first = `${yearOf(key)}-${String(monthOf(key)).padStart(2, "0")}-01`;
  return { first, last: addMonthsClamped(first, 1, 1) && addDays(addMonthsClamped(first, 1, 1), -1) };
}
