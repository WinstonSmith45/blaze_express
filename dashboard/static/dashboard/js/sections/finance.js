// Документы и бухгалтерия → Финансовые отчёты:
// Список отчётов реализации (ежедневные) и Детализации к отчётам реализации (еженедельные).
import {
  $, runFile, escapeHtml, num, sumBy, fmtInt, fmtDay, fmtShortDay, intAxis, tile, renderChips,
} from "../core.js";
import { DataTable, matches } from "../table.js";
import { drawChart, chartCard } from "../charts.js";

const moneyFormat = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtRub = (v) => (v == null || Number.isNaN(v) ? "—" : moneyFormat.format(v) + " ₽");

const REPORT_TYPES = { 1: "Основной", 2: "По выкупам" };
const BREADCRUMBS = "Документы и бухгалтерия → Финансовые отчёты";

const rub = (key, label) => ({
  key, label, num: true, sortValue: (r) => r[key], text: (r) => fmtRub(r[key]), total: (r) => r[key], fmt: fmtRub,
});

// ---------- Список отчётов реализации ----------

const LIST_AMOUNTS = [
  { key: "retailAmountSum", label: "Продажа" },
  { key: "forPaySum", label: "К перечислению за товар" },
  { key: "deliveryServiceSum", label: "Логистика", cost: true },
  { key: "paidStorageSum", label: "Хранение", cost: true },
  { key: "paidAcceptanceSum", label: "Платная приёмка", cost: true },
  { key: "deductionSum", label: "Удержания", cost: true },
  { key: "penaltySum", label: "Штрафы", cost: true },
  { key: "additionalPaymentSum", label: "Доплаты" },
  { key: "cashbackDiscountSum", label: "Кешбэк, скидка" },
  { key: "bankPaymentSum", label: "Итого к оплате" },
];

const LIST_COLUMNS = [
  { key: "dateFrom", label: "Период", sortValue: (r) => r.dateFrom,
    text: (r) => (r.dateFrom === r.dateTo ? fmtDay(r.dateFrom) : `${fmtDay(r.dateFrom)} – ${fmtDay(r.dateTo)}`) },
  { key: "reportType", label: "Тип", sortValue: (r) => r.reportType, text: (r) => REPORT_TYPES[r.reportType] || r.reportType },
  { key: "reportId", label: "№ отчёта", num: true, sortValue: (r) => r.reportId, text: (r) => r.reportId },
  { key: "createDate", label: "Сформирован", sortValue: (r) => r.createDate, text: (r) => fmtDay(r.createDate) },
  ...LIST_AMOUNTS.map((a) => rub(a.key, a.label)),
];

export const financeReports = {
  id: "finance-reports",
  title: "Отчёты реализации",
  breadcrumbs: BREADCRUMBS,
  filter: { type: "" },

  mount(el) {
    el.insertAdjacentHTML("beforeend", `
      <p class="muted">Ежедневные отчёты о реализации с начала месяца. Суммы по отчётам «основной» и «по выкупам» складываются.</p>
      <div class="toolbar"><div class="chips" id="finance-reports-type"></div></div>
      <div class="tiles" id="finance-reports-tiles"></div>
      <div class="charts">
        ${chartCard("finance-reports-chart-pay", "Продажа и итого к оплате по дням, ₽")}
        ${chartCard("finance-reports-chart-costs", "Расходы по дням, ₽")}
      </div>
      <h2>Отчёты</h2>
      <div class="table-wrap"><table id="finance-reports-table"></table></div>`);
    this.table = new DataTable($("finance-reports-table"), LIST_COLUMNS, { sortKey: "dateFrom" });
  },

  async render(runId) {
    const data = await runFile(runId, "finance_list");
    this.rows = (Array.isArray(data) ? data : []).map((r) => {
      const row = { ...r };
      for (const a of LIST_AMOUNTS) row[a.key] = num(r[a.key]);
      return row;
    });
    this.table.setRows(this.rows);
    this.update();
  },

  update() {
    const f = this.filter;
    const counts = { 1: 0, 2: 0 };
    for (const r of this.rows) counts[r.reportType] = (counts[r.reportType] || 0) + 1;
    renderChips($("finance-reports-type"), [
      { value: "", label: "Все отчёты", count: this.rows.length },
      { value: "1", label: REPORT_TYPES[1], count: counts[1] },
      { value: "2", label: REPORT_TYPES[2], count: counts[2] },
    ], f.type, (v) => { f.type = v; this.update(); });

    const rows = this.rows.filter((r) => !f.type || String(r.reportType) === f.type);
    $("finance-reports-tiles").innerHTML = LIST_AMOUNTS
      .map((a) => tile(a.label, fmtRub(sumBy(rows, (r) => r[a.key]))))
      .join("");

    const days = [...new Set(rows.map((r) => r.dateFrom))].sort();
    const byDay = (key) => days.map((d) => sumBy(rows.filter((r) => r.dateFrom === d), (r) => r[key]));
    drawChart("finance-reports-chart-pay", {
      type: "bar",
      labels: days.map(fmtShortDay),
      datasets: [
        { label: "Продажа", data: byDay("retailAmountSum") },
        { label: "Итого к оплате", data: byDay("bankPaymentSum") },
      ],
      formatValue: intAxis,
    });
    drawChart("finance-reports-chart-costs", {
      type: "bar",
      stacked: true,
      labels: days.map(fmtShortDay),
      datasets: LIST_AMOUNTS.filter((a) => a.cost).map((a) => ({ label: a.label, data: byDay(a.key) })),
      formatValue: intAxis,
    });

    this.table.setFilter((r) => !f.type || String(r.reportType) === f.type);
  },
};

