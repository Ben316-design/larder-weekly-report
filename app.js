import {
  acceptInvite,
  getUser,
  handleAuthCallback,
  login,
  logout,
  requestPasswordRecovery,
  updateUser,
} from "https://cdn.jsdelivr.net/npm/@netlify/identity@2.0.0/+esm";

const app = document.querySelector("#app");
const sectionMenu = document.querySelector("#section-menu");
const menuButton = document.querySelector("#menu-button");
const closeMenuButton = document.querySelector("#close-menu");
const drawer = document.querySelector("#menu-drawer");
const drawerBackdrop = document.querySelector("#drawer-backdrop");
const topWeek = document.querySelector("#top-week");
const weekButton = document.querySelector("#week-button");
const uploadInput = document.querySelector("#weekly-report-input");

const sharedReportEndpoint = "/.netlify/functions/report";
const authEndpoint = "/.netlify/functions/auth";
const adminEndpoint = "/.netlify/functions/admin";
const sharedReportPollInterval = 60_000;
const lowerIsBetterOverviewIds = new Set(["wages", "foh", "chefs"]);
let report = null;
let state = {
  section: "overview",
  week: "",
  sourceName: "",
  isUploaded: false,
  authMode: "loading",
  authMessage: "",
  authToken: "",
  user: null,
  access: null,
  adminUsers: null,
  adminMessage: "",
};
let expandedTable = null;
let sharedReportVersion = "";
let reportPolling = null;

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
  if (hasExplicitNumberFormat(card.numberFormat)) return formatWithNumberFormat(card.value, card.numberFormat);
  const label = card.label.toLowerCase();
  if (label.includes("gp") || label.includes("wages as")) return formatByKind(card.value, "percentage");
  if (label.includes("covers") || label.includes("bookings")) return compactNumber.format(card.value);
  return formatByKind(card.value, "currency");
}

function numberFormatKind(numberFormat) {
  const format = plainText(numberFormat).toLowerCase();
  if (format.includes("%")) return "percentage";
  if (/[£$€Ł]/.test(format) || format.includes("[$")) return "currency";
  return "";
}

