// Отчёты → Основные отчёты: Заказы и Продажи (statistics-api).
import {
  $, runFile, productNames, currentRun, runMonthStart, escapeHtml, fmtInt, fmtMoney, fmtPercent, fmtWbDateTime,
  fmtShortDay, intAxis, sumBy, tile, renderChips, countBy,
} from "../core.js";
import { DataTable, matches } from "../table.js";
import { drawChart, chartCard } from "../charts.js";

const PAGE_SIZE = 50;

const money = (key, label) => ({
  key, label, num: true, sortValue: (r) => r[key], text: (r) => fmtMoney(r[key]), total: (r) => r[key], fmt: fmtMoney,
});

const commonColumns = () => [
  { key: "date", label: "Дата", sortValue: (r) => r.date, text: (r) => fmtWbDateTime(r.date) },
  { key: "title", label: "Товар", cls: "name", sortValue: (r) => r.title || r.subject || "",
    html: (r) => `${escapeHtml(r.title || r.subject)}<small>${escapeHtml(r.subject)}${r.brand ? " · " + escapeHtml(r.brand) : ""}</small>` },
  { key: "nmId", label: "Артикул WB", num: true, sortValue: (r) => r.nmId, text: (r) => r.nmId },
  { key: "supplierArticle", label: "Артикул продавца", sortValue: (r) => r.supplierArticle || "", text: (r) => r.supplierArticle },
  { key: "techSize", label: "Размер", sortValue: (r) => r.techSize || "", text: (r) => (r.techSize === "0" ? "—" : r.techSize) },
  { key: "warehouseName", label: "Склад", sortValue: (r) => r.warehouseName || "", text: (r) => r.warehouseName },
  { key: "regionName", label: "Регион", sortValue: (r) => r.regionName || "", text: (r) => r.regionName },
  money("totalPrice", "Цена до скидок"),
  { key: "discountPercent", label: "Скидка продавца", num: true, sortValue: (r) => r.discountPercent, text: (r) => fmtPercent(r.discountPercent) },
  money("priceWithDisc", "Цена со скидкой продавца"),
  { key: "spp", label: "СПП", num: true, sortValue: (r) => r.spp, text: (r) => fmtPercent(r.spp) },
  money("finishedPrice", "Цена для покупателя"),
];

function makeSection(config) {
  return {
    id: config.id,
    title: config.title,
    breadcrumbs: "Отчёты → Основные отчёты",
    filter: { period: "month", kind: "", warehouseType: "", search: "" },

    mount(el) {
      const id = config.id;
      el.insertAdjacentHTML("beforeend", `
        <p class="muted">${config.note}</p>
        <div class="toolbar">
          <div class="chips" id="${id}-period"></div>
          <div class="chips" id="${id}-kind"></div>
          <div class="chips" id="${id}-warehouse"></div>
        </div>
        <div class="tiles" id="${id}-tiles"></div>
        <div class="charts">
          ${chartCard(`${id}-chart-days`, config.daysCaption)}
          ${chartCard(`${id}-chart-regions`, "Топ-10 регионов, шт")}
        </div>
        <h2>${config.tableTitle}</h2>
        <div class="toolbar">
          <input type="search" id="${id}-search" placeholder="Поиск: товар, артикул, склад, регион">
        </div>
        <div class="table-wrap"><table id="${id}-table"></table></div>`);
      this.table = new DataTable($(`${id}-table`), config.columns, { sortKey: "date", pageSize: PAGE_SIZE });
      $(`${id}-search`).addEventListener("input", (e) => { this.filter.search = e.target.value; this.update(); });
    },

    async render(runId) {
      const [rows, names] = await Promise.all([runFile(runId, config.file), productNames(runId)]);
      this.monthStart = runMonthStart(currentRun());
      this.rows = (Array.isArray(rows) ? rows : []).map((r) => ({ ...r, title: names.get(r.nmId)?.title }));
      this.table.setRows(this.rows);
      this.update();
    },

    // Rows matching period and warehouse filters (kind is applied separately for counts).
    baseRows() {
      const { period, warehouseType } = this.filter;
      return this.rows.filter((r) =>
        (period === "all" || r.date >= this.monthStart) &&
        (!warehouseType || r.warehouseType === warehouseType));
    },

    update() {
      const id = config.id;
      const f = this.filter;
      const base = this.baseRows();

      const inPeriod = this.rows.filter((r) => r.date >= this.monthStart).length;
      renderChips($(`${id}-period`), [
        { value: "month", label: "С начала месяца", count: inPeriod },
        { value: "all", label: "Все загруженные", count: this.rows.length },
      ], f.period, (v) => { f.period = v; this.update(); });

      const kinds = countBy(base, config.kindOf);
      renderChips($(`${id}-kind`), [{ value: "", label: "Все", count: base.length }].concat(
        config.kinds.map((k) => ({ value: k.value, label: k.label, count: kinds[k.value] || 0 }))),
      f.kind, (v) => { f.kind = v; this.update(); });

      const types = countBy(this.rows, (r) => r.warehouseType);
      renderChips($(`${id}-warehouse`), [{ value: "", label: "Все склады" }].concat(
        Object.keys(types).sort().map((t) => ({ value: t, label: t, count: types[t] }))),
      f.warehouseType, (v) => { f.warehouseType = v; this.update(); });

      const visible = base.filter((r) => !f.kind || config.kindOf(r) === f.kind);
      $(`${id}-tiles`).innerHTML = config.tiles(base, visible).join("");
      this.drawCharts(base, visible);
      this.table.setFilter((r) =>
        (f.period === "all" || r.date >= this.monthStart) &&
        (!f.warehouseType || r.warehouseType === f.warehouseType) &&
        (!f.kind || config.kindOf(r) === f.kind) &&
        matches(f.search, [r.title, r.subject, r.brand, r.supplierArticle, r.nmId, r.warehouseName, r.regionName]));
    },

    drawCharts(base, visible) {
      const days = [...new Set(base.map((r) => r.date.slice(0, 10)))].sort();
      drawChart(`${config.id}-chart-days`, {
        type: "bar",
        stacked: true,
        labels: days.map(fmtShortDay),
        datasets: config.kinds.map((k, i) => ({
          label: k.label,
          color: i,
          data: days.map((d) => base.filter((r) => r.date.startsWith(d) && config.kindOf(r) === k.value).length),
        })),
        formatValue: intAxis,
      });

      const regions = Object.entries(countBy(visible, (r) => r.regionName || "—"))
        .sort((a, b) => b[1] - a[1]).slice(0, 10);
      drawChart(`${config.id}-chart-regions`, {
        type: "bar",
        horizontal: true,
        legend: false,
        labels: regions.map(([name]) => name),
        datasets: [{ label: "Шт", data: regions.map(([, n]) => n), color: 2 }],
        formatValue: intAxis,
      });
    },
  };
}

