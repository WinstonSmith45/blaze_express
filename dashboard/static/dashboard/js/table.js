// Sortable table with optional totals row and pagination.
import { escapeHtml } from "./core.js";

// Column: {key, label, num, cls, text(row) | html(row), sortValue(row), total(row), fmt(sum)}
export class DataTable {
  constructor(table, columns, { sortKey, sortDir = -1, pageSize = 0, totals = true } = {}) {
    this.table = table;
    this.columns = columns;
    this.sort = { key: sortKey, dir: sortDir };
    this.pageSize = pageSize;
    this.showTotals = totals;
    this.rows = [];
    this.filter = null;
    this.page = 0;
    this.pager = null;
    if (pageSize) {
      this.pager = document.createElement("div");
      this.pager.className = "pager";
      (table.closest(".table-wrap") || table).after(this.pager);
    }
  }

  setRows(rows) {
    this.rows = rows;
    this.page = 0;
    this.render();
  }

  setFilter(filter) {
    this.filter = filter;
    this.page = 0;
    this.render();
  }

  visibleRows() {
    const rows = this.filter ? this.rows.filter(this.filter) : this.rows;
    const col = this.columns.find((c) => c.key === this.sort.key);
    if (!col || !col.sortValue) return rows;
    const dir = this.sort.dir;
    return [...rows].sort((a, b) => {
      const va = col.sortValue(a);
      const vb = col.sortValue(b);
      if (typeof va === "string" || typeof vb === "string") return String(va ?? "").localeCompare(String(vb ?? ""), "ru") * dir;
      return ((va ?? 0) - (vb ?? 0)) * dir;
    });
  }

  render() {
    const rows = this.visibleRows();
    const pages = this.pageSize ? Math.max(1, Math.ceil(rows.length / this.pageSize)) : 1;
    this.page = Math.min(this.page, pages - 1);
    const pageRows = this.pageSize ? rows.slice(this.page * this.pageSize, (this.page + 1) * this.pageSize) : rows;

    const head = this.columns.map((c) => {
      const sortable = Boolean(c.sortValue);
      const sorted = this.sort.key === c.key;
      const cls = [c.num ? "num" : "", sorted ? "sorted" : "", sortable ? "sortable" : ""].join(" ");
      const arrow = sorted ? (this.sort.dir > 0 ? " ↑" : " ↓") : "";
      return `<th class="${cls}" data-key="${c.key}">${escapeHtml(c.label)}${arrow}</th>`;
    }).join("");

    const body = pageRows.length
      ? pageRows.map((row) => "<tr>" + this.columns.map((c) =>
        `<td class="${c.num ? "num" : ""} ${c.cls || ""}">${c.html ? c.html(row) : escapeHtml(c.text ? c.text(row) : "")}</td>`
      ).join("") + "</tr>").join("")
      : `<tr><td class="empty" colspan="${this.columns.length}">Нет данных</td></tr>`;

    let foot = "";
    if (this.showTotals && rows.length) {
      foot = "<tr>" + this.columns.map((c, i) => {
        let value = "";
        if (i === 0) value = `Итого (${rows.length})`;
        else if (c.total) value = c.fmt(rows.reduce((sum, r) => sum + (c.total(r) || 0), 0));
        return `<td class="${c.num ? "num" : ""}">${value}</td>`;
      }).join("") + "</tr>";
    }

    this.table.innerHTML = `<thead><tr>${head}</tr></thead><tbody>${body}</tbody><tfoot>${foot}</tfoot>`;
    this.table.querySelectorAll("th.sortable").forEach((th) => {
      th.addEventListener("click", () => {
        if (this.sort.key === th.dataset.key) this.sort.dir = -this.sort.dir;
        else this.sort = { key: th.dataset.key, dir: -1 };
        this.render();
      });
    });

    if (this.pager) this.renderPager(rows.length, pages);
  }

  renderPager(total, pages) {
    if (pages <= 1) {
      this.pager.innerHTML = "";
      return;
    }
    const from = this.page * this.pageSize + 1;
    const to = Math.min(total, (this.page + 1) * this.pageSize);
    this.pager.innerHTML = `
      <button type="button" data-page="0" ${this.page === 0 ? "disabled" : ""}>«</button>
      <button type="button" data-page="${this.page - 1}" ${this.page === 0 ? "disabled" : ""}>‹</button>
      <span>${from}–${to} из ${total}</span>
      <button type="button" data-page="${this.page + 1}" ${this.page >= pages - 1 ? "disabled" : ""}>›</button>
      <button type="button" data-page="${pages - 1}" ${this.page >= pages - 1 ? "disabled" : ""}>»</button>`;
    this.pager.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      this.page = Number(b.dataset.page);
      this.render();
    }));
  }
}

// Case-insensitive match of a query against several fields.
export function matches(query, values) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return values.some((v) => String(v ?? "").toLowerCase().includes(q));
}
