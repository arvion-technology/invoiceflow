// InvoiceFlow — demo application.
// All money, tax, numbering and status logic comes from ../src/*.js. This file
// only renders that state and handles interaction; there is no second copy of
// the rules in the UI.
import {
  CURRENCIES, formatMoney, formatMoneyCompact, parseMoney, toMajor, amountInWords,
  getCurrency, microToRate,
} from "../src/money.js";
import {
  STATUS, withDerived, summarize, agingBuckets, revenueByMonth, invoiceTotals,
  amountDue, deriveStatus, nextInvoiceNumber,
} from "../src/invoice.js";
import { computeTotals } from "../src/tax.js";
import { addDays, formatDate, todayKey, isValidDateKey } from "../src/dates.js";
import { scheduleFrom, describeRule } from "../src/recurring.js";
import { buildSampleData } from "../src/sample.js";

const $ = A.$, $$ = A.$$, el = A.el;

const STORE_KEY = "invoiceflow:v1";

/* ------------------------------------------------------------------ state */

function loadData() {
  const saved = A.store.get(STORE_KEY);
  if (saved && Array.isArray(saved.invoices) && saved.invoices.length && saved.settings) return saved;
  return buildSampleData({ now: Date.now() });
}

let DB = loadData();
const state = {
  view: "dashboard",
  filter: "all",
  query: "",
  client: "",
  editorMode: "new",
  draft: null,
  printId: null,
};

const baseCurrency = () => DB.settings.baseCurrency || "USD";
const ratesTable = () => DB.rates || { base: "USD", rates: { USD: 1_000_000 } };

function persist() {
  if (!A.store.set(STORE_KEY, DB)) A.toast("Could not save — browser storage is full", "error");
}

function clientById(id) {
  return DB.clients.find((client) => client.id === id) || { name: "Unknown client", email: "", address: "", contact: "" };
}

function invoiceById(id) {
  return DB.invoices.find((invoice) => invoice.id === id) || null;
}

function derived(invoice) {
  return withDerived(invoice, { now: Date.now() });
}

function money(minor, currency, opts) {
  return formatMoney(minor, currency, opts);
}

function majorString(minor, currency) {
  return toMajor(minor, currency).toFixed(getCurrency(currency).exponent);
}

function parseMoneySafe(value, currency) {
  try {
    return parseMoney(value, currency);
  } catch {
    return 0;
  }
}

function currencyOptions(selected) {
  return Object.keys(CURRENCIES).sort().map((code) =>
    el("option", { value: code, selected: code === selected ? "" : null, text: `${code} — ${CURRENCIES[code].name}` }));
}

function taxRateOptions(selected) {
  const rates = [0, 500, 1300];
  if (!rates.includes(selected)) rates.push(selected);
  return rates.sort((a, b) => a - b).map((bp) =>
    el("option", { value: String(bp), selected: bp === selected ? "" : null, text: `${(bp / 100).toFixed(bp % 100 === 0 ? 0 : 2)}%` }));
}

/* ------------------------------------------------------------------ chrome */

const STATUS_LABEL = { draft: "Draft", sent: "Sent", partial: "Part paid", overdue: "Overdue", paid: "Paid", void: "Void" };
const STATUS_TONE = { draft: "", sent: "blue", partial: "gold", overdue: "red", paid: "green", void: "purple" };

function statusBadge(status) {
  return el("span", { class: `badge ${STATUS_TONE[status] || ""}`, text: STATUS_LABEL[status] || status });
}

function renderChrome() {
  $("#topbar-today").textContent = formatDate(todayKey(Date.now()));
  $("#nav-invoice-count").textContent = String(DB.invoices.length);
  const totals = summarize(DB.invoices, { now: Date.now(), base: baseCurrency(), rates: ratesTable() });
  const overdue = totals.counts.overdue || 0;
  $("#sidebar-stats").replaceChildren(
    el("span", { text: `${DB.invoices.length} invoices · ${DB.clients.length} clients` }),
    el("br"),
    el("span", { text: `${money(totals.outstanding, baseCurrency())} outstanding` }),
    overdue ? el("br") : null,
    overdue ? el("span", { style: "color:var(--red)", text: `${overdue} overdue` }) : null,
  );
}

function kpiCard({ label, value, sub, tone = "gold", spark }) {
  return el("div", { class: "card" },
    el("div", { class: "stat" },
      el("div", { class: "stat-label", text: label }),
      el("div", { class: "row", style: "align-items:baseline;gap:10px" },
        el("div", { class: `stat-value ${tone}`, text: value }),
        spark ? A.sparkline(spark, { width: 90, height: 26, color: tone === "green" ? "#34d399" : tone === "blue" ? "#3a7bff" : "#f5c26b" }) : null),
      el("div", { class: "small muted", text: sub })));
}

/* --------------------------------------------------------------- dashboard */

function dueCell(inv) {
  const d = derived(inv);
  const hint = d.daysPastDue > 0
    ? el("span", { class: "late", text: `${d.daysPastDue} days late` })
    : d.daysUntilDue === 0
      ? el("span", { class: "soon", text: "due today" })
      : d.daysUntilDue > 0 && d.daysUntilDue <= 7
        ? el("span", { class: "soon", text: `in ${d.daysUntilDue} days` })
        : el("span", { class: "plain", text: formatDate(inv.dueOn) });
  return el("div", { class: "due-cell" },
    el("span", { class: "small muted", text: formatDate(inv.dueOn) }),
    hint);
}

