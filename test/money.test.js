import test from "node:test";
import assert from "node:assert/strict";

import {
  CURRENCIES, getCurrency, minorFactor, parseMoney, formatMoney, formatMoneyCompact,
  toMajor, divRound, multiplyMoney, percentOf, percentToBasisPoints, allocate,
  convert, rateToMicro, amountInWords, sumMoney, addMoney, isCurrency,
} from "../src/money.js";

test("currencies carry their real ISO exponent", () => {
  assert.equal(minorFactor("USD"), 100);
  assert.equal(minorFactor("JPY"), 1);
  assert.equal(minorFactor("KWD"), 1000);
  assert.equal(isCurrency("usd"), true);
  assert.equal(isCurrency("BTC"), false);
  assert.equal(getCurrency("gbp").name, "Pound Sterling");
  assert.throws(() => getCurrency("XYZ"), RangeError);
  assert.equal(Object.keys(CURRENCIES).length >= 10, true);
});

test("parseMoney reads human input without floating point drift", () => {
  assert.equal(parseMoney("1,234.56", "USD"), 123456);
  assert.equal(parseMoney("$1,234", "USD"), 123400);
  assert.equal(parseMoney("(45.10)", "USD"), -4510);
  assert.equal(parseMoney("-0.005", "USD"), -1, "half away from zero");
  assert.equal(parseMoney("0.004", "USD"), 0);
  assert.equal(parseMoney(1.005, "USD"), 101, "binary float 1.005 still becomes 101");
  assert.equal(parseMoney("1.2345", "KWD"), 1235);
  assert.equal(parseMoney("1234.6", "JPY"), 1235, "yen has no subunit but still rounds");
  assert.equal(parseMoney("1234.4", "JPY"), 1234);
  assert.throws(() => parseMoney("not money", "USD"), TypeError);
  assert.throws(() => parseMoney("12.3.4", "USD"), TypeError);
  assert.throws(() => parseMoney(Infinity, "USD"), TypeError);
});

test("formatMoney respects currency exponents", () => {
  assert.equal(formatMoney(123456, "USD"), "$1,234.56");
  assert.match(formatMoney(1235, "KWD"), /^KWD\s1\.235$/u);
  assert.equal(formatMoney(1235, "JPY"), "¥1,235");
  assert.match(formatMoney(-500, "USD"), /-\$5\.00/);
  assert.match(formatMoneyCompact(5000000, "USD"), /^\$50k$/);
});

test("toMajor is display-only and never used for math", () => {
  assert.equal(toMajor(1234, "USD"), 12.34);
  assert.equal(toMajor(1234, "JPY"), 1234);
});

test("integer division rounds half away from zero", () => {
  assert.equal(divRound(105, 100), 1);
  assert.equal(divRound(106, 100), 1);
  assert.equal(divRound(-105, 100), -1);
  assert.equal(divRound(-106, 100), -1);
  assert.equal(divRound(-15, 10), -2, "-1.5 rounds away from zero");
  assert.equal(divRound(15, 10), 2);
  assert.equal(divRound(-14, 10), -1);
  assert.throws(() => divRound(1, 0), RangeError);
});

test("multiplyMoney rounds once at the boundary", () => {
  assert.equal(multiplyMoney(999, 1.5), 1499);
  assert.equal(multiplyMoney(8500, 6), 51000);
  assert.equal(multiplyMoney(1200, 0.5), 600);
  assert.equal(multiplyMoney(100, 0.004), 0);
  assert.throws(() => multiplyMoney(100.5, 1), TypeError);
});

test("percentOf uses basis points", () => {
  assert.equal(percentOf(10000, 1300), 1300);
  assert.equal(percentOf(333, 1300), 43);
  assert.equal(percentToBasisPoints(13.5), 1350);
});

test("allocate preserves the total exactly", () => {
  const parts = allocate(1000, [3, 1, 1]);
  assert.deepEqual(parts, [600, 200, 200]);
  assert.equal(sumMoney(parts), 1000);

  const odd = allocate(100, [3333, 3333, 3334]);
  assert.equal(sumMoney(odd), 100, "largest remainder never loses a unit");

  const negative = allocate(-7, [1, 1, 1]);
  assert.equal(sumMoney(negative), -7);

  assert.deepEqual(allocate(10, []), []);
  assert.deepEqual(allocate(3, [0, 0]), [2, 1], "zero weights split as evenly as possible");
});

test("convert goes through a per-USD rate table in one division", () => {
  const table = { base: "USD", rates: { USD: rateToMicro(1), NPR: rateToMicro(133.5), JPY: rateToMicro(150) } };
  assert.equal(convert(100000, "USD", "NPR", table), 13350000, "$1,000 = NPR 133,500");
  assert.equal(convert(13350000, "NPR", "USD", table), 100000);
  assert.equal(convert(100000, "USD", "JPY", table), 150000, "$1,000 = ¥150,000 (no cents)");
  assert.equal(convert(100, "USD", "USD", table), 100);
  assert.throws(() => convert(100, "USD", "EUR", table), RangeError);
});

test("amountInWords writes the printed invoice footer", () => {
  assert.equal(amountInWords(123456, "USD"), "One thousand two hundred and thirty-four dollars and fifty-six cents");
  assert.equal(amountInWords(100, "USD"), "One dollar");
  assert.equal(amountInWords(101, "USD"), "One dollar and one cent");
  assert.equal(amountInWords(150000, "JPY"), "One hundred and fifty thousand yen");
  assert.equal(amountInWords(0, "USD"), "Zero dollars");
  assert.equal(amountInWords(100500, "KWD"), "One hundred dinars and five hundred fils");
});

test("money helpers reject non-integer minor units", () => {
  assert.equal(addMoney(100, 250, -50), 300);
  assert.throws(() => addMoney(100.5, 1), TypeError);
});
