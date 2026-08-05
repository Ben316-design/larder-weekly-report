const app = document.querySelector("#app");
const sectionMenu = document.querySelector("#section-menu");
const menuButton = document.querySelector("#menu-button");
const closeMenuButton = document.querySelector("#close-menu");
const drawer = document.querySelector("#menu-drawer");
const drawerBackdrop = document.querySelector("#drawer-backdrop");
const topWeek = document.querySelector("#top-week");
const weekButton = document.querySelector("#week-button");
const uploadInput = document.querySelector("#weekly-report-input");

const fallbackReport = window.LARDER_REPORT_DATA;
const storageKey = "larder-weekly-report-upload";
const savedReport = loadSavedReport();
let report = savedReport || fallbackReport;
let state = {
  section: "overview",
  week: report.selectedWeek,
  sourceName: savedReport ? loadSavedSourceName() : "Published report",
  isUploaded: Boolean(savedReport),
};

const ratioSections = new Set(["overall-gp", "food-gp", "drink-gp", "wages", "foh", "chefs", "cleaners"]);
const sectionLayouts = [
  { id: "sales", label: "Sales", accent: "orange", titleRow: 40, groupRow: 41, headerRow: 42, dataStart: 43, dataEnd: 55, columns: 11 },
  { id: "covers", label: "Covers summary", accent: "green", titleRow: 59, groupRow: 60, headerRow: 61, dataStart: 62, dataEnd: 74, columns: 14 },
  { id: "lunch", label: "Lunch covers", accent: "lime", titleRow: 78, groupRow: 79, headerRow: 80, dataStart: 81, dataEnd: 93, columns: 12 },
  { id: "dinner", label: "Dinner covers", accent: "blue", titleRow: 97, groupRow: 98, headerRow: 99, dataStart: 100, dataEnd: 112, columns: 12 },
  { id: "sph", label: "Spend per head", accent: "peach", titleRow: 116, groupRow: 117, headerRow: 118, dataStart: 119, dataEnd: 131, columns: 8 },
  { id: "bookings", label: "Future bookings", accent: "peach", titleRow: 135, groupRow: 136, headerRow: 137, dataStart: 138, dataEnd: 150, columns: 8 },
  { id: "overall-gp", label: "Overall GP", accent: "peach", titleRow: 154, groupRow: 155, headerRow: 156, dataStart: 157, dataEnd: 169, columns: 10 },
  { id: "food-gp", label: "Food GP", accent: "lavender", titleRow: 173, groupRow: 174, headerRow: 175, dataStart: 176, dataEnd: 188, columns: 11 },
  { id: "drink-gp", label: "Drink GP", accent: "royal", titleRow: 192, groupRow: 193, headerRow: 194, dataStart: 195, dataEnd: 207, columns: 11 },
  { id: "wages", label: "Total wages", accent: "burnt", titleRow: 211, groupRow: 212, headerRow: 213, dataStart: 214, dataEnd: 226, columns: 10 },
  { id: "foh", label: "Front of house", accent: "sky", titleRow: 230, groupRow: 231, headerRow: 232, dataStart: 233, dataEnd: 245, columns: 11 },
  { id: "chefs", label: "Chefs", accent: "lilac", titleRow: 249, groupRow: 250, headerRow: 251, dataStart: 252, dataEnd: 264, columns: 10 },
  { id: "cleaners", label: "KPI / cleaners", accent: "lime", titleRow: 268, groupRow: 269, headerRow: 270, dataStart: 271, dataEnd: 283, columns: 10 },
];