function hasExplicitNumberFormat(numberFormat) {
  const format = plainText(numberFormat).trim().toLowerCase();
  return Boolean(format && format !== "general" && format !== "@");
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

function formatPlainNumber(value, numberFormat = "") {
  const firstFormat = plainText(numberFormat).split(";")[0];
  const fractionDigits = decimalPlaces(firstFormat, 0);
  return new Intl.NumberFormat("en-GB", {
    useGrouping: /#,##/.test(firstFormat),
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  }).format(value);
}

function formatWithNumberFormat(value, numberFormat) {
  const kind = numberFormatKind(numberFormat);
  if (kind) return formatByKind(value, kind, numberFormat);
  return formatPlainNumber(value, numberFormat);
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
  if (typeof value !== "number") return "";
  const label = plainText(header.label).toLowerCase();
  const group = plainText(header.group).toLowerCase();
  const isComparison = section.id === "wages"
    ? label === "ly % of sales" && /up or down/.test(group)
    : /up\/?down|same week|variance from target|^(?:7w|13w)\s*%$/.test(label);
  if (!isComparison) return "";
  const lowerIsBetter = ["wages", "foh", "chefs", "cleaners"].includes(section.id);
  if (value > 0) return lowerIsBetter ? "comparison-negative" : "comparison-positive";
  if (value < 0) return lowerIsBetter ? "comparison-positive" : "comparison-negative";
  return "";
}

function validSheetColour(value) {
  const colour = plainText(value).replace(/^#/, "").slice(-6);
  return /^[0-9a-f]{6}$/i.test(colour) ? `#${colour.toUpperCase()}` : "";
}

function sheetStyleAttribute(style) {
  if (!style || typeof style !== "object") return "";
  const fill = validSheetColour(style.fill) || "#FFFFFF";
  const colour = validSheetColour(style.color) || "#1A1A1A";
  const weight = style.bold ? "700" : "400";
  return ` style="--sheet-fill:${fill};--sheet-colour:${colour};--sheet-weight:${weight}"`;
}

function sheetStyleClass(style) {
  return style && typeof style === "object" ? "sheet-style" : "";
}

function classNames(...names) {
  return names.filter(Boolean).join(" ");
}

function formatValue(value, section, header, numberFormat) {
  if (typeof value === "number" && hasExplicitNumberFormat(numberFormat)) return formatWithNumberFormat(value, numberFormat);
  if (value === null || value === undefined || value === "") return "&mdash;";
  if (typeof value !== "number") return escapeHtml(String(value).replace(/Not found/gi, "—"));
  const kind = displayKind(section, header, numberFormat);
  if (kind) return formatByKind(value, kind, numberFormat);
  return compactNumber.format(value);
}

function arrowForTrend(trend) {
  return normaliseTrend(trend).toLowerCase().startsWith("up") ? "&uarr;" : "&darr;";
}

function trendTone(trend, cardId = "") {
  const text = normaliseTrend(trend).toLowerCase();
  const lowerIsBetter = lowerIsBetterOverviewIds.has(cardId);
  if (text.startsWith("up")) return lowerIsBetter ? "negative" : "positive";
  if (text.startsWith("down")) return lowerIsBetter ? "positive" : "negative";
  return "neutral";
}

function withOverviewTones(sourceReport) {
  if (!sourceReport?.overview) return sourceReport;
  return {
    ...sourceReport,
    overview: sourceReport.overview.map((card) => ({ ...card, tone: trendTone(card.trend, card.id) })),
  };
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

function tableHeaderGroups(headers) {
  const groups = [];
  headers.forEach((header, index) => {
    const label = header.group || header.label;
    const previous = groups.at(-1);
    if (previous?.label === label) {
      previous.columns.push({ header, index });
    } else {
      groups.push({ label, columns: [{ header, index }] });
    }
  });
  return groups;
}

function groupClass(index) {
  return `band-${(index % 4) + 1}`;
}

function tableGroupClass(index) {
  return `table-band-${(index % 7) + 1}`;
}

function sectionIcon(section) {
  const icons = {
    sales: "£", covers: "◎", lunch: "☀", dinner: "◐", sph: "⌁", bookings: "↗",
    "overall-gp": "%", "food-gp": "F", "drink-gp": "D", wages: "W", foh: "F", chefs: "C", cleaners: "K",
  };
  return icons[section.id] || "•";
}

function isSignedIn() {
  return state.authMode === "authenticated" && Boolean(state.user && state.access);
}

function canManageUsers() {
  return Boolean(state.access?.canManageUsers);
}

function canPublishReport() {
  return Boolean(state.access?.canPublish);
}

function renderAuthScreen() {
  const message = state.authMessage ? `<p class="auth-message">${escapeHtml(state.authMessage)}</p>` : "";
  if (state.authMode === "loading") {
    return `<section class="auth-page"><div class="auth-card"><p class="eyebrow">LARDER WEEKLY REPORT</p><h2>Preparing your secure report</h2><p>Checking your sign-in securely.</p></div></section>`;
  }
  if (state.authMode === "forgot") {
    return `<section class="auth-page"><form class="auth-card" data-auth-form="forgot"><p class="eyebrow">ACCOUNT RECOVERY</p><h2>Reset your password</h2><p>Enter your account email and we will send a secure reset link.</p>${message}<label>Email address<input required name="email" type="email" autocomplete="email" placeholder="you@example.com"></label><button class="auth-submit" type="submit">Send reset link</button><button class="auth-link" type="button" data-auth-mode="login">Back to sign in</button></form></section>`;
  }
  if (state.authMode === "reset") {
    return `<section class="auth-page"><form class="auth-card" data-auth-form="reset"><p class="eyebrow">CHOOSE A PASSWORD</p><h2>Set your new password</h2><p>Choose a password with at least 12 characters.</p>${message}<label>New password<input required minlength="12" name="password" type="password" autocomplete="new-password"></label><label>Confirm password<input required minlength="12" name="confirmPassword" type="password" autocomplete="new-password"></label><button class="auth-submit" type="submit">Save new password</button></form></section>`;
  }
  if (state.authMode === "invite") {
    return `<section class="auth-page"><form class="auth-card" data-auth-form="invite"><p class="eyebrow">WELCOME</p><h2>Set up your account</h2><p>Create a password to access the report that has been shared with you.</p>${message}<label>New password<input required minlength="12" name="password" type="password" autocomplete="new-password"></label><label>Confirm password<input required minlength="12" name="confirmPassword" type="password" autocomplete="new-password"></label><button class="auth-submit" type="submit">Activate account</button></form></section>`;
  }
  return `<section class="auth-page"><form class="auth-card" data-auth-form="login"><p class="eyebrow">LARDER WEEKLY REPORT</p><h2>Sign in to your report</h2><p>Your report sections are selected by your account administrator.</p>${message}<label>Email address<input required name="email" type="email" autocomplete="email" placeholder="you@example.com"></label><label>Password<input required name="password" type="password" autocomplete="current-password"></label><button class="auth-submit" type="submit">Sign in</button><button class="auth-link" type="button" data-auth-mode="forgot">Forgot your password?</button></form></section>`;
}

function renderNoReport() {
  if (canPublishReport()) return renderUpdateReport();
  return `<section class="auth-page"><div class="auth-card"><p class="eyebrow">WEEKLY REPORT</p><h2>Your account is ready</h2><p>There is no weekly report published yet. An Admin or Owner will upload it shortly.</p><button class="auth-link" type="button" data-action="sign-out">Sign out</button></div></section>`;
}

function renderSensitiveAccessCheck() {
  return `<form class="sensitive-access" data-auth-form="reauthenticate"><p><strong>Confirm it is you</strong><span>Enter your own account password before changing users or publishing a report. Confirmation lasts five minutes.</span></p><label>Your password<input required name="password" type="password" autocomplete="current-password"></label><button type="submit">Confirm</button><small class="sensitive-access__message">${escapeHtml(state.adminMessage || "")}</small></form>`;
}

function accessSectionChoices(selectedSections, disabled = false) {
  const selected = new Set(selectedSections || []);
  return `<div class="access-sections">${sectionLayouts.map((section) => `<label><input ${disabled ? "disabled" : ""} type="checkbox" name="sections" value="${section.id}" ${selected.has(section.id) ? "checked" : ""}><span>${escapeHtml(section.label)}</span></label>`).join("")}</div>`;
}

function renderAdmin() {
  const users = state.adminUsers;
  const isAdmin = state.access?.role === "admin";
  return `<section class="admin-page">
    <button class="back-link" type="button" data-section="overview">&larr; Overview</button>
    <div class="page-intro"><p class="eyebrow">ADMIN CONTROL CENTRE</p><h2>People and report access</h2><p>Add account holders and choose the report sections each viewer can see. Owners have full access once they confirm their own password.</p></div>
    ${renderSensitiveAccessCheck()}
    <section class="admin-create"><h3>Add a person</h3><form data-admin-form="create"><label>Name<input name="name" autocomplete="name" placeholder="Optional"></label><label>Email address<input required name="email" type="email" autocomplete="email" placeholder="person@example.com"></label><label>Temporary password<input required minlength="12" name="password" type="password" autocomplete="new-password" placeholder="At least 12 characters"></label><label>Role<select name="role"><option value="viewer">Viewer</option>${isAdmin ? '<option value="owner">Owner</option>' : ""}</select></label><div class="admin-section-picker"><span>Visible report sections</span>${accessSectionChoices(sectionLayouts.map((section) => section.id))}</div><button class="auth-submit" type="submit">Create account</button></form></section>
    <section class="admin-people"><div class="section-label"><span></span>People with access</div>${users === null ? '<p class="admin-loading">Loading people…</p>' : users.map((person) => renderAdminUser(person, isAdmin)).join("")}</section>
  </section>`;
}

function renderAdminUser(person, isAdmin) {
  const canEdit = !person.isInitialAdmin && (isAdmin || person.role === "viewer");
  if (!canEdit) return `<article class="admin-user-card"><div><strong>${escapeHtml(person.name || person.email)}</strong><span>${escapeHtml(person.email)}</span></div><p>${person.isInitialAdmin ? "Primary administrator" : "Owner account"} · Full report access</p></article>`;
  const owner = person.role === "owner";
  return `<form class="admin-user-card" data-admin-form="update"><input type="hidden" name="userId" value="${escapeHtml(person.id)}"><div class="admin-user-card__identity"><label>Name<input name="name" value="${escapeHtml(person.name || "")}" autocomplete="name"></label><span>${escapeHtml(person.email)}</span></div><div class="admin-user-card__controls"><label>Role<select name="role"><option value="viewer" ${!owner ? "selected" : ""}>Viewer</option>${isAdmin ? `<option value="owner" ${owner ? "selected" : ""}>Owner</option>` : ""}</select></label><label class="admin-toggle"><input name="enabled" type="checkbox" ${person.enabled ? "checked" : ""}><span>Can sign in</span></label></div><div class="admin-section-picker"><span>Visible report sections${owner ? " (owners always see all sections)" : ""}</span>${accessSectionChoices(person.sections, owner)}</div><button type="submit">Save access</button></form>`;
}

function renderMenu() {
  const menuItems = [
    `<button class="menu-item ${state.section === "overview" ? "is-active" : ""}" data-section="overview"><span class="menu-item__icon">⌂</span><span>Overview</span><span class="menu-item__chevron">›</span></button>`,
    `<button class="menu-item menu-item--update ${state.section === "update-report" ? "is-active" : ""}" data-section="update-report"><span class="menu-item__icon">↥</span><span>Update report</span><span class="menu-item__chevron">›</span></button>`,
    ...(report?.sections || []).map((section) => `<button class="menu-item ${state.section === section.id ? "is-active" : ""}" data-section="${section.id}">
      <span class="menu-item__icon accent-${section.accent}">${sectionIcon(section)}</span>
      <span>${escapeHtml(section.label)}</span><span class="menu-item__chevron">›</span>
    </button>`),
  ];
  if (!canPublishReport()) menuItems.splice(1, 1);
  if (canManageUsers()) {
    menuItems.splice(1, 0, `<button class="menu-item menu-item--admin ${state.section === "admin" ? "is-active" : ""}" data-section="admin"><span class="menu-item__icon">⚙</span><span>Admin control centre</span><span class="menu-item__chevron">›</span></button>`);
  }
  sectionMenu.innerHTML = menuItems.join("");
  const footer = document.querySelector(".drawer-footer");
  if (footer) footer.innerHTML = `<span>${escapeHtml(state.user?.email || "")}</span><button type="button" data-action="sign-out">Sign out</button>`;
}

function renderUploader() {
  return `<section class="upload-panel" aria-label="Update weekly report">
    <div class="upload-panel__copy">
      <p class="eyebrow">WEEKLY UPDATE</p>
      <h3>Update this week's report</h3>
      <p>Drop an Excel report here to update the figures for everyone.</p>
    </div>
    <button class="drop-zone" id="report-uploader" type="button" data-action="choose-upload">
      <span class="drop-zone__icon">⇪</span>
      <span><strong>Drop .xlsx file here</strong><small>or tap to choose your weekly report</small></span>
    </button>
    <div class="upload-status" id="upload-status" aria-live="polite"><span>Current source</span><strong>${escapeHtml(state.sourceName)}</strong></div>
  </section>`;
}

function renderOverview() {
  const primary = report.overview.slice(0, 4);
  const performance = report.overview.slice(4);
  const corePerformance = primary.length ? `<section class="overview-group">
      <div class="section-label"><span></span>Core performance</div>
      <div class="summary-grid summary-grid--feature">${primary.map(renderSummaryCard).join("")}</div>
    </section>` : "";
  const salesPerformance = performance.length ? `<section class="overview-group">
      <div class="section-label"><span></span>Sales, covers &amp; wages</div>
      <div class="summary-grid">${performance.map(renderSummaryCard).join("")}</div>
    </section>` : "";
  const detailLinks = report.sections.length ? `<section class="quick-links" aria-label="Detailed report sections">
      <div class="section-label"><span></span>Detailed report</div>
      ${report.sections.map((section) => `<button class="quick-link accent-${section.accent}" type="button" data-section="${section.id}">
        <span class="quick-link__icon">${sectionIcon(section)}</span><span>${escapeHtml(section.label)}</span><span>›</span>
      </button>`).join("")}
    </section>` : `<section class="error-state"><p class="eyebrow">NO SECTIONS SELECTED</p><h2>Ask an Admin or Owner to choose the report sections for this account.</h2></section>`;
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

    ${corePerformance}
    ${salesPerformance}
    ${detailLinks}`;
}

function renderUpdateReport() {
  return `
    <section class="update-report-page">
      <button class="back-link" type="button" data-section="overview">&larr; Overview</button>
      <div class="page-intro update-report-intro">
        <p class="eyebrow">WEEKLY REPORT</p>
        <h2>Update report</h2>
        <p>Drag in this week’s Excel report to update the app for everyone.</p>
      </div>
      ${renderSensitiveAccessCheck()}
      ${renderUploader()}
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
  const tableGroups = tableHeaderGroups(section.headers);
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
          ${metrics.map(({ header, index }) => {
            const columnStyle = section.columnStyles?.[index];
            return `<article class="${classNames("metric-card", sheetStyleClass(columnStyle), comparisonClass(section, header, row.values[index]))}"${sheetStyleAttribute(columnStyle)}><span>${escapeHtml(header.label)}</span><strong>${formatValue(row.values[index], section, header, row.numberFormats?.[index])}</strong></article>`;
          }).join("")}
        </div>
      </section>`).join("")}
    </div>

    <section class="history-section accent-${section.accent}">
      <div class="history-section__heading">
        <div><p class="eyebrow">13-WEEK VIEW</p><h3>Recent performance</h3></div>
        <span class="swipe-hint">Tap to expand &rarr;</span>
      </div>
      <div class="table-wrap" tabindex="0" data-action="expand-table" aria-label="Thirteen-week performance table. Tap to view full screen.">
        <button class="table-expand-close" type="button" data-action="collapse-table" aria-label="Close full screen table">&larr; Back to report</button>
        <table>
          <thead>
            <tr class="table-group-row">${tableGroups.map((group, index) => {
              const isWeek = group.columns[0].index === 0 && group.columns.length === 1;
              const span = isWeek ? ' rowspan="2"' : ` colspan="${group.columns.length}"`;
              return `<th class="${tableGroupClass(index)}" scope="${isWeek ? "col" : "colgroup"}"${span}>${escapeHtml(group.label)}</th>`;
            }).join("")}</tr>
            <tr class="table-column-row">${tableGroups.slice(1).flatMap((group, groupIndex) => group.columns.map(({ header }) => `<th class="${tableGroupClass(groupIndex + 1)}" scope="col">${escapeHtml(header.label)}</th>`)).join("")}</tr>
          </thead>
          <tbody>${section.rows.map((historyRow) => `<tr class="${historyRow.week === row.week ? "is-selected" : ""}">
            <th scope="row">${formatDate(historyRow.week, true)}</th>
            ${historyRow.values.map((value, index) => {
              const columnStyle = section.columnStyles?.[index];
              return `<td class="${classNames(sheetStyleClass(columnStyle), comparisonClass(section, section.headers[index + 1], value))}"${sheetStyleAttribute(columnStyle)}>${formatValue(value, section, section.headers[index + 1], historyRow.numberFormats?.[index])}</td>`;
            }).join("")}
          </tr>`).join("")}</tbody>
        </table>
      </div>
    </section>`;
}

function render() {
  collapseExpandedTable({ restoreFocus: false });
  const authenticated = isSignedIn();
  menuButton.hidden = !authenticated;
  weekButton.hidden = !authenticated || !canPublishReport();
  if (!authenticated) {
    drawer.classList.remove("is-open");
    drawer.setAttribute("aria-hidden", "true");
    drawerBackdrop.classList.remove("is-visible");
    drawerBackdrop.hidden = true;
    topWeek.textContent = "Secure access";
    app.innerHTML = renderAuthScreen();
    attachAuthListeners();
    return;
  }
  topWeek.textContent = report ? formatDate(state.week || report.selectedWeek, true).replace(/&mdash;/g, "—") : "No report yet";
  renderMenu();
  app.innerHTML = !report ? (state.section === "admin" ? renderAdmin() : renderNoReport()) : state.section === "overview" ? renderOverview() : state.section === "update-report" ? renderUpdateReport() : state.section === "admin" ? renderAdmin() : renderSection(getSection(state.section));
  attachDynamicListeners();
  if (state.section === "admin" && state.adminUsers === null) void loadAdminUsers();
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
  const permitted = section === "overview"
    || (section === "update-report" && canPublishReport())
    || (section === "admin" && canManageUsers())
    || report?.sections.some((item) => item.id === section);
  if (!permitted) return;
  state.section = section;
  closeMenu();
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
  app.focus({ preventScroll: true });
}

function formValue(form, name) {
  return new FormData(form).get(name)?.toString().trim() || "";
}

function authFailure(message) {
  report = null;
  sharedReportVersion = "";
  state = { ...state, authMode: "login", authMessage: message, user: null, access: null };
  render();
}

async function loadAccessProfile() {
  const response = await fetch(authEndpoint, { cache: "no-store", headers: { Accept: "application/json" } });
  if (response.status === 401) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Your account could not be checked.");
  return payload;
}

async function beginSignedInExperience() {
  state = { ...state, authMode: "loading", authMessage: "" };
  render();
  try {
    const profile = await loadAccessProfile();
    if (!profile?.user) {
      authFailure("Please sign in to view the report.");
      return;
    }
    if (!profile.access?.enabled) {
      await logout();
      authFailure("This account does not currently have access to the report.");
      return;
    }
    state = { ...state, user: profile.user, access: profile.access };
    const loaded = await loadSharedReport();
    if (!state.user) return;
    if (!loaded) {
      state = { ...state, authMode: "authenticated", section: canPublishReport() ? "update-report" : "overview", authMessage: "" };
      render();
      if (!reportPolling) reportPolling = window.setInterval(() => { void loadSharedReport({ renderAfterLoad: true }); }, sharedReportPollInterval);
      return;
    }
    state = { ...state, authMode: "authenticated", authMessage: "" };
    render();
    if (!reportPolling) reportPolling = window.setInterval(() => { void loadSharedReport({ renderAfterLoad: true }); }, sharedReportPollInterval);
  } catch (error) {
    console.error(error);
    authFailure(error.message || "We could not open your account. Please try again.");
  }
}

function attachAuthListeners() {
  document.querySelectorAll("[data-auth-mode]").forEach((button) => button.addEventListener("click", () => {
    state = { ...state, authMode: button.dataset.authMode, authMessage: "" };
    render();
  }));
  document.querySelectorAll("[data-auth-form='login']").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = formValue(form, "email");
    const password = formValue(form, "password");
    state = { ...state, authMode: "loading", authMessage: "" };
    render();
    try {
      await login(email, password);
      await beginSignedInExperience();
    } catch (error) {
      authFailure(error.message || "That email address or password is not recognised.");
    }
  }));
  document.querySelectorAll("[data-auth-form='forgot']").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await requestPasswordRecovery(formValue(form, "email"));
      state = { ...state, authMessage: "If that account exists, a reset email is on its way." };
      render();
    } catch (error) {
      state = { ...state, authMessage: error.message || "The reset email could not be sent." };
      render();
    }
  }));
  document.querySelectorAll("[data-auth-form='reset'], [data-auth-form='invite']").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = formValue(form, "password");
    if (password !== formValue(form, "confirmPassword")) {
      state = { ...state, authMessage: "The two passwords do not match." };
      render();
      return;
    }
    state = { ...state, authMode: "loading", authMessage: "" };
    render();
    try {
      if (form.dataset.authForm === "invite") await acceptInvite(state.authToken, password);
      else await updateUser({ password });
      await beginSignedInExperience();
    } catch (error) {
      authFailure(error.message || "Your password could not be saved.");
    }
  }));
  document.querySelectorAll("[data-auth-form='reauthenticate']").forEach((form) => form.addEventListener("submit", (event) => {
    event.preventDefault();
    void confirmSensitiveAccess(form);
  }));
}

