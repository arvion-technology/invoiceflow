/**
 * Recurring invoice schedules.
 *
 * The hard part is not "add 30 days" — it is the calendar. A retainer that
 * starts on 31 January must bill 28 February in a non-leap year (29 in a leap
 * year) and then return to 31 March. The naive `new Date(y, m + 1, 31)` either
 * overflows into March or leaves the schedule stuck on the 28th forever. So the
 * rule keeps the original anchor day and clamps it into the target month,
 * without ever mutating the anchor.
 *
 * All arithmetic happens on `YYYY-MM-DD` calendar dates (see dates.js), so a
 * schedule never shifts by an hour when a country changes its clocks.
 */

import { addDays, addMonthsClamped, dayOf, formatDate, weekdayOf } from "./dates.js";

export const BILLING_UNITS = Object.freeze(["day", "week", "month", "year"]);

const ALIASES = {
  daily: { every: 1, unit: "day" },
  weekly: { every: 1, unit: "week" },
  biweekly: { every: 2, unit: "week" },
  fortnightly: { every: 2, unit: "week" },
  monthly: { every: 1, unit: "month" },
  quarterly: { every: 3, unit: "month" },
  yearly: { every: 1, unit: "year" },
  annually: { every: 1, unit: "year" },
};

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Normalise a user-facing interval into { every, unit }. */
export function normalizeRule(rule) {
  if (typeof rule === "string" && ALIASES[rule]) return ALIASES[rule];
  const every = Number(rule?.every ?? 1);
  const unit = rule?.unit;
  if (!Number.isInteger(every) || every < 1) throw new RangeError("every must be a positive integer");
  if (!BILLING_UNITS.includes(unit)) throw new TypeError(`unknown billing unit: ${unit}`);
  return { every, unit };
}

function shift(key, every, unit, anchorDay) {
  if (unit === "day") return addDays(key, every);
  if (unit === "week") return addDays(key, every * 7);
  if (unit === "month") return addMonthsClamped(key, every, anchorDay);
  if (unit === "year") return addMonthsClamped(key, every * 12, anchorDay);
  throw new TypeError(`unknown billing unit: ${unit}`);
}

export function dueOnFor(issuedOn, termsDays = 14) {
  if (!Number.isInteger(termsDays) || termsDays < 0) throw new RangeError("termsDays must be a non-negative integer");
  return addDays(issuedOn, termsDays);
}

/**
 * Generate the issued/due dates for a recurring rule.
 *
 * @param {{startOn:string, every?:number, unit?:string, count?:number,
 *          until?:string|null, termsDays?:number}} rule
 * @returns {{sequence:number, issuedOn:string, dueOn:string}[]}
 */
export function generateSchedule(rule) {
  const { every, unit } = normalizeRule(rule);
  const startOn = rule.startOn;
  const count = Number(rule.count ?? 12);
  const termsDays = Number(rule.termsDays ?? 14);
  const until = rule.until || null;
  if (!Number.isInteger(count) || count < 1 || count > 120) {
    throw new RangeError("count must be an integer between 1 and 120");
  }
  const anchorDay = dayOf(startOn);
  const schedule = [];
  let issuedOn = startOn;
  for (let sequence = 1; sequence <= count; sequence += 1) {
    if (until && issuedOn > until) break;
    schedule.push({ sequence, issuedOn, dueOn: dueOnFor(issuedOn, termsDays) });
    issuedOn = shift(issuedOn, every, unit, anchorDay);
  }
  return schedule;
}

/**
 * Next occurrences strictly after `after` (a date key). Used by the dashboard's
 * "upcoming" panel; capped so a rule that started years ago cannot loop forever.
 */
export function scheduleFrom(rule, { after, limit = 6 } = {}) {
  const { every, unit } = normalizeRule(rule);
  const anchorDay = dayOf(rule.startOn);
  const termsDays = Number(rule.termsDays ?? 14);
  const count = Math.min(120, Number(rule.count ?? 12));
  const out = [];
  let issuedOn = rule.startOn;
  for (let sequence = 1; sequence <= count && out.length < limit; sequence += 1) {
    if (!after || issuedOn > after) {
      out.push({ sequence, issuedOn, dueOn: dueOnFor(issuedOn, termsDays) });
    }
    issuedOn = shift(issuedOn, every, unit, anchorDay);
  }
  return out;
}

/** First occurrence strictly after `after`, or null. */
export function nextOccurrence(rule, after) {
  return scheduleFrom(rule, { after, limit: 1 })[0] || null;
}

function ordinal(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] || "th"}`;
}

/** Plain-English description used in the settings and dashboard panels. */
export function describeRule(rule) {
  const { every, unit } = normalizeRule(rule);
  const start = rule.startOn;
  if (unit === "day") return every === 1 ? "Every day" : `Every ${every} days`;
  if (unit === "week") {
    const day = WEEKDAYS[weekdayOf(start) - 1];
    return every === 1 ? `Weekly on ${day}` : `Every ${every} weeks on ${day}`;
  }
  if (unit === "year") {
    return every === 1
      ? `Yearly on ${dayOf(start)} ${formatDate(start).split(" ")[1]}`
      : `Every ${every} years on ${formatDate(start)}`;
  }
  const day = ordinal(dayOf(start));
  if (every === 1) return `Monthly on the ${day}`;
  if (every === 3) return `Quarterly on the ${day}`;
  return `Every ${every} months on the ${day}`;
}

/** Is this rule anchored on a day that only exists in some months? */
export function hasRareAnchor(rule) {
  return dayOf(rule.startOn) >= 29;
}