export const orders = makeSection({
  id: "orders",
  title: "Заказы",
  file: "statistics_orders",
  note: "Каждая строка — одна единица товара в заказе. API отдаёт заказы, изменённые с начала месяца, поэтому среди «всех загруженных» есть и более ранние заказы.",
  daysCaption: "Заказы и отмены по дням, шт",
  tableTitle: "Список заказов",
  kinds: [
    { value: "active", label: "Без отмены" },
    { value: "cancelled", label: "Отменённые" },
  ],
  kindOf: (r) => (r.isCancel ? "cancelled" : "active"),
  tiles: (base, visible) => {
    const cancelled = base.filter((r) => r.isCancel).length;
    return [
      tile("Заказы, шт", fmtInt(visible.length)),
      tile("Отмены, шт", fmtInt(cancelled), `<span class="tile-delta muted">${fmtPercent(base.length ? (cancelled / base.length) * 100 : null)} от заказов</span>`),
      tile("Сумма по цене со скидкой продавца", fmtMoney(sumBy(visible, (r) => r.priceWithDisc))),
      tile("Сумма, оплаченная покупателями", fmtMoney(sumBy(visible, (r) => r.finishedPrice))),
      tile("Средний чек покупателя", fmtMoney(visible.length ? sumBy(visible, (r) => r.finishedPrice) / visible.length : null)),
    ];
  },
  columns: [
    ...commonColumns(),
    { key: "status", label: "Статус", sortValue: (r) => (r.isCancel ? r.cancelDate : ""),
      html: (r) => (r.isCancel
        ? `<span class="badge badge-deficient">Отменён ${escapeHtml(fmtWbDateTime(r.cancelDate))}</span>`
        : `<span class="muted">—</span>`) },
    { key: "warehouseType", label: "Тип склада", sortValue: (r) => r.warehouseType || "", text: (r) => r.warehouseType },
  ],
});

export const sales = makeSection({
  id: "sales",
  title: "Продажи",
  file: "statistics_sales",
  note: "Продажи (выкупы) и возвраты. У возвратов суммы отрицательные, поэтому итоги уже учитывают их.",
  daysCaption: "Продажи и возвраты по дням, шт",
  tableTitle: "Список продаж и возвратов",
  kinds: [
    { value: "sale", label: "Продажи" },
    { value: "return", label: "Возвраты" },
  ],
  // saleID: S… — продажа, R… — возврат.
  kindOf: (r) => (String(r.saleID).startsWith("R") ? "return" : "sale"),
  tiles: (base, visible) => [
    tile("Продажи, шт", fmtInt(visible.filter((r) => !String(r.saleID).startsWith("R")).length)),
    tile("Возвраты, шт", fmtInt(visible.filter((r) => String(r.saleID).startsWith("R")).length)),
    tile("Сумма по цене со скидкой продавца", fmtMoney(sumBy(visible, (r) => r.priceWithDisc))),
    tile("Сумма, оплаченная покупателями", fmtMoney(sumBy(visible, (r) => r.finishedPrice))),
    tile("К перечислению продавцу", fmtMoney(sumBy(visible, (r) => r.forPay))),
  ],
  columns: [
    ...commonColumns(),
    { key: "kind", label: "Тип", sortValue: (r) => r.saleID,
      html: (r) => (String(r.saleID).startsWith("R")
        ? `<span class="badge badge-deficient">Возврат</span>`
        : `<span class="badge badge-balanced">Продажа</span>`) },
    money("forPay", "К перечислению"),
    { key: "warehouseType", label: "Тип склада", sortValue: (r) => r.warehouseType || "", text: (r) => r.warehouseType },
  ],
});
