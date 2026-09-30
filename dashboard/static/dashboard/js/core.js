// Shared state, data loading and formatting helpers.

export const state = {
  runs: [],
  history: [],
  runId: null,
  cache: new Map(),
};

export const $ = (id) => document.getElementById(id);

const intFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const decimalFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const dateTimeFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  timeZone: "Europe/Moscow",
});
const isoDayFormat = new Intl.DateTimeFormat("en-CA", {
  year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Europe/Moscow",
});

export const fmtInt = (v) => (v == null || Number.isNaN(v) ? "—" : intFormat.format(v));
export const fmtDecimal = (v) => (v == null || Number.isNaN(v) ? "—" : decimalFormat.format(v));
export const fmtMoney = (v) => (v == null || Number.isNaN(v) ? "—" : intFormat.format(v) + " ₽");
export const fmtPercent = (v) => (v == null || Number.isNaN(v) ? "—" : decimalFormat.format(v) + " %");
export const fmtDateTime = (iso) => dateTimeFormat.format(new Date(iso));
export const intAxis = (v) => intFormat.format(v);

// "2026-09-01T13:36:12" (WB local time) -> "01.09.2026 13:36"
export function fmtWbDateTime(value) {
  if (!value) return "—";
  const [date, time = ""] = value.split("T");
  const [y, m, d] = date.split("-");
  return `${d}.${m}.${y}${time ? " " + time.slice(0, 5) : ""}`;
}

// "2026-09-01" -> "01.09"
export function fmtShortDay(value) {
  const [, m, d] = value.split("-");
  return `${d}.${m}`;
}

// "2026-09-01" -> "01.09.2026"
export function fmtDay(value) {
  if (!value) return "—";
  const [y, m, d] = value.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}

// First day of the run's month in Moscow time, as "YYYY-MM-01".
export function runMonthStart(run) {
  return isoDayFormat.format(new Date(run.started_at)).slice(0, 8) + "01";
}

export function currentRun() {
  return state.runs.find((r) => r.id === state.runId);
}

// Finance API returns amounts as strings.
export const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

export function sumBy(rows, getter) {
  return rows.reduce((acc, r) => acc + (getter(r) || 0), 0);
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

export function durationHours(d) {
  return d ? (d.days || 0) * 24 + (d.hours || 0) : 0;
}

export function fmtDuration(d) {
  if (!d) return "—";
  const parts = [];
  if (d.days) parts.push(`${d.days} д`);
  if (d.hours || !d.days) parts.push(`${d.hours || 0} ч`);
  return parts.join(" ");
}

export async function fetchJson(url) {
  const resp = await fetch(url, { headers: { Accept: "application/json" } });
  if (resp.status === 401) {
    // Session expired: go to the login page and come back here afterwards.
    location.href = `login/?next=${encodeURIComponent(location.pathname + location.hash)}`;
    throw new Error("требуется вход");
  }
  if (!resp.ok) throw new Error(`${url}: HTTP ${resp.status}`);
  return resp.json();
}

export function runFile(runId, name) {
  const key = `${runId}/${name}`;
  if (!state.cache.has(key)) {
    // Cache the promise so parallel callers share one request; drop it on failure.
    const promise = fetchJson(`api/runs/${runId}/${name}`).catch((err) => {
      state.cache.delete(key);
      throw err;
    });
    state.cache.set(key, promise);
  }
  return state.cache.get(key);
}

// nmId -> {title, vendorCode, subjectName, brandName}, from the sales funnel
// and the stock report (the funnel covers more products).
export async function productNames(runId) {
  const [funnel, stocks] = await Promise.all([
    runFile(runId, "sales_funnel_products"),
    runFile(runId, "analytics_stocks_products"),
  ]);
  const names = new Map();
  for (const p of stocks?.data?.items || []) {
    names.set(p.nmID, { title: p.name, vendorCode: p.vendorCode, subjectName: p.subjectName, brandName: p.brandName });
  }
  for (const { product: p } of funnel?.data?.products || []) {
    names.set(p.nmId, { title: p.title, vendorCode: p.vendorCode, subjectName: p.subjectName, brandName: p.brandName });
  }
  return names;
}

export function showError(err) {
  console.error(err);
  const el = $("error");
  el.textContent = `Не удалось загрузить данные: ${err.message}`;
  el.hidden = false;
}

export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// ---------- small UI builders ----------

export function tile(label, value, extra = "") {
  return `<div class="tile">
    <div class="tile-label">${escapeHtml(label)}</div>
    <div class="tile-value">${value}</div>
    ${extra}
  </div>`;
}

// Change badge: diff is absolute, text is what to show.
export function deltaBadge(diff, text, { inverse = false } = {}) {
  if (diff == null || Number.isNaN(diff)) return "";
  if (diff === 0) return `<span class="tile-delta muted">без изменений</span>`;
  const good = inverse ? diff < 0 : diff > 0;
  return `<span class="tile-delta ${good ? "delta-up" : "delta-down"}">${escapeHtml(text)}</span>`;
}

export function signed(value, formatter) {
  return (value > 0 ? "+" : value < 0 ? "−" : "") + formatter(Math.abs(value));
}

// Segmented filter buttons; onChange receives the selected value.
export function renderChips(box, options, selected, onChange) {
  box.innerHTML = options.map((o) =>
    `<button type="button" class="chip ${o.value === selected ? "active" : ""}" data-value="${escapeHtml(o.value)}">${escapeHtml(o.label)}${o.count != null ? " · " + o.count : ""}</button>`
  ).join("");
  box.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => onChange(b.dataset.value)));
}

export function countBy(rows, getter) {
  const counts = {};
  for (const r of rows) {
    const key = getter(r);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}
