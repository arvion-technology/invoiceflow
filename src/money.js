/**
 * Money in invoiceflow.
 *
 * Every amount is an integer count of minor units: 1234 in USD means $12.34,
 * 1234 in JPY means ¥1,234, 1234 in KWD means 1.234 dinar. There is no float in
 * the storage model at all. Floats appear in exactly two places, reading a
 * typed price and converting using an exchange rate, and both are rounded once,
 * at the boundary, with an explicit rule.
 *
 * Rounding rule: half away from zero. `roundMinor(-105)` is -1.05 at exponent 2
 * (not -1.04), which is what an accountant expects from a line printed as
 * -1.045. Multiplication of amount × quantity and amount × rate goes through
 * BigInt so a large invoice cannot silently lose a cent to IEEE-754.
 */

export const CURRENCIES = Object.freeze({
  USD: { code: "USD", exponent: 2, name: "US Dollar", unit: ["dollar", "dollars"], sub: ["cent", "cents"] },
  EUR: { code: "EUR", exponent: 2, name: "Euro", unit: ["euro", "euros"], sub: ["cent", "cents"] },
  GBP: { code: "GBP", exponent: 2, name: "Pound Sterling", unit: ["pound", "pounds"], sub: ["penny", "pence"] },
  NPR: { code: "NPR", exponent: 2, name: "Nepalese Rupee", unit: ["rupee", "rupees"], sub: ["paisa", "paisa"] },
  INR: { code: "INR", exponent: 2, name: "Indian Rupee", unit: ["rupee", "rupees"], sub: ["paisa", "paisa"] },
  JPY: { code: "JPY", exponent: 0, name: "Japanese Yen", unit: ["yen", "yen"], sub: ["sen", "sen"] },
  KWD: { code: "KWD", exponent: 3, name: "Kuwaiti Dinar", unit: ["dinar", "dinars"], sub: ["fils", "fils"] },
  BHD: { code: "BHD", exponent: 3, name: "Bahraini Dinar", unit: ["dinar", "dinars"], sub: ["fils", "fils"] },
  AED: { code: "AED", exponent: 2, name: "UAE Dirham", unit: ["dirham", "dirhams"], sub: ["fils", "fils"] },
  CAD: { code: "CAD", exponent: 2, name: "Canadian Dollar", unit: ["dollar", "dollars"], sub: ["cent", "cents"] },
  AUD: { code: "AUD", exponent: 2, name: "Australian Dollar", unit: ["dollar", "dollars"], sub: ["cent", "cents"] },
  SGD: { code: "SGD", exponent: 2, name: "Singapore Dollar", unit: ["dollar", "dollars"], sub: ["cent", "cents"] },
});

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

export function getCurrency(code) {
  const cur = CURRENCIES[String(code || "").toUpperCase()];
  if (!cur) throw new RangeError(`unsupported currency: ${code}`);
  return cur;
}

export function isCurrency(code) {
  return Object.prototype.hasOwnProperty.call(CURRENCIES, String(code || "").toUpperCase());
}

/** Number of minor units in one major unit: 100 for USD, 1 for JPY, 1000 for KWD. */
export function minorFactor(code) {
  return 10 ** getCurrency(code).exponent;
}

function toSafeNumber(big) {
  if (big > MAX_SAFE || big < -MAX_SAFE) {
    throw new RangeError("amount exceeds the safe integer range");
  }
  return Number(big);
}

/**
 * Integer division with half-away-from-zero rounding.
 * Accepts number or BigInt so callers can keep the multiplication exact.
 */
export function divRound(numerator, denominator) {
  let n = typeof numerator === "bigint" ? numerator : BigInt(Math.trunc(numerator));
  const d = typeof denominator === "bigint" ? denominator : BigInt(Math.trunc(denominator));
  if (d === 0n) throw new RangeError("division by zero");
  const negative = (n < 0n) !== (d < 0n);
  if (n < 0n) n = -n;
  const ad = d < 0n ? -d : d;
  let q = n / ad;
  if ((n % ad) * 2n >= ad) q += 1n;
  return toSafeNumber(negative ? -q : q);
}

/**
 * Parse a user-entered or API-supplied amount into minor units.
 * Accepts numbers and strings with thousands separators, currency symbols,
 * a leading sign or parenthesised negatives: "$1,234.565" → 123457 (USD).
 */
