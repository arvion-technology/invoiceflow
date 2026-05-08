import test from "node:test";
import assert from "node:assert/strict";

import { computeTotals, lineGross, resolveDiscount, taxSummary } from "../src/tax.js";

const usd = (lines, extra = {}) => computeTotals({
  lines: lines.map((line) => ({ unitPrice: line[1], qty: line[0], taxRateBp: line[2] })),
  ...extra,
});

test("line gross is unit price times quantity, rounded once", () => {
  assert.equal(lineGross({ unitPrice: 8500, qty: 6 }), 51000);
  assert.equal(lineGross({ unitPrice: 999, qty: 1.5 }), 1499);
  assert.equal(lineGross({ unitPrice: 100, qty: 0 }), 0);
  assert.throws(() => lineGross({ unitPrice: 100.5, qty: 1 }), TypeError);
});

test("discount is applied before tax, so tax falls too", () => {
  const totals = usd([[1, 10000, 1300]], { discount: { type: "percent", value: 10 } });
  assert.equal(totals.subtotal, 10000);
  assert.equal(totals.discount, 1000);
  assert.equal(totals.net, 9000);
  assert.equal(totals.tax, 1170, "13% of 9000, not 13% of 10000");
  assert.equal(totals.total, 10170);
});

test("discount is split across lines without losing a cent", () => {
  const totals = usd([
    [1, 3333, 0],
    [1, 3333, 0],
    [1, 3334, 0],
  ], { discount: { type: "fixed", value: 100 } });
  assert.equal(totals.discount, 100);
  assert.equal(totals.lines.reduce((a, line) => a + line.discount, 0), 100);
  assert.equal(totals.net, 9900);
  assert.equal(totals.total, 9900);
});

test("fixed discount cannot exceed the subtotal", () => {
  const totals = usd([[2, 5000, 0]], { discount: { type: "fixed", value: 100000 } });
  assert.equal(totals.discount, 10000);
  assert.equal(totals.net, 0);
  assert.equal(totals.total, 0);
});

test("percentage above 100 is clamped", () => {
  const totals = usd([[1, 10000, 0]], { discount: { type: "percent", value: 140 } });
  assert.equal(totals.discount, 10000);
  assert.equal(totals.net, 0);
});

test("tax-inclusive prices extract tax instead of adding it", () => {
  const totals = computeTotals({ lines: [{ unitPrice: 11300, qty: 1, taxRateBp: 1300 }], taxInclusive: true });
  assert.equal(totals.net, 10000);
  assert.equal(totals.tax, 1300);
  assert.equal(totals.total, 11300, "the customer pays the sticker price");
});

test("mixed tax rates are calculated per line and grouped", () => {
  const totals = computeTotals({
    taxRateBp: 1300,
    lines: [
      { unitPrice: 10000, qty: 1 },
      { unitPrice: 5000, qty: 1, taxRateBp: 0 },
    ],
  });
  assert.equal(totals.tax, 1300);
  assert.equal(totals.total, 16300);
  assert.deepEqual(totals.taxGroups.map((g) => [g.rateBp, g.tax]), [[1300, 1300], [0, 0]]);
});

test("tax is rounded per line and the difference is visible", () => {
  const totals = computeTotals({
    taxRateBp: 1000,
    lines: [
      { unitPrice: 5, qty: 1 },
      { unitPrice: 5, qty: 1 },
    ],
  });
  assert.equal(totals.subtotal, 10);
  assert.equal(totals.tax, 2, "each 0.5 cent rounds up, so the reported tax is 2 not 1");
  assert.equal(totals.total, 12);
});

test("fractional quantities are supported", () => {
  const totals = computeTotals({ lines: [{ unitPrice: 12000, qty: 2.5, taxRateBp: 0 }] });
  assert.equal(totals.subtotal, 30000);
  assert.equal(totals.total, 30000);
});

test("empty and zero-value invoices produce zeros, not NaN", () => {
  const totals = computeTotals({});
  assert.deepEqual(
    { subtotal: totals.subtotal, discount: totals.discount, net: totals.net, tax: totals.tax, total: totals.total },
    { subtotal: 0, discount: 0, net: 0, tax: 0, total: 0 },
  );
  assert.deepEqual(totals.taxGroups, []);
});

test("inclusive tax and a discount compose correctly", () => {
  const totals = computeTotals({
    lines: [{ unitPrice: 11300, qty: 1, taxRateBp: 1300 }],
    taxInclusive: true,
    discount: { type: "percent", value: 10 },
  });
  assert.equal(totals.discount, 1130);
  assert.equal(totals.total, 10170);
  assert.equal(totals.net, 9000);
  assert.equal(totals.tax, 1170);
});

test("invalid discount and tax inputs throw rather than guess", () => {
  assert.throws(() => resolveDiscount({ type: "percent", value: -5 }, 1000), RangeError);
  assert.throws(() => resolveDiscount({ type: "fixed", value: 10.5 }, 1000), RangeError);
  assert.throws(() => resolveDiscount({ type: "bogus" }, 1000), TypeError);
  assert.throws(() => computeTotals({ lines: [{ unitPrice: 100, taxRateBp: -1 }] }), RangeError);
  assert.throws(() => computeTotals({ lines: [{ unitPrice: 100, taxRateBp: 20000 }] }), RangeError);
});

test("taxSummary labels the groups for the print view", () => {
  const totals = computeTotals({
    lines: [
      { unitPrice: 10000, qty: 1, taxRateBp: 1300 },
      { unitPrice: 5000, qty: 1, taxRateBp: 0 },
    ],
  });
  const rows = taxSummary(totals);
  assert.deepEqual(rows.map((r) => r.label), ["13%", "No tax"]);
});
