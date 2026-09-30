// Entry point: navigation, run selection and polling for new runs.
import { $, state, fetchJson, runFile, fmtDateTime, fmtMoney, showError } from "./core.js";
import summary from "./sections/summary.js";
import funnel from "./sections/funnel.js";
import { stocksProducts, stocksWarehouses } from "./sections/stocks.js";
import { orders, sales } from "./sections/statistics.js";
import { financeReports, financeDetailed } from "./sections/finance.js";

const POLL_INTERVAL_MS = 30000;

const SECTIONS = [summary, funnel, stocksProducts, stocksWarehouses, orders, sales, financeReports, financeDetailed];
const byId = new Map(SECTIONS.map((s) => [s.id, s]));

let currentSection = summary;

function mountSections() {
  const main = $("sections");
  for (const section of SECTIONS) {
    const el = document.createElement("section");
    el.id = `section-${section.id}`;
    el.hidden = true;
    el.innerHTML = (section.breadcrumbs ? `<p class="breadcrumbs muted">${section.breadcrumbs}</p>` : "") + `<h1>${section.title}</h1>`;
    main.append(el);
    section.mount(el);
  }
}

async function renderHeader() {
  const [seller, balance] = await Promise.all([
    runFile(state.runId, "common_seller_info"),
    runFile(state.runId, "finance_balance"),
  ]);
  $("seller-name").textContent = seller.tradeMark || seller.name || "—";
  $("seller-meta").textContent = [seller.name, seller.tin && `ИНН ${seller.tin}`].filter(Boolean).join(" · ");
  $("balance-current").textContent = fmtMoney(balance.current);
  $("balance-withdraw").textContent = fmtMoney(balance.for_withdraw);
}

function renderRunTime() {
  const run = state.runs.find((r) => r.id === state.runId);
  $("run-time").textContent = run ? fmtDateTime(run.started_at) : "—";
}

async function renderSection() {
  if (!state.runId) return;
  $("error").hidden = true;
  try {
    await currentSection.render(state.runId);
  } catch (err) {
    showError(err);
  }
}

function showSection(id) {
  currentSection = byId.get(id) || summary;
  for (const s of SECTIONS) $(`section-${s.id}`).hidden = s !== currentSection;
  document.querySelectorAll(".sidebar a").forEach((a) => a.classList.toggle("active", a.dataset.section === currentSection.id));
  return renderSection();
}

// The dashboard always shows the latest finished run.
async function selectRun(runId) {
  state.runId = runId;
  renderRunTime();
  renderHeader().catch(showError);
  await renderSection();
}

async function refreshRuns() {
  const [{ runs }, { history }] = await Promise.all([fetchJson("api/runs"), fetchJson("api/history")]);
  const latestBefore = state.runs[0]?.id;
  state.runs = runs;
  state.history = history;
  return { latestBefore, latestNow: runs[0]?.id };
}

async function poll() {
  try {
    const { latestBefore, latestNow } = await refreshRuns();
    if (latestNow && latestNow !== latestBefore) await selectRun(latestNow);
  } catch (err) {
    console.warn("poll failed", err);
  }
}

async function init() {
  mountSections();
  window.addEventListener("hashchange", () => showSection(location.hash.slice(1)));

  try {
    await refreshRuns();
  } catch (err) {
    showError(err);
    return;
  }
  if (!state.runs.length) {
    showError(new Error("нет завершённых запусков в data/"));
    return;
  }
  state.runId = state.runs[0].id;
  renderRunTime();
  renderHeader().catch(showError);
  await showSection(location.hash.slice(1));
  setInterval(poll, POLL_INTERVAL_MS);
}

init();