async function confirmSensitiveAccess(form) {
  const password = formValue(form, "password");
  if (!password) return;
  state = { ...state, adminMessage: "Confirming your password…" };
  render();
  try {
    const response = await fetch(authEndpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reauthenticate", password }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Your password could not be confirmed.");
    state = { ...state, adminMessage: "Confirmed. You can now make changes for the next five minutes." };
  } catch (error) {
    state = { ...state, adminMessage: error.message || "Your password could not be confirmed." };
  }
  render();
}

async function loadAdminUsers() {
  try {
    const response = await fetch(adminEndpoint, { cache: "no-store", headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "People could not be loaded.");
    state = { ...state, adminUsers: payload.users || [] };
  } catch (error) {
    state = { ...state, adminUsers: [], adminMessage: error.message || "People could not be loaded." };
  }
  if (state.section === "admin") render();
}

async function submitAdminForm(form) {
  const formData = new FormData(form);
  const action = form.dataset.adminForm;
  const body = action === "create"
    ? { action, name: formData.get("name"), email: formData.get("email"), password: formData.get("password"), role: formData.get("role"), sections: formData.getAll("sections") }
    : { action, userId: formData.get("userId"), name: formData.get("name"), role: formData.get("role"), enabled: formData.get("enabled") === "on", sections: formData.getAll("sections") };
  state = { ...state, adminMessage: action === "create" ? "Creating account…" : "Saving access…" };
  render();
  try {
    const response = await fetch(adminEndpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 428) throw new Error("Confirm your own password above before making this change.");
    if (!response.ok) throw new Error(payload.error || "The access change could not be saved.");
    state = { ...state, adminUsers: payload.users || [], adminMessage: action === "create" ? "Account created. Share the temporary password with the person securely." : "Access saved." };
  } catch (error) {
    state = { ...state, adminMessage: error.message || "The access change could not be saved." };
  }
  render();
}

async function signOut() {
  try {
    await logout();
  } catch (error) {
    console.warn("The account could not be signed out cleanly.", error);
  }
  if (reportPolling) {
    window.clearInterval(reportPolling);
    reportPolling = null;
  }
  report = null;
  sharedReportVersion = "";
  state = { section: "overview", week: "", sourceName: "", isUploaded: false, authMode: "login", authMessage: "You have signed out.", authToken: "", user: null, access: null, adminUsers: null, adminMessage: "" };
  render();
}

function updateExpandedTableViewport() {
  if (!expandedTable) return;
  const height = Math.round(window.visualViewport?.height || window.innerHeight);
  document.documentElement.style.setProperty("--expanded-table-height", `${height}px`);
}

function resetExpandedTableScroll() {
  if (!expandedTable) return;
  expandedTable.scrollTop = 0;
  window.requestAnimationFrame(() => {
    updateExpandedTableViewport();
    if (expandedTable) expandedTable.scrollTop = 0;
  });
}

function expandTable(table) {
  if (!table || expandedTable === table) return;
  collapseExpandedTable({ restoreFocus: false });
  expandedTable = table;
  table.classList.add("is-expanded");
  table.setAttribute("aria-label", "Thirteen-week performance table, full screen view.");
  document.body.classList.add("table-expanded");
  updateExpandedTableViewport();
  table.scrollTop = 0;
  table.querySelector("[data-action='collapse-table']")?.focus({ preventScroll: true });
}

function collapseExpandedTable({ restoreFocus = true } = {}) {
  if (!expandedTable) return;
  const table = expandedTable;
  expandedTable = null;
  table.classList.remove("is-expanded");
  table.setAttribute("aria-label", "Thirteen-week performance table. Tap to view full screen.");
  document.body.classList.remove("table-expanded");
  document.documentElement.style.removeProperty("--expanded-table-height");
  if (restoreFocus && table.isConnected) table.focus({ preventScroll: true });
}

function attachDynamicListeners() {
  document.querySelectorAll("[data-section]").forEach((button) => button.addEventListener("click", () => changeSection(button.dataset.section)));
  document.querySelectorAll("[data-action='open-menu']").forEach((button) => button.addEventListener("click", openMenu));
  document.querySelectorAll("[data-action='sign-out']").forEach((button) => button.addEventListener("click", () => { void signOut(); }));
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
  document.querySelectorAll("[data-auth-form='reauthenticate']").forEach((form) => form.addEventListener("submit", (event) => {
    event.preventDefault();
    void confirmSensitiveAccess(form);
  }));
  document.querySelectorAll("[data-admin-form]").forEach((form) => form.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitAdminForm(form);
  }));
  document.querySelectorAll("[data-action='expand-table']").forEach((table) => {
    table.addEventListener("click", (event) => {
      if (!event.target.closest("[data-action='collapse-table']")) expandTable(table);
    });
    table.addEventListener("keydown", (event) => {
      if ((event.key === "Enter" || event.key === " ") && !table.classList.contains("is-expanded")) {
        event.preventDefault();
        expandTable(table);
      }
    });
  });
  document.querySelectorAll("[data-action='collapse-table']").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    collapseExpandedTable();
  }));
}

