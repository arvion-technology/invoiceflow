/**
 * Invoice totals: the order in which discount and tax are applied.
 *
 * The order is fixed and deliberate:
 *
 *   1. line gross      = unit price × quantity            (integer minor units)
 *   2. subtotal        = Σ line gross
 *   3. discount        = percentage of subtotal, or a fixed amount capped at it
 *   4. discount split  = largest-remainder allocation across lines by gross
 *   5. taxable amount  = line gross − its discount share   (reduced by the discount)
 *   6. tax             = taxable amount × rate, per line
 *   7. total           = Σ (taxable amount + tax)
 *
 * Applying a discount *before* tax is the client-friendly order and the one most
 * invoices use: a 10% discount on a taxed line reduces the tax too. Applying it
 * after tax would charge tax on money the customer never pays.
 *
 * Tax is rounded per line, not once on the subtotal. With several lines at
 * different rates that is the only way to report the right tax per rate, at the
 * cost of a one-cent difference from taxing the whole invoice at once. Invoices
 * with a single rate can show a different cent than a flat calculation; the
 * README says so, and the code never hides it.
 *
 * `taxInclusive: true` means the prices you entered already contain tax (the
 * normal way a retail price is quoted). The engine extracts the tax instead of
 * adding it: base = round(gross × 10000 / (10000 + rate)).
 */

import { divRound, multiplyMoney, percentOf, percentToBasisPoints, allocate } from "./money.js";

const MAX_BP = 10_000;

function rateOf(line, invoice) {
  const raw = line.taxRateBp ?? invoice.taxRateBp ?? 0;
  const rate = Math.round(raw);
  if (!Number.isFinite(rate) || rate < 0 || rate > MAX_BP) {
    throw new RangeError(`tax rate out of range: ${raw}`);
  }
  return rate;
}

/** Gross amount of one line, before discount and tax. */
export function lineGross(line) {
  const qty = line.qty ?? 1;
  const unit = line.unitPrice ?? 0;
  if (!Number.isInteger(unit)) throw new TypeError("unitPrice must be integer minor units");
  if (!Number.isFinite(qty)) throw new TypeError("qty must be finite");
  return multiplyMoney(unit, qty);
}

/**
 * Compute every number printed on an invoice.
 * @param {object} invoice
 * @returns {{lines: object[], subtotal:number, discount:number, net:number,
 *            tax:number, total:number, taxGroups: object[], taxInclusive:boolean}}
 */
export function computeTotals(invoice = {}) {
  const lines = Array.isArray(invoice.lines) ? invoice.lines : [];
  const taxInclusive = invoice.taxInclusive === true;
  const grosses = lines.map((line) => lineGross(line));
  const subtotal = grosses.reduce((a, b) => a + b, 0);

  const discount = resolveDiscount(invoice.discount, subtotal);
  const shares = discount === 0 ? grosses.map(() => 0) : allocate(discount, grosses);

  const resultLines = lines.map((line, i) => {
    const gross = grosses[i];
    const lineDiscount = shares[i];
    const taxable = gross - lineDiscount;
    const rateBp = rateOf(line, invoice);

    let net;
    let tax;
    if (taxInclusive) {
      net = rateBp === 0 ? taxable : divRound(BigInt(taxable) * 10_000n, BigInt(10_000 + rateBp));
      tax = taxable - net;
    } else {
      net = taxable;
      tax = percentOf(taxable, rateBp);
    }
    return {
      description: line.description || "",
      qty: line.qty ?? 1,
      unitPrice: line.unitPrice ?? 0,
      taxRateBp: rateBp,
      gross,
      discount: lineDiscount,
      net,
      tax,
      total: net + tax,
    };
  });

  const totals = resultLines.reduce(
    (acc, line) => {
      acc.net += line.net;
      acc.tax += line.tax;
      acc.total += line.total;
      return acc;
    },
    { net: 0, tax: 0, total: 0 },
  );

  const groups = new Map();
  for (const line of resultLines) {
    if (!groups.has(line.taxRateBp)) groups.set(line.taxRateBp, { rateBp: line.taxRateBp, net: 0, tax: 0 });
    const group = groups.get(line.taxRateBp);
    group.net += line.net;
    group.tax += line.tax;
  }

  return {
    lines: resultLines,
    subtotal,
    discount,
    net: totals.net,
    tax: totals.tax,
    total: totals.total,
    taxGroups: [...groups.values()].sort((a, b) => b.rateBp - a.rateBp),
    taxInclusive,
  };
}

/** Turn a discount descriptor into an integer minor-unit amount for this subtotal. */
export function resolveDiscount(discount, subtotal) {
  if (!discount || discount.type === "none") return 0;
  if (discount.type === "percent") {
    const percent = Number(discount.value);
    if (!Number.isFinite(percent) || percent < 0) throw new RangeError("discount percent must be >= 0");
    const bp = Math.min(MAX_BP, percentToBasisPoints(percent));
    return Math.min(subtotal, percentOf(subtotal, bp));
  }
  if (discount.type === "fixed") {
    const value = Number(discount.value);
    if (!Number.isInteger(value) || value < 0) throw new RangeError("fixed discount must be integer minor units");
    return Math.min(subtotal, value);
  }
  throw new TypeError(`unknown discount type: ${discount.type}`);
}

/** Tax totals grouped by rate, ready for a "VAT 13% (NPR 1,234.00)" line. */
export function taxSummary(totals) {
  return (totals.taxGroups || []).map((group) => ({
    ...group,
    label: group.rateBp === 0 ? "No tax" : `${(group.rateBp / 100).toFixed(group.rateBp % 100 === 0 ? 0 : 2)}%`,
  }));
}