const overviewLayouts = [
  { id: "sales-inc", label: "Total sales inc. VAT", value: [5, 0], trend: [15, 0] },
  { id: "overall-gp", label: "Overall GP", value: [5, 4], trend: [7, 4] },
  { id: "food-gp", label: "Food GP", value: [5, 8], trend: [7, 8] },
  { id: "drink-gp", label: "Drink GP", value: [5, 12], trend: [7, 12] },
  { id: "sales-ex", label: "Total sales ex. VAT", value: [13, 0], trend: [15, 0] },
  { id: "covers", label: "Total covers", value: [13, 4], trend: [15, 4] },
  { id: "sph", label: "Spend per head inc. VAT", value: [13, 8], trend: [15, 8] },
  { id: "bookings", label: "Future bookings", value: [13, 12], trend: [15, 12] },
  { id: "wages", label: "Wages as % of sales", value: [21, 0], trend: [23, 0] },
  { id: "foh", label: "FOH wages as % of sales", value: [21, 4], trend: [23, 4] },
  { id: "chefs", label: "Chefs wages as % of sales", value: [21, 8], trend: [23, 8] },
];

const compactNumber = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1, minimumFractionDigits: 0 });

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function plainText(value) {
  return value == null ? "" : String(value).trim();
}

function formatDate(value, short = false) {
  if (!value) return "&mdash;";
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: short ? "short" : "long", year: "numeric" }).format(date);
}

function formatOverviewValue(card) {
  const kind = numberFormatKind(card.numberFormat);
  if (kind) return formatByKind(card.value, kind, card.numberFormat);
  const label = card.label.toLowerCase();
  if (label.includes("gp") || label.includes("wages as")) return formatByKind(card.value, "percentage");
  if (label.includes("covers") || label.includes("bookings")) return compactNumber.format(card.value);
  return formatByKind(card.value, "currency");
}

function numberFormatKind(numberFormat) {
  const format = plainText(numberFormat).toLowerCase();
  if (format.includes("%")) return "percentage";
  if (/[£$€]/.test(format) || format.includes("[$")) return "currency";
  return "";
}

function displayKind(section, header, numberFormat) {
  if (isPercentage(section, header)) return "percentage";
  if (isCurrency(section, header)) return "currency";
  return numberFormatKind(numberFormat);
}

