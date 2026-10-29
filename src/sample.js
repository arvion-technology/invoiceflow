/**
 * The sample workspace.
 *
 * This is the one place where numbers are invented: sixteen invoices for nine
 * fictional clients of a fictional studio. Everything else in the repository is
 * computed from these records by the same code the demo runs. Dates are
 * relative to "now" so the dashboard always shows a mixture of paid, due-soon
 * and overdue invoices instead of a static screenshot of 2024.
 *
 * Exchange rates are fixed on purpose. A demo that fetches live FX rates is a
 * demo that breaks in an offline room; the README says they are illustrative.
 */

import { addDays, todayKey, toUTC } from "./dates.js";
import { parseMoney, rateToMicro } from "./money.js";
import { invoiceTotals } from "./invoice.js";
import { dueOnFor } from "./recurring.js";

/** Indicative mid-market rates, quoted per 1 USD. Fixed for the demo. */
export const RATES = Object.freeze({
  base: "USD",
  asOf: "2026-10-01",
  note: "Indicative rates fixed for the demo. Not live market data.",
  rates: Object.freeze({
    USD: rateToMicro(1),
    EUR: rateToMicro(0.92),
    GBP: rateToMicro(0.79),
    NPR: rateToMicro(133.5),
    INR: rateToMicro(88),
    JPY: rateToMicro(150),
    CAD: rateToMicro(1.36),
    AUD: rateToMicro(1.52),
    AED: rateToMicro(3.67),
    SGD: rateToMicro(1.34),
    KWD: rateToMicro(0.307),
    BHD: rateToMicro(0.376),
  }),
});

export const CLIENTS = Object.freeze([
  { id: "cli-1", name: "Meridian Freight", contact: "Priya Nair", email: "priya@meridianfreight.example", country: "Singapore", currency: "USD", address: "8 Marina View, Singapore 018960" },
  { id: "cli-2", name: "Kestrel Health", contact: "Dana Whitfield", email: "dana@kestrelhealth.example", country: "United States", currency: "USD", address: "1440 Harbor Street, Portland, OR 97209" },
  { id: "cli-3", name: "Sundara Coffee", contact: "Anish Shrestha", email: "anish@sundara.example", country: "Nepal", currency: "NPR", address: "Jhamsikhel, Lalitpur 44700" },
  { id: "cli-4", name: "Loom & Ledger", contact: "Harriet Ellis", email: "harriet@loomledger.example", country: "United Kingdom", currency: "GBP", address: "12 Redchurch Street, London E2 7DJ" },
  { id: "cli-5", name: "Atlas Field Co", contact: "Jonas Berg", email: "jonas@atlasfield.example", country: "Germany", currency: "EUR", address: "Torstraße 91, 10119 Berlin" },
  { id: "cli-6", name: "Beacon Learning", contact: "Maya Trudeau", email: "maya@beaconlearning.example", country: "Canada", currency: "CAD", address: "610 King Street West, Toronto, ON M5V 1M5" },
  { id: "cli-7", name: "Ropeway Digital", contact: "Tom Ashby", email: "tom@ropeway.example", country: "Australia", currency: "AUD", address: "77 Foster Street, Surry Hills NSW 2010" },
  { id: "cli-8", name: "Kanchen Studio", contact: "Rupa Gurung", email: "rupa@kanchen.example", country: "Nepal", currency: "NPR", address: "Baluwatar, Kathmandu 44600" },
  { id: "cli-9", name: "Hoshino Works", contact: "Aiko Tanaka", email: "aiko@hoshino.example", country: "Japan", currency: "JPY", address: "2-11-3 Ebisu, Shibuya, Tokyo 150-0013" },
]);

export const SERVICES = Object.freeze([
  { description: "Product design retainer", unitPrice: { USD: 4800, EUR: 4400, GBP: 3800, AUD: 7200, CAD: 6400, NPR: 420000, JPY: 480000 } },
  { description: "Brand identity sprint", unitPrice: { USD: 3800, EUR: 3500, GBP: 3200, AUD: 5700, CAD: 5100, NPR: 360000, JPY: 420000 } },
  { description: "Design system audit", unitPrice: { USD: 1450, EUR: 1350, GBP: 1200, AUD: 2200, CAD: 1950, NPR: 145000, JPY: 160000 } },
  { description: "Frontend implementation (hourly)", unitPrice: { USD: 85, EUR: 78, GBP: 70, AUD: 120, CAD: 105, NPR: 6500, JPY: 9000 } },
  { description: "Discovery workshop (per day)", unitPrice: { USD: 650, EUR: 600, GBP: 540, AUD: 950, CAD: 860, NPR: 62000, JPY: 68000 } },
  { description: "UX research interview", unitPrice: { USD: 180, EUR: 165, GBP: 150, AUD: 260, CAD: 230, NPR: 14000, JPY: 16000 } },
  { description: "Motion design pass", unitPrice: { USD: 1200, EUR: 1100, GBP: 980, AUD: 1800, CAD: 1600, NPR: 120000, JPY: 135000 } },
  { description: "Support and maintenance (hourly)", unitPrice: { USD: 110, EUR: 100, GBP: 90, AUD: 160, CAD: 140, NPR: 8500, JPY: 12000 } },
  { description: "Accessibility review", unitPrice: { USD: 950, EUR: 880, GBP: 780, AUD: 1400, CAD: 1250, NPR: 95000, JPY: 105000 } },
  { description: "Localisation pass (Nepali)", unitPrice: { USD: 45, EUR: 42, GBP: 38, AUD: 65, CAD: 58, NPR: 3500, JPY: 5000 } },
]);