export function parseMoney(value, code = "USD") {
  const cur = getCurrency(code);
  let text;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("amount must be a finite number");
    // Turn the binary float into a decimal string first, then round once in
    // decimal space. 19 significant digits covers every cent a human can type.
    text = Math.abs(value) < 1e21 ? trimFloat(value) : String(value);
  } else if (typeof value === "bigint") {
    return toSafeNumber(value);
  } else if (typeof value === "string") {
    text = value;
  } else {
    throw new TypeError("amount must be a string, number or bigint");
  }

  text = text.trim();
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  const cleaned = text.replace(/[^0-9.+-]/g, "");
  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (!match || (!match[2] && !match[3])) throw new TypeError(`cannot parse amount: ${value}`);
  const sign = match[1];
  if (sign === "-") negative = !negative;
  const whole = BigInt(match[2] || "0");
  let fraction = match[3] || "";

  let minor = whole * BigInt(10 ** cur.exponent);
  const next = fraction[cur.exponent] || "0";
  if (cur.exponent > 0) {
    if (fraction.length < cur.exponent) fraction = fraction.padEnd(cur.exponent, "0");
    minor += BigInt(fraction.slice(0, cur.exponent) || "0");
  }
  // Round the first dropped digit half away from zero. JPY (exponent 0) rounds
  // too: entering ¥1,234.60 must not silently truncate to ¥1,234.
  if (Number(next) >= 5) minor += 1n;
  return toSafeNumber(negative ? -minor : minor);
}

/** Drop float noise without exponent notation (1e-7 has no cents anyway). */
function trimFloat(value) {
  if (Number.isInteger(value)) return String(value);
  const s = value.toFixed(12);
  return s.replace(/0+$/, "").replace(/\.$/, "");
}

/** Minor units as a major-unit number. Display only, never do math with it. */
export function toMajor(minor, code = "USD") {
  return minor / minorFactor(code);
}

/** Format an integer amount for display. */
export function formatMoney(minor, code = "USD", { locale = "en-US", display = "symbol", signDisplay = "auto" } = {}) {
  const cur = getCurrency(code);
  const value = toMajor(minor, code);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: cur.code,
      currencyDisplay: display,
      minimumFractionDigits: cur.exponent,
      maximumFractionDigits: cur.exponent,
      signDisplay,
    }).format(value);
  } catch {
    const digits = Math.abs(minor).toString().padStart(cur.exponent + 1, "0");
    const cut = digits.length - cur.exponent;
    return `${minor < 0 ? "-" : ""}${cur.code} ${digits.slice(0, cut)}${cur.exponent ? "." + digits.slice(cut) : ""}`;
  }
}

/** Compact display for dashboard KPI tiles: $12.4k, ¥1.2M. */
export function formatMoneyCompact(minor, code = "USD") {
  const cur = getCurrency(code);
  const major = toMajor(minor, code);
  const abs = Math.abs(major);
  const abbrev = abs >= 1e9 ? [1e9, "B"] : abs >= 1e6 ? [1e6, "M"] : abs >= 1e3 ? [1e3, "k"] : null;
  if (abbrev) {
    const n = (major / abbrev[0]).toFixed(abs / abbrev[0] >= 10 ? 0 : 1).replace(/\.0$/, "");
    try {
      const symbol = new Intl.NumberFormat("en-US", { style: "currency", currency: cur.code, currencyDisplay: "narrowSymbol", maximumFractionDigits: 0 }).format(0).replace(/[\d.,\s]/g, "");
      return `${symbol}${n}${abbrev[1]}`;
    } catch {
      return `${cur.code} ${n}${abbrev[1]}`;
    }
  }
  return formatMoney(minor, code);
}

export function addMoney(...amounts) {
  return amounts.reduce((a, b) => {
    if (!Number.isInteger(a) || !Number.isInteger(b)) throw new TypeError("money must be integer minor units");
    return a + b;
  }, 0);
}

export function sumMoney(amounts) {
  return amounts.reduce((a, b) => a + b, 0);
}

/** unit price × quantity (quantity may be fractional, e.g. 1.5 hours). */
export function multiplyMoney(unitMinor, quantity) {
  if (!Number.isInteger(unitMinor)) throw new TypeError("unit price must be integer minor units");
  if (!Number.isFinite(quantity)) throw new TypeError("quantity must be finite");
  const micro = Math.round(quantity * 1e6);
  return divRound(BigInt(unitMinor) * BigInt(micro), 1_000_000n);
}

/** Basis points of an amount: 1300 bp = 13%. */
export function percentOf(minor, basisPoints) {
  if (!Number.isInteger(basisPoints)) throw new TypeError("basis points must be an integer");
  return divRound(BigInt(minor) * BigInt(basisPoints), 10_000n);
}

/** 13.75 → 1375 basis points. */
export function percentToBasisPoints(percent) {
  return Math.round(percent * 100);
}

/**
 * Split an integer total across weights so the parts sum back exactly to the
 * total. Used to spread an invoice-level discount across lines without the
 * classic "one cent disappeared" bug. Largest-remainder apportionment.
 */
