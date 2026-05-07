import test from "node:test";
import assert from "node:assert/strict";

import {
  BILLING_UNITS, normalizeRule, generateSchedule, scheduleFrom, nextOccurrence,
  dueOnFor, describeRule, hasRareAnchor,
} from "../src/recurring.js";

test("monthly schedules clamp to the short month and return to the anchor day", () => {
  const schedule = generateSchedule({ startOn: "2026-01-31", unit: "month", count: 4 });
  assert.deepEqual(schedule.map((row) => row.issuedOn), [
    "2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30",
  ]);
});

test("a leap year keeps 29 February for a 31st-anchored retainer", () => {
  const schedule = generateSchedule({ startOn: "2028-01-31", unit: "month", count: 3 });
  assert.deepEqual(schedule.map((row) => row.issuedOn), ["2028-01-31", "2028-02-29", "2028-03-31"]);
});

test("yearly schedules clamp 29 February on non-leap years", () => {
  const schedule = generateSchedule({ startOn: "2028-02-29", unit: "year", count: 2 });
  assert.deepEqual(schedule.map((row) => row.issuedOn), ["2028-02-29", "2029-02-28"]);
});

test("quarterly and biweekly aliases normalise to their units", () => {
  assert.deepEqual(normalizeRule("quarterly"), { every: 3, unit: "month" });
  assert.deepEqual(normalizeRule("biweekly"), { every: 2, unit: "week" });
  assert.deepEqual(normalizeRule({ every: 2, unit: "month" }), { every: 2, unit: "month" });

  const quarterly = generateSchedule({ startOn: "2026-01-15", unit: "month", every: 3, count: 3 });
  assert.deepEqual(quarterly.map((row) => row.issuedOn), ["2026-01-15", "2026-04-15", "2026-07-15"]);

  const biweekly = generateSchedule({ startOn: "2026-10-01", unit: "week", every: 2, count: 3 });
  assert.deepEqual(biweekly.map((row) => row.issuedOn), ["2026-10-01", "2026-10-15", "2026-10-29"]);
});

test("due dates are issue date plus payment terms", () => {
  const schedule = generateSchedule({ startOn: "2026-10-01", unit: "month", count: 2, termsDays: 30 });
  assert.equal(schedule[0].dueOn, "2026-10-31");
  assert.equal(schedule[1].dueOn, "2026-12-01");
  assert.equal(dueOnFor("2026-12-25", 7), "2027-01-01");
  assert.equal(dueOnFor("2026-12-25", 0), "2026-12-25");
});

test("schedule stops at the until date", () => {
  const schedule = generateSchedule({ startOn: "2026-01-15", unit: "month", count: 12, until: "2026-04-30" });
  assert.deepEqual(schedule.map((row) => row.issuedOn), ["2026-01-15", "2026-02-15", "2026-03-15", "2026-04-15"]);
});

test("count and unit are validated, not silently defaulted", () => {
  assert.throws(() => generateSchedule({ startOn: "2026-01-01", unit: "fortnight", count: 2 }), TypeError);
  assert.throws(() => generateSchedule({ startOn: "2026-01-01", unit: "month", count: 0 }), RangeError);
  assert.throws(() => generateSchedule({ startOn: "2026-01-01", unit: "month", count: 5000 }), RangeError);
  assert.throws(() => normalizeRule({ every: 0, unit: "month" }), RangeError);
  assert.ok(BILLING_UNITS.includes("week"));
});

test("scheduleFrom returns future occurrences without repeating one", () => {
  const rule = { startOn: "2026-01-15", unit: "month", count: 12, termsDays: 14 };
  const upcoming = scheduleFrom(rule, { after: "2026-10-28", limit: 3 });
  assert.deepEqual(upcoming.map((row) => row.issuedOn), ["2026-11-15", "2026-12-15"]);
  const next = nextOccurrence(rule, "2026-10-28");
  assert.equal(next.issuedOn, "2026-11-15");
  assert.equal(next.dueOn, "2026-11-29");
});

test("scheduleFrom respects the rule's count", () => {
  const rule = { startOn: "2026-01-15", unit: "month", count: 2 };
  assert.deepEqual(scheduleFrom(rule, { after: "2026-10-28" }), []);
  assert.equal(scheduleFrom(rule, { after: "2026-01-01" }).length, 2);
});

test("describeRule reads like a sentence", () => {
  assert.equal(describeRule({ startOn: "2026-10-14", unit: "month" }), "Monthly on the 14th");
  assert.equal(describeRule({ startOn: "2026-03-31", unit: "month" }), "Monthly on the 31st");
  assert.equal(describeRule({ startOn: "2026-10-14", unit: "week" }), "Weekly on Wednesday");
  assert.equal(describeRule({ startOn: "2026-03-02", unit: "week", every: 2 }), "Every 2 weeks on Monday");
  assert.equal(describeRule({ startOn: "2026-10-14", unit: "month", every: 3 }), "Quarterly on the 14th");
  assert.equal(describeRule({ startOn: "2026-10-14", unit: "year" }), "Yearly on 14 Oct");
});

test("rare anchors are flagged so the UI can explain a 28 February invoice", () => {
  assert.equal(hasRareAnchor({ startOn: "2026-01-31" }), true);
  assert.equal(hasRareAnchor({ startOn: "2026-01-29" }), true);
  assert.equal(hasRareAnchor({ startOn: "2026-01-28" }), false);
});
