import test from "node:test";
import assert from "node:assert/strict";

import {
  STATUS, paymentsTotal, invoiceTotal, amountDue, deriveStatus, isOverdue, daysPastDue,
  withDerived, formatInvoiceNumber, parseInvoiceNumber, nextInvoiceNumber, sequenceGaps,
  duplicateNumbers, summarize, agingBuckets, revenueByMonth,
} from "../src/invoice.js";
import { endOfDay, addDays } from "../src/dates.js";

const NOW = Date.UTC(2026, 9, 28, 12); // 2026-10-28 12:00 UTC

function invoice(overrides = {}) {
  return {
    id: "inv-test",
    number: "INV-2026-0001",
    clientId: "cli-1",
    currency: "USD",
    issuedOn: "2026-10-01",
    dueOn: "2026-10-15",
    termsDays: 14,
    lines: [{ description: "Design", unitPrice: 10000, qty: 1, taxRateBp: 0 }],
    payments: [],
    ...overrides,
  };
}

test("invoice numbering pads the sequence and carries the year", () => {
  assert.equal(formatInvoiceNumber({ prefix: "INV", year: 2026, sequence: 42 }), "INV-2026-0042");
  assert.equal(formatInvoiceNumber({ prefix: "INV", year: 2026, sequence: 42, pad: 2 }), "INV-2026-42");
  assert.equal(formatInvoiceNumber({ prefix: "NL", year: 2027, sequence: 7, separator: "/" }), "NL/2027/0007");
  assert.throws(() => formatInvoiceNumber({ year: 2026, sequence: 0 }), RangeError);
});

test("parseInvoiceNumber round-trips and rejects malformed numbers", () => {
  assert.deepEqual(parseInvoiceNumber("INV-2026-0042"), { prefix: "INV", year: 2026, sequence: 42, pad: 4 });
  assert.equal(parseInvoiceNumber("INV-00042"), null);
  assert.equal(parseInvoiceNumber("draft"), null);
  assert.equal(parseInvoiceNumber("INV-2026-0000"), null);
  assert.deepEqual(parseInvoiceNumber("NL/2027/7", { separator: "/" }), { prefix: "NL", year: 2027, sequence: 7, pad: 1 });
});

test("nextInvoiceNumber ignores other years and other prefixes", () => {
  const invoices = [
    { number: "INV-2025-0099" },
    { number: "INV-2026-0007" },
    { number: "INV-2026-0008" },
    { number: "CRN-2026-0500" },
    { number: "not-a-number" },
  ];
  assert.equal(nextInvoiceNumber(invoices, { prefix: "INV", year: 2026 }), "INV-2026-0009");
  assert.equal(nextInvoiceNumber([], { prefix: "INV", year: 2026 }), "INV-2026-0001");
});

test("sequenceGaps finds skipped numbers and duplicateNumbers finds repeats", () => {
  const invoices = [{ number: "INV-2026-0001" }, { number: "INV-2026-0003" }, { number: "INV-2026-0003" }];
  assert.deepEqual(sequenceGaps(invoices, { prefix: "INV", year: 2026 }), [2]);
  assert.deepEqual(duplicateNumbers(invoices), ["INV-2026-0003"]);
});

test("status is derived from payments and due date", () => {
  const paid = invoice({ payments: [{ amount: 10000, at: NOW }] });
  assert.equal(deriveStatus(paid, { now: NOW }), STATUS.PAID);
  assert.equal(amountDue(paid), 0);
  assert.equal(paymentsTotal(paid), 10000);

  const partial = invoice({ payments: [{ amount: 2500, at: NOW }] });
  assert.equal(deriveStatus(partial, { now: NOW }), STATUS.PARTIAL);
  assert.equal(amountDue(partial), 7500);

  assert.equal(deriveStatus(invoice(), { now: NOW }), STATUS.OVERDUE);
  assert.equal(deriveStatus(invoice({ dueOn: "2026-11-10" }), { now: NOW }), STATUS.SENT);
});

test("draft and void outrank any payment", () => {
  const draft = invoice({ draft: true, payments: [{ amount: 10000, at: NOW }] });
  assert.equal(deriveStatus(draft, { now: NOW }), STATUS.DRAFT);
  const voided = invoice({ voided: true, payments: [{ amount: 10000, at: NOW }] });
  assert.equal(deriveStatus(voided, { now: NOW }), STATUS.VOID);
  assert.equal(isOverdue(voided, { now: NOW }), false);
});