const VAT_NP = 1300; // 13% Nepali VAT on domestic services
const EXPORT_ZERO = 0; // services exported from Nepal are zero-rated

/**
 * Invoice templates. `issuedDaysAgo` is negative in the past; `pay` describes
 * how the invoice was settled. Amounts are major units, converted to integer
 * minor units as the sample is materialised.
 */
const TEMPLATES = [
  {
    id: "inv-0001", clientId: "cli-1", currency: "USD", issuedDaysAgo: 158, termsDays: 30,
    lines: [{ service: 0, qty: 1 }, { service: 7, qty: 6 }],
    pay: { kind: "full", daysAfterIssue: 18 },
  },
  {
    id: "inv-0002", clientId: "cli-4", currency: "GBP", issuedDaysAgo: 132, termsDays: 14,
    lines: [{ service: 1, qty: 1 }],
    pay: { kind: "full", daysAfterIssue: 11 },
  },
  {
    id: "inv-0003", clientId: "cli-3", currency: "NPR", issuedDaysAgo: 96, termsDays: 14,
    lines: [{ service: 1, qty: 1 }, { service: 8, qty: 1 }],
    taxRateBp: VAT_NP, taxInclusive: true,
    pay: { kind: "full", daysAfterIssue: 13 },
  },
  {
    id: "inv-0004", clientId: "cli-5", currency: "EUR", issuedDaysAgo: 74, termsDays: 30,
    lines: [{ service: 2, qty: 1 }, { service: 3, qty: 26 }],
    discount: { type: "percent", value: 5 },
    pay: { kind: "partial", fraction: 0.4, daysAfterIssue: 16 },
  },
  {
    id: "inv-0005", clientId: "cli-2", currency: "USD", issuedDaysAgo: 68, termsDays: 30,
    lines: [{ service: 5, qty: 8 }, { service: 4, qty: 1 }],
  },
  {
    id: "inv-0006", clientId: "cli-6", currency: "CAD", issuedDaysAgo: 52, termsDays: 21,
    lines: [{ service: 3, qty: 40 }],
    discount: { type: "fixed", value: 12000 },
  },
  {
    id: "inv-0007", clientId: "cli-7", currency: "AUD", issuedDaysAgo: 44, termsDays: 30,
    lines: [{ service: 6, qty: 1 }, { service: 8, qty: 1 }],
    pay: { kind: "full", daysAfterIssue: 22 },
  },
  {
    id: "inv-0008", clientId: "cli-3", currency: "NPR", issuedDaysAgo: 38, termsDays: 14,
    lines: [
      { description: "Packaging artwork", unitPrice: 95000, qty: 1 },
      { description: "Print production supervision", unitPrice: 22500, qty: 2 },
    ],
    taxRateBp: VAT_NP, taxInclusive: true,
  },
  {
    id: "inv-0009", clientId: "cli-1", currency: "USD", issuedDaysAgo: 26, termsDays: 30,
    lines: [{ service: 0, qty: 1 }],
    recurringId: "rec-1",
  },
  {
    id: "inv-0010", clientId: "cli-8", currency: "NPR", issuedDaysAgo: 22, termsDays: 14,
    lines: [
      { description: "Website design", unitPrice: 240000, qty: 1 },
      { service: 7, qty: 5 },
    ],
    taxRateBp: VAT_NP,
    pay: { kind: "partial", fraction: 0.5, daysAfterIssue: 9 },
  },
  {
    id: "inv-0011", clientId: "cli-4", currency: "GBP", issuedDaysAgo: 16, termsDays: 30,
    lines: [{ description: "Brand rollout support", unitPrice: 2400, qty: 1 }, { service: 7, qty: 4 }],
  },
  {
    id: "inv-0012", clientId: "cli-2", currency: "USD", issuedDaysAgo: 9, termsDays: 30,
    lines: [{ service: 8, qty: 1 }, { service: 3, qty: 12 }],
    pay: { kind: "full", daysAfterIssue: 5 },
  },
  {
    id: "inv-0013", clientId: "cli-9", currency: "JPY", issuedDaysAgo: 4, termsDays: 30,
    lines: [{ service: 0, qty: 1 }],
  },
  {
    id: "inv-0014", clientId: "cli-6", currency: "CAD", issuedDaysAgo: 1, termsDays: 21,
    lines: [{ service: 0, qty: 1 }, { service: 3, qty: 6 }],
    draft: true,
  },
  {
    id: "inv-0015", clientId: "cli-7", currency: "AUD", issuedDaysAgo: 20, termsDays: 30,
    lines: [{ service: 4, qty: 1 }],
    voided: true,
    note: "Voided, wrong entity on the invoice. Reissued as INV-2026-0048.",
  },
  {
    id: "inv-0016", clientId: "cli-5", currency: "EUR", issuedDaysAgo: 12, termsDays: 30,
    lines: [{ service: 4, qty: 2 }, { service: 9, qty: 14 }],
  },
];