function setUploadStatus(message, kind = "") {
  const status = document.querySelector("#upload-status");
  if (status) status.innerHTML = `<span class="${kind}">${escapeHtml(message)}</span>`;
}

function canUseSharedUpdates() {
  return location.protocol === "https:" && canPublishReport();
}

function isSharedReportPayload(payload) {
  return Boolean(payload?.report?.selectedWeek && Array.isArray(payload.report.sections) && Array.isArray(payload.report.overview));
}

function applySharedReport(payload, { renderAfterLoad = false } = {}) {
  if (!isSharedReportPayload(payload)) return false;
  const version = plainText(payload.version || payload.updatedAt);
  const nextAccess = payload.access || state.access;
  const versionKey = `${version}|${JSON.stringify(nextAccess || {})}`;
  const hasChanged = !sharedReportVersion || versionKey !== sharedReportVersion;
  if (!hasChanged) return true;
  report = withOverviewTones(payload.report);
  const activeSection = state.section;
  const sectionIsAvailable = activeSection === "overview"
    || (activeSection === "update-report" && nextAccess?.canPublish)
    || (activeSection === "admin" && nextAccess?.canManageUsers)
    || report.sections.some((section) => section.id === activeSection);
  state = {
    ...state,
    section: sectionIsAvailable ? activeSection : "overview",
    week: report.selectedWeek,
    sourceName: plainText(payload.sourceName) || "Published report",
    isUploaded: false,
    access: nextAccess,
  };
  sharedReportVersion = versionKey || report.selectedWeek;
  if (renderAfterLoad || hasChanged) render();
  return true;
}

