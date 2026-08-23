import {
  acceptInvite,
  getUser,
  handleAuthCallback,
  login,
  logout,
  requestPasswordRecovery,
  updateUser,
} from "https://cdn.jsdelivr.net/npm/@netlify/identity@2.0.0/+esm";
import { allowedWeeksForAccess, reportForWeek } from "./report-model.js";

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
const localPreviewMode = location.hostname === "localhost" && new URLSearchParams(location.search).has("local-preview");
const lowerIsBetterOverviewIds = new Set(["wages", "foh", "chefs", "senior-management"]);
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
  previewUser: null,
  previewAccess: null,
  availableWeeks: [],
};
let expandedTable = null;
let sharedReportVersion = "";
let reportPolling = null;
let localPreviewSource = null;
let localPreviewModel = null;

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
const dynamicAccentCycle = ["orange", "green", "lime", "blue", "peach", "lavender", "royal", "burnt", "sky", "lilac"];

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
  { id: "senior-management", label: "Senior Management wages as % of sales", value: [21, 12], trend: [23, 12] },
];

const compactNumber = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1, minimumFractionDigits: 0 });

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function plainText(value) {
  return value == null ? "" : String(value).trim();
}

function slugify(value, fallback = "item") {
  const slug = plainText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
  return slug || fallback;
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
  const lowerIsBetter = ["wages", "foh", "chefs", "cleaners", "senior-management"].includes(section.id)
    || /\b(wages?|labou?r|payroll|costs?)\b/i.test(section.label);
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

function lowerIsBetterOverviewCard(card) {
  const id = typeof card === "string" ? card : card?.id;
  const label = typeof card === "object" ? card?.label : "";
  return Boolean(card?.lowerIsBetter)
    || lowerIsBetterOverviewIds.has(id)
    || /\b(wages?|labou?r|payroll|costs?)\b/i.test(label);
}

function trendTone(trend, card = "") {
  const text = normaliseTrend(trend).toLowerCase();
  const lowerIsBetter = lowerIsBetterOverviewCard(card);
  if (text.startsWith("up")) return lowerIsBetter ? "negative" : "positive";
  if (text.startsWith("down")) return lowerIsBetter ? "positive" : "negative";
  return "neutral";
}

function withOverviewTones(sourceReport) {
  if (!sourceReport?.overview) return sourceReport;
  return {
    ...sourceReport,
    overview: sourceReport.overview.map((card) => ({ ...card, tone: trendTone(card.trend, card) })),
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

function renderPreviewBanner() {
  if (!state.previewUser) return "";
  return `<section class="preview-banner"><div><p class="eyebrow">READ-ONLY PREVIEW</p><strong>Viewing ${escapeHtml(state.previewUser.name)}’s report</strong><span>${escapeHtml(state.previewUser.email || "")}</span></div><button type="button" data-action="exit-preview">Back to Admin</button></section>`;
}

function renderSensitiveAccessCheck() {
  if (state.access?.role === "admin") return "";
  return `<form class="sensitive-access" data-auth-form="reauthenticate"><p><strong>Confirm it is you</strong><span>Enter your own account password before changing users or publishing a report. Confirmation lasts five minutes.</span></p><label>Your password<input required name="password" type="password" autocomplete="current-password"></label><button type="submit">Confirm</button><small class="sensitive-access__message">${escapeHtml(state.adminMessage || "")}</small></form>`;
}

function permissionSections() {
  return report?.sections || sectionLayouts.map((section) => ({ ...section, headers: [{ label: "Week", group: "Week" }] }));
}

function dateAccessForEditor(savedAccess) {
  if (savedAccess?.scope === "all") return { scope: "all" };
  if (savedAccess?.scope === "range" && savedAccess.start && savedAccess.end) return { scope: "range", start: savedAccess.start, end: savedAccess.end };
  return { scope: "current" };
}

function reportDateBounds() {
  const weeks = state.availableWeeks || [];
  return { earliest: weeks[0] || "", latest: weeks.at(-1) || report?.selectedWeek || "" };
}

function permissionFieldId(header, index) {
  return header?.id || String(index);
}

function hasSelectedField(fields, header, index) {
  const selections = Array.isArray(fields) ? fields : [];
  return selections.includes("*") || selections.includes(permissionFieldId(header, index)) || selections.includes(String(index));
}

function defaultAccessView(selectedSections = permissionSections().map((section) => section.id)) {
  const selected = new Set(selectedSections);
  return {
    overview: { enabled: true, cards: (report?.overview || overviewLayouts).map((card) => card.id) },
    sections: Object.fromEntries(permissionSections().map((section) => [section.id, {
      enabled: selected.has(section.id),
      fields: section.headers.length > 1 ? section.headers.slice(1).map((header, index) => permissionFieldId(header, index + 1)) : ["*"],
    }])),
  };
}

function accessViewForEditor(savedView, legacySections) {
  if (!savedView) return defaultAccessView(legacySections);
  const source = defaultAccessView([]);
  return {
    overview: {
      enabled: savedView.overview?.enabled !== false,
      cards: Array.isArray(savedView.overview?.cards) ? savedView.overview.cards : source.overview.cards,
    },
    sections: Object.fromEntries(permissionSections().map((section) => {
      const saved = savedView.sections?.[section.id];
      return [section.id, {
        enabled: saved?.enabled === true,
        fields: Array.isArray(saved?.fields) ? saved.fields : [],
      }];
    })),
  };
}

function fieldGroups(section) {
  const groups = new Map();
  section.headers.slice(1).forEach((header, index) => {
    const group = header.group || "Report details";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push({ header, index: index + 1, id: permissionFieldId(header, index + 1) });
  });
  return [...groups.entries()];
}

function renderAccessEditor(savedView, legacySections, disabled = false, savedDateAccess = null) {
  const view = accessViewForEditor(savedView, legacySections);
  const overviewCards = report?.overview || overviewLayouts;
  const dateAccess = dateAccessForEditor(savedDateAccess);
  const dateBounds = reportDateBounds();
  return `<section class="permission-editor">
    <div class="permission-editor__intro"><strong>What this person can view</strong><span>Choose the report-ending dates, overview cards, and individual figures that appear in their report.</span></div>
    <details class="permission-area" open><summary>Report dates</summary><label class="permission-toggle"><span>Date access</span><select ${disabled ? "disabled" : ""} name="dateScope"><option value="current" ${dateAccess.scope === "current" ? "selected" : ""}>Current report week only</option><option value="all" ${dateAccess.scope === "all" ? "selected" : ""}>All available weeks</option><option value="range" ${dateAccess.scope === "range" ? "selected" : ""}>Custom date range</option></select></label><div class="permission-date-range" ${dateAccess.scope === "range" ? "" : "hidden"}><label>From<input ${disabled ? "disabled" : ""} type="date" name="dateStart" min="${escapeHtml(dateBounds.earliest)}" max="${escapeHtml(dateBounds.latest)}" value="${escapeHtml(dateAccess.start || dateBounds.earliest)}"></label><label>To<input ${disabled ? "disabled" : ""} type="date" name="dateEnd" min="${escapeHtml(dateBounds.earliest)}" max="${escapeHtml(dateBounds.latest)}" value="${escapeHtml(dateAccess.end || dateBounds.latest)}"></label></div><p class="permission-date-note">This controls the report-ending week they can choose. Every permitted report still includes its 13-week comparison.</p></details>
    <details class="permission-area" open><summary>Overview page</summary><label class="permission-toggle"><input ${disabled ? "disabled" : ""} type="checkbox" name="overviewEnabled" ${view.overview.enabled ? "checked" : ""}><span>Show the overview page</span></label><div class="permission-options">${overviewCards.map((card) => `<label><input ${disabled ? "disabled" : ""} type="checkbox" name="overviewCards" value="${escapeHtml(card.id)}" ${view.overview.cards.includes(card.id) ? "checked" : ""}><span>${escapeHtml(card.label)}</span></label>`).join("")}</div></details>
    <details class="permission-area" open><summary>Detailed report sections</summary>${permissionSections().map((section) => {
      const sectionView = view.sections[section.id] || { enabled: false, fields: [] };
      return `<details class="permission-section"><summary>${escapeHtml(section.label)}</summary><label class="permission-toggle"><input ${disabled ? "disabled" : ""} type="checkbox" name="sectionEnabled" value="${section.id}" ${sectionView.enabled ? "checked" : ""}><span>Show ${escapeHtml(section.label)}</span></label>${section.headers.length > 1 ? fieldGroups(section).map(([group, fields]) => `<div class="permission-field-group"><strong>${escapeHtml(group)}</strong><div class="permission-options">${fields.map(({ header, index, id }) => `<label><input ${disabled ? "disabled" : ""} type="checkbox" name="sectionFields" value="${section.id}:${id}" ${hasSelectedField(sectionView.fields, header, index) ? "checked" : ""}><span>${escapeHtml(header.label)}</span></label>`).join("")}</div></div>`).join("") : '<p class="permission-empty">Upload a report to choose individual figures.</p>'}</details>`;
    }).join("")}</details>
  </section>`;
}

function renderPreviewButton(person) {
  if (person.id === state.user?.id) return "";
  const name = person.name || person.email;
  return `<button class="preview-report-button" type="button" data-action="preview-user" data-user-id="${escapeHtml(person.id)}" data-user-name="${escapeHtml(name)}">View ${escapeHtml(name)}’s report</button>`;
}

function renderAdmin() {
  const users = state.adminUsers;
  const isAdmin = state.access?.role === "admin";
  return `<section class="admin-page">
    <button class="back-link" type="button" data-section="overview">&larr; Overview</button>
    <div class="page-intro"><p class="eyebrow">ADMIN CONTROL CENTRE</p><h2>People and report access</h2><p>Set each Viewer’s permitted report dates, overview cards, and detailed figures. Owners always receive the complete report.</p></div>
    ${renderSensitiveAccessCheck()}
    <section class="admin-create"><h3>Add a person</h3><form data-admin-form="create"><label>Name<input name="name" autocomplete="name" placeholder="Optional"></label><label>Email address<input required name="email" type="email" autocomplete="email" placeholder="person@example.com"></label><label>Temporary password<input required minlength="12" name="password" type="password" autocomplete="new-password" placeholder="At least 12 characters"></label><label>Role<select name="role"><option value="viewer">Viewer</option>${isAdmin ? '<option value="owner">Owner</option>' : ""}</select></label>${renderAccessEditor(null, permissionSections().map((section) => section.id))}<button class="auth-submit" type="submit">Create account</button></form></section>
    <section class="admin-people"><div class="section-label"><span></span>People with access</div>${users === null ? '<p class="admin-loading">Loading people…</p>' : users.map((person) => renderAdminUser(person, isAdmin)).join("")}</section>
  </section>`;
}

function renderAdminUser(person, isAdmin) {
  const canEdit = !person.isInitialAdmin && (isAdmin || person.role === "viewer");
  if (!canEdit) return `<article class="admin-user-card"><div><strong>${escapeHtml(person.name || person.email)}</strong><span>${escapeHtml(person.email)}</span></div><p>${person.isInitialAdmin ? "Primary administrator" : "Owner account"} · Full report access</p>${renderPreviewButton(person)}</article>`;
  const owner = person.role === "owner";
  return `<form class="admin-user-card" data-admin-form="update"><input type="hidden" name="userId" value="${escapeHtml(person.id)}"><div class="admin-user-card__identity"><label>Name<input name="name" value="${escapeHtml(person.name || "")}" autocomplete="name"></label><span>${escapeHtml(person.email)}</span></div><div class="admin-user-card__controls"><label>Role<select name="role"><option value="viewer" ${!owner ? "selected" : ""}>Viewer</option>${isAdmin ? `<option value="owner" ${owner ? "selected" : ""}>Owner</option>` : ""}</select></label><label class="admin-toggle"><input name="enabled" type="checkbox" ${person.enabled ? "checked" : ""}><span>Can sign in</span></label></div>${owner ? '<p class="permission-owner">Owners always see the complete report.</p>' : renderAccessEditor(person.view, person.sections, false, person.dateAccess)}<div class="admin-user-card__actions">${renderPreviewButton(person)}<button type="submit">Save access</button></div></form>`;
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
  if (!canPublishReport() || state.previewUser) menuItems.splice(1, 1);
  if (canManageUsers() && !state.previewUser) {
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
      <h3>Update the master report</h3>
      <p>Drop in the full Master Performance Sheet to update the figures and available report weeks for everyone.</p>
    </div>
    <button class="drop-zone" id="report-uploader" type="button" data-action="choose-upload">
      <span class="drop-zone__icon">⇪</span>
      <span><strong>Drop the master .xlsx here</strong><small>or tap to choose the full Master Performance Sheet</small></span>
    </button>
    <div class="upload-status" id="upload-status" aria-live="polite"><span>Current source</span><strong>${escapeHtml(state.sourceName)}</strong></div>
  </section>`;
}

function monthKey(value) {
  return /^\d{4}-\d{2}/.test(plainText(value)) ? plainText(value).slice(0, 7) : "";
}

function shiftMonth(month, amount) {
  const [year, index] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, index - 1 + amount, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthTitle(month) {
  const [year, number] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, number - 1, 1)));
}

function renderWeekCalendar(weeks) {
  const selectedWeek = report?.selectedWeek || weeks.at(-1) || "";
  const month = monthKey(state.calendarMonth) || monthKey(selectedWeek);
  const [year, number] = month.split("-").map(Number);
  const firstDay = (new Date(Date.UTC(year, number - 1, 1)).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const available = new Set(weeks);
  const earliestMonth = monthKey(weeks[0]);
  const latestMonth = monthKey(weeks.at(-1));
  const cells = Array.from({ length: firstDay }, () => `<span class="week-calendar__blank" aria-hidden="true"></span>`);
  for (let day = 1; day <= daysInMonth; day += 1) {
    const week = `${month}-${String(day).padStart(2, "0")}`;
    const allowed = available.has(week);
    const selected = week === selectedWeek;
    cells.push(`<button class="week-calendar__day ${allowed ? "is-available" : ""} ${selected ? "is-selected" : ""}" type="button" ${allowed ? `data-action="choose-calendar-week" data-week="${week}"` : "disabled"} aria-label="${escapeHtml(formatDate(week))}${selected ? ", selected" : ""}">${day}</button>`);
  }
  return `<div class="week-calendar" role="dialog" aria-label="Choose report ending week">
    <div class="week-calendar__header"><button type="button" data-action="calendar-month" data-month-offset="-1" ${month <= earliestMonth ? "disabled" : ""} aria-label="Previous month">‹</button><strong>${escapeHtml(monthTitle(month))}</strong><button type="button" data-action="calendar-month" data-month-offset="1" ${month >= latestMonth ? "disabled" : ""} aria-label="Next month">›</button></div>
    <div class="week-calendar__weekdays"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div>
    <div class="week-calendar__days">${cells.join("")}</div>
    <p>Gold dates are available report-ending weeks.</p>
    <button class="week-calendar__cancel" type="button" data-action="close-calendar">Cancel</button>
  </div>`;
}

function renderWeekPicker() {
  const weeks = [...new Set(state.availableWeeks || [])];
  if (weeks.length <= 1) return `<strong>${formatDate(report.selectedWeek)}</strong>`;
  return `<div class="report-week-picker"><span>Report ending</span><button class="report-week-picker__button" type="button" data-action="toggle-calendar" aria-expanded="${state.calendarOpen ? "true" : "false"}" aria-haspopup="dialog"><strong>${formatDate(report.selectedWeek)}</strong><b aria-hidden="true">▦</b></button>${state.calendarOpen ? renderWeekCalendar(weeks) : ""}</div>`;
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
      <p>Select a permitted report-ending week. The full 13-week comparison stays in every report section.</p>
    </section>

    <section class="week-hero" aria-label="Selected report week">
      <div>${renderWeekPicker()}</div>
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
        <p>Drag in the full Master Performance Sheet to update the app and all available report weeks for everyone.</p>
      </div>
      ${renderSensitiveAccessCheck()}
      ${renderUploader()}
    </section>`;
}

function renderSummaryCard(card) {
  const linkedSection = card.sectionId || (card.id === "sales-inc" || card.id === "sales-ex" ? "sales" : card.id);
  const tone = card.tone || trendTone(card.trend, card);
  return `<button class="summary-card summary-card--${tone}" data-section="${linkedSection}" type="button">
    <span class="summary-card__label">${escapeHtml(card.label)}</span>
    <strong>${formatOverviewValue(card)}</strong>
    <span class="trend trend--${tone}">${arrowForTrend(card.trend)} ${escapeHtml(normaliseTrend(card.trend) || "No comparison")}</span>
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
  weekButton.hidden = !authenticated || !canPublishReport() || Boolean(state.previewUser);
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
  const page = !report ? (state.section === "admin" ? renderAdmin() : renderNoReport()) : state.section === "overview" ? renderOverview() : state.section === "update-report" ? renderUpdateReport() : state.section === "admin" ? renderAdmin() : renderSection(getSection(state.section));
  app.innerHTML = `${renderPreviewBanner()}${page}`;
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
    || (section === "update-report" && canPublishReport() && !state.previewUser)
    || (section === "admin" && canManageUsers() && !state.previewUser)
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
      if (!reportPolling) reportPolling = window.setInterval(() => { if (!state.previewUser) void loadSharedReport({ renderAfterLoad: true, week: report?.selectedWeek || "" }); }, sharedReportPollInterval);
      return;
    }
    state = { ...state, authMode: "authenticated", authMessage: "" };
    render();
    if (!reportPolling) reportPolling = window.setInterval(() => { if (!state.previewUser) void loadSharedReport({ renderAfterLoad: true, week: report?.selectedWeek || "" }); }, sharedReportPollInterval);
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

function accessViewFromForm(form) {
  const formData = new FormData(form);
  const enabledSections = new Set(formData.getAll("sectionEnabled"));
  const fields = new Map();
  formData.getAll("sectionFields").forEach((value) => {
    const [section, index] = String(value).split(":");
    if (!fields.has(section)) fields.set(section, []);
    fields.get(section).push(index);
  });
  return {
    overview: {
      enabled: formData.get("overviewEnabled") === "on",
      cards: formData.getAll("overviewCards").map(String),
    },
    sections: Object.fromEntries(permissionSections().map((section) => [section.id, {
      enabled: enabledSections.has(section.id),
      fields: fields.get(section.id) || [],
    }])),
  };
}

function dateAccessFromForm(form) {
  const formData = new FormData(form);
  const scope = plainText(formData.get("dateScope"));
  if (scope === "all") return { scope: "all" };
  if (scope === "range") return { scope, start: plainText(formData.get("dateStart")), end: plainText(formData.get("dateEnd")) };
  return { scope: "current" };
}

function localSectionsFromView(view) {
  return Object.entries(view?.sections || {}).filter(([, selection]) => selection?.enabled).map(([section]) => section);
}

function localUserWithAccess(current, body) {
  const role = body.role === "owner" ? "owner" : "viewer";
  return {
    ...current,
    id: current?.id || `local-${Date.now()}`,
    name: plainText(body.name),
    email: plainText(body.email) || current?.email || "",
    role,
    enabled: body.enabled !== false,
    sections: localSectionsFromView(body.view),
    view: role === "owner" ? null : body.view,
    dateAccess: role === "owner" ? { scope: "all" } : body.dateAccess,
    isInitialAdmin: false,
  };
}

async function submitAdminForm(form) {
  const formData = new FormData(form);
  const action = form.dataset.adminForm;
  const body = action === "create"
    ? { action, name: formData.get("name"), email: formData.get("email"), password: formData.get("password"), role: formData.get("role"), view: accessViewFromForm(form), dateAccess: dateAccessFromForm(form) }
    : { action, userId: formData.get("userId"), name: formData.get("name"), role: formData.get("role"), enabled: formData.get("enabled") === "on", view: accessViewFromForm(form), dateAccess: dateAccessFromForm(form) };
  if (localPreviewMode) {
    const users = state.adminUsers || [];
    const nextUsers = action === "create"
      ? [...users, localUserWithAccess(null, body)]
      : users.map((person) => String(person.id) === String(body.userId) ? localUserWithAccess(person, body) : person);
    state = { ...state, adminUsers: nextUsers, adminMessage: action === "create" ? "Local account created for preview only." : "Local access saved. Use View report to check this person’s permissions." };
    render();
    return;
  }
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
  localPreviewModel = null;
  sharedReportVersion = "";
  state = { section: "overview", week: "", sourceName: "", isUploaded: false, authMode: "login", authMessage: "You have signed out.", authToken: "", user: null, access: null, adminUsers: null, adminMessage: "", availableWeeks: [] };
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
  document.querySelectorAll("[data-action='preview-user']").forEach((button) => button.addEventListener("click", () => { void previewUserReport(button.dataset.userId); }));
  document.querySelectorAll("[data-action='exit-preview']").forEach((button) => button.addEventListener("click", () => { void exitPreview(); }));
  document.querySelectorAll("[data-action='toggle-calendar']").forEach((button) => button.addEventListener("click", () => {
    const opening = !state.calendarOpen;
    state = { ...state, calendarOpen: opening, calendarMonth: monthKey(report?.selectedWeek) };
    render();
  }));
  document.querySelectorAll("[data-action='close-calendar']").forEach((button) => button.addEventListener("click", () => {
    state = { ...state, calendarOpen: false, calendarMonth: monthKey(report?.selectedWeek) };
    render();
  }));
  document.querySelectorAll("[data-action='calendar-month']").forEach((button) => button.addEventListener("click", () => {
    state = { ...state, calendarOpen: true, calendarMonth: shiftMonth(state.calendarMonth || monthKey(report?.selectedWeek), Number(button.dataset.monthOffset || 0)) };
    render();
  }));
  document.querySelectorAll("[data-action='choose-calendar-week']").forEach((button) => button.addEventListener("click", () => { void changeReportWeek(button.dataset.week); }));
  document.querySelectorAll("select[name='dateScope']").forEach((select) => select.addEventListener("change", () => {
    const range = select.closest(".permission-area")?.querySelector(".permission-date-range");
    if (range) range.hidden = select.value !== "range";
  }));
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

function filterReportForView(source, access) {
  if (access.role === "admin" || access.role === "owner") return source;
  const view = access.view;
  const sections = source.sections.flatMap((section) => {
    if (!access.sections.includes(section.id)) return [];
    const selection = view?.sections?.[section.id];
    if (view && !selection?.enabled) return [];
    const kept = section.headers.map((header, index) => ({ header, index }))
      .filter(({ header, index }) => index === 0 || !view || hasSelectedField(selection.fields, header, index));
    if (kept.length < 2) return [];
    const values = kept.slice(1).map(({ index }) => index - 1);
    return [{ ...section, headers: kept.map(({ header }) => header), columnStyles: values.map((index) => section.columnStyles?.[index]), rows: section.rows.map((row) => ({ ...row, values: values.map((index) => row.values[index]), numberFormats: values.map((index) => row.numberFormats?.[index]) })) }];
  });
  const overview = source.overview.filter((card) => !view
    ? access.sections.includes(card.id === "sales-inc" || card.id === "sales-ex" ? "sales" : card.id)
    : view.overview?.enabled !== false && (view.overview.cards.includes("*") || view.overview.cards.includes(card.id)));
  return { ...source, overview, sections };
}

async function changeReportWeek(week) {
  if (!week || week === report?.selectedWeek || !(state.availableWeeks || []).includes(week)) return;
  if (localPreviewMode && localPreviewModel) {
    const fullReport = reportForWeek(localPreviewModel, week);
    if (!fullReport) return;
    report = withOverviewTones(state.previewAccess ? filterReportForView(fullReport, state.previewAccess) : fullReport);
    state = { ...state, week: report.selectedWeek, calendarOpen: false, calendarMonth: monthKey(report.selectedWeek) };
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  const loaded = await loadSharedReport({ week, renderAfterLoad: true, previewUserId: state.previewUser?.id || "" });
  if (loaded) window.scrollTo({ top: 0, behavior: "smooth" });
}

function applySharedReport(payload, { renderAfterLoad = false, preview = false } = {}) {
  if (!isSharedReportPayload(payload)) return false;
  const version = plainText(payload.version || payload.updatedAt);
  const previewing = preview || Boolean(payload.preview);
  const reportAccess = payload.access || state.access;
  const nextAccess = previewing ? state.access : reportAccess;
  const versionKey = `${version}|${payload.preview?.id || ""}|${payload.report?.selectedWeek || ""}|${JSON.stringify(reportAccess || {})}`;
  const hasChanged = !sharedReportVersion || versionKey !== sharedReportVersion;
  if (!hasChanged) return true;
  report = withOverviewTones(payload.report);
  const activeSection = state.section;
  const sectionIsAvailable = activeSection === "overview"
    || (activeSection === "update-report" && nextAccess?.canPublish && !previewing)
    || (activeSection === "admin" && nextAccess?.canManageUsers && !previewing)
    || report.sections.some((section) => section.id === activeSection);
  state = {
    ...state,
    section: sectionIsAvailable ? activeSection : "overview",
    week: report.selectedWeek,
    sourceName: plainText(payload.sourceName) || "Published report",
    isUploaded: false,
    access: nextAccess,
    availableWeeks: Array.isArray(payload.availableWeeks) && payload.availableWeeks.length ? payload.availableWeeks : [report.selectedWeek],
    calendarOpen: false,
    calendarMonth: monthKey(report.selectedWeek),
    previewUser: previewing ? payload.preview : null,
    previewAccess: previewing ? reportAccess : null,
  };
  sharedReportVersion = versionKey || report.selectedWeek;
  if (renderAfterLoad || hasChanged) render();
  return true;
}

async function loadSharedReport({ renderAfterLoad = false, previewUserId = "", week = "" } = {}) {
  if (location.protocol !== "https:") return false;
  try {
    const parameters = new URLSearchParams();
    if (previewUserId) parameters.set("preview", previewUserId);
    if (week) parameters.set("week", week);
    const url = parameters.size ? `${sharedReportEndpoint}?${parameters.toString()}` : sharedReportEndpoint;
    const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
    if (response.status === 401) {
      if (isSignedIn()) await signOut();
      return false;
    }
    if (response.status === 404) return false;
    if (!response.ok) throw new Error(`The shared report could not be loaded (${response.status}).`);
    return applySharedReport(await response.json(), { renderAfterLoad, preview: Boolean(previewUserId) });
  } catch (error) {
    console.warn("The shared report could not be loaded.", error);
    return false;
  }
}

async function previewUserReport(userId) {
  if (!userId || !canManageUsers()) return;
  if (localPreviewMode) {
    const person = state.adminUsers?.find((user) => user.id === userId);
    if (!person || !localPreviewSource) return;
    const previewAccess = person.role === "owner" ? { role: "owner", sections: permissionSections().map((section) => section.id), dateAccess: { scope: "all" } } : { role: "viewer", sections: person.sections, view: person.view, dateAccess: person.dateAccess };
    const availableWeeks = localPreviewModel ? allowedWeeksForAccess(localPreviewModel, previewAccess.dateAccess) : [localPreviewSource.selectedWeek];
    const sourceReport = localPreviewModel ? reportForWeek(localPreviewModel, availableWeeks.includes(localPreviewModel.currentWeek) ? localPreviewModel.currentWeek : availableWeeks.at(-1)) : localPreviewSource;
    report = withOverviewTones(filterReportForView(sourceReport, previewAccess));
    state = { ...state, section: "overview", availableWeeks, calendarOpen: false, calendarMonth: monthKey(report.selectedWeek), previewUser: { id: person.id, name: person.name || person.email, email: person.email }, previewAccess };
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  closeMenu();
  state = { ...state, adminMessage: "Opening report preview…" };
  render();
  const loaded = await loadSharedReport({ previewUserId: userId, renderAfterLoad: true });
  if (!loaded) {
    state = { ...state, adminMessage: "That report preview could not be opened." };
    render();
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function exitPreview() {
  if (!state.previewUser) return;
  if (localPreviewMode && localPreviewSource) {
    report = localPreviewModel ? withOverviewTones(reportForWeek(localPreviewModel, localPreviewModel.currentWeek)) : localPreviewSource;
    state = { ...state, availableWeeks: localPreviewModel?.availableWeeks || [report.selectedWeek], calendarOpen: false, calendarMonth: monthKey(report.selectedWeek), previewUser: null, previewAccess: null, section: "admin", adminMessage: "" };
    render();
    return;
  }
  state = { ...state, previewUser: null, previewAccess: null, section: "admin", adminMessage: "" };
  sharedReportVersion = "";
  render();
  await loadSharedReport({ renderAfterLoad: true });
}

async function publishSharedReport(submission, sourceName) {
  const response = await fetch(sharedReportEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...submission, sourceName }),
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
  setUploadStatus("Reading your master report…", "is-loading");
  try {
    const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array", cellNF: true, cellText: true, cellStyles: true });
    const sheetName = workbook.SheetNames.find((name) => /generate\s*report/i.test(name)) || workbook.SheetNames[0];
    if (!sheetName) throw new Error("The workbook does not contain a report sheet.");
    const reportSheet = workbook.Sheets[sheetName];
    const masterSections = masterSectionLayouts(reportSheet);
    const isMasterWorkbook = masterSections.length > 0 && masterSections.every((section) => (
      (section.sourceColumns || [{ source: section.source }]).every(({ source }) => workbook.Sheets[source])
    ));
    const model = isMasterWorkbook ? masterReportModelFromWorkbook(workbook, reportSheet) : null;
    const nextReport = model ? reportForWeek(model, model.currentWeek) : reportFromSheet(reportSheet);
    const submission = model ? { model } : { report: nextReport };
    if (localPreviewMode) {
      localPreviewModel = model;
      localPreviewSource = withOverviewTones(nextReport);
      report = localPreviewSource;
      state = { ...state, section: "overview", week: report.selectedWeek, sourceName: file.name, availableWeeks: model?.availableWeeks || [report.selectedWeek], calendarOpen: false, calendarMonth: monthKey(report.selectedWeek), adminMessage: "Master workbook loaded for local preview only." };
      render();
      setUploadStatus("Master workbook loaded locally. It has not been published.", "is-success");
      return;
    }
    if (!canUseSharedUpdates()) throw new Error("Only an Administrator or Owner can update the shared report.");
    setUploadStatus("Publishing the master report for everyone…", "is-loading");
    const sharedReport = await publishSharedReport(submission, file.name);
    applySharedReport(sharedReport, { renderAfterLoad: true });
    setUploadStatus("Updated for everyone. Open reports refresh automatically within one minute.", "is-success");
  } catch (error) {
    console.error(error);
    setUploadStatus(error.message || "The master workbook could not be read.", "is-error");
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
  const layouts = discoverSectionLayouts(sheet);
  if (!layouts.length) throw new Error("I could not find the weekly report tables in this workbook.");
  const selectedWeek = dateFromExcel(cellValue(sheet, 1, 13));
  const sections = layouts.map((layout) => sectionFromSheet(sheet, layout));
  const firstWeek = sections.find((section) => section.rows[0])?.rows[0]?.week;
  const latestWeek = sections.find((section) => section.rows.length)?.rows.at(-1)?.week;
  const week = selectedWeek || latestWeek || firstWeek;
  if (!week) throw new Error("I could not find the reporting week in this workbook.");
  return {
    reportTitle: plainText(cellValue(sheet, 0, 0)) || "LARDER LICHFIELD | WEEKLY PERFORMANCE REPORT",
    selectedWeek: week,
    overview: overviewCardLayouts(sheet, layouts).map((layout) => {
      const trend = plainText(cellValue(sheet, layout.trend[0], layout.trend[1]));
      return {
        id: layout.id,
        label: layout.label,
        value: cellValue(sheet, layout.value[0], layout.value[1]),
        numberFormat: cellNumberFormat(sheet, layout.value[0], layout.value[1]),
        trend,
        lowerIsBetter: layout.lowerIsBetter,
        sectionId: layout.sectionId,
        tone: trendTone(trend, layout),
        detail: "Current report",
      };
    }),
    sections,
  };
}

function headersFromSheet(sheet, layout) {
  let activeGroup = "";
  const usedHeaderIds = new Set();
  return Array.from({ length: layout.columns }, (_, index) => {
    const groupCell = plainText(cellValue(sheet, layout.groupRow, index));
    if (groupCell) activeGroup = groupCell;
    const label = plainText(cellValue(sheet, layout.headerRow, index));
    const displayLabel = label || activeGroup || `Column ${index + 1}`;
    return {
      id: index === 0 ? "week" : uniqueIdentifier(`${activeGroup}-${displayLabel}`, usedHeaderIds),
      label: displayLabel,
      group: activeGroup,
    };
  });
}

function formulaAt(sheet, row, column) {
  const address = window.XLSX.utils.encode_cell({ r: row, c: column });
  const formula = plainText(sheet[address]?.f);
  return formula ? (formula.startsWith("=") ? formula : `=${formula}`) : "";
}

function preferredOverviewCardId(label) {
  const name = slugify(label, "overview-card");
  if (/total.*sales.*inc/.test(name)) return "sales-inc";
  if (/total.*sales.*ex/.test(name)) return "sales-ex";
  if (/overall.*gp/.test(name)) return "overall-gp";
  if (/food.*gp/.test(name)) return "food-gp";
  if (/drink.*gp/.test(name)) return "drink-gp";
  if (/total.*covers/.test(name)) return "covers";
  if (/spend.*head/.test(name)) return "sph";
  if (/future.*booking/.test(name)) return "bookings";
  if (/senior.*management.*wage/.test(name)) return "senior-management";
  if (/(front.*house|foh).*wage/.test(name)) return "foh";
  if (/chef.*wage/.test(name)) return "chefs";
  if (/^wages?.*(sales|of)/.test(name)) return "wages";
  return name;
}

function overviewSectionId(cardId, sections) {
  const preferred = cardId === "sales-inc" || cardId === "sales-ex" ? "sales" : cardId;
  if (sections.some((section) => section.id === preferred)) return preferred;
  const terms = {
    "senior-management": /senior.*management/i,
    foh: /front.*house|foh/i,
    chefs: /chef/i,
    wages: /total.*wage|wages/i,
    "overall-gp": /overall.*(?:gp|profit)/i,
    "food-gp": /food.*(?:gp|profit)/i,
    "drink-gp": /drink.*(?:gp|profit)/i,
    covers: /cover/i,
    sph: /spend.*head/i,
    bookings: /future.*booking/i,
  };
  const matcher = terms[cardId];
  return matcher ? sections.find((section) => matcher.test(section.label))?.id || "" : "";
}

function overviewCardLayouts(sheet, sections = []) {
  const merges = sheet["!merges"] || [];
  const usedIds = new Set();
  const cards = [];
  for (const titleRange of merges) {
    const titleWidth = titleRange.e.c - titleRange.s.c + 1;
    if (titleWidth < 3 || titleRange.e.r !== titleRange.s.r) continue;
    const label = plainText(cellValue(sheet, titleRange.s.r, titleRange.s.c));
    if (!label || /^(?:7|13)w\s+average|sales mix|adjusted|target\b|flash\b/i.test(label)) continue;
    const valueRange = merges.find((range) => range.s.c === titleRange.s.c && range.e.c === titleRange.e.c && range.s.r === titleRange.e.r + 1);
    if (!valueRange) continue;
    const value = cellValue(sheet, valueRange.s.r, valueRange.s.c);
    const valueFormula = formulaAt(sheet, valueRange.s.r, valueRange.s.c);
    if (value == null && !valueFormula) continue;
    const trendRange = merges.find((range) => range.s.c === titleRange.s.c && range.e.c === titleRange.e.c && range.s.r === valueRange.e.r + 1);
    const baseId = preferredOverviewCardId(label);
    const fallback = overviewLayouts.find((layout) => layout.id === baseId);
    const id = uniqueIdentifier(baseId, usedIds);
    const trend = trendRange ? [trendRange.s.r, trendRange.s.c] : (fallback?.trend || [valueRange.e.r + 1, valueRange.s.c]);
    cards.push({
      id,
      label,
      order: titleRange.s.r * 1000 + titleRange.s.c,
      value: [valueRange.s.r, valueRange.s.c],
      trend,
      valueFormula,
      trendFormula: formulaAt(sheet, trend[0], trend[1]),
      staticValue: value,
      staticTrend: plainText(cellValue(sheet, trend[0], trend[1])),
      numberFormat: cellNumberFormat(sheet, valueRange.s.r, valueRange.s.c),
      lowerIsBetter: /\b(wages?|labou?r|payroll|costs?)\b/i.test(label),
      sectionId: overviewSectionId(baseId, sections),
    });
  }
  if (cards.length) return cards.sort((left, right) => left.order - right.order).map(({ order, ...card }) => card);
  return overviewLayouts.map((layout) => ({
    ...layout,
    valueFormula: formulaAt(sheet, layout.value[0], layout.value[1]),
    trendFormula: formulaAt(sheet, layout.trend[0], layout.trend[1]),
    staticValue: cellValue(sheet, layout.value[0], layout.value[1]),
    staticTrend: plainText(cellValue(sheet, layout.trend[0], layout.trend[1])),
    numberFormat: cellNumberFormat(sheet, layout.value[0], layout.value[1]),
    lowerIsBetter: /\b(wages?|labou?r|payroll|costs?)\b/i.test(layout.label),
    sectionId: overviewSectionId(layout.id, sections),
  }));
}

function cellLocationFromReference(reference) {
  const match = plainText(reference).toUpperCase().match(/^\$?([A-Z]{1,3})\$?(\d+)$/);
  if (!match) return null;
  const column = [...match[1]].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
  return { column, row: Number(match[2]) - 1 };
}

function formulaReferences(formula) {
  return plainText(formula).toUpperCase().match(/\$?[A-Z]{1,3}\$?\d+/g) || [];
}

function formulaTerm(sheet, reference, dataRow) {
  const location = cellLocationFromReference(reference);
  if (!location) return null;
  if (location.row === dataRow) return { type: "row", column: location.column };
  const value = cellValue(sheet, location.row, location.column);
  return typeof value === "number" && Number.isFinite(value) ? { type: "number", value } : null;
}

function simpleCalculationForReportCell(sheet, formula, dataRow) {
  const expression = plainText(formula).replace(/^=/, "").replace(/\s+/g, "");
  if (!expression || /XLOOKUP|INDIRECT|XMATCH/i.test(expression)) return null;
  const match = expression.match(/^(\$?[A-Z]{1,3}\$?\d+|[-+]?\d+(?:\.\d+)?)([+\-*/])(\$?[A-Z]{1,3}\$?\d+|[-+]?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const asTerm = (token) => {
    if (/^\$?[A-Z]/i.test(token)) return formulaTerm(sheet, token, dataRow);
    const value = Number(token);
    return Number.isFinite(value) ? { type: "number", value } : null;
  };
  const left = asTerm(match[1]);
  const right = asTerm(match[3]);
  return left && right ? { left, operator: match[2], right } : null;
}

function masterSectionLayouts(reportSheet) {
  const range = window.XLSX.utils.decode_range(reportSheet["!ref"]);
  const usedIds = new Set();
  const layouts = [];
  for (let configRow = range.s.r; configRow <= range.e.r - 5; configRow += 1) {
    if (plainText(cellValue(reportSheet, configRow, 0)).toLowerCase() !== "tab name :") continue;
    const source = plainText(cellValue(reportSheet, configRow, 1));
    const titleRow = configRow + 2;
    const groupRow = configRow + 3;
    const headerRow = configRow + 4;
    const dataStart = configRow + 5;
    const title = plainText(cellValue(reportSheet, titleRow, 0));
    const lastColumn = lastUsedTableColumn(reportSheet, configRow + 1, configRow + 1, range.e.c);
    const columns = lastColumn + 1;
    if (!source || !title || !/\bweek\b/i.test(plainText(cellValue(reportSheet, groupRow, 0))) || columns <= 1) continue;
    const known = knownSectionMetadata(title);
    const id = uniqueIdentifier(known?.id || title, usedIds);
    const layout = {
      id,
      label: known?.label || title,
      accent: known?.accent || dynamicAccentCycle[layouts.length % dynamicAccentCycle.length],
      title,
      source,
      configRow,
      titleRow,
      groupRow,
      headerRow,
      dataStart,
      columns,
    };
    const sourceColumns = Array.from({ length: columns - 1 }, (_, index) => {
      const column = index + 1;
      const formula = formulaAt(reportSheet, dataStart, column);
      const references = formulaReferences(formula);
      const sourceReference = references.find((reference) => cellLocationFromReference(reference)?.row === configRow);
      const fieldReference = references.find((reference) => cellLocationFromReference(reference)?.row === configRow + 1);
      const sourceLocation = sourceReference && cellLocationFromReference(sourceReference);
      const fieldLocation = fieldReference && cellLocationFromReference(fieldReference);
      return {
        source: sourceLocation ? plainText(cellValue(reportSheet, sourceLocation.row, sourceLocation.column)) || source : source,
        field: fieldLocation ? plainText(cellValue(reportSheet, fieldLocation.row, fieldLocation.column)) : plainText(cellValue(reportSheet, configRow + 1, column)),
        calculation: simpleCalculationForReportCell(reportSheet, formula, dataStart),
      };
    });
    layouts.push({
      ...layout,
      headers: headersFromSheet(reportSheet, layout),
      sourceFields: sourceColumns.map(({ field }) => field),
      sourceColumns,
      columnStyles: Array.from({ length: columns - 1 }, (_, index) => cellDisplayStyle(reportSheet, dataStart, index + 1)),
      numberFormats: Array.from({ length: columns - 1 }, (_, index) => cellNumberFormat(reportSheet, dataStart, index + 1)),
    });
  }
  return layouts;
}

function sourceDataForMaster(workbook, definitions, currentWeek) {
  const requiredFields = new Map();
  definitions.forEach((definition) => {
    if (!requiredFields.has(definition.source)) requiredFields.set(definition.source, new Set());
    (definition.sourceColumns || definition.sourceFields.map((field) => ({ source: definition.source, field }))).forEach(({ source, field }) => {
      if (!field) return;
      if (!requiredFields.has(source)) requiredFields.set(source, new Set());
      requiredFields.get(source).add(field);
    });
  });
  const sources = {};
  requiredFields.forEach((fields, sourceName) => {
    const sheet = workbook.Sheets[sourceName];
    if (!sheet?.["!ref"]) throw new Error(`The master workbook is missing the ${sourceName} source tab.`);
    const range = window.XLSX.utils.decode_range(sheet["!ref"]);
    const columns = new Map();
    for (let column = range.s.c; column <= range.e.c; column += 1) {
      const heading = plainText(cellValue(sheet, range.s.r, column));
      if (heading) columns.set(heading, column);
    }
    const dateColumn = columns.get("Date");
    if (dateColumn === undefined) throw new Error(`The ${sourceName} tab needs a Date column.`);
    const values = {};
    for (let row = range.s.r + 1; row <= range.e.r; row += 1) {
      const week = dateFromExcel(cellValue(sheet, row, dateColumn));
      if (!week || week > currentWeek) continue;
      const entry = {};
      fields.forEach((field) => {
        const column = columns.get(field);
        const value = column === undefined ? "Not found" : cellValue(sheet, row, column);
        // XLOOKUP returns zero when it finds an empty source cell, rather than a blank value.
        entry[field] = value == null && column !== undefined ? 0 : value;
      });
      // XLOOKUP returns the first matching date when a source sheet contains duplicates.
      if (!values[week]) values[week] = entry;
    }
    sources[sourceName] = values;
  });
  return sources;
}

function masterReportModelFromWorkbook(workbook, reportSheet) {
  const currentWeek = dateFromExcel(cellValue(reportSheet, 1, 13));
  if (!currentWeek) throw new Error("I could not find the selected week-ending date in Generate Report.");
  const sections = masterSectionLayouts(reportSheet);
  if (!sections.length) throw new Error("I could not find the report configuration rows in this master workbook.");
  const sources = sourceDataForMaster(workbook, sections, currentWeek);
  const availableWeeks = Object.keys(sources[sections[0].source] || {}).sort();
  if (!availableWeeks.includes(currentWeek)) throw new Error("The selected week is not available in the master report data.");
  return {
    type: "larder-master-report",
    version: 1,
    reportTitle: plainText(cellValue(reportSheet, 0, 0)) || "LARDER LICHFIELD | WEEKLY PERFORMANCE REPORT",
    currentWeek,
    availableWeeks,
    overview: overviewCardLayouts(reportSheet, sections).map((layout) => ({
      id: layout.id,
      label: layout.label,
      valueCell: window.XLSX.utils.encode_cell({ r: layout.value[0], c: layout.value[1] }),
      valueFormula: layout.valueFormula,
      trendFormula: layout.trendFormula,
      staticValue: layout.staticValue,
      staticTrend: layout.staticTrend,
      numberFormat: layout.numberFormat,
      lowerIsBetter: layout.lowerIsBetter,
      sectionId: layout.sectionId,
    })),
    sections: sections.map(({ configRow, titleRow, groupRow, headerRow, columns, ...section }) => section),
    sources,
  };
}

function knownSectionMetadata(title) {
  const name = slugify(title);
  const id = name === "sales" ? "sales"
    : /covers.*summary/.test(name) ? "covers"
      : /covers.*lunch/.test(name) ? "lunch"
        : /covers.*dinner/.test(name) ? "dinner"
          : /spend.*head/.test(name) ? "sph"
            : /future.*booking/.test(name) ? "bookings"
              : /gross.*profit.*overall/.test(name) ? "overall-gp"
                : /gross.*profit.*food/.test(name) ? "food-gp"
                  : /gross.*profit.*drink/.test(name) ? "drink-gp"
                    : /total.*wage/.test(name) ? "wages"
                      : /front.*house.*wage/.test(name) ? "foh"
                        : /chef.*wage/.test(name) ? "chefs"
                          : /(kpi|cleaner)/.test(name) ? "cleaners"
                            : /senior.*management/.test(name) ? "senior-management"
                              : "";
  if (id === "senior-management") return { id, label: title, accent: "lilac" };
  return sectionLayouts.find((section) => section.id === id) || null;
}

function uniqueIdentifier(base, used) {
  const safeBase = slugify(base, "section");
  let candidate = safeBase;
  let duplicate = 2;
  while (used.has(candidate)) {
    candidate = `${safeBase}-${duplicate}`;
    duplicate += 1;
  }
  used.add(candidate);
  return candidate;
}

function lastUsedTableColumn(sheet, startRow, endRow, maximumColumn) {
  let lastColumn = 0;
  for (let row = startRow; row <= endRow; row += 1) {
    for (let column = 0; column <= maximumColumn; column += 1) {
      if (plainText(cellValue(sheet, row, column))) lastColumn = Math.max(lastColumn, column);
    }
  }
  return lastColumn;
}

function discoverSectionLayouts(sheet) {
  const range = window.XLSX.utils.decode_range(sheet["!ref"]);
  const layouts = [];
  const usedIds = new Set();
  let row = Math.max(range.s.r, 0);

  while (row <= range.e.r) {
    if (!dateFromExcel(cellValue(sheet, row, 0))) {
      row += 1;
      continue;
    }
    const dataStart = row;
    while (row <= range.e.r && dateFromExcel(cellValue(sheet, row, 0))) row += 1;
    const dataEnd = row - 1;
    const titleRow = dataStart - 3;
    const groupRow = dataStart - 2;
    const headerRow = dataStart - 1;
    const title = plainText(cellValue(sheet, titleRow, 0));
    const hasWeekHeading = /\bweek\b/i.test(plainText(cellValue(sheet, groupRow, 0)));
    const columns = lastUsedTableColumn(sheet, groupRow, dataEnd, range.e.c) + 1;

    if (dataEnd - dataStart >= 1 && title && hasWeekHeading && columns > 1) {
      const known = knownSectionMetadata(title);
      const id = uniqueIdentifier(known?.id || title, usedIds);
      layouts.push({
        id,
        label: known?.label || title,
        accent: known?.accent || dynamicAccentCycle[layouts.length % dynamicAccentCycle.length],
        titleRow,
        groupRow,
        headerRow,
        dataStart,
        dataEnd,
        columns,
      });
    }
  }
  return layouts;
}

function sectionFromSheet(sheet, layout) {
  const headers = headersFromSheet(sheet, layout);
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
  if (localPreviewMode) {
    await loadLocalPermissionsPreview();
    return;
  }
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

async function loadLocalPermissionsPreview() {
  try {
    const response = await fetch("./data/report-data.json", { cache: "no-store" });
    if (!response.ok) throw new Error("The local sample report could not be loaded.");
    localPreviewSource = withOverviewTones(await response.json());
    report = localPreviewSource;
    const viewerView = defaultAccessView(["sales", "covers", "wages"]);
    viewerView.overview.cards = ["sales-inc", "covers", "wages"];
    viewerView.sections.sales.fields = ["1", "4", "5", "6", "7", "8", "9", "10"];
    viewerView.sections.covers.fields = ["1", "2", "3", "4", "5", "6", "7"];
    viewerView.sections.wages.fields = ["1", "2", "3", "4", "5", "6"];
    state = {
      ...state,
      section: "admin",
      week: report.selectedWeek,
      sourceName: "Local preview report",
      availableWeeks: [report.selectedWeek],
      authMode: "authenticated",
      user: { id: "preview-admin", email: "admin@example.com", name: "Admin preview" },
      access: { enabled: true, role: "admin", sections: report.sections.map((section) => section.id), dateAccess: { scope: "all" }, canManageUsers: true, canPublish: true },
      adminUsers: [
        { id: "preview-viewer", name: "Jordan Viewer", email: "jordan@example.com", role: "viewer", enabled: true, sections: ["sales", "covers", "wages"], view: viewerView, dateAccess: { scope: "current" }, isInitialAdmin: false },
        { id: "preview-owner", name: "Morgan Owner", email: "morgan@example.com", role: "owner", enabled: true, sections: report.sections.map((section) => section.id), view: null, dateAccess: { scope: "all" }, isInitialAdmin: false },
      ],
    };
    render();
  } catch (error) {
    authFailure(error.message || "The local permissions preview could not be started.");
  }
}