function decimalPlaces(numberFormat, fallback) {
  const firstFormat = plainText(numberFormat).split(";")[0];
  const decimalPart = firstFormat.match(/\.([0#]+)/)?.[1];
  return decimalPart ? decimalPart.length : fallback;
}

function formatByKind(value, kind, numberFormat = "") {
  const sourceKind = numberFormatKind(numberFormat);
  const fallbackPlaces = kind === "currency" ? 0 : 1;
  const fractionDigits = sourceKind === kind ? decimalPlaces(numberFormat, fallbackPlaces) : fallbackPlaces;
  if (kind === "currency") {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
      maximumFractionDigits: fractionDigits,
      minimumFractionDigits: fractionDigits,
    }).format(value);
  }
  return new Intl.NumberFormat("en-GB", {
    style: "percent",
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  }).format(value);
}

function isPercentage(section, header) {
  const columnLabel = header.label.toLowerCase();
  if (/^(ly sales|ly covers|ly sph|ly 13w ma|sales ex vat|purchases ex vat|total wages|total sales ex vat|food ex vat|drink ex vat|other ex vat|total ex vat)$/.test(columnLabel)) return false;
  const label = `${header.label} ${header.group}`.toLowerCase();
  if (/%|up\/down|variance|same week|7w %|13w %/.test(label)) return true;
  if (!ratioSections.has(section.id)) return false;
  if (/sales ex vat|purchases ex vat|total wages/.test(label)) return false;
  return /gp|wages as|of sales|7w ma|13w ma|ly|figures on report|up or down/.test(label);
}

function isCurrency(section, header) {
  const label = `${header.label} ${header.group}`.toLowerCase();
  if (isPercentage(section, header)) return false;
  return /sales|purchases|wages|sph|spend/.test(label);
}

function comparisonClass(section, header, value) {
  if (typeof value !== "number" || !isPercentage(section, header)) return "";
  const group = plainText(header.group).toLowerCase();
  if (!/compared to last year|up or down/.test(group)) return "";
  if (value > 0) return "comparison-positive";
  if (value < 0) return "comparison-negative";
  return "";
}

function formatValue(value, section, header, numberFormat) {
  if (value === null || value === undefined || value === "") return "&mdash;";
  if (typeof value !== "number") return escapeHtml(String(value).replace(/Not found/gi, "—"));
  const kind = displayKind(section, header, numberFormat);
  if (kind) return formatByKind(value, kind, numberFormat);
  return compactNumber.format(value);
}

function arrowForTrend(trend) {
  return normaliseTrend(trend).toLowerCase().startsWith("up") ? "&uarr;" : "&darr;";
}

function trendTone(trend) {
  const text = normaliseTrend(trend).toLowerCase();
  if (text.startsWith("up")) return "positive";
  if (text.startsWith("down")) return "negative";
  return "neutral";
}

function normaliseTrend(value) {
  return plainText(value).replace(/^[\u25B2\u25BC\u2191\u2193\s]+/u, "");
}

function getSection(id) {
  return report.sections.find((section) => section.id === id);
}

function getCurrentRow(section) {
  return section.rows.find((row) => row.week === state.week) || section.rows[0];
}

function groupMetrics(section) {
  const groups = new Map();
  section.headers.slice(1).forEach((header, index) => {
    const name = header.group || "Performance";
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push({ header, index });
  });
  return [...groups.entries()];
}

function groupClass(index) {
  return `band-${(index % 4) + 1}`;
}

function sectionIcon(section) {
  const icons = {
    sales: "£", covers: "◎", lunch: "☀", dinner: "◐", sph: "⌁", bookings: "↗",
    "overall-gp": "%", "food-gp": "F", "drink-gp": "D", wages: "W", foh: "F", chefs: "C", cleaners: "K",
  };
  return icons[section.id] || "•";
}

function renderMenu() {
  const menuItems = [
    `<button class="menu-item ${state.section === "overview" ? "is-active" : ""}" data-section="overview"><span class="menu-item__icon">⌂</span><span>Overview</span><span class="menu-item__chevron">›</span></button>`,
    ...report.sections.map((section) => `<button class="menu-item ${state.section === section.id ? "is-active" : ""}" data-section="${section.id}">
      <span class="menu-item__icon accent-${section.accent}">${sectionIcon(section)}</span>
      <span>${escapeHtml(section.label)}</span><span class="menu-item__chevron">›</span>
    </button>`),
  ];
  sectionMenu.innerHTML = menuItems.join("");
}

function renderUploader() {
  const uploaded = state.isUploaded;
  return `<section class="upload-panel ${uploaded ? "is-uploaded" : ""}" aria-label="Update weekly report">
    <div class="upload-panel__copy">
      <p class="eyebrow">WEEKLY UPDATE</p>
      <h3>${uploaded ? "This week is ready" : "Update this week's report"}</h3>
      <p>Drop an Excel report here to replace the figures shown on this device.</p>
    </div>
    <button class="drop-zone" id="report-uploader" type="button" data-action="choose-upload">
      <span class="drop-zone__icon">⇪</span>
      <span><strong>Drop .xlsx file here</strong><small>or tap to choose your weekly report</small></span>
    </button>
    <div class="upload-status" id="upload-status" aria-live="polite"><span>Current source</span><strong>${escapeHtml(state.sourceName)}</strong></div>
    ${uploaded ? `<button class="reset-report" type="button" data-action="reset-report">Use the published report instead</button>` : ""}
  </section>`;
}

function renderOverview() {
  const primary = report.overview.slice(0, 4);
  const performance = report.overview.slice(4);
  return `
    <section class="page-intro overview-intro">
      <p class="eyebrow">WEEKLY PERFORMANCE REPORT</p>
      <h2>At a glance</h2>
      <p>The current week, with the last 13 weeks kept in every report section.</p>
    </section>

    <section class="week-hero" aria-label="Current report week">
      <div><span>Reporting week</span><strong>${formatDate(report.selectedWeek)}</strong></div>
      <button class="text-button" type="button" data-action="open-menu">Browse sections <span>&rarr;</span></button>
    </section>

    ${renderUploader()}

    <section class="overview-group">
      <div class="section-label"><span></span>Core performance</div>
      <div class="summary-grid summary-grid--feature">${primary.map(renderSummaryCard).join("")}</div>
    </section>

    <section class="overview-group">
      <div class="section-label"><span></span>Sales, covers &amp; wages</div>
      <div class="summary-grid">${performance.map(renderSummaryCard).join("")}</div>
    </section>

    <section class="quick-links" aria-label="Detailed report sections">
      <div class="section-label"><span></span>Detailed report</div>
      ${report.sections.map((section) => `<button class="quick-link accent-${section.accent}" type="button" data-section="${section.id}">
        <span class="quick-link__icon">${sectionIcon(section)}</span><span>${escapeHtml(section.label)}</span><span>›</span>
      </button>`).join("")}
    </section>`;
}

function renderSummaryCard(card) {
  const linkedSection = card.id === "sales-inc" || card.id === "sales-ex" ? "sales" : card.id;
  return `<button class="summary-card summary-card--${card.tone}" data-section="${linkedSection}" type="button">
    <span class="summary-card__label">${escapeHtml(card.label)}</span>
    <strong>${formatOverviewValue(card)}</strong>
    <span class="trend trend--${card.tone}">${arrowForTrend(card.trend)} ${escapeHtml(normaliseTrend(card.trend) || "No comparison")}</span>
    <small>${escapeHtml(card.detail || "Current uploaded report")}</small>
  </button>`;
}

function renderSection(section) {
  const row = getCurrentRow(section);
  const groups = groupMetrics(section);
  if (!row) return `<section class="error-state"><p class="eyebrow">NO DATA</p><h2>This report does not include ${escapeHtml(section.label)}.</h2></section>`;
  return `
    <section class="section-hero accent-${section.accent}">
      <button class="back-link" type="button" data-section="overview">&larr; Overview</button>
      <div class="section-hero__title"><span class="section-hero__icon">${sectionIcon(section)}</span><div>
        <p class="eyebrow">DETAILED REPORT</p><h2>${escapeHtml(section.title)}</h2>
      </div></div>
    </section>

    <section class="selected-week" aria-label="Displayed reporting week"><span>Showing</span><strong>${formatDate(row.week)}</strong></section>
    <div class="metric-groups accent-${section.accent}">
      ${groups.map(([name, metrics], groupIndex) => `<section class="metric-group ${groupClass(groupIndex)}">
        <h3>${escapeHtml(name)}</h3><div class="metric-grid">
          ${metrics.map(({ header, index }) => `<article class="metric-card ${comparisonClass(section, header, row.values[index])}"><span>${escapeHtml(header.label)}</span><strong>${formatValue(row.values[index], section, header, row.numberFormats?.[index])}</strong></article>`).join("")}
        </div>
      </section>`).join("")}
    </div>

    <section class="history-section accent-${section.accent}">
      <div class="history-section__heading">
        <div><p class="eyebrow">13-WEEK VIEW</p><h3>Recent performance</h3></div>
        <span class="swipe-hint">Swipe table &rarr;</span>
      </div>
      <div class="table-wrap" tabindex="0" aria-label="Thirteen-week performance table">
        <table>
          <thead><tr>${section.headers.map((header, index) => `<th class="${groupClass(index)}">${escapeHtml(header.label)}</th>`).join("")}</tr></thead>
          <tbody>${section.rows.map((historyRow) => `<tr class="${historyRow.week === row.week ? "is-selected" : ""}">
            <th scope="row">${formatDate(historyRow.week, true)}</th>
            ${historyRow.values.map((value, index) => `<td class="${comparisonClass(section, section.headers[index + 1], value)}">${formatValue(value, section, section.headers[index + 1], historyRow.numberFormats?.[index])}</td>`).join("")}
          </tr>`).join("")}</tbody>
        </table>
      </div>
    </section>`;
}

function render() {
  topWeek.textContent = formatDate(state.week || report.selectedWeek, true).replace(/&mdash;/g, "—");
  renderMenu();
  app.innerHTML = state.section === "overview" ? renderOverview() : renderSection(getSection(state.section));
  attachDynamicListeners();
}

function openMenu() {
  drawer.classList.add("is-open");
  drawer.setAttribute("aria-hidden", "false");
  drawerBackdrop.hidden = false;
  requestAnimationFrame(() => drawerBackdrop.classList.add("is-visible"));
  closeMenuButton.focus();
}

function closeMenu() {
  drawer.classList.remove("is-open");
  drawer.setAttribute("aria-hidden", "true");
  drawerBackdrop.classList.remove("is-visible");
  window.setTimeout(() => { drawerBackdrop.hidden = true; }, 220);
  menuButton.focus();
}

function changeSection(section) {
  state.section = section;
  closeMenu();
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
  app.focus({ preventScroll: true });
}

function attachDynamicListeners() {
  document.querySelectorAll("[data-section]").forEach((button) => button.addEventListener("click", () => changeSection(button.dataset.section)));
  document.querySelectorAll("[data-action='open-menu']").forEach((button) => button.addEventListener("click", openMenu));
  document.querySelectorAll("[data-action='choose-upload']").forEach((button) => {
    button.addEventListener("click", () => uploadInput.click());
    button.addEventListener("dragover", (event) => { event.preventDefault(); button.classList.add("is-dragging"); });
    button.addEventListener("dragleave", () => button.classList.remove("is-dragging"));
    button.addEventListener("drop", (event) => {
      event.preventDefault();
      button.classList.remove("is-dragging");
      handleUpload(event.dataTransfer.files);
    });
  });
  document.querySelectorAll("[data-action='reset-report']").forEach((button) => button.addEventListener("click", resetReport));
}

function setUploadStatus(message, kind = "") {
  const status = document.querySelector("#upload-status");
  if (status) status.innerHTML = `<span class="${kind}">${escapeHtml(message)}</span>`;
}

async function handleUpload(files) {
  const file = files?.[0];
  if (!file) return;
  if (!/\.(xlsx|xlsm|xls)$/i.test(file.name)) {
    setUploadStatus("Please choose an Excel .xlsx, .xlsm or .xls file.", "is-error");
    return;
  }
  if (!window.XLSX) {
    setUploadStatus("The Excel reader is unavailable. Check your internet connection and reload the app.", "is-error");
    return;
  }
  setUploadStatus("Reading your weekly report…", "is-loading");
  try {
    const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array" });
    const sheetName = workbook.SheetNames.find((name) => /generate\s*report/i.test(name)) || workbook.SheetNames[0];
    if (!sheetName) throw new Error("The workbook does not contain a report sheet.");
    const nextReport = reportFromSheet(workbook.Sheets[sheetName]);
    report = nextReport;
    state = { section: "overview", week: nextReport.selectedWeek, sourceName: file.name, isUploaded: true };
    saveReport(nextReport, file.name);
    render();
  } catch (error) {
    console.error(error);
    setUploadStatus(error.message || "The report could not be read. Please use the single-sheet weekly report export.", "is-error");
  } finally {
    uploadInput.value = "";
  }
}

function cellValue(sheet, row, column) {
  const address = window.XLSX.utils.encode_cell({ r: row, c: column });
  return sheet[address]?.v ?? null;
}

function cellNumberFormat(sheet, row, column) {
  const address = window.XLSX.utils.encode_cell({ r: row, c: column });
  return sheet[address]?.z || "";
}

function dateFromExcel(value) {
  if (value instanceof Date) return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  if (typeof value === "number") {
    const parsed = window.XLSX.SSF.parse_date_code(value);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  const text = plainText(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function reportFromSheet(sheet) {
  if (!sheet || !sheet["!ref"]) throw new Error("The selected sheet is empty.");
  const selectedWeek = dateFromExcel(cellValue(sheet, 1, 13));
  const sections = sectionLayouts.map((layout) => sectionFromSheet(sheet, layout, selectedWeek));
  const firstWeek = sections.find((section) => section.rows[0])?.rows[0]?.week;
  const week = selectedWeek || firstWeek;
  if (!week) throw new Error("I could not find the reporting week in this workbook.");
  return {
    reportTitle: plainText(cellValue(sheet, 0, 0)) || "LARDER LICHFIELD | WEEKLY PERFORMANCE REPORT",
    selectedWeek: week,
    overview: overviewLayouts.map((layout) => {
      const trend = plainText(cellValue(sheet, layout.trend[0], layout.trend[1]));
      return {
        id: layout.id,
        label: layout.label,
        value: cellValue(sheet, layout.value[0], layout.value[1]),
        numberFormat: cellNumberFormat(sheet, layout.value[0], layout.value[1]),
        trend,
        tone: trendTone(trend),
        detail: "Current report",
      };
    }),
    sections,
  };
}

function sectionFromSheet(sheet, layout, selectedWeek) {
  let activeGroup = "";
  const headers = Array.from({ length: layout.columns }, (_, index) => {
    const groupCell = plainText(cellValue(sheet, layout.groupRow, index));
    if (groupCell) activeGroup = groupCell;
    const label = plainText(cellValue(sheet, layout.headerRow, index));
    return { label: label || activeGroup || `Column ${index + 1}`, group: activeGroup };
  });
  const rows = [];
  for (let rowIndex = layout.dataStart; rowIndex <= layout.dataEnd; rowIndex += 1) {
    const week = dateFromExcel(cellValue(sheet, rowIndex, 0));
    if (!week) continue;
    rows.push({
      week,
      values: Array.from({ length: layout.columns - 1 }, (_, index) => cellValue(sheet, rowIndex, index + 1)),
      numberFormats: Array.from({ length: layout.columns - 1 }, (_, index) => cellNumberFormat(sheet, rowIndex, index + 1)),
    });
  }
  return { id: layout.id, label: layout.label, accent: layout.accent, title: plainText(cellValue(sheet, layout.titleRow, 0)) || layout.label, headers, rows };
}

function loadSavedReport() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(storageKey));
    return saved?.report?.sections?.length ? saved.report : null;
  } catch {
    return null;
  }
}

function loadSavedSourceName() {
  try {
    return JSON.parse(window.localStorage.getItem(storageKey))?.sourceName || "Published report";
  } catch {
    return "Published report";
  }
}

function saveReport(nextReport, sourceName) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify({ report: nextReport, sourceName }));
  } catch {
    // The report is still displayed for this visit if the browser blocks local storage.
  }
}