async function loadSharedReport({ renderAfterLoad = false } = {}) {
  if (location.protocol !== "https:") return false;
  try {
    const response = await fetch(sharedReportEndpoint, { cache: "no-store", headers: { Accept: "application/json" } });
    if (response.status === 401) {
      if (isSignedIn()) await signOut();
      return false;
    }
    if (response.status === 404) return false;
    if (!response.ok) throw new Error(`The shared report could not be loaded (${response.status}).`);
    return applySharedReport(await response.json(), { renderAfterLoad });
  } catch (error) {
    console.warn("The shared report could not be loaded.", error);
    return false;
  }
}

async function publishSharedReport(nextReport, sourceName) {
  const response = await fetch(sharedReportEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ report: nextReport, sourceName }),
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 428) throw new Error("Confirm your own password above before publishing this report.");
  if (response.status === 401) throw new Error("Your sign-in has expired. Please sign in again.");
  if (!response.ok) throw new Error(payload.error || "The report could not be published for everyone.");
  if (!isSharedReportPayload(payload)) throw new Error("The shared report was saved, but its confirmation was incomplete.");
  return payload;
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
    const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array", cellNF: true, cellText: true, cellStyles: true });
    const sheetName = workbook.SheetNames.find((name) => /generate\s*report/i.test(name)) || workbook.SheetNames[0];
    if (!sheetName) throw new Error("The workbook does not contain a report sheet.");
    const nextReport = reportFromSheet(workbook.Sheets[sheetName]);
    if (!canUseSharedUpdates()) throw new Error("Only an Administrator or Owner can update the shared report.");
    setUploadStatus("Publishing this week for everyone…", "is-loading");
    const sharedReport = await publishSharedReport(nextReport, file.name);
    applySharedReport(sharedReport, { renderAfterLoad: true });
    setUploadStatus("Updated for everyone. Open reports refresh automatically within one minute.", "is-success");
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

