// Аналитика и данные → История остатков: Данные по товарам, Остатки на складах WB.
import {
  $, runFile, escapeHtml, fmtInt, fmtMoney, fmtDecimal, fmtDuration, durationHours, renderChips, countBy,
} from "../core.js";
import { DataTable, matches } from "../table.js";

// Stock status names as in the WB seller portal.
const AVAILABILITY = {
  deficient: "Дефицитный",
  actual: "Актуальный",
  balanced: "Сбалансированный",
  nonActual: "Неактуальный",
  nonLiquid: "Неликвидный",
  invalidData: "Некорректные данные",
};

const metric = (key, label, fmt, withTotal = true) => ({
  key, label, num: true,
  sortValue: (r) => r.metrics[key],
  text: (r) => fmt(r.metrics[key]),
  ...(withTotal ? { total: (r) => r.metrics[key], fmt } : {}),
});

const PRODUCT_COLUMNS = [
  { key: "photo", label: "", html: (r) => r.mainPhoto ? `<img class="photo" loading="lazy" src="${escapeHtml(r.mainPhoto)}" alt="">` : "" },
  { key: "name", label: "Товар", cls: "name", sortValue: (r) => r.name || "",
    html: (r) => `${escapeHtml(r.name)}<small>${escapeHtml(r.subjectName)}${r.brandName ? " · " + escapeHtml(r.brandName) : ""}</small>` },
  { key: "nmID", label: "Артикул WB", num: true, sortValue: (r) => r.nmID, text: (r) => r.nmID },
  { key: "vendorCode", label: "Артикул продавца", sortValue: (r) => r.vendorCode || "", text: (r) => r.vendorCode },
  { key: "availability", label: "Статус", sortValue: (r) => AVAILABILITY[r.metrics.availability] || "",
    html: (r) => `<span class="badge badge-${escapeHtml(r.metrics.availability)}">${escapeHtml(AVAILABILITY[r.metrics.availability] || r.metrics.availability)}</span>` },
  metric("ordersCount", "Заказы, шт", fmtInt),
  metric("ordersSum", "Заказы, ₽", fmtMoney),
  metric("avgOrders", "Заказов в день", fmtDecimal, false),
  metric("buyoutCount", "Выкупы, шт", fmtInt),
  metric("buyoutSum", "Выкупы, ₽", fmtMoney),
  metric("buyoutPercent", "Выкуп, %", fmtInt, false),
  metric("stockCount", "Остаток, шт", fmtInt),
  metric("stockSum", "Остаток, ₽", fmtMoney),
  { key: "saleRate", label: "Хватит на", num: true, sortValue: (r) => durationHours(r.metrics.saleRate), text: (r) => fmtDuration(r.metrics.saleRate) },
  { key: "avgStockTurnover", label: "Оборачиваемость", num: true, sortValue: (r) => durationHours(r.metrics.avgStockTurnover), text: (r) => fmtDuration(r.metrics.avgStockTurnover) },
  metric("toClientCount", "К клиенту, шт", fmtInt),
  metric("fromClientCount", "От клиента, шт", fmtInt),
  { key: "price", label: "Цена, ₽", num: true, sortValue: (r) => r.metrics.currentPrice?.minPrice,
    text: (r) => {
      const p = r.metrics.currentPrice || {};
      return p.minPrice === p.maxPrice ? fmtMoney(p.minPrice) : `${fmtMoney(p.minPrice)} – ${fmtMoney(p.maxPrice)}`;
    } },
];

export const stocksProducts = {
  id: "stocks-products",
  title: "Данные по товарам",
  breadcrumbs: "Аналитика и данные → История остатков",
  filter: { search: "", status: "" },

  mount(el) {
    el.insertAdjacentHTML("beforeend", `
      <div class="toolbar">
        <input type="search" id="products-search" placeholder="Поиск: название, артикул, категория">
        <div class="chips" id="products-filters"></div>
      </div>
      <div class="table-wrap"><table id="products-table"></table></div>`);
    this.table = new DataTable($("products-table"), PRODUCT_COLUMNS, { sortKey: "ordersCount" });
    $("products-search").addEventListener("input", (e) => { this.filter.search = e.target.value; this.applyFilter(); });
  },

  async render(runId) {
    const data = await runFile(runId, "analytics_stocks_products");
    this.rows = data?.data?.items || [];
    this.table.setRows(this.rows);
    this.applyFilter();
  },

  applyFilter() {
    const { search, status } = this.filter;
    const counts = countBy(this.rows, (r) => r.metrics.availability);
    const options = [{ value: "", label: "Все", count: this.rows.length }].concat(
      Object.keys(AVAILABILITY).filter((k) => counts[k]).map((k) => ({ value: k, label: AVAILABILITY[k], count: counts[k] })));
    renderChips($("products-filters"), options, status, (value) => { this.filter.status = value; this.applyFilter(); });
    this.table.setFilter((r) =>
      (!status || r.metrics.availability === status) &&
      matches(search, [r.name, r.vendorCode, r.subjectName, r.brandName, r.nmID]));
  },
};

const count = (key, label) => ({
  key, label, num: true, sortValue: (r) => r[key], text: (r) => fmtInt(r[key]), total: (r) => r[key], fmt: fmtInt,
});

const WAREHOUSE_COLUMNS = [
  { key: "name", label: "Товар", cls: "name", sortValue: (r) => r.name || "",
    html: (r) => `${escapeHtml(r.name || "—")}<small>${escapeHtml(r.vendorCode || "")}</small>` },
  { key: "nmId", label: "Артикул WB", num: true, sortValue: (r) => r.nmId, text: (r) => r.nmId },
  { key: "chrtId", label: "ID размера", num: true, sortValue: (r) => r.chrtId, text: (r) => r.chrtId },
  { key: "warehouseName", label: "Склад", sortValue: (r) => r.warehouseName || "", text: (r) => r.warehouseName },
  { key: "regionName", label: "Регион", sortValue: (r) => r.regionName || "", text: (r) => r.regionName },
  count("quantity", "На складе, шт"),
  count("inWayToClient", "В пути к клиенту, шт"),
  count("inWayFromClient", "В пути от клиента, шт"),
];

export const stocksWarehouses = {
  id: "stocks-warehouses",
  title: "Остатки на складах WB",
  breadcrumbs: "Аналитика и данные → История остатков",

  mount(el) {
    el.insertAdjacentHTML("beforeend", `
      <div class="toolbar">
        <input type="search" id="warehouses-search" placeholder="Поиск: название, артикул, склад">
      </div>
      <div class="table-wrap"><table id="warehouses-table"></table></div>`);
    this.table = new DataTable($("warehouses-table"), WAREHOUSE_COLUMNS, { sortKey: "quantity" });
    $("warehouses-search").addEventListener("input", (e) => {
      const q = e.target.value;
      this.table.setFilter((r) => matches(q, [r.name, r.vendorCode, r.warehouseName, r.regionName, r.nmId, r.chrtId]));
    });
  },

  async render(runId) {
    const [stocks, products] = await Promise.all([
      runFile(runId, "analytics_stocks_wb_warehouse"),
      runFile(runId, "analytics_stocks_products"),
    ]);
    // Warehouse rows carry only ids; take names from the product report.
    const byNm = new Map((products?.data?.items || []).map((p) => [p.nmID, p]));
    this.table.setRows((stocks?.data?.items || []).map((r) => ({
      ...r,
      name: byNm.get(r.nmId)?.name,
      vendorCode: byNm.get(r.nmId)?.vendorCode,
    })));
  },
};
