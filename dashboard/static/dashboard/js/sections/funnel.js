// Аналитика и данные → Воронка продаж: статистика карточек товаров за период.
import {
  $, runFile, escapeHtml, fmtInt, fmtMoney, fmtDecimal, fmtPercent, fmtDay, intAxis, sumBy, tile, deltaBadge, signed,
} from "../core.js";
import { DataTable, matches } from "../table.js";
import { drawChart, chartCard } from "../charts.js";

const TOTALS = [
  { key: "openCount", label: "Переходы в карточку", fmt: fmtInt },
  { key: "cartCount", label: "Положили в корзину", fmt: fmtInt },
  { key: "orderCount", label: "Заказы, шт", fmt: fmtInt },
  { key: "orderSum", label: "Заказы, ₽", fmt: fmtMoney },
  { key: "buyoutCount", label: "Выкупы, шт", fmt: fmtInt },
  { key: "buyoutSum", label: "Выкупы, ₽", fmt: fmtMoney },
  { key: "cancelCount", label: "Отмены, шт", fmt: fmtInt, inverse: true },
  { key: "addToWishlist", label: "Добавили в отложенные", fmt: fmtInt },
];

const FUNNEL_STEPS = [
  { key: "openCount", label: "Переходы в карточку" },
  { key: "cartCount", label: "Корзина" },
  { key: "orderCount", label: "Заказы" },
  { key: "buyoutCount", label: "Выкупы" },
];

const percentChange = (current, past) => (past ? ((current - past) / past) * 100 : null);

const cur = (key, label, fmt, withTotal = true) => ({
  key, label, num: true,
  sortValue: (r) => r.cur[key],
  text: (r) => fmt(r.cur[key]),
  ...(withTotal ? { total: (r) => r.cur[key], fmt } : {}),
});

const COLUMNS = [
  { key: "title", label: "Товар", cls: "name", sortValue: (r) => r.p.title || "",
    html: (r) => `${escapeHtml(r.p.title)}<small>${escapeHtml(r.p.subjectName)}${r.p.brandName ? " · " + escapeHtml(r.p.brandName) : ""}</small>` },
  { key: "nmId", label: "Артикул WB", num: true, sortValue: (r) => r.p.nmId, text: (r) => r.p.nmId },
  { key: "vendorCode", label: "Артикул продавца", sortValue: (r) => r.p.vendorCode || "", text: (r) => r.p.vendorCode },
  { key: "productRating", label: "Рейтинг карточки", num: true, sortValue: (r) => r.p.productRating, text: (r) => fmtDecimal(r.p.productRating) },
  { key: "feedbackRating", label: "Рейтинг отзывов", num: true, sortValue: (r) => r.p.feedbackRating, text: (r) => fmtDecimal(r.p.feedbackRating) },
  cur("openCount", "Переходы", fmtInt),
  cur("cartCount", "Корзина, шт", fmtInt),
  { key: "addToCartPercent", label: "Конв. в корзину", num: true, sortValue: (r) => r.cur.conversions?.addToCartPercent, text: (r) => fmtPercent(r.cur.conversions?.addToCartPercent) },
  cur("orderCount", "Заказы, шт", fmtInt),
  cur("orderSum", "Заказы, ₽", fmtMoney),
  { key: "orderCountDynamic", label: "Заказы к прошлому периоду", num: true, sortValue: (r) => r.cmp.orderCountDynamic,
    html: (r) => {
      const v = r.cmp.orderCountDynamic;
      if (v == null) return "—";
      return `<span class="${v > 0 ? "delta-up" : v < 0 ? "delta-down" : "muted"}">${escapeHtml(signed(v, fmtPercent))}</span>`;
    } },
  { key: "cartToOrderPercent", label: "Конв. в заказ", num: true, sortValue: (r) => r.cur.conversions?.cartToOrderPercent, text: (r) => fmtPercent(r.cur.conversions?.cartToOrderPercent) },
  cur("buyoutCount", "Выкупы, шт", fmtInt),
  cur("buyoutSum", "Выкупы, ₽", fmtMoney),
  { key: "buyoutPercent", label: "Выкуп", num: true, sortValue: (r) => r.cur.conversions?.buyoutPercent, text: (r) => fmtPercent(r.cur.conversions?.buyoutPercent) },
  cur("cancelCount", "Отмены, шт", fmtInt),
  cur("avgPrice", "Средняя цена", fmtMoney, false),
  { key: "stockWb", label: "Остаток WB, шт", num: true, sortValue: (r) => r.p.stocks?.wb, text: (r) => fmtInt(r.p.stocks?.wb), total: (r) => r.p.stocks?.wb, fmt: fmtInt },
  { key: "stockMp", label: "Остаток МП, шт", num: true, sortValue: (r) => r.p.stocks?.mp, text: (r) => fmtInt(r.p.stocks?.mp), total: (r) => r.p.stocks?.mp, fmt: fmtInt },
];

