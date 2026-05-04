/**
 * Invoice lifecycle: numbering, status derivation, ageing and the dashboard
 * aggregates. All functions are pure and take the clock as an argument, so the
 * tests can put an invoice on the day before its due date and the day after
 * without waiting for time to pass.
 *
 * Status is *derived*, never stored. A stored status drifts: an invoice marked
 * "sent" yesterday is overdue today, and a cron job that forgets to run leaves
 * the dashboard lying. The only facts in the store are the issue date, the due
 * date, the void flag and the payments — everything else is calculated.
 */

import { computeTotals } from "./tax.js";
import { addDays, dateKey, diffDays, endOfDay, monthLabel, monthOf, todayKey, yearOf } from "./dates.js";
import { convert, formatMoney } from "./money.js";

export const STATUS = Object.freeze({
  DRAFT: "draft",
  SENT: "sent",
  PARTIAL: "partial",
  PAID: "paid",
  OVERDUE: "overdue",
  VOID: "void",
});

export const STATUS_ORDER = [STATUS.DRAFT, STATUS.SENT, STATUS.PARTIAL, STATUS.OVERDUE, STATUS.PAID, STATUS.VOID];

/** Every number printed on an invoice. */
export function invoiceTotals(invoice) {
  return computeTotals(invoice);
}

export function invoiceTotal(invoice) {
  return invoiceTotals(invoice).total;
}

export function paymentsTotal(invoice) {
  const payments = Array.isArray(invoice.payments) ? invoice.payments : [];
  return payments.reduce((acc, payment) => {
    if (!Number.isInteger(payment.amount)) throw new TypeError("payment.amount must be integer minor units");
    return acc + payment.amount;
  }, 0);
}

export function amountDue(invoice) {
  return Math.max(0, invoiceTotal(invoice) - paymentsTotal(invoice));
}

/**
 * Derive the status from the facts. Precedence matters:
 * void > draft > paid > partial > overdue > sent.
 */
export function deriveStatus(invoice, { now = Date.now() } = {}) {
  if (invoice.voided === true) return STATUS.VOID;
  if (invoice.draft === true) return STATUS.DRAFT;
  const total = invoiceTotal(invoice);
  const paid = paymentsTotal(invoice);
  if (paid >= total) return STATUS.PAID;
  if (paid > 0) return STATUS.PARTIAL;
  if (isOverdue(invoice, { now })) return STATUS.OVERDUE;
  return STATUS.SENT;
}

/** Overdue begins the first moment after the due date, not on it. */
export function isOverdue(invoice, { now = Date.now() } = {}) {
  if (invoice.voided === true || invoice.draft === true) return false;
  if (paymentsTotal(invoice) >= invoiceTotal(invoice)) return false;
  return now > endOfDay(invoice.dueOn);
}

/** Whole days late, 0 when not yet due. */
export function daysPastDue(invoice, { now = Date.now() } = {}) {
  if (!isOverdue(invoice, { now })) return 0;
  return diffDays(todayKey(now), invoice.dueOn);
}

/** Days until the due date; negative means late. */
export function daysUntilDue(invoice, { now = Date.now() } = {}) {
  return diffDays(invoice.dueOn, todayKey(now));
}

/** Attach computed fields used by every view. */
export function withDerived(invoice, { now = Date.now() } = {}) {
  const totals = invoiceTotals(invoice);
  const paid = paymentsTotal(invoice);
  return {
    ...invoice,
    totals,
    paid,
    due: Math.max(0, totals.total - paid),
    status: deriveStatus(invoice, { now }),
    daysPastDue: daysPastDue(invoice, { now }),
    daysUntilDue: daysUntilDue(invoice, { now }),
  };
}

/* ------------------------------------------------------------- numbering -- */

const DEFAULT_FORMAT = { prefix: "INV", pad: 4, separator: "-" };

export function formatInvoiceNumber({ prefix = "INV", year, sequence, pad = 4, separator = "-" }) {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError("sequence must be a positive integer");
  }
  if (!Number.isInteger(year)) throw new RangeError("year must be an integer");
  return [prefix, String(year), String(sequence).padStart(pad, "0")].filter(Boolean).join(separator);
}

/**
 * Parse a number back into its parts. Returns null for anything that does not
 * match the pattern, which is what the settings screen uses to warn about
 * imported invoices that would break the sequence.
 */