function cellDisplayStyle(sheet, row, column) {
  const address = window.XLSX.utils.encode_cell({ r: row, c: column });
  const cell = sheet[address] || {};
  const style = cell.s && typeof cell.s === "object" ? cell.s : {};
  return {
    fill: validSheetColour(style.fill?.fgColor?.rgb || style.fill?.fgColor || style.fill?.bgColor?.rgb || style.fill?.bgColor || cell.fill?.fgColor?.rgb),
    color: validSheetColour(style.font?.color?.rgb || style.font?.color || cell.font?.color?.rgb),
    bold: Boolean(style.font?.bold || style.bold || cell.font?.bold),
  };
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
        tone: trendTone(trend, layout.id),
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
  return {
    id: layout.id,
    label: layout.label,
    accent: layout.accent,
    title: plainText(cellValue(sheet, layout.titleRow, 0)) || layout.label,
    headers,
    columnStyles: Array.from({ length: layout.columns - 1 }, (_, index) => cellDisplayStyle(sheet, layout.dataStart, index + 1)),
    rows,
  };
}

uploadInput.addEventListener("change", (event) => handleUpload(event.target.files));
menuButton.addEventListener("click", openMenu);
closeMenuButton.addEventListener("click", closeMenu);
drawerBackdrop.addEventListener("click", closeMenu);
weekButton.addEventListener("click", () => {
  changeSection("update-report");
  window.setTimeout(() => document.querySelector("#report-uploader")?.focus(), 250);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && expandedTable) {
    collapseExpandedTable();
    return;
  }
  if (event.key === "Escape" && drawer.classList.contains("is-open")) closeMenu();
});
window.visualViewport?.addEventListener("resize", updateExpandedTableViewport);
window.addEventListener("orientationchange", () => {
  window.setTimeout(resetExpandedTableScroll, 180);
});

render();
void initialiseApplication();

async function initialiseApplication() {
  if (location.protocol !== "https:") {
    authFailure("Open the secure Netlify report link to sign in. Local file previews cannot use account access.");
    return;
  }
  const hashParameters = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const inviteToken = hashParameters.get("invite_token") || new URLSearchParams(location.search).get("invite_token");
  const recoveryToken = hashParameters.get("recovery_token") || new URLSearchParams(location.search).get("recovery_token");
  let callback = null;
  try {
    callback = await handleAuthCallback();
  } catch (error) {
    console.warn("The account link could not be processed automatically.", error);
  }
  if (callback?.type === "invite" || inviteToken) {
    state = { ...state, authMode: "invite", authToken: callback?.token || inviteToken || "", authMessage: "" };
    render();
    return;
  }
  if (callback?.type === "recovery" || recoveryToken) {
    state = { ...state, authMode: "reset", authToken: recoveryToken || "", authMessage: "" };
    render();
    return;
  }
  try {
    const currentUser = await getUser();
    if (currentUser) await beginSignedInExperience();
    else authFailure("");
  } catch (error) {
    authFailure("Sign in to view the current report.");
  }
}