// ---------- Детализация ----------

const DETAIL_AMOUNTS = [
  { key: "retailAmount", label: "Продажи" },
  { key: "ppvzSalesCommission", label: "Комиссия WB" },
  { key: "forPay", label: "К перечислению за товар" },
  { key: "deliveryService", label: "Логистика" },
  { key: "paidStorage", label: "Хранение" },
  { key: "paidAcceptance", label: "Платная приёмка" },
  { key: "penalty", label: "Штрафы" },
  { key: "deduction", label: "Удержания" },
  { key: "additionalPayment", label: "Доплаты" },
];

const NUMERIC_FIELDS = [...DETAIL_AMOUNTS.map((a) => a.key), "retailPriceWithDisc", "acquiringFee"];

// Aggregate detail rows by a key into rows with counts and amount sums.
function aggregate(rows, keyOf, describe) {
  const groups = new Map();
  for (const r of rows) {
    const key = keyOf(r);
    if (!groups.has(key)) groups.set(key, { ...describe(r), key, rowsCount: 0, quantity: 0, ...Object.fromEntries(DETAIL_AMOUNTS.map((a) => [a.key, 0])) });
    const g = groups.get(key);
    g.rowsCount += 1;
    g.quantity += r.quantity || 0;
    for (const a of DETAIL_AMOUNTS) g[a.key] += r[a.key];
  }
  return [...groups.values()];
}

const groupAmountColumns = () => [
  { key: "rowsCount", label: "Строк", num: true, sortValue: (r) => r.rowsCount, text: (r) => fmtInt(r.rowsCount), total: (r) => r.rowsCount, fmt: fmtInt },
  { key: "quantity", label: "Кол-во, шт", num: true, sortValue: (r) => r.quantity, text: (r) => fmtInt(r.quantity), total: (r) => r.quantity, fmt: fmtInt },
  ...DETAIL_AMOUNTS.map((a) => rub(a.key, a.label)),
];

const OPERATION_COLUMNS = [
  { key: "operation", label: "Обоснование для оплаты", cls: "name", sortValue: (r) => r.operation, text: (r) => r.operation || "—" },
  ...groupAmountColumns(),
];

const PRODUCT_COLUMNS = [
  { key: "title", label: "Товар", cls: "name", sortValue: (r) => r.title || "",
    html: (r) => (r.nmId
      ? `${escapeHtml(r.title)}<small>${escapeHtml(r.vendorCode)} · ${escapeHtml(r.nmId)}</small>`
      : `<span class="muted">Без привязки к товару</span>`) },
  ...groupAmountColumns(),
];

const DETAIL_COLUMNS = [
  { key: "rrDate", label: "Дата операции", sortValue: (r) => r.rrDate, text: (r) => fmtDay(r.rrDate) },
  { key: "sellerOperName", label: "Обоснование для оплаты", sortValue: (r) => r.sellerOperName || "", text: (r) => r.sellerOperName },
  { key: "docTypeName", label: "Тип документа", sortValue: (r) => r.docTypeName || "", text: (r) => r.docTypeName || "—" },
  { key: "title", label: "Товар", cls: "name", sortValue: (r) => r.title || "",
    html: (r) => (r.nmId ? `${escapeHtml(r.title)}<small>${escapeHtml(r.vendorCode)} · ${escapeHtml(r.nmId)}</small>` : `<span class="muted">—</span>`) },
  { key: "techSize", label: "Размер", sortValue: (r) => r.techSize || "", text: (r) => (r.techSize === "0" ? "—" : r.techSize) },
  { key: "quantity", label: "Кол-во", num: true, sortValue: (r) => r.quantity, text: (r) => fmtInt(r.quantity), total: (r) => r.quantity, fmt: fmtInt },
  rub("retailPriceWithDisc", "Цена со скидкой"),
  ...DETAIL_AMOUNTS.map((a) => rub(a.key, a.label)),
  { key: "officeName", label: "Склад", sortValue: (r) => r.officeName || "", text: (r) => r.officeName },
  { key: "srid", label: "ID заказа (srid)", sortValue: (r) => r.srid || "", text: (r) => r.srid },
];