function renderDashboard() {
  const now = Date.now();
  const totals = summarize(DB.invoices, { now, base: baseCurrency(), rates: ratesTable() });
  const revenue = revenueByMonth(DB.invoices, { months: 6, now, base: baseCurrency(), rates: ratesTable() });
  const sparkInvoiced = revenue.map((row) => row.invoiced);
  const sparkCollected = revenue.map((row) => row.collected);

  $("#kpis").replaceChildren(
    kpiCard({ label: "Invoiced · 6 mo", value: money(totals.invoiced, baseCurrency()), sub: "Issued, excluding drafts", spark: sparkInvoiced }),
    kpiCard({ label: "Collected", value: money(totals.paid, baseCurrency()), sub: "Payments recorded", tone: "green", spark: sparkCollected }),
    kpiCard({ label: "Outstanding", value: money(totals.outstanding, baseCurrency()), sub: `${totals.counts.sent + totals.counts.partial + totals.counts.overdue} open invoices`, spark: sparkInvoiced }),
    kpiCard({ label: "Overdue", value: money(totals.overdue, baseCurrency()), sub: `${totals.counts.overdue} past their due date`, tone: totals.overdue ? "gold" : "green" }),
  );

  $("#revenue-chart").replaceChildren(A.lineChart({
    series: [
      { name: "Invoiced", data: revenue.map((row) => row.invoiced) },
      { name: "Collected", data: revenue.map((row) => row.collected), color: "#3a7bff", area: false },
    ],
    labels: revenue.map((row) => row.label),
    width: 760,
    height: 162,
    yFormat: (value) => (value === 0 ? "$0" : formatMoneyCompact(Math.round(value), baseCurrency())),
  }));

  const ageing = agingBuckets(DB.invoices, { now, base: baseCurrency(), rates: ratesTable() });
  const totalOutstanding = ageing.reduce((sum, bucket) => sum + bucket.amount, 0);
  const colours = ["#34d399", "#f5c26b", "#fbbf24", "#f87171", "#a78bfa"];
  $("#ageing-total").textContent = `${money(totalOutstanding, baseCurrency())} open`;
  $("#ageing-donut").replaceChildren(A.donut({
    slices: ageing.map((bucket, i) => ({ label: bucket.label, value: bucket.amount, color: colours[i] })),
    size: 122,
    thickness: 15,
    centerValue: formatMoneyCompact(totalOutstanding, baseCurrency()),
    centerLabel: "outstanding",
  }));
  $("#ageing-legend").replaceChildren(...ageing.map((bucket, i) =>
    el("div", { class: "ageing-row" },
      el("i", { style: `width:8px;height:8px;border-radius:2px;flex:none;background:${colours[i]}` }),
      el("span", { class: "label", text: bucket.label }),
      el("span", { class: "spacer" }),
      el("span", { class: "amount", text: bucket.amount ? money(bucket.amount, baseCurrency()) : "—" }))));

  const recent = [...DB.invoices]
    .sort((a, b) => b.issuedOn.localeCompare(a.issuedOn) || b.number.localeCompare(a.number))
    .slice(0, 6);
  $("#recent-invoices").replaceChildren(A.dataTable({
    columns: [
      {
        label: "Invoice",
        render: (inv) => el("div", { class: "invoice-cell" },
          el("span", { class: "num", text: inv.number }),
          el("span", { class: "client", text: clientById(inv.clientId).name })),
      },
      { label: "Issued", render: (inv) => el("span", { class: "small muted", text: formatDate(inv.issuedOn) }) },
      { label: "Due", render: (inv) => dueCell(inv) },
      { label: "Amount", align: "right", render: (inv) => el("span", { class: "mono", text: money(invoiceTotals(inv).total, inv.currency) }) },
      { label: "Status", align: "right", render: (inv) => statusBadge(derived(inv).status) },
    ],
    rows: recent,
    onRowClick: (inv) => { location.hash = `#print/${inv.id}`; },
  }));

  const overdue = DB.invoices.map((inv) => derived(inv))
    .filter((inv) => inv.status === STATUS.OVERDUE)
    .sort((a, b) => b.daysPastDue - a.daysPastDue);
  $("#attention-count").textContent = String(overdue.length);
  const attentionItems = overdue.slice(0, 4).map((inv) => el("div", {
    class: "attention-item",
    onclick: () => { location.hash = `#print/${inv.id}`; },
  },
  el("div", { class: "top" },
    el("span", { class: "client", text: clientById(inv.clientId).name }),
    el("span", { class: "spacer" }),
    el("span", { class: "num", text: inv.number })),
  el("div", { class: "bottom" },
    el("span", { class: "amount", text: money(inv.due, inv.currency) }),
    el("span", { class: "late", text: `${inv.daysPastDue} days past due` }))));
  $("#attention-list").replaceChildren(...(overdue.length
    ? attentionItems
    : [el("div", { class: "small muted", text: "Nothing overdue. The ageing panel still shows what is open." })]));

  const upcoming = DB.recurring.flatMap((rule) =>
    scheduleFrom(rule, { after: todayKey(now), limit: 2 }).map((occurrence) => ({ rule, occurrence })))
    .sort((a, b) => a.occurrence.issuedOn.localeCompare(b.occurrence.issuedOn))
    .slice(0, 4);
  $("#next-recurring").replaceChildren(...(upcoming.length
    ? upcoming.map(({ rule, occurrence }) => {
      const ruleTotals = computeTotals({ lines: rule.lines, taxRateBp: rule.taxRateBp });
      return el("div", { class: "recurring-line" },
        el("span", { class: "date", text: formatDate(occurrence.issuedOn) }),
        el("span", { class: "client", text: clientById(rule.clientId).name }),
        el("span", { class: "spacer" }),
        el("span", { class: "small", style: "color:var(--gold);font-variant-numeric:tabular-nums", text: money(ruleTotals.total, rule.currency) }));
    })
    : [el("div", { class: "small muted", text: "No further occurrences in these rules." })]));
}

/* ---------------------------------------------------------------- invoices */

function filteredInvoices() {
  const query = state.query.trim().toLowerCase();
  return DB.invoices.filter((inv) => {
    const d = derived(inv);
    if (state.filter !== "all" && d.status !== state.filter) return false;
    if (state.client && inv.clientId !== state.client) return false;
    if (!query) return true;
    const client = clientById(inv.clientId);
    return inv.number.toLowerCase().includes(query)
      || client.name.toLowerCase().includes(query)
      || (client.contact || "").toLowerCase().includes(query);
  }).sort((a, b) => b.issuedOn.localeCompare(a.issuedOn) || b.number.localeCompare(a.number));
}