function priceFor(serviceIndex, currency, overrideDescription, overridePrice) {
  if (overridePrice !== undefined) {
    return { description: overrideDescription, unitPrice: parseMoney(overridePrice, currency) };
  }
  const service = SERVICES[serviceIndex];
  if (!service) throw new RangeError(`unknown service index ${serviceIndex}`);
  const major = service.unitPrice[currency];
  const fallback = service.unitPrice.USD;
  return {
    description: service.description,
    unitPrice: parseMoney(major ?? fallback, currency),
  };
}

export function buildSampleData({ now = Date.now() } = {}) {
  const today = todayKey(now);
  const invoices = [];

  TEMPLATES.forEach((template, index) => {
    const issuedOn = addDays(today, -template.issuedDaysAgo);
    const currency = template.currency;
    const lines = template.lines.map((line, lineIndex) => ({
      id: `${template.id}-l${lineIndex + 1}`,
      description: line.description || priceFor(line.service, currency, line.description).description,
      qty: line.qty ?? 1,
      unitPrice: line.unitPrice !== undefined
        ? parseMoney(line.unitPrice, currency)
        : priceFor(line.service, currency).unitPrice,
      taxRateBp: line.taxRateBp ?? template.taxRateBp ?? EXPORT_ZERO,
    }));

    const year = Number(issuedOn.slice(0, 4));
    const sequence = 40 + index;
    const invoice = {
      id: template.id,
      number: `INV-${year}-${String(sequence).padStart(4, "0")}`,
      clientId: template.clientId,
      currency,
      issuedOn,
      dueOn: dueOnFor(issuedOn, template.termsDays),
      termsDays: template.termsDays,
      lines,
      discount: template.discount || null,
      taxRateBp: template.taxRateBp ?? EXPORT_ZERO,
      taxInclusive: template.taxInclusive === true,
      notes: template.note || "Payment by bank transfer. Please quote the invoice number.",
      draft: template.draft === true,
      voided: template.voided === true,
      recurringId: template.recurringId || null,
      payments: [],
    };

    if (template.pay) {
      const total = invoiceTotals(invoice).total;
      const amount = template.pay.kind === "full" ? total : Math.round(total * template.pay.fraction);
      if (amount > 0) {
        invoice.payments.push({
          id: `${template.id}-p1`,
          amount,
          at: toUTC(addDays(issuedOn, template.pay.daysAfterIssue)),
          method: template.pay.kind === "full" ? "Bank transfer" : "Bank transfer (part)",
          reference: `TX-${template.id.slice(-4)}`,
        });
      }
    }
    invoices.push(invoice);
  });

  const settings = {
    business: {
      name: "Northline Studio",
      legalName: "Northline Studio Pvt. Ltd.",
      email: "billing@northline.example",
      phone: "+977 1 555 0142",
      website: "northline.example",
      addressLines: ["Jhamsikhel, Lalitpur 44700", "Bagmati, Nepal"],
      taxId: "PAN 601234567",
      bank: {
        name: "Nabil Bank",
        account: "0123456789012",
        swift: "NABLNPKA",
        note: "Please include the invoice number as the payment reference.",
      },
    },
    defaults: {
      currency: "USD",
      taxRateBp: VAT_NP,
      exportTaxRateBp: EXPORT_ZERO,
      termsDays: 14,
      prefix: "INV",
      pad: 4,
      separator: "-",
    },
    baseCurrency: "USD",
    today,
  };

  const recurring = [
    {
      id: "rec-1",
      clientId: "cli-1",
      label: "Meridian Freight, product design retainer",
      currency: "USD",
      startOn: addDays(today, -26),
      every: 1,
      unit: "month",
      count: 12,
      termsDays: 30,
      lines: [{ description: "Product design retainer", qty: 1, unitPrice: parseMoney(4800, "USD"), taxRateBp: EXPORT_ZERO }],
      taxRateBp: EXPORT_ZERO,
      active: true,
    },
    {
      id: "rec-2",
      clientId: "cli-8",
      label: "Kanchen Studio, support and maintenance",
      currency: "NPR",
      startOn: addDays(today, -22),
      every: 1,
      unit: "month",
      count: 6,
      termsDays: 14,
      lines: [{ description: "Support and maintenance (hourly)", qty: 6, unitPrice: parseMoney(8500, "NPR"), taxRateBp: VAT_NP }],
      taxRateBp: VAT_NP,
      active: true,
    },
  ];

  return { settings, clients: CLIENTS, invoices, recurring, rates: RATES };
}