export const financeDetailed = {
  id: "finance-detailed",
  title: "Детализация",
  breadcrumbs: BREADCRUMBS,
  filter: { report: "", operation: "", search: "" },

  mount(el) {
    el.insertAdjacentHTML("beforeend", `
      <p class="muted">Детализация еженедельных отчётов о реализации. Это другие отчёты, не те, что в «Отчётах реализации», поэтому суммы с ними не складываются.</p>
      <div class="toolbar"><div class="chips" id="finance-detailed-reports"></div></div>
      <div class="tiles" id="finance-detailed-tiles"></div>
      <h2>По видам операций</h2>
      <div class="table-wrap"><table id="finance-detailed-operations"></table></div>
      <h2>По товарам</h2>
      <div class="table-wrap"><table id="finance-detailed-products"></table></div>
      <h2>Все строки</h2>
      <div class="toolbar">
        <input type="search" id="finance-detailed-search" placeholder="Поиск: товар, артикул, srid, склад">
        <select id="finance-detailed-operation"></select>
      </div>
      <div class="table-wrap"><table id="finance-detailed-table"></table></div>`);
    this.operationsTable = new DataTable($("finance-detailed-operations"), OPERATION_COLUMNS, { sortKey: "rowsCount" });
    this.productsTable = new DataTable($("finance-detailed-products"), PRODUCT_COLUMNS, { sortKey: "forPay", pageSize: 20 });
    this.table = new DataTable($("finance-detailed-table"), DETAIL_COLUMNS, { sortKey: "rrDate", pageSize: 50 });
    $("finance-detailed-search").addEventListener("input", (e) => { this.filter.search = e.target.value; this.applyRowFilter(); });
    $("finance-detailed-operation").addEventListener("change", (e) => { this.filter.operation = e.target.value; this.applyRowFilter(); });
  },

  async render(runId) {
    const data = await runFile(runId, "finance_detailed");
    this.rows = (Array.isArray(data) ? data : []).map((r) => {
      const row = { ...r };
      for (const key of NUMERIC_FIELDS) row[key] = num(r[key]);
      return row;
    });
    this.reports = [...new Map(this.rows.map((r) => [String(r.reportId), r])).values()]
      .map((r) => ({ id: String(r.reportId), dateFrom: r.dateFrom, dateTo: r.dateTo, type: r.reportType }))
      .sort((a, b) => a.dateFrom.localeCompare(b.dateFrom) || a.type - b.type);
    if (this.filter.report && !this.reports.some((r) => r.id === this.filter.report)) this.filter.report = "";
    this.table.setRows(this.rows);
    this.update();
  },

  reportRows() {
    return this.rows.filter((r) => !this.filter.report || String(r.reportId) === this.filter.report);
  },

  update() {
    const f = this.filter;
    renderChips($("finance-detailed-reports"), [{ value: "", label: "Все отчёты", count: this.rows.length }].concat(
      this.reports.map((r) => ({
        value: r.id,
        label: `${fmtDay(r.dateFrom)} – ${fmtDay(r.dateTo)} · ${REPORT_TYPES[r.type] || r.type}`,
        count: this.rows.filter((x) => String(x.reportId) === r.id).length,
      }))),
    f.report, (v) => { f.report = v; this.update(); });

    const rows = this.reportRows();
    $("finance-detailed-tiles").innerHTML = DETAIL_AMOUNTS
      .map((a) => tile(a.label, fmtRub(sumBy(rows, (r) => r[a.key]))))
      .join("");

    this.operationsTable.setRows(aggregate(rows, (r) => r.sellerOperName || "", (r) => ({ operation: r.sellerOperName })));
    this.productsTable.setRows(aggregate(rows, (r) => r.nmId || 0, (r) => ({ nmId: r.nmId, title: r.title, vendorCode: r.vendorCode })));

    const operations = [...new Set(rows.map((r) => r.sellerOperName).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru"));
    if (f.operation && !operations.includes(f.operation)) f.operation = "";
    $("finance-detailed-operation").innerHTML = [`<option value="">Все операции</option>`]
      .concat(operations.map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`)).join("");
    $("finance-detailed-operation").value = f.operation;
    this.applyRowFilter();
  },

  applyRowFilter() {
    const f = this.filter;
    this.table.setFilter((r) =>
      (!f.report || String(r.reportId) === f.report) &&
      (!f.operation || (r.sellerOperName || "") === f.operation) &&
      matches(f.search, [r.title, r.vendorCode, r.nmId, r.srid, r.officeName, r.subjectName]));
  },
};
