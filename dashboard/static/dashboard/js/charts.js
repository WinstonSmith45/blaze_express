// Chart.js helpers: one chart per canvas id, colours from CSS variables.
import { $, cssVar } from "./core.js";

const charts = {};

export const seriesColor = (i) => cssVar(`--series-${(i % 5) + 1}`);

export function drawChart(canvasId, { type, labels, datasets, formatValue, horizontal = false, stacked = false, legend = true }) {
  if (!window.Chart) return;
  const grid = cssVar("--grid");
  const text = cssVar("--muted");
  const valueAxis = {
    stacked,
    beginAtZero: true,
    ticks: { color: text, callback: (v) => formatValue(v) },
    grid: { color: grid },
  };
  const labelAxis = { stacked, ticks: { color: text, autoSkip: true, maxRotation: 0 }, grid: { color: grid } };

  if (charts[canvasId]) charts[canvasId].destroy();
  charts[canvasId] = new Chart($(canvasId), {
    type,
    data: {
      labels,
      datasets: datasets.map((d, i) => ({
        borderColor: seriesColor(d.color ?? i),
        backgroundColor: seriesColor(d.color ?? i),
        borderWidth: type === "line" ? 2 : 0,
        borderRadius: type === "bar" ? 3 : 0,
        tension: 0.2,
        ...d,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: horizontal ? "y" : "x",
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: legend, labels: { color: text, boxWidth: 12 } },
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${formatValue(horizontal ? ctx.parsed.x : ctx.parsed.y)}` } },
      },
      scales: horizontal ? { x: valueAxis, y: labelAxis } : { x: labelAxis, y: valueAxis },
    },
  });
}

// Markup for a chart card; the canvas id is used by drawChart.
export function chartCard(canvasId, caption, { tall = false } = {}) {
  return `<figure class="chart-card">
    <figcaption>${caption}</figcaption>
    <div class="chart-box ${tall ? "tall" : ""}"><canvas id="${canvasId}"></canvas></div>
  </figure>`;
}