export function allocate(total, weights) {
  if (!Number.isInteger(total)) throw new TypeError("total must be integer minor units");
  if (!Array.isArray(weights) || weights.length === 0) return [];
  if (weights.some((w) => !Number.isFinite(w) || w < 0)) throw new RangeError("weights must be non-negative numbers");
  const count = weights.length;
  const sumW = weights.reduce((a, b) => a + b, 0);
  if (sumW === 0) return allocate(total, new Array(count).fill(1));

  const negative = total < 0;
  const magnitude = BigInt(Math.abs(total));
  const sum = BigInt(Math.round(sumW * 1e6));
  const scaled = weights.map((w) => BigInt(Math.round(w * 1e6)));

  const parts = [];
  const remainders = [];
  for (let i = 0; i < count; i += 1) {
    const numerator = magnitude * scaled[i];
    const floor = numerator / sum;
    parts.push(floor);
    remainders.push({ index: i, rem: numerator - floor * sum });
  }
  let leftover = magnitude - parts.reduce((a, b) => a + b, 0n);
  remainders.sort((a, b) => (b.rem === a.rem ? a.index - b.index : b.rem > a.rem ? 1 : -1));
  for (let i = 0; leftover > 0n && i < remainders.length; i += 1) {
    parts[remainders[i].index] += 1n;
    leftover -= 1n;
  }
  return parts.map((p) => toSafeNumber(negative ? -p : p));
}

/**
 * Convert minor units using a currency table whose micro rates are *units per
 * one base unit* (the way FX tables are normally quoted: 1 USD = 133.5 NPR).
 * Cross-rates are computed by dividing, so no double rounding on a base leg.
 */
export function convert(amountMinor, from, to, table) {
  const src = getCurrency(from);
  const dst = getCurrency(to);
  if (src.code === dst.code) return amountMinor;
  const srcRate = table?.rates?.[src.code];
  const dstRate = table?.rates?.[dst.code];
  if (!srcRate || !dstRate) {
    throw new RangeError(`no exchange rate for ${src.code} -> ${dst.code}`);
  }
  const numerator = BigInt(amountMinor) * BigInt(dstRate) * BigInt(10 ** dst.exponent);
  const denominator = BigInt(srcRate) * BigInt(10 ** src.exponent);
  return divRound(numerator, denominator);
}

/** 0.92 → 920000. Rates are held as integers for the same reason amounts are. */
export function rateToMicro(rate) {
  if (!Number.isFinite(rate) || rate <= 0) throw new RangeError("rate must be a positive number");
  return Math.round(rate * 1e6);
}

export function microToRate(micro) {
  return micro / 1e6;
}

/* ---------------------------------------------------------------- words --- */

const ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES = [[1e9, "billion"], [1e6, "million"], [1e3, "thousand"], [1, ""]];

function underThousand(n) {
  const words = [];
  const hundreds = Math.floor(n / 100);
  if (hundreds) words.push(`${ONES[hundreds]} hundred`);
  const rest = n % 100;
  if (rest) {
    if (words.length) words.push("and");
    if (rest < 20) words.push(ONES[rest]);
    else {
      const t = Math.floor(rest / 10);
      const ones = rest % 10;
      words.push(ones ? `${TENS[t]}-${ONES[ones]}` : TENS[t]);
    }
  }
  return words.join(" ");
}

function wordsForInteger(n) {
  if (n === 0) return "zero";
  const chunks = [];
  for (const [value, label] of SCALES) {
    const count = Math.floor(n / value);
    if (!count) continue;
    chunks.push(`${underThousand(count)}${label ? " " + label : ""}`);
    n -= count * value;
  }
  return chunks.join(" ");
}

function pluralise([one, many], count) {
  return count === 1 ? one : many;
}

/**
 * Amount in words for the printable invoice footer. The major amount is written
 * out and the fraction is written as an integer count of the subunit (cents,
 * pence, fils), which is how invoices are read aloud. JPY has no subunit and
 * prints only the yen amount.
 */
export function amountInWords(minor, code = "USD") {
  const cur = getCurrency(code);
  const factor = 10 ** cur.exponent;
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const major = Math.floor(abs / factor);
  const fraction = abs % factor;

  const majorWords = wordsForInteger(major);
  let text = `${majorWords} ${pluralise(cur.unit, major)}`;
  if (cur.exponent > 0) {
    const digits = String(fraction).padStart(cur.exponent, "0");
    if (fraction > 0) text += ` and ${wordsForInteger(Number(digits))} ${pluralise(cur.sub, fraction)}`;
  }
  text = text.charAt(0).toUpperCase() + text.slice(1);
  return negative ? `Minus ${text.toLowerCase()}` : text;
}