export function parseInvoiceNumber(number, { separator = "-" } = {}) {
  if (typeof number !== "string") return null;
  const escaped = separator.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^(.*?)${escaped}(\\d{4})${escaped}(\\d+)$`).exec(number);
  if (!match) return null;
  const sequence = Number(match[3]);
  if (!Number.isInteger(sequence) || sequence < 1) return null;
  return { prefix: match[1], year: Number(match[2]), sequence, pad: match[3].length };
}

/**
 * Next number for a prefix and year. Void invoices still consume a number:
 * gaps in a tax sequence are a question an auditor will ask.
 */
export function nextInvoiceNumber(invoices, { prefix = "INV", year = new Date().getUTCFullYear(), pad = 4, separator = "-" } = {}) {
  let max = 0;
  for (const invoice of invoices) {
    const parsed = parseInvoiceNumber(invoice.number, { separator });
    if (!parsed) continue;
    if (parsed.prefix !== prefix || parsed.year !== year) continue;
    max = Math.max(max, parsed.sequence);
  }
  return formatInvoiceNumber({ prefix, year, sequence: max + 1, pad, separator });
}

/** Sequence numbers missing between 1 and the highest issued number. */
export function sequenceGaps(invoices, { prefix = "INV", year = new Date().getUTCFullYear(), separator = "-" } = {}) {
  const seen = new Set();
  let max = 0;
  for (const invoice of invoices) {
    const parsed = parseInvoiceNumber(invoice.number, { separator });
    if (!parsed || parsed.prefix !== prefix || parsed.year !== year) continue;
    seen.add(parsed.sequence);
    max = Math.max(max, parsed.sequence);
  }
  const gaps = [];
  for (let n = 1; n <= max; n += 1) if (!seen.has(n)) gaps.push(n);
  return gaps;
}

/** Numbers issued twice — a real risk when invoices are imported from CSV. */
export function duplicateNumbers(invoices) {
  const counts = new Map();
  for (const invoice of invoices) counts.set(invoice.number, (counts.get(invoice.number) || 0) + 1);
  return [...counts.entries()].filter(([, n]) => n > 1).map(([number]) => number);
}

/* --------------------------------------------------------- dashboard math -- */

function toBase(amount, invoice, base, rates) {
  if (invoice.currency === base) return amount;
  if (!rates) throw new RangeError(`provide rates to report ${invoice.currency} in ${base}`);
  return convert(amount, invoice.currency, base, rates);
}

function dateInRange(key, start, endExclusive) {
  return key >= start && key < endExclusive;
}

/**
 * Headline totals for the dashboard, converted into the reporting currency.
 * Draft and void invoices are excluded from every money figure — an unissued
 * invoice is not revenue and a cancelled one is not a debt.
 */
export function summarize(invoices, { now = Date.now(), base = "USD", rates = null } = {}) {
  const out = {
    base,
    invoiced: 0,
    paid: 0,
    outstanding: 0,
    overdue: 0,
    counts: { draft: 0, sent: 0, partial: 0, overdue: 0, paid: 0, void: 0 },
    byCurrency: [],
  };
  const byCurrency = new Map();

  for (const invoice of invoices) {
    const derived = withDerived(invoice, { now });
    out.counts[derived.status] = (out.counts[derived.status] || 0) + 1;
    if (derived.status === STATUS.DRAFT || derived.status === STATUS.VOID) continue;

    const total = toBase(derived.totals.total, invoice, base, rates);
    const paid = toBase(derived.paid, invoice, base, rates);
    const due = Math.max(0, total - paid);

    out.invoiced += total;
    out.paid += Math.min(paid, total);
    out.outstanding += due;
    if (derived.status === STATUS.OVERDUE) out.overdue += due;

    const row = byCurrency.get(invoice.currency) || { currency: invoice.currency, count: 0, invoiced: 0, outstanding: 0 };
    row.count += 1;
    row.invoiced += derived.totals.total;
    row.outstanding += derived.due;
    byCurrency.set(invoice.currency, row);
  }
  out.byCurrency = [...byCurrency.values()].sort((a, b) => b.invoiced - a.invoiced);
  return out;
}

/** Outstanding money bucketed by how late it is. */
export function agingBuckets(invoices, { now = Date.now(), base = "USD", rates = null } = {}) {
  const labels = [
    { key: "current", label: "Current", max: 0 },
    { key: "1-30", label: "1–30 days", max: 30 },
    { key: "31-60", label: "31–60 days", max: 60 },
    { key: "61-90", label: "61–90 days", max: 90 },
    { key: "90+", label: "90+ days", max: Infinity },
  ].map((bucket) => ({ ...bucket, count: 0, amount: 0 }));

  for (const invoice of invoices) {
    if (invoice.draft === true || invoice.voided === true) continue;
    const due = amountDue(invoice);
    if (due <= 0) continue;
    const days = daysPastDue(invoice, { now });
    const bucket = labels.find((candidate) => days <= candidate.max);
    bucket.count += 1;
    bucket.amount += toBase(due, invoice, base, rates);
  }
  return labels;
}

/** Invoiced vs collected, per calendar month, for the trailing `months` months. */
export function revenueByMonth(invoices, { months = 6, now = Date.now(), base = "USD", rates = null } = {}) {
  const today = todayKey(now);
  const baseYear = yearOf(today);
  const baseMonth = monthOf(today);
  const rows = [];

  for (let i = months - 1; i >= 0; i -= 1) {
    // Anchor every row on day 1 so month keys are stable regardless of today.
    const total = baseYear * 12 + (baseMonth - 1) - i;
    const year = Math.floor(total / 12);
    const month = (total % 12 + 12) % 12 + 1;
    const key = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
    rows.push({ key, label: monthLabel(`${key}-01`), invoiced: 0, collected: 0 });
  }
  const byMonth = new Map(rows.map((row) => [row.key, row]));
  const inBase = (amount, invoice) => toBase(amount, invoice, base, rates);

  for (const invoice of invoices) {
    if (invoice.voided === true || invoice.draft === true) continue;
    const issued = byMonth.get(invoice.issuedOn.slice(0, 7));
    if (issued) issued.invoiced += inBase(invoiceTotals(invoice).total, invoice);
    for (const payment of invoice.payments || []) {
      const month = byMonth.get(dateKey(payment.at).slice(0, 7));
      if (month) month.collected += inBase(payment.amount, invoice);
    }
  }
  return rows;
}

/** Format an invoice total in its own currency; convenience for views. */
export function formattedTotal(invoice, options = {}) {
  return formatMoney(invoiceTotals(invoice).total, invoice.currency, options);
}