function renderStatusTabs() {
  const counts = DB.invoices.reduce((acc, inv) => {
    const status = derived(inv).status;
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
  const filters = [
    { key: "all", label: "All", count: DB.invoices.length },
    ...Object.keys(STATUS_LABEL).map((key) => ({ key, label: STATUS_LABEL[key], count: counts[key] || 0 })),
  ];
  $("#status-tabs").replaceChildren(...filters.map((filter) =>
    el("button", {
      class: `tab ${state.filter === filter.key ? "active" : ""}`,
      "data-filter": filter.key,
      role: "tab",
      text: `${filter.label}${filter.count ? ` (${filter.count})` : ""}`,
    })));
}

function renderClientFilter() {
  const select = $("#client-filter");
  select.replaceChildren(
    el("option", { value: "", text: "All clients" }),
    ...DB.clients.map((client) => el("option", {
      value: client.id,
      selected: state.client === client.id ? "" : null,
      text: client.name,
    })));
}

function renderInvoiceRows() {
  const rows = filteredInvoices();
  renderStatusTabs();
  $("#invoice-table").replaceChildren(A.dataTable({
    columns: [
      {
        label: "Invoice",
        render: (inv) => el("div", { class: "invoice-cell" },
          el("span", { class: "num", text: inv.number }),
          el("span", { class: "client", text: clientById(inv.clientId).name })),
      },
      { label: "Issued", render: (inv) => el("span", { class: "small muted", text: formatDate(inv.issuedOn) }) },
      { label: "Due", render: (inv) => dueCell(inv) },
      { label: "Total", align: "right", render: (inv) => el("span", { class: "mono", text: money(invoiceTotals(inv).total, inv.currency) }) },
      {
        label: "Paid",
        align: "right",
        render: (inv) => el("span", { class: "mono muted", text: derived(inv).paid ? money(derived(inv).paid, inv.currency) : "—" }),
      },
      { label: "Status", align: "right", render: (inv) => statusBadge(derived(inv).status) },
      {
        label: "",
        align: "right",
        render: (inv) => {
          const d = derived(inv);
          const actions = el("div", { class: "actions" },
            el("button", {
              class: "btn ghost sm",
              onclick: (event) => { event.stopPropagation(); location.hash = `#print/${inv.id}`; },
              text: "Open",
            }));
          if (d.due > 0 && d.status !== STATUS.DRAFT && d.status !== STATUS.VOID) {
            actions.append(el("button", {
              class: "btn sm",
              onclick: (event) => { event.stopPropagation(); recordPayment(inv); },
              text: "Payment",
            }));
          }
          return actions;
        },
      },
    ],
    rows,
    empty: "No invoices match this filter.",
    onRowClick: (inv) => { location.hash = `#print/${inv.id}`; },
  }));

  const totals = summarize(rows, { now: Date.now(), base: baseCurrency(), rates: ratesTable() });
  $("#invoice-count").textContent = `${rows.length} of ${DB.invoices.length} invoices`;
  $("#invoice-base-total").textContent = rows.length
    ? `Open value ${money(totals.outstanding, baseCurrency())} · ${money(totals.overdue, baseCurrency())} overdue`
    : "";
  renderClientFilter();
}

function renderInvoices() {
  $("#invoice-search").value = state.query;
  renderStatusTabs();
  renderClientFilter();
  renderInvoiceRows();
}

/* ------------------------------------------------------------------ editor */

function blankInvoice() {
  const defaults = DB.settings.defaults;
  const client = DB.clients[0];
  const issuedOn = todayKey(Date.now());
  const domestic = client.country === "Nepal";
  const taxRateBp = domestic ? defaults.taxRateBp : defaults.exportTaxRateBp;
  return {
    id: A.uid("inv"),
    number: nextInvoiceNumber(DB.invoices, {
      prefix: defaults.prefix,
      year: Number(issuedOn.slice(0, 4)),
      pad: defaults.pad,
      separator: defaults.separator,
    }),
    clientId: client.id,
    currency: client.currency || defaults.currency,
    issuedOn,
    dueOn: addDays(issuedOn, defaults.termsDays),
    termsDays: defaults.termsDays,
    lines: [{ id: A.uid("line"), description: "", qty: 1, unitPrice: 0, taxRateBp }],
    discount: null,
    taxRateBp,
    taxInclusive: false,
    notes: "Payment by bank transfer. Please quote the invoice number.",
    draft: true,
    voided: false,
    recurringId: null,
    payments: [],
  };
}

function draftTotals() {
  return computeTotals(state.draft);
}

function renderLineRows() {
  const host = $("#line-items");
  const draft = state.draft;
  host.replaceChildren(
    el("div", { class: "line-row line-head" },
      el("div", { text: "Description" }),
      el("div", { text: "Qty" }),
      el("div", { text: "Unit price" }),
      el("div", { text: "Tax" }),
      el("div", { style: "text-align:right", text: "Amount" }),
      el("div")),
    ...draft.lines.map((line, index) => el("div", { class: "line-row" },
      el("input", {
        class: "input", value: line.description, placeholder: "What was delivered?",
        "aria-label": `Description line ${index + 1}`,
        oninput: (event) => { line.description = event.target.value; },
      }),
      el("input", {
        class: "input", type: "number", min: "0", step: "0.25", value: String(line.qty),
        "aria-label": `Quantity line ${index + 1}`,
        oninput: (event) => {
          const qty = Number(event.target.value);
          line.qty = Number.isFinite(qty) && qty >= 0 ? qty : 0;
          refreshTotals();
        },
      }),
      el("input", {
        class: "input", inputmode: "decimal", value: majorString(line.unitPrice, draft.currency),
        "aria-label": `Unit price line ${index + 1}`,
        oninput: (event) => {
          line.unitPrice = parseMoneySafe(event.target.value, draft.currency);
          refreshTotals();
        },
      }),
      el("select", {
        class: "select", "aria-label": `Tax rate line ${index + 1}`,
        onchange: (event) => { line.taxRateBp = Number(event.target.value); refreshTotals(); },
      }, ...taxRateOptions(line.taxRateBp)),
      el("span", { class: "amount", "data-amount": String(index), text: money(0, draft.currency) }),
      el("button", {
        class: "btn icon ghost", "aria-label": `Remove line ${index + 1}`,
        disabled: draft.lines.length <= 1 ? "" : null,
        onclick: () => {
          if (draft.lines.length <= 1) return;
          draft.lines.splice(index, 1);
          renderLineRows();
          refreshTotals();
        },
        text: "✕",
      }))));
}

function buildTotalsPanel(totals) {
  const draft = state.draft;
  const rows = [
    el("div", { class: "editor-total" },
      el("span", { class: "label", text: "Subtotal" }),
      el("span", { class: "value", text: money(totals.subtotal, draft.currency) })),
  ];
  if (totals.discount > 0) {
    rows.push(el("div", { class: "editor-total" },
      el("span", { class: "label", text: "Discount" }),
      el("span", { class: "value", style: "color:var(--green)", text: `− ${money(totals.discount, draft.currency)}` })));
  }
  rows.push(el("div", { class: "editor-total" },
    el("span", { class: "label", text: "Net" }),
    el("span", { class: "value", text: money(totals.net, draft.currency) })));
  for (const group of totals.taxGroups) {
    const label = group.rateBp === 0
      ? "Tax (zero-rated)"
      : `Tax ${(group.rateBp / 100).toFixed(group.rateBp % 100 === 0 ? 0 : 2)}%${totals.taxInclusive ? " (included)" : ""}`;
    rows.push(el("div", { class: "editor-total" },
      el("span", { class: "label", text: label }),
      el("span", { class: "value", text: money(group.tax, draft.currency) })));
  }
  rows.push(el("div", { class: "editor-total grand" },
    el("span", { class: "label", text: "Total" }),
    el("span", { class: "value", text: money(totals.total, draft.currency) })));

  if (draft.payments.length) {
    const paid = draft.payments.reduce((sum, payment) => sum + payment.amount, 0);
    rows.push(el("div", { class: "editor-total" },
      el("span", { class: "label", text: "Payments recorded" }),
      el("span", { class: "value", text: `− ${money(paid, draft.currency)}` })));
    rows.push(el("div", { class: "editor-total" },
      el("span", { class: "label", text: "Balance due" }),
      el("span", { class: "value", text: money(Math.max(0, totals.total - paid), draft.currency) })));
  }

  return [
    el("div", { class: "card-head" },
      el("div", { class: "card-title", text: "Totals" }),
      el("span", { class: "spacer" }),
      el("span", { class: "badge gold", text: draft.currency })),
    ...rows,
    el("div", { class: "divider" }),
    el("div", { class: "words" }, el("b", { text: "In words: " }), amountInWords(totals.total, draft.currency)),
    el("div", { class: "small muted mt-2", text: `${draft.lines.length} line${draft.lines.length === 1 ? "" : "s"} · stored as integer minor units` }),
  ];
}

function refreshTotals() {
  if (!state.draft || state.view !== "editor") return;
  const totals = draftTotals();
  $$("[data-amount]", $("#line-items")).forEach((node) => {
    const line = totals.lines[Number(node.dataset.amount)];
    node.textContent = line ? money(line.gross, state.draft.currency) : money(0, state.draft.currency);
  });
  $("#totals-panel").replaceChildren(...buildTotalsPanel(totals));
  $("#editor-number").textContent = state.draft.number;
}

function renderEditor() {
  const draft = state.draft;
  if (!draft) return;
  const editing = state.editorMode === "edit";

  $("#editor-eyebrow").textContent = editing ? "Edit" : "New";
  $("#editor-title").textContent = editing ? `Edit ${draft.number}` : "New invoice";
  $("#editor-lede").textContent = editing
    ? "Changes are recalculated locally. Status stays derived from the due date and payments."
    : "Amounts are entered in major units and stored as integer minor units. The totals panel recalculates as you type.";
  $("#editor-save").textContent = editing ? "Save changes" : "Save and issue";
  $("#editor-save-draft").style.display = editing ? "none" : "";
  $("#editor-save-draft").textContent = "Save draft";

  $("#editor-client").replaceChildren(...DB.clients.map((client) => el("option", {
    value: client.id, selected: client.id === draft.clientId ? "" : null, text: client.name,
  })));
  $("#editor-currency").replaceChildren(...currencyOptions(draft.currency));
  $("#editor-terms").value = String(draft.termsDays || 14);
  $("#editor-issued").value = draft.issuedOn;
  $("#editor-due").value = draft.dueOn;
  $("#editor-tax-mode").value = draft.taxInclusive ? "inclusive" : "exclusive";
  $("#editor-discount-type").value = draft.discount?.type || "none";
  $("#editor-discount-value").value = draft.discount
    ? (draft.discount.type === "percent" ? String(draft.discount.value) : majorString(draft.discount.value, draft.currency))
    : "";
  $("#editor-discount-value").disabled = !draft.discount;
  $("#editor-tax-rate").replaceChildren(...taxRateOptions(draft.taxRateBp));
  $("#editor-notes").value = draft.notes || "";

  renderLineRows();
  refreshTotals();
}

/* --------------------------------------------------------------- payments */

function recordPayment(invoice) {
  const due = amountDue(invoice);
  if (due <= 0) {
    A.toast("This invoice is already settled", "error");
    return;
  }
  const amountInput = el("input", { class: "input", value: majorString(due, invoice.currency), inputmode: "decimal" });
  const method = el("select", { class: "select" },
    ...["Bank transfer", "Card", "Cash", "Cheque", "Other"].map((name) => el("option", { value: name, text: name })));
  A.modal({
    title: `Record payment · ${invoice.number}`,
    body: el("div", { class: "col", style: "gap:14px" },
      el("p", { class: "small muted mb-0", text: `${money(due, invoice.currency)} is still due. Payments are stored as integer minor units.` }),
      el("label", { class: "field" }, "Amount received", amountInput),
      el("label", { class: "field" }, "Method", method)),
    actions: [
      { label: "Cancel" },
      {
        label: "Record payment",
        kind: "primary",
        onClick: () => {
          let amount;
          try {
            amount = parseMoney(amountInput.value, invoice.currency);
          } catch {
            A.toast("That amount cannot be parsed", "error");
            return false;
          }
          if (amount <= 0) {
            A.toast("Payment must be greater than zero", "error");
            return false;
          }
          if (amount > due) {
            A.toast("Payment is larger than the amount due", "error");
            return false;
          }
          invoice.payments.push({
            id: A.uid("pay"),
            amount,
            at: Date.now(),
            method: method.value,
            reference: `PMT-${invoice.number.slice(-4)}`,
          });
          persist();
          A.toast(`Payment of ${money(amount, invoice.currency)} recorded`, "success");
          route();
        },
      },
    ],
  });
}

/* ------------------------------------------------------------------- print */

function renderPrint() {
  const invoice = invoiceById(state.printId)
    || [...DB.invoices].sort((a, b) => b.issuedOn.localeCompare(a.issuedOn))[0];
  if (!invoice) return;
  state.printId = invoice.id;
  const d = derived(invoice);
  const client = clientById(invoice.clientId);
  const totals = invoiceTotals(invoice);
  const business = DB.settings.business;
  const paid = d.paid;
  const balance = Math.max(0, totals.total - paid);

  $("#print-payment").disabled = d.status === STATUS.DRAFT || d.status === STATUS.VOID || balance <= 0;
  $("#print-edit").disabled = false;
  $("#print-hint").textContent = `${STATUS_LABEL[d.status]} · ${money(balance, invoice.currency)} balance · ${invoice.payments.length} payment${invoice.payments.length === 1 ? "" : "s"}`;

  const lineRows = totals.lines.map((line) => el("tr", {},
    el("td", { class: "desc", text: line.description || "—" }),
    el("td", { class: "qty", text: String(line.qty) }),
    el("td", { class: "num", text: money(line.unitPrice, invoice.currency) }),
    el("td", { class: "num", text: line.taxRateBp ? `${(line.taxRateBp / 100).toFixed(line.taxRateBp % 100 === 0 ? 0 : 2)}%` : "—" }),
    el("td", { class: "num", text: money(line.gross, invoice.currency) })));

  const totalRows = [el("div", { class: "line" },
    el("span", { text: "Subtotal" }),
    el("span", { class: "v", text: money(totals.subtotal, invoice.currency) }))];
  if (totals.discount > 0) {
    totalRows.push(el("div", { class: "line discount" },
      el("span", { text: "Discount" }),
      el("span", { class: "v", text: `− ${money(totals.discount, invoice.currency)}` })));
  }
  for (const group of totals.taxGroups) {
    totalRows.push(el("div", { class: "line" },
      el("span", { text: group.rateBp === 0
        ? "Tax (zero-rated)"
        : `Tax ${(group.rateBp / 100).toFixed(group.rateBp % 100 === 0 ? 0 : 2)}%${totals.taxInclusive ? " (included)" : ""}` }),
      el("span", { class: "v", text: money(group.tax, invoice.currency) })));
  }
  totalRows.push(el("div", { class: "line grand" },
    el("span", { text: "Total" }),
    el("span", { class: "v", text: money(totals.total, invoice.currency) })));
  if (paid > 0) {
    totalRows.push(el("div", { class: "line" },
      el("span", { text: "Paid" }),
      el("span", { class: "v", text: `− ${money(paid, invoice.currency)}` })));
    totalRows.push(el("div", { class: "line balance" },
      el("span", { text: "Balance due" }),
      el("span", { class: "v", text: money(balance, invoice.currency) })));
  }

  $("#print-host").replaceChildren(el("div", { class: "paper" },
    el("div", { class: "paper-top" },
      el("div", { class: "paper-brand" },
        el("div", { class: "paper-logo", text: (business.name || "N")[0] }),
        el("div", {},
          el("div", { class: "paper-biz", text: business.name }),
          el("div", { class: "paper-meta", text: business.addressLines.join(" · ") }),
          el("div", { class: "paper-meta", text: `${business.email} · ${business.phone}` }),
          el("div", { class: "paper-meta", text: `${business.taxId} · ${business.website}` }))),
      el("div", { class: "paper-title" },
        el("div", { class: "paper-label", text: "Invoice" }),
        el("div", { class: "big", text: invoice.number.split("-").slice(-1)[0] }),
        el("div", { class: "paper-number", text: invoice.number }),
        el("span", { class: `chip ${d.status}`, text: STATUS_LABEL[d.status] }))),
    el("div", { class: "paper-parties" },
      el("div", {},
        el("div", { class: "paper-label", text: "Billed to" }),
        el("div", { class: "party-name", text: client.name }),
        el("div", { class: "party-line", text: client.contact }),
        el("div", { class: "party-line", text: client.address }),
        el("div", { class: "party-line", text: `${client.email} · ${client.country}` })),
      el("div", { class: "paper-facts" },
        el("div", {}, el("span", { class: "k", text: "Issued" }), el("span", { class: "v", text: formatDate(invoice.issuedOn) })),
        el("div", {}, el("span", { class: "k", text: "Due" }), el("span", { class: "v", text: formatDate(invoice.dueOn) })),
        el("div", {}, el("span", { class: "k", text: "Terms" }), el("span", { class: "v", text: `${invoice.termsDays} days` })),
        el("div", {}, el("span", { class: "k", text: "Currency" }), el("span", { class: "v", text: invoice.currency })),
        el("div", { style: "grid-column:span 2" },
          el("span", { class: "k", text: "Amount due" }),
          el("span", { class: "v", style: "font-size:15px", text: money(balance, invoice.currency) })))),
    el("table", { class: "paper-table" },
      el("thead", {}, el("tr", {},
        el("th", { text: "Description" }),
        el("th", { class: "num", text: "Qty" }),
        el("th", { class: "num", text: "Unit price" }),
        el("th", { class: "num", text: "Tax" }),
        el("th", { class: "num", text: "Amount" }))),
      el("tbody", {}, ...lineRows)),
    el("div", { class: "paper-bottom" },
      el("div", { class: "paper-note" },
        el("div", { class: "paper-label", text: "Notes" }),
        el("div", { text: invoice.notes || "—" }),
        el("div", { class: "block" },
          el("div", { class: "paper-label", text: "Payment details" }),
          el("div", {}, el("b", { text: business.bank.name }), ` · A/C ${business.bank.account}`),
          el("div", {}, `SWIFT ${business.bank.swift}`),
          el("div", {}, business.bank.note))),
      el("div", { class: "paper-totals" }, ...totalRows)),
    el("div", { class: "paper-words" }, el("b", { text: "Amount in words: " }), amountInWords(totals.total, invoice.currency)),
    el("div", { class: "paper-foot" },
      el("span", { text: `${business.legalName} · ${business.email}` }),
      el("span", { text: `Sample workspace · ${invoice.number}` }))));
}

/* --------------------------------------------------------------- recurring */

function reminderText(inv) {
  const client = clientById(inv.clientId);
  const d = derived(inv);
  return `Hi ${client.contact || client.name}, invoice ${inv.number} for ${money(d.due, inv.currency)} was due ${formatDate(inv.dueOn)} and is now ${d.daysPastDue} day${d.daysPastDue === 1 ? "" : "s"} past due. Could you confirm a payment date? — ${DB.settings.business.name}`;
}

function renderRecurring() {
  const now = Date.now();
  $("#recurring-rules").replaceChildren(...DB.recurring.map((rule) => {
    const ruleTotals = computeTotals({ lines: rule.lines, taxRateBp: rule.taxRateBp });
    const upcoming = scheduleFrom(rule, { after: todayKey(now), limit: 4 });
    return el("div", { class: "card" },
      el("div", { class: "card-head" },
        el("div", {},
          el("div", { class: "card-title", text: rule.label }),
          el("div", { class: "card-sub", text: `${clientById(rule.clientId).name} · ${describeRule(rule)}` })),
        el("span", { class: "spacer" }),
        el("span", { class: "badge green", text: "active" })),
      el("div", { class: "rule-meta" },
        el("span", { class: "badge", text: money(ruleTotals.total, rule.currency) }),
        el("span", { class: "badge", text: `${rule.termsDays}-day terms` }),
        el("span", { class: "badge", text: rule.taxRateBp ? `${(rule.taxRateBp / 100).toFixed(0)}% tax` : "zero-rated" }),
        el("span", { class: "badge", text: `${rule.count} issues` })),
      el("table", { class: "rule-table" },
        el("thead", {}, el("tr", {},
          el("th", { text: "Issue date" }),
          el("th", { text: "Due date" }),
          el("th", { class: "num", text: "Amount" }))),
        el("tbody", {}, ...upcoming.map((occurrence) => el("tr", {},
          el("td", { class: "mono", text: formatDate(occurrence.issuedOn) }),
          el("td", { class: "mono", text: formatDate(occurrence.dueOn) }),
          el("td", { class: "num", text: money(ruleTotals.total, rule.currency) }))))),
      upcoming.length ? null : el("p", { class: "small muted mb-0", text: "This rule has issued all of its occurrences." }));
  }));

  const overdue = DB.invoices.map((inv) => derived(inv))
    .filter((inv) => inv.status === STATUS.OVERDUE)
    .sort((a, b) => b.daysPastDue - a.daysPastDue);
  $("#reminder-count").textContent = String(overdue.length);
  $("#reminder-list").replaceChildren(...(overdue.length ? overdue.map((inv) => {
    const text = reminderText(inv);
    return el("div", { class: "reminder" },
      el("div", { class: "row", style: "margin-bottom:8px" },
        el("span", { class: "badge red", text: `${inv.daysPastDue} days late` }),
        el("span", { class: "spacer" }),
        el("span", { class: "mono small muted", text: inv.number })),
      el("div", { class: "reminder-text", text }),
      el("div", { class: "reminder-actions" },
        el("button", {
          class: "btn sm",
          onclick: async () => {
            try {
              await navigator.clipboard.writeText(text);
              A.toast("Reminder copied to clipboard", "success");
            } catch {
              A.toast("Clipboard blocked — select the text and copy manually", "error");
            }
          },
          text: "Copy reminder",
        }),
        el("button", { class: "btn ghost sm", onclick: () => { location.hash = `#print/${inv.id}`; }, text: "Open invoice" })));
  }) : [el("div", { class: "small muted", text: "No overdue invoices — no reminders to send." })]));
}

/* ---------------------------------------------------------------- settings */

function fillSettings() {
  const business = DB.settings.business;
  const defaults = DB.settings.defaults;
  $("#set-name").value = business.name;
  $("#set-legal").value = business.legalName;
  $("#set-email").value = business.email;
  $("#set-phone").value = business.phone;
  $("#set-taxid").value = business.taxId;
  $("#set-website").value = business.website;
  $("#set-address").value = business.addressLines.join("\n");
  $("#set-currency").replaceChildren(...currencyOptions(defaults.currency));
  $("#set-tax").replaceChildren(...taxRateOptions(defaults.taxRateBp));
  $("#set-prefix").value = defaults.prefix;
  $("#set-terms").value = String(defaults.termsDays);
  const year = Number(todayKey(Date.now()).slice(0, 4));
  $("#set-next-number").textContent = `Next number: ${nextInvoiceNumber(DB.invoices, {
    prefix: defaults.prefix, year, pad: defaults.pad, separator: defaults.separator,
  })} — void invoices still consume a number.`;

  $("#rates-note").textContent = ratesTable().note || "";
  $("#rates-asof").textContent = `as of ${formatDate(ratesTable().asOf || todayKey(Date.now()))}`;
  const base = ratesTable().base;
  const rows = Object.entries(ratesTable().rates)
    .filter(([code]) => code !== base)
    .map(([code, micro]) => ({ code, name: CURRENCIES[code]?.name || code, perUsd: microToRate(micro) }))
    .sort((a, b) => a.code.localeCompare(b.code));
  $("#rates-table").replaceChildren(A.dataTable({
    columns: [
      { label: "Currency", render: (row) => el("span", { class: "mono", text: row.code }) },
      { label: "Name", render: (row) => el("span", { class: "small muted", text: row.name }) },
      { label: "Per 1 USD", align: "right", render: (row) => el("span", { class: "mono", text: row.perUsd.toFixed(4) }) },
    ],
    rows,
  }));

  const bytes = JSON.stringify(DB).length;
  $("#data-stats").replaceChildren(
    ...[
      ["Invoices", String(DB.invoices.length)],
      ["Clients", String(DB.clients.length)],
      ["Recurring rules", String(DB.recurring.length)],
      ["Storage size", `${(bytes / 1024).toFixed(1)} KB`],
      ["Storage key", `arvion:${STORE_KEY}`],
    ].flatMap(([key, value]) => [el("dt", { text: key }), el("dd", { text: value })]));
}

function saveSettings() {
  const business = DB.settings.business;
  business.name = $("#set-name").value.trim() || "Business name";
  business.legalName = $("#set-legal").value.trim();
  business.email = $("#set-email").value.trim();
  business.phone = $("#set-phone").value.trim();
  business.taxId = $("#set-taxid").value.trim();
  business.website = $("#set-website").value.trim();
  business.addressLines = $("#set-address").value.split("\n").map((line) => line.trim()).filter(Boolean);

  DB.settings.defaults.currency = $("#set-currency").value;
  DB.settings.defaults.taxRateBp = Number($("#set-tax").value);
  DB.settings.defaults.prefix = $("#set-prefix").value.trim() || "INV";
  DB.settings.defaults.termsDays = Number($("#set-terms").value);
  persist();
  renderChrome();
  fillSettings();
  A.toast("Settings saved to this browser", "success");
}

/* ------------------------------------------------------------------ routing */

const VIEWS = ["dashboard", "invoices", "editor", "print", "recurring", "settings"];

function route() {
  const raw = location.hash.replace(/^#/, "") || "dashboard";
  const [name, arg] = raw.split("/");
  let view = name;

  if (name === "new") {
    view = "editor";
    if (state.editorMode !== "new" || !state.draft) {
      state.editorMode = "new";
      state.draft = blankInvoice();
    }
  } else if (name === "edit") {
    view = "editor";
    const invoice = invoiceById(arg);
    if (invoice) {
      state.editorMode = "edit";
      state.draft = JSON.parse(JSON.stringify(invoice));
    } else {
      view = "invoices";
      state.editorMode = "new";
    }
  } else if (name === "print") {
    state.printId = arg || null;
  } else if (!VIEWS.includes(name)) {
    view = "dashboard";
  }
  state.view = view;

  $$("[data-view-panel]").forEach((panel) => { panel.hidden = panel.dataset.viewPanel !== view; });
  const activeNav = view === "editor" ? (state.editorMode === "new" ? "new" : "invoices") : view;
  $$("[data-view]").forEach((link) => link.classList.toggle("active", link.dataset.view === activeNav));

  if (view === "dashboard") renderDashboard();
  else if (view === "invoices") renderInvoices();
  else if (view === "editor") renderEditor();
  else if (view === "print") renderPrint();
  else if (view === "recurring") renderRecurring();
  else if (view === "settings") fillSettings();

  renderChrome();
  window.scrollTo({ top: 0 });
}

/* --------------------------------------------------------------------- wire */

function saveInvoice({ asDraft }) {
  const draft = state.draft;
  if (!draft) return;
  if (!draft.lines.some((line) => (line.description || "").trim())) {
    A.toast("Add at least one line item with a description", "error");
    return;
  }
  if (!draft.clientId) {
    A.toast("Choose a client", "error");
    return;
  }
  if (!draft.dueOn || !draft.issuedOn) {
    A.toast("Issued and due dates are required", "error");
    return;
  }
  const saved = { ...draft, draft: asDraft };
  const index = DB.invoices.findIndex((invoice) => invoice.id === saved.id);
  if (index >= 0) DB.invoices[index] = saved;
  else DB.invoices.push(saved);
  persist();
  state.draft = null;
  state.editorMode = "new";
  A.toast(`${saved.number} saved · ${STATUS_LABEL[deriveStatus(saved, { now: Date.now() })].toLowerCase()}`, "success");
  location.hash = `#print/${saved.id}`;
  route();
}

function wire() {
  $("#global-search").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    state.query = event.target.value;
    state.filter = "all";
    location.hash = "#invoices";
    route();
  });

  const newInvoice = () => { location.hash = "#new"; };
  ["#topbar-new", "#dashboard-new", "#invoices-new"].forEach((selector) => $(selector).addEventListener("click", newInvoice));

  $("#status-tabs").addEventListener("click", (event) => {
    const tab = event.target.closest("[data-filter]");
    if (!tab) return;
    state.filter = tab.dataset.filter;
    renderInvoiceRows();
  });

  $("#invoice-search").addEventListener("input", (event) => {
    state.query = event.target.value;
    renderInvoiceRows();
  });

  $("#client-filter").addEventListener("change", (event) => {
    state.client = event.target.value;
    renderInvoiceRows();
  });

  $("#export-dashboard").addEventListener("click", () => {
    const rows = revenueByMonth(DB.invoices, { months: 6, now: Date.now(), base: baseCurrency(), rates: ratesTable() });
    const csv = A.toCSV(rows.map((row) => ({
      month: row.key,
      invoiced: majorString(row.invoiced, baseCurrency()),
      collected: majorString(row.collected, baseCurrency()),
    })), ["month", "invoiced", "collected"]);
    A.download("invoiceflow-revenue.csv", csv, "text/csv");
    A.toast("Revenue series exported", "success");
  });

  $("#export-invoices").addEventListener("click", () => {
    const rows = filteredInvoices().map((inv) => {
      const d = derived(inv);
      return {
        number: inv.number,
        client: clientById(inv.clientId).name,
        currency: inv.currency,
        issued: inv.issuedOn,
        due: inv.dueOn,
        status: d.status,
        subtotal: majorString(d.totals.subtotal, inv.currency),
        discount: majorString(d.totals.discount, inv.currency),
        tax: majorString(d.totals.tax, inv.currency),
        total: majorString(d.totals.total, inv.currency),
        paid: majorString(d.paid, inv.currency),
        amount_due: majorString(d.due, inv.currency),
      };
    });
    A.download("invoiceflow-invoices.csv", A.toCSV(rows), "text/csv");
    A.toast(`${rows.length} invoices exported`, "success");
  });

  /* ---- editor fields: static DOM, so wire exactly once ---- */
  $("#editor-client").addEventListener("change", (event) => {
    const draft = state.draft;
    if (!draft) return;
    draft.clientId = event.target.value;
    const client = clientById(draft.clientId);
    if (state.editorMode === "new") {
      draft.currency = client.currency || DB.settings.defaults.currency;
      draft.taxRateBp = client.country === "Nepal" ? DB.settings.defaults.taxRateBp : DB.settings.defaults.exportTaxRateBp;
      draft.lines.forEach((line) => { line.taxRateBp = draft.taxRateBp; });
    }
    renderEditor();
  });
  $("#editor-currency").addEventListener("change", (event) => {
    if (!state.draft) return;
    state.draft.currency = event.target.value;
    renderEditor();
  });
  $("#editor-terms").addEventListener("change", (event) => {
    const draft = state.draft;
    if (!draft) return;
    draft.termsDays = Number(event.target.value);
    draft.dueOn = addDays(draft.issuedOn, draft.termsDays);
    $("#editor-due").value = draft.dueOn;
  });
  $("#editor-issued").addEventListener("change", (event) => {
    const draft = state.draft;
    if (!draft) return;
    if (!isValidDateKey(event.target.value)) { A.toast("Pick a valid issue date", "error"); return; }
    draft.issuedOn = event.target.value;
    draft.dueOn = addDays(draft.issuedOn, draft.termsDays);
    $("#editor-due").value = draft.dueOn;
  });
  $("#editor-due").addEventListener("change", (event) => {
    if (!state.draft) return;
    if (!isValidDateKey(event.target.value)) { A.toast("Pick a valid due date", "error"); return; }
    state.draft.dueOn = event.target.value;
  });
  $("#editor-tax-mode").addEventListener("change", (event) => {
    if (!state.draft) return;
    state.draft.taxInclusive = event.target.value === "inclusive";
    refreshTotals();
  });
  $("#editor-discount-type").addEventListener("change", (event) => {
    const draft = state.draft;
    if (!draft) return;
    const type = event.target.value;
    const current = $("#editor-discount-value").value;
    if (type === "none") {
      draft.discount = null;
      $("#editor-discount-value").value = "";
      $("#editor-discount-value").disabled = true;
    } else {
      $("#editor-discount-value").disabled = false;
      draft.discount = type === "percent"
        ? { type: "percent", value: Number(current) || 0 }
        : { type: "fixed", value: parseMoneySafe(current || "0", draft.currency) };
    }
    refreshTotals();
  });
  $("#editor-discount-value").addEventListener("input", (event) => {
    const draft = state.draft;
    if (!draft || !draft.discount) return;
    const raw = event.target.value;
    draft.discount = draft.discount.type === "percent"
      ? { type: "percent", value: Number(raw) || 0 }
      : { type: "fixed", value: parseMoneySafe(raw || "0", draft.currency) };
    refreshTotals();
  });
  $("#editor-tax-rate").addEventListener("change", (event) => {
    const draft = state.draft;
    if (!draft) return;
    draft.taxRateBp = Number(event.target.value);
    draft.lines.forEach((line) => { line.taxRateBp = draft.taxRateBp; });
    renderLineRows();
    refreshTotals();
  });
  $("#editor-notes").addEventListener("input", (event) => {
    if (state.draft) state.draft.notes = event.target.value;
  });
  $("#editor-add-line").addEventListener("click", () => {
    const draft = state.draft;
    if (!draft) return;
    draft.lines.push({ id: A.uid("line"), description: "", qty: 1, unitPrice: 0, taxRateBp: draft.taxRateBp });
    renderLineRows();
    refreshTotals();
  });
  $("#editor-cancel").addEventListener("click", () => { location.hash = "#invoices"; });
  $("#editor-save-draft").addEventListener("click", () => saveInvoice({ asDraft: true }));
  $("#editor-save").addEventListener("click", () => {
    saveInvoice({ asDraft: state.editorMode === "edit" ? state.draft.draft === true : false });
  });

  /* ---- print actions ---- */
  $("#print-back").addEventListener("click", () => { location.hash = "#invoices"; });
  $("#print-print").addEventListener("click", () => window.print());
  $("#print-edit").addEventListener("click", () => {
    if (state.printId) location.hash = `#edit/${state.printId}`;
  });
  $("#print-payment").addEventListener("click", () => {
    const invoice = invoiceById(state.printId);
    if (invoice) recordPayment(invoice);
  });

  /* ---- settings ---- */
  $("#settings-save").addEventListener("click", saveSettings);

  $("#data-export").addEventListener("click", () => {
    A.download("invoiceflow-backup.json", JSON.stringify(DB, null, 2), "application/json");
    A.toast("Backup downloaded", "success");
  });
  $("#data-import").addEventListener("click", () => $("#data-file").click());
  $("#data-file").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed.settings?.business || !Array.isArray(parsed.invoices) || !Array.isArray(parsed.clients)) {
        throw new Error("not an InvoiceFlow backup");
      }
      DB = {
        settings: parsed.settings,
        clients: parsed.clients,
        invoices: parsed.invoices,
        recurring: Array.isArray(parsed.recurring) ? parsed.recurring : [],
        rates: parsed.rates || DB.rates,
      };
      persist();
      route();
      A.toast("Backup imported", "success");
    } catch (error) {
      A.toast(`Import failed: ${error.message}`, "error");
    } finally {
      event.target.value = "";
    }
  });
  $("#data-reset").addEventListener("click", () => {
    A.modal({
      title: "Restore the sample workspace?",
      body: el("p", { class: "small", text: "This replaces the invoices, settings and schedules in this browser with a freshly generated sample. It cannot be undone." }),
      actions: [
        { label: "Cancel" },
        {
          label: "Restore sample data",
          kind: "danger",
          onClick: () => {
            DB = buildSampleData({ now: Date.now() });
            persist();
            state.query = "";
            state.filter = "all";
            state.client = "";
            A.toast("Sample workspace restored", "success");
            location.hash = "#dashboard";
            route();
          },
        },
      ],
    });
  });

  window.addEventListener("hashchange", route);
}

/* --------------------------------------------------------------------- boot */

wire();
route();