export default {
  id: "funnel",
  title: "Воронка продаж",
  breadcrumbs: "Аналитика и данные",

  mount(el) {
    el.insertAdjacentHTML("beforeend", `
      <p class="muted" id="funnel-period"></p>
      <div class="tiles" id="funnel-tiles"></div>
      <div class="charts">
        ${chartCard("chart-funnel", "Воронка: текущий и прошлый период, шт")}
        ${chartCard("chart-funnel-top", "Топ-10 товаров по заказам, ₽", { tall: false })}
      </div>
      <h2>Товары</h2>
      <div class="toolbar">
        <input type="search" id="funnel-search" placeholder="Поиск: название, артикул, категория">
      </div>
      <div class="table-wrap"><table id="funnel-table"></table></div>`);
    this.table = new DataTable($("funnel-table"), COLUMNS, { sortKey: "orderSum" });
    $("funnel-search").addEventListener("input", (e) => {
      const q = e.target.value;
      this.table.setFilter((r) => matches(q, [r.p.title, r.p.vendorCode, r.p.subjectName, r.p.brandName, r.p.nmId]));
    });
  },

  async render(runId) {
    const data = await runFile(runId, "sales_funnel_products");
    const rows = (data?.data?.products || []).map(({ product, statistic }) => ({
      p: product,
      cur: statistic?.selected || {},
      past: statistic?.past || {},
      cmp: statistic?.comparison || {},
    }));

    const selected = rows[0]?.cur.period;
    const past = rows[0]?.past.period;
    $("funnel-period").textContent = selected
      ? `Период ${fmtDay(selected.start)} – ${fmtDay(selected.end)}` +
        (past ? ` · сравнение с ${fmtDay(past.start)} – ${fmtDay(past.end)}` : "") +
        ` · товаров: ${rows.length}`
      : "Нет данных";

    const total = (period, key) => sumBy(rows, (r) => r[period][key]);
    const conversion = (a, b) => (b ? (a / b) * 100 : null);
    const tiles = TOTALS.map((t) => {
      const now = total("cur", t.key);
      const before = total("past", t.key);
      const change = percentChange(now, before);
      return tile(t.label, t.fmt(now), change == null ? "" : deltaBadge(now - before, signed(change, fmtPercent), { inverse: t.inverse }));
    });
    tiles.push(tile("Конверсия в корзину", fmtPercent(conversion(total("cur", "cartCount"), total("cur", "openCount")))));
    tiles.push(tile("Конверсия в заказ", fmtPercent(conversion(total("cur", "orderCount"), total("cur", "cartCount")))));
    $("funnel-tiles").innerHTML = tiles.join("");

    drawChart("chart-funnel", {
      type: "bar",
      horizontal: true,
      labels: FUNNEL_STEPS.map((s) => s.label),
      datasets: [
        { label: "Текущий период", data: FUNNEL_STEPS.map((s) => total("cur", s.key)) },
        { label: "Прошлый период", data: FUNNEL_STEPS.map((s) => total("past", s.key)) },
      ],
      formatValue: intAxis,
    });

    const top = [...rows].sort((a, b) => (b.cur.orderSum || 0) - (a.cur.orderSum || 0)).slice(0, 10);
    drawChart("chart-funnel-top", {
      type: "bar",
      horizontal: true,
      legend: false,
      labels: top.map((r) => r.p.vendorCode || r.p.nmId),
      datasets: [{ label: "Заказы, ₽", data: top.map((r) => r.cur.orderSum || 0) }],
      formatValue: intAxis,
    });

    this.table.setRows(rows);
  },
};