test("overdue starts the moment after the due date, not on it", () => {
  const atDue = invoice({ dueOn: "2026-10-28" });
  assert.equal(isOverdue(atDue, { now: endOfDay("2026-10-28") }), false);
  assert.equal(isOverdue(atDue, { now: endOfDay("2026-10-28") + 1 }), true);
  assert.equal(daysPastDue(atDue, { now: endOfDay("2026-10-29") }), 1);
  assert.equal(daysPastDue(invoice({ dueOn: "2026-10-30" }), { now: NOW }), 0);
  assert.equal(daysPastDue(invoice({ dueOn: "2026-10-01" }), { now: NOW }), 27);
});

test("an overpaid invoice is paid, never negative", () => {
  const overpaid = invoice({ payments: [{ amount: 15000, at: NOW }] });
  assert.equal(amountDue(overpaid), 0);
  assert.equal(deriveStatus(overpaid, { now: NOW }), STATUS.PAID);
});

test("withDerived adds totals, status and ageing in one pass", () => {
  const derived = withDerived(invoice({ payments: [{ amount: 4000, at: NOW }] }), { now: NOW });
  assert.equal(derived.totals.total, 10000);
  assert.equal(derived.paid, 4000);
  assert.equal(derived.due, 6000);
  assert.equal(derived.status, "partial");
  assert.equal(derived.daysPastDue, 13);
});

test("non-integer payment amounts are rejected", () => {
  assert.throws(() => paymentsTotal({ payments: [{ amount: 10.5, at: NOW }] }), TypeError);
  assert.throws(() => invoiceTotal({ lines: [{ unitPrice: 100.5, qty: 1 }] }), TypeError);
});

test("summarize excludes drafts and voids and converts to the reporting currency", () => {
  const rates = { base: "USD", rates: { USD: 1_000_000, EUR: 920_000 } };
  const invoices = [
    invoice({ id: "a", number: "INV-2026-0001", statusSource: "issued" }),
    invoice({ id: "b", number: "INV-2026-0002", draft: true }),
    invoice({ id: "c", number: "INV-2026-0003", voided: true }),
    invoice({
      id: "d", number: "INV-2026-0004", currency: "EUR",
      lines: [{ unitPrice: 10000, qty: 1, taxRateBp: 0 }],
      dueOn: "2026-11-30",
    }),
  ];
  const totals = summarize(invoices, { now: NOW, base: "USD", rates });
  assert.deepEqual(totals.counts, { draft: 1, sent: 1, partial: 0, overdue: 1, paid: 0, void: 1 });
  assert.equal(totals.outstanding, 10000 + 10870);
  assert.equal(totals.overdue, 10000);
  assert.equal(totals.byCurrency.length, 2);
  const eur = totals.byCurrency.find((row) => row.currency === "EUR");
  assert.equal(eur.outstanding, 10000, "the per-currency row stays in its own currency");
});

test("agingBuckets puts each unpaid invoice in exactly one bucket", () => {
  const make = (dueOn) => invoice({ id: dueOn, number: `INV-2026-${dueOn}`, dueOn });
  const invoices = [
    make("2026-11-05"),
    make("2026-10-20"),
    make("2026-09-20"),
    make("2026-08-20"),
    make("2026-06-01"),
    invoice({ id: "paid", number: "INV-2026-9999", dueOn: "2026-01-01", payments: [{ amount: 10000, at: NOW }] }),
    invoice({ id: "draft", number: "INV-2026-9998", dueOn: "2026-01-01", draft: true }),
  ];
  const buckets = agingBuckets(invoices, { now: NOW, base: "USD", rates: null });
  assert.deepEqual(buckets.map((b) => [b.label, b.count]), [
    ["Current", 1],
    ["1–30 days", 1],
    ["31–60 days", 1],
    ["61–90 days", 1],
    ["90+ days", 1],
  ]);
  assert.equal(buckets.reduce((sum, b) => sum + b.amount, 0), 50000);
});

test("revenueByMonth separates invoiced from collected", () => {
  const invoices = [
    invoice({ issuedOn: "2026-10-01", dueOn: "2026-10-15", payments: [{ amount: 4000, at: Date.UTC(2026, 9, 20) }] }),
  ];
  const rows = revenueByMonth(invoices, { months: 3, now: NOW, base: "USD", rates: null });
  assert.deepEqual(rows.map((r) => r.key), ["2026-08", "2026-09", "2026-10"]);
  const october = rows.at(-1);
  assert.equal(october.invoiced, 10000);
  assert.equal(october.collected, 4000);
  assert.equal(rows[0].invoiced, 0);
});

test("termsDays and due dates are consistent in the sample shape", () => {
  assert.equal(addDays("2026-10-01", 14), "2026-10-15");
});