function resetReport() {
  try { window.localStorage.removeItem(storageKey); } catch { /* no-op */ }
  report = fallbackReport;
  state = { section: "overview", week: report.selectedWeek, sourceName: "Published report", isUploaded: false };
  render();
}

uploadInput.addEventListener("change", (event) => handleUpload(event.target.files));
menuButton.addEventListener("click", openMenu);
closeMenuButton.addEventListener("click", closeMenu);
drawerBackdrop.addEventListener("click", closeMenu);
weekButton.addEventListener("click", () => {
  changeSection("overview");
  window.setTimeout(() => document.querySelector("#report-uploader")?.focus(), 250);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && drawer.classList.contains("is-open")) closeMenu();
});

render();
loadPublishedWorkbook();

async function loadPublishedWorkbook() {
  if (savedReport || !window.XLSX || location.protocol === "file:") return;
  try {
    const response = await fetch("./data/weekly-report.xlsx", { cache: "no-store" });
    if (!response.ok) return;
    const workbook = window.XLSX.read(await response.arrayBuffer(), { type: "array" });
    const sheetName = workbook.SheetNames.find((name) => /generate\s*report/i.test(name)) || workbook.SheetNames[0];
    if (!sheetName) return;
    const publishedReport = reportFromSheet(workbook.Sheets[sheetName]);
    report = publishedReport;
    state = { section: "overview", week: publishedReport.selectedWeek, sourceName: "Published report", isUploaded: false };
    render();
  } catch (error) {
    console.warn("The published report file could not be loaded.", error);
  }
}
