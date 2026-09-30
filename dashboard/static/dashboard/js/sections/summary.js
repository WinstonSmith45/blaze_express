// Сводка: metrics from report.csv of each run.
import { $, state, fmtInt, fmtMoney, fmtDateTime, intAxis, tile, deltaBadge, signed } from "../core.js";
import { drawChart, chartCard } from "../charts.js";

const METRICS = [
  { key: "total_orders_count", label: "Заказы, шт", money: false },
  { key: "total_orders_sum", label: "Заказы, ₽", money: true },
  { key: "total_buyout_count", label: "Выкупы, шт", money: false },
  { key: "total_buyout_sum", label: "Выкупы, ₽", money: true },
  { key: "total_commission_spending", label: "Комиссия WB, ₽", money: true, cost: true },
  { key: "total_logistics_spending", label: "Логистика, ₽", money: true, cost: true },
  { key: "total_warehouse_storage_spending", label: "Хранение, ₽", money: true, cost: true },
];

export default {
  id: "summary",
  title: "Сводка",

  mount(el) {
    el.insertAdjacentHTML("beforeend", `
      <p class="muted" id="summary-period"></p>
      <div class="tiles" id="summary-tiles"></div>
      <div class="charts">
        ${chartCard("chart-sums", "Суммы по дням, ₽")}
        ${chartCard("chart-counts", "Количество по дням, шт")}
      </div>`);
  },

  async render() {
    const index = state.history.findIndex((h) => h.id === state.runId);
    const current = state.history[index];
    const previous = index > 0 ? state.history[index - 1] : null;

    $("summary-period").textContent = current
      ? `Данные с начала месяца по  ${fmtDateTime(current.started_at)}` +
        (previous ? ` · изменение к ${fmtDateTime(previous.started_at)}` : "")
      : "Нет данных";

    $("summary-tiles").innerHTML = METRICS.map((m) => {
      const format = m.money ? fmtMoney : fmtInt;
      const value = current ? current.metrics[m.key] : null;
      let delta = "";
      if (current && previous) {
        const diff = value - previous.metrics[m.key];
        // Growth of costs is bad, growth of orders and buyouts is good.
        delta = deltaBadge(diff, signed(diff, format), { inverse: m.cost });
      }
      return tile(m.label, format(value), delta);
    }).join("");

    const labels = state.history.map((h) => fmtDateTime(h.started_at));
    const pointRadius = state.history.map((h) => (h.id === state.runId ? 6 : 3));
    const line = (metrics) => metrics.map((m) => ({
      label: m.label,
      data: state.history.map((h) => h.metrics[m.key]),
      pointRadius,
    }));
    drawChart("chart-sums", { type: "line", labels, datasets: line([METRICS[1], METRICS[3]]), formatValue: intAxis });
    drawChart("chart-counts", { type: "line", labels, datasets: line([METRICS[0], METRICS[2]]), formatValue: intAxis });
  },
};
