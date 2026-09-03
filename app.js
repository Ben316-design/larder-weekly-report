import {
  acceptInvite,
  getUser,
  handleAuthCallback,
  login,
  logout,
  requestPasswordRecovery,
  updateUser,
} from "https://cdn.jsdelivr.net/npm/@netlify/identity@2.0.0/+esm";
import { allowedWeeksForAccess, isMasterReportModel, reportForWeek } from "./report-model.js";

const app = document.querySelector("#app");
const sectionMenu = document.querySelector("#section-menu");
const menuButton = document.querySelector("#menu-button");
const closeMenuButton = document.querySelector("#close-menu");
const drawer = document.querySelector("#menu-drawer");
const drawerBackdrop = document.querySelector("#drawer-backdrop");
const drawerKicker = document.querySelector("#drawer-kicker");
const drawerTitle = document.querySelector("#drawer-title");
const topWeek = document.querySelector("#top-week");
const weekButton = document.querySelector("#week-button");
const uploadInput = document.querySelector("#weekly-report-input");
const budgetInput = document.querySelector("#budget-input");

const sharedReportEndpoint = "/.netlify/functions/report";
const budgetEndpoint = "/.netlify/functions/budget";
const authEndpoint = "/.netlify/functions/auth";
const adminEndpoint = "/.netlify/functions/admin";
const tasksEndpoint = "/.netlify/functions/tasks";
const activityEndpoint = "/.netlify/functions/activity";
const sharedReportPollInterval = 60_000;
const localPreviewMode = location.hostname === "localhost" && new URLSearchParams(location.search).has("local-preview");
const localPreviewMasterStorageKey = "larder-information-hub-local-master-v1";
const lowerIsBetterOverviewIds = new Set(["wages", "foh", "chefs", "senior-management"]);
let report = null;
let state = {
  section: "hub",
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
  taskData: null,
  taskMessage: "",
  menuMode: "report",
  executive: null,
  executivePeriod: "",
  executiveMetricModes: {},
  executiveDetailMetric: "",
  executiveDetailOverlays: [],
  executiveDetailYearScope: "all",
  executiveScenarioOpen: false,
  executiveScenario: null,
  profitPlans: {},
  profitPlanYear: "",
  profitPlanMessage: "",
  profitPlanReviewMonth: "",
  profitPlanBudget: null,
  profitPlanBudgets: {},
  overviewPaceOpen: false,
  budgetSalesAssumptions: {},
  budgetSalesExpandedMonth: "",
  budgetSalesDetailMonth: "",
  budgetSalesProjectionMonth: "",
  budgetSalesWeekProjectionMonth: "",
  budgetSalesGuideOpen: false,
};
let expandedTable = null;
let sharedReportVersion = "";
let reportPolling = null;
let localPreviewSource = null;
let localPreviewModel = null;
let lastActivityKey = "";

function readSavedLocalPreviewMaster() {
  if (!localPreviewMode) return null;
  try {
    const saved = JSON.parse(window.localStorage.getItem(localPreviewMasterStorageKey) || "");
    return isMasterReportModel(saved?.model) ? saved : null;
  } catch (error) {
    return null;
  }
}

function saveLocalPreviewMaster(model, sourceName) {
  if (!localPreviewMode || !isMasterReportModel(model)) return;
  try {
    window.localStorage.setItem(localPreviewMasterStorageKey, JSON.stringify({ model, sourceName, savedAt: new Date().toISOString() }));
  } catch (error) {
    console.warn("The local Master Sheet could not be retained after refresh.", error);
  }
}

function requestedStartSection() {
  return new URLSearchParams(location.search).get("open") === "tasks" ? "tasks" : "hub";
}

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
  return ["admin", "owner"].includes(state.access?.role) && Boolean(state.access?.canManageUsers);
}

function canPublishReport() {
  return ["admin", "owner"].includes(state.access?.role) && Boolean(state.access?.canPublish);
}

function canViewExecutiveDashboard() {
  return canManageUsers() && !state.previewUser;
}

function canViewProfitPlan() {
  return canViewExecutiveDashboard();
}

function renderAuthScreen() {
  const message = state.authMessage ? `<p class="auth-message">${escapeHtml(state.authMessage)}</p>` : "";
  if (state.authMode === "loading") {
    return `<section class="auth-page"><div class="auth-card"><p class="eyebrow">LARDER INFORMATION HUB</p><h2>Preparing your secure hub</h2><p>Checking your sign-in securely.</p></div></section>`;
  }
  if (state.authMode === "forgot") {
    return `<section class="auth-page"><form class="auth-card" data-auth-form="forgot"><p class="eyebrow">ACCOUNT RECOVERY</p><h2>Reset your password</h2><p>Enter your account email and we will send a secure reset link.</p>${message}<label>Email address<input required name="email" type="email" autocomplete="email" placeholder="you@example.com"></label><button class="auth-submit" type="submit">Send reset link</button><button class="auth-link" type="button" data-auth-mode="login">Back to sign in</button></form></section>`;
  }
  if (state.authMode === "reset") {
    return `<section class="auth-page"><form class="auth-card" data-auth-form="reset"><p class="eyebrow">CHOOSE A PASSWORD</p><h2>Set your new password</h2><p>Choose a password with at least 12 characters.</p>${message}<label>New password<input required minlength="12" name="password" type="password" autocomplete="new-password"></label><label>Confirm password<input required minlength="12" name="confirmPassword" type="password" autocomplete="new-password"></label><button class="auth-submit" type="submit">Save new password</button></form></section>`;
  }
  if (state.authMode === "invite") {
    return `<section class="auth-page"><form class="auth-card" data-auth-form="invite"><p class="eyebrow">LARDER INFORMATION HUB</p><h2>Set up your account</h2><p>Create a password to access the information shared with you.</p>${message}<label>New password<input required minlength="12" name="password" type="password" autocomplete="new-password"></label><label>Confirm password<input required minlength="12" name="confirmPassword" type="password" autocomplete="new-password"></label><button class="auth-submit" type="submit">Activate account</button></form></section>`;
  }
  return `<section class="auth-page"><form class="auth-card" data-auth-form="login"><p class="eyebrow">LARDER INFORMATION HUB</p><h2>Sign in to your information hub</h2><p>The information available to you is selected by your account administrator.</p>${message}<label>Email address<input required name="email" type="email" autocomplete="email" placeholder="you@example.com"></label><label>Password<input required name="password" type="password" autocomplete="current-password"></label><button class="auth-submit" type="submit">Sign in</button><button class="auth-link" type="button" data-auth-mode="forgot">Forgot your password?</button></form></section>`;
}

function userFirstName() {
  const name = plainText(state.user?.name);
  if (name) return name.split(/\s+/)[0];
  return plainText(state.user?.email).split("@")[0] || "there";
}

function renderOutstandingTaskAlert(count, className) {
  const total = Math.max(0, Math.floor(Number(count) || 0));
  if (!total) return "";
  return `<span class="${className}" role="status" aria-label="${total} outstanding ${total === 1 ? "task" : "tasks"}"><b>${total}</b><i aria-hidden="true">!</i></span>`;
}

function renderTaskMenuItem(active = false) {
  const outstanding = Number(state.taskData?.outstandingCount || 0);
  return `<button class="menu-item menu-item--tasks ${active ? "is-active" : ""}" data-section="tasks"><span class="menu-item__icon">✓</span><span>My tasks</span>${renderOutstandingTaskAlert(outstanding, "menu-item__task-alert")}<span class="menu-item__chevron">›</span></button>`;
}

function renderHub() {
  const reportAvailable = Boolean(report);
  const outstandingTasks = Number(state.taskData?.outstandingCount || 0);
  return `<section class="hub-page">
    <div class="hub-intro">
      <p class="eyebrow">LARDER INFORMATION HUB</p>
      <h2>Welcome, ${escapeHtml(userFirstName())}</h2>
      <p>Choose an area to view the information tailored for your account.</p>
    </div>
    <section class="hub-menu" aria-label="Information hub menu">
      <button class="hub-menu-card" type="button" data-section="overview">
        <span class="hub-menu-card__icon" aria-hidden="true">▦</span>
        <span><strong>Weekly reports</strong><small>${reportAvailable ? "View your personalised weekly performance report" : "Your weekly report will be available here soon"}</small></span>
        <span class="hub-menu-card__arrow" aria-hidden="true">›</span>
      </button>
      <button class="hub-menu-card hub-menu-card--tasks ${outstandingTasks ? "is-urgent" : ""}" type="button" data-section="tasks">
        <span class="hub-menu-card__icon" aria-hidden="true">✓</span>
        <span><strong>My tasks</strong><small>${outstandingTasks ? `${outstandingTasks} outstanding ${outstandingTasks === 1 ? "task" : "tasks"}` : "View tasks and reminders assigned to you"}</small></span>
        ${renderOutstandingTaskAlert(outstandingTasks, "hub-menu-card__task-alert")}<span class="hub-menu-card__arrow" aria-hidden="true">›</span>
      </button>
      ${canManageUsers() ? `<button class="hub-menu-card hub-menu-card--users" type="button" data-section="users">
        <span class="hub-menu-card__icon" aria-hidden="true">♙</span>
        <span><strong>Users</strong><small>Create accounts, manage sign-in access, and review activity</small></span>
        <span class="hub-menu-card__arrow" aria-hidden="true">›</span>
      </button>` : ""}
      ${canViewExecutiveDashboard() ? `<button class="hub-menu-card hub-menu-card--executive" type="button" data-section="executive">
        <span class="hub-menu-card__icon" aria-hidden="true">↗</span>
        <span><strong>Executive dashboard</strong><small>Explore long-term business performance and the leading indicators ahead</small></span>
        <span class="hub-menu-card__arrow" aria-hidden="true">›</span>
      </button>` : ""}
      ${canViewProfitPlan() ? `<button class="hub-menu-card hub-menu-card--profit-plan" type="button" data-section="profit-plan">
        <span class="hub-menu-card__icon" aria-hidden="true">↟</span>
        <span><strong>Budget &amp; targets</strong><small>Upload the annual budget and track it against weekly results</small></span>
        <span class="hub-menu-card__arrow" aria-hidden="true">›</span>
      </button>` : ""}
    </section>
  </section>`;
}

function formatDateTime(value) {
  if (!value) return "No due date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No due date";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function taskStatusLabel(status) {
  return ({ open: "To do", awaiting_approval: "Awaiting approval", completed: "Completed", declined: "Needs attention" })[status] || "Task";
}

function taskStatusClass(status) {
  return `task-status--${String(status || "open").replace(/[^a-z_]/g, "")}`;
}

function taskPeopleOptions(selected = []) {
  const selectedIds = new Set(selected || []);
  return (state.taskData?.people || []).map((person) => `<label><input type="checkbox" name="watcherIds" value="${escapeHtml(person.id)}" ${selectedIds.has(person.id) ? "checked" : ""}><span>${escapeHtml(person.name)}</span></label>`).join("");
}

function renderTaskCard(task) {
  const currentId = state.user?.id;
  const isAssignee = task.assigneeId === currentId;
  const canReview = (task.creatorId === currentId || state.taskData?.canManageAll) && task.status === "awaiting_approval";
  const recurrence = task.recurrence && task.recurrence !== "none" ? `Repeats ${task.recurrence}` : "One-off task";
  return `<article class="task-card task-card--${escapeHtml(task.status)}">
    <div class="task-card__heading"><span class="task-status ${taskStatusClass(task.status)}">${escapeHtml(taskStatusLabel(task.status))}</span><span class="task-card__due">Due ${escapeHtml(formatDateTime(task.dueAt))}</span></div>
    <h3>${escapeHtml(task.title)}</h3>
    ${task.description ? `<p>${escapeHtml(task.description)}</p>` : ""}
    <dl class="task-card__details"><div><dt>Assigned to</dt><dd>${escapeHtml(task.assigneeName)}</dd></div><div><dt>Set by</dt><dd>${escapeHtml(task.creatorName)}</dd></div><div><dt>Schedule</dt><dd>${escapeHtml(recurrence)}</dd></div>${task.watcherNames?.length ? `<div><dt>Watching</dt><dd>${escapeHtml(task.watcherNames.join(", "))}</dd></div>` : ""}</dl>
    ${task.status === "declined" && task.reviewNote ? `<p class="task-card__note"><strong>Review note:</strong> ${escapeHtml(task.reviewNote)}</p>` : ""}
    ${task.status === "awaiting_approval" && task.completionNote ? `<p class="task-card__note"><strong>Completion note:</strong> ${escapeHtml(task.completionNote)}</p>` : ""}
    ${isAssignee && ["open", "declined"].includes(task.status) ? `<form class="task-complete-form" data-task-form="complete"><input type="hidden" name="taskId" value="${escapeHtml(task.id)}"><label>Completion note <textarea name="completionNote" rows="2" placeholder="Optional update for the task setter"></textarea></label><button type="submit">Mark completed</button></form>` : ""}
    ${canReview ? `<form class="task-review-form" data-task-form="review"><input type="hidden" name="taskId" value="${escapeHtml(task.id)}"><label>Review note <textarea name="reviewNote" rows="2" placeholder="Optional feedback"></textarea></label><div><button type="submit" name="decision" value="approve">Accept completion</button><button class="task-decline-button" type="submit" name="decision" value="decline">Decline</button></div></form>` : ""}
  </article>`;
}

function renderTaskCreator({ page = false } = {}) {
  if (!state.taskData?.canCreate) return "";
  const people = state.taskData.people || [];
  if (!people.length) return `<section class="task-create ${page ? "task-create--page" : ""}"><p>You have permission to set tasks, but no task recipients have been selected for your account yet.</p></section>`;
  const form = `<form data-task-form="create">
    <label>Task title<input required name="title" maxlength="140" placeholder="What needs to be done?"></label>
    <label>Instructions<textarea name="description" rows="3" maxlength="2000" placeholder="Add any useful detail"></textarea></label>
    <label>Assign to<select required name="assigneeId"><option value="">Choose a person</option>${people.map((person) => `<option value="${escapeHtml(person.id)}">${escapeHtml(person.name)}</option>`).join("")}</select></label>
    <label>Due date and time<input required name="dueAt" type="datetime-local"></label>
    <label>Reminder time<input name="reminderAt" type="datetime-local"><small>Optional — an in-app and phone reminder is sent at this time.</small></label>
    <label>Repeat<select name="recurrence"><option value="none">Does not repeat</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select><small>The next task is created when this one is accepted.</small></label>
    <fieldset><legend>Also notify</legend>${taskPeopleOptions()}</fieldset>
    <button class="auth-submit" type="submit">Set task</button>
  </form>`;
  return page ? `<section class="task-create task-create--page">${form}</section>` : `<details class="task-create" open><summary>Set a task</summary>${form}</details>`;
}

function renderSetTask() {
  return `<section class="tasks-page">
    <button class="back-link" type="button" data-section="hub">&larr; Information Hub</button>
    <div class="page-intro"><p class="eyebrow">LARDER INFORMATION HUB</p><h2>Set a task</h2><p>Assign a task, choose its reminders, and decide whether it repeats.</p></div>
    ${renderTaskCreator({ page: true })}
  </section>`;
}

function renderTasks() {
  const taskData = state.taskData;
  if (!taskData) return `<section class="loading">Loading your tasks…</section>`;
  const tasks = taskData.tasks || [];
  const activeTasks = tasks.filter((task) => task.status !== "completed");
  const myTasks = activeTasks.filter((task) => task.assigneeId === state.user?.id && ["open", "declined"].includes(task.status));
  const tasksYouSet = activeTasks.filter((task) => task.creatorId === state.user?.id && task.assigneeId !== state.user?.id && task.status !== "awaiting_approval");
  const allTasksView = Boolean(taskData.canManageAll);
  const awaitingReview = tasks.filter((task) => task.status === "awaiting_approval" && (task.creatorId === state.user?.id || taskData.canManageAll));
  const completed = tasks.filter((task) => task.status === "completed" && (allTasksView || task.assigneeId === state.user?.id || task.creatorId === state.user?.id));
  const notifications = taskData.notifications || [];
  const unreadNotifications = notifications.filter((note) => !note.readAt).length;
  const primaryTasks = allTasksView ? activeTasks : myTasks;
  const primaryLabel = allTasksView ? "All active tasks" : "Tasks for you";
  const primaryEmpty = allTasksView ? "There are no active tasks across the team." : "You have no outstanding tasks.";
  return `<section class="tasks-page">
    <button class="back-link" type="button" data-section="hub">&larr; Information Hub</button>
    <div class="page-intro"><p class="eyebrow">LARDER INFORMATION HUB</p><h2>My tasks</h2><p>${allTasksView ? "See every task set across the team, including the tasks you have created." : "Keep on top of tasks assigned to you and follow the tasks you have set."}</p></div>
    <section class="task-summary"><div><strong>${taskData.outstandingCount || 0}</strong><span>Outstanding</span></div><div><strong>${awaitingReview.length}</strong><span>Awaiting approval</span></div><div class="task-summary__actions">${taskData.canCreate ? '<button type="button" data-section="set-task">Set a task</button>' : ""}<button type="button" data-action="enable-phone-notifications">Enable phone reminders</button></div></section>
    ${state.taskMessage ? `<p class="task-message">${escapeHtml(state.taskMessage)}</p>` : ""}
    <section class="task-list-section"><div class="section-label"><span></span>${primaryLabel}</div>${primaryTasks.length ? `<div class="task-list">${primaryTasks.map(renderTaskCard).join("")}</div>` : `<p class="task-empty">${primaryEmpty}</p>`}</section>
    ${!allTasksView && tasksYouSet.length ? `<section class="task-list-section"><div class="section-label"><span></span>Tasks you have set</div><div class="task-list">${tasksYouSet.map(renderTaskCard).join("")}</div></section>` : ""}
    ${awaitingReview.length ? `<section class="task-list-section"><div class="section-label"><span></span>Ready for your review</div><div class="task-list">${awaitingReview.map(renderTaskCard).join("")}</div></section>` : ""}
    ${completed.length ? `<section class="task-list-section"><div class="section-label"><span></span>Recently completed</div><div class="task-list">${completed.slice(0, 8).map(renderTaskCard).join("")}</div></section>` : ""}
    <section class="task-notifications"><div class="task-notifications__heading"><div class="section-label"><span></span>Updates</div>${unreadNotifications ? `<button type="button" data-action="mark-task-notifications-read">Mark all read</button>` : ""}</div>${notifications.length ? `<div>${notifications.slice(0, 12).map((note) => `<article class="task-notification ${note.readAt ? "" : "is-unread"}"><strong>${escapeHtml(note.title)}</strong><span>${escapeHtml(note.message)}</span><small>${escapeHtml(formatDateTime(note.createdAt))}</small></article>`).join("")}</div>` : '<p class="task-empty">Task updates will appear here.</p>'}</section>
  </section>`;
}

function executiveRows() {
  const data = state.executive;
  if (!data?.rows || !Array.isArray(data.weeks)) return [];
  return data.weeks.map((week) => ({ week, ...data.rows[week] })).filter((row) => row.week);
}

function executiveYears() {
  return [...new Set(executiveRows().map((row) => row.week.slice(0, 4)))].sort();
}

function executiveFinancialYear(week) {
  const year = Number(week.slice(0, 4));
  const month = Number(week.slice(5, 7));
  const startYear = month >= 5 ? year : year - 1;
  return `${startYear}/${String(startYear + 1).slice(-2)}`;
}

function executiveFinancialYears() {
  return [...new Set(executiveRows().map((row) => executiveFinancialYear(row.week)))].sort();
}

function defaultExecutivePeriod() {
  return executiveYears().at(-1) || "all";
}

function executivePeriodGrain() {
  if (state.executiveGrain) return state.executiveGrain;
  if (state.executivePeriod === "latest-13") return "latest-13";
  if (state.executivePeriod === "all") return "all";
  return "year";
}

function executivePeriodOptions(grain = executivePeriodGrain()) {
  const weeks = executiveRows().map((row) => row.week);
  if (grain === "year") return executiveYears().map((year) => ({ value: year, label: `Calendar year ${year}` }));
  if (grain === "financial-year") return executiveFinancialYears().map((year) => ({ value: year, label: `Financial year ${year}` }));
  if (grain === "quarter") {
    return [...new Set(weeks.map((week) => {
      const [year, month] = week.split("-").map(Number);
      return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
    }))].sort().map((value) => {
      const [year, quarter] = value.split("-Q");
      return { value, label: `Q${quarter} ${year}` };
    });
  }
  if (grain === "month") {
    return [...new Set(weeks.map((week) => week.slice(0, 7)))].sort().map((value) => ({ value, label: monthTitle(value) }));
  }
  return [];
}

function executiveSelectedPeriod() {
  const grain = executivePeriodGrain();
  if (grain === "latest-13") return "latest-13";
  if (grain === "all") return "all";
  const options = executivePeriodOptions(grain);
  return options.some((option) => option.value === state.executivePeriod) ? state.executivePeriod : options.at(-1)?.value || defaultExecutivePeriod();
}

function defaultExecutivePeriodForGrain(grain) {
  if (grain === "latest-13" || grain === "all") return grain;
  return executivePeriodOptions(grain).at(-1)?.value || defaultExecutivePeriod();
}

function executivePeriodWeeks() {
  const allWeeks = executiveRows().map((row) => row.week);
  const grain = executivePeriodGrain();
  const period = executiveSelectedPeriod();
  if (grain === "latest-13") return allWeeks.slice(-13);
  if (grain === "all") return allWeeks;
  if (grain === "month") return allWeeks.filter((week) => week.startsWith(`${period}-`));
  if (grain === "financial-year") return allWeeks.filter((week) => executiveFinancialYear(week) === period);
  if (grain === "quarter") return allWeeks.filter((week) => {
    const [year, quarter] = period.split("-Q");
    const month = Number(week.slice(5, 7));
    return week.startsWith(`${year}-`) && Math.floor((month - 1) / 3) + 1 === Number(quarter);
  });
  return allWeeks.filter((week) => week.startsWith(`${period}-`));
}

function executivePeriodTitle() {
  const grain = executivePeriodGrain();
  const period = executiveSelectedPeriod();
  if (grain === "latest-13") return "Latest 13 completed weeks";
  if (grain === "all") return "All available data";
  if (grain === "month") return monthTitle(period);
  if (grain === "quarter") {
    const [year, quarter] = period.split("-Q");
    return `Q${quarter} ${year}`;
  }
  if (grain === "financial-year") {
    if (period === executiveFinancialYears().at(-1)) return `${period} financial year to date`;
    return `Financial year ${period}`;
  }
  if (period === executiveYears().at(-1)) return `${period} reporting year to date`;
  return `Calendar year ${period}`;
}

function executiveValue(row, key) {
  const value = Number(row?.[key]);
  return Number.isFinite(value) ? value : null;
}

function executiveMetric(rows, key, aggregate = "mean") {
  const values = rows.map((row) => executiveValue(row, key)).filter((value) => value !== null);
  if (!values.length) return null;
  return aggregate === "sum" ? values.reduce((total, value) => total + value, 0) : values.reduce((total, value) => total + value, 0) / values.length;
}

function executiveRatioMetric(rows, { numeratorKey, valueKey, denominatorKey, denominatorScale = 1 }) {
  const numerator = executiveMetric(rows, numeratorKey || valueKey, "sum");
  const denominator = executiveMetric(rows, denominatorKey, "sum");
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return numerator / (denominator * denominatorScale);
}

function executiveRowsForWeeks(weeks) {
  const entries = state.executive?.rows || {};
  return weeks.map((week) => ({ week, ...entries[week] })).filter((row) => Object.prototype.hasOwnProperty.call(entries, row.week));
}

const executiveMonthlyFlowKeys = [
  "salesEx", "salesInc", "covers", "foodSalesInc", "drinkSalesInc",
  "overallGpPounds", "adjustedFoodGpPounds", "adjustedDrinkGpPounds",
  "totalWages", "seniorManagementWages", "comps", "expenses", "futureBookings",
];

function executiveMonthlyRows(month, { through = "" } = {}) {
  return executiveRows().map((row) => {
    const { days, share } = budgetWeekMonthAllocation(row.week, month, through);
    if (!days) return null;
    const allocated = { ...row, calendarDaysInMonth: days, calendarDayShare: share };
    executiveMonthlyFlowKeys.forEach((key) => {
      const value = executiveValue(row, key);
      if (Number.isFinite(value)) allocated[key] = value * share;
    });
    return allocated;
  }).filter(Boolean);
}

function executiveRowsForSelectedPeriod() {
  return executivePeriodGrain() === "month"
    ? executiveMonthlyRows(executiveSelectedPeriod())
    : executiveRowsForWeeks(executivePeriodWeeks());
}

function executiveComparableRows(weeks) {
  const entries = state.executive?.rows || {};
  const sameWeeksLastYear = weeks.map((week) => {
    const date = new Date(`${week}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - 364);
    return date.toISOString().slice(0, 10);
  });
  return executiveRowsForWeeks(sameWeeksLastYear).filter((row) => Object.keys(row).length > 1);
}

function executiveComparisonRowsForSelectedPeriod() {
  if (executivePeriodGrain() !== "month") return executiveComparableRows(executivePeriodWeeks());
  const month = executiveSelectedPeriod();
  const currentRows = executiveMonthlyRows(month);
  const latestCoveredDate = currentRows.reduce((latest, row) => {
    const candidate = row.week < budgetMonthEnd(month) ? row.week : budgetMonthEnd(month);
    return !latest || candidate > latest ? candidate : latest;
  }, "");
  if (!latestCoveredDate) return [];
  const priorThrough = new Date(`${latestCoveredDate}T12:00:00Z`);
  priorThrough.setUTCFullYear(priorThrough.getUTCFullYear() - 1);
  return executiveMonthlyRows(shiftMonth(month, -12), { through: priorThrough.toISOString().slice(0, 10) });
}

function executiveFormat(value, kind = "number") {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  if (kind === "currency") return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(value);
  if (kind === "percentage") return new Intl.NumberFormat("en-GB", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);
  if (kind === "decimal") return new Intl.NumberFormat("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(value);
}

function executiveChange(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

function executiveTrend(current, previous, { lowerIsBetter = false, label = "same weeks last year", mode = "relative", kind = "currency" } = {}) {
  const change = mode === "relative" ? executiveChange(current, previous) : Number.isFinite(current) && Number.isFinite(previous) ? current - previous : null;
  if (change === null) return { tone: "neutral", text: "No comparable period" };
  const direction = change > 0 ? "Up" : change < 0 ? "Down" : "Unchanged";
  const good = change === 0 || (lowerIsBetter ? change < 0 : change > 0);
  const amount = mode === "points"
    ? `${(Math.abs(change) * 100).toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
    : mode === "value"
      ? executiveFormat(Math.abs(change), kind)
      : Math.abs(change).toLocaleString("en-GB", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return { tone: change === 0 ? "neutral" : good ? "positive" : "negative", text: `${direction} ${amount} vs ${label}` };
}

function executiveCardMetric(rows, { key, aggregate = "mean", ratio }, showValue) {
  if (!ratio) return executiveMetric(rows, key, aggregate);
  return showValue ? executiveMetric(rows, ratio.valueKey, "sum") : executiveRatioMetric(rows, ratio);
}

function executiveCardDetails({ id, label, key, kind, aggregate = "mean", lowerIsBetter = false, rows, comparisonRows, ratio, ratioTrendMode = "points", basis, valueToggle = false, valueToggleLabel = "£ value", suppressValueToggle = false }) {
  const showValue = Boolean((ratio || valueToggle) && state.executiveMetricModes?.[id] === "value");
  const current = executiveCardMetric(rows, { key, aggregate, ratio }, showValue);
  const previous = executiveCardMetric(comparisonRows, { key, aggregate, ratio }, showValue);
  const trend = comparisonRows.length ? executiveTrend(current, previous, {
    lowerIsBetter,
    mode: ratio ? showValue ? "value" : ratioTrendMode : showValue ? "value" : "relative",
    kind: ratio?.valueKind || kind,
  }) : null;
  return {
    current,
    trend,
    kind: ratio && showValue ? ratio.valueKind || "currency" : kind,
    label: ratio && showValue ? ratio.valueLabel || label : label,
    basis: ratio ? showValue ? "Total for selected period" : basis || "Percentage of sales for selected period" : basis || (aggregate === "sum" ? "Total for selected period" : "Average per reporting week"),
    toggle: valueToggle || (ratio && !suppressValueToggle) ? `<button class="executive-value-toggle" type="button" data-action="toggle-executive-value" data-metric="${escapeHtml(id)}">${showValue ? "Show %" : escapeHtml(valueToggleLabel)}</button>` : "",
  };
}

function renderExecutiveKpi(options) {
  const card = executiveCardDetails(options);
  const interaction = options.id ? `data-action="open-executive-detail" data-metric="${escapeHtml(options.id)}" tabindex="0" role="button" aria-label="View ${escapeHtml(card.label)} through time"` : "";
  return `<article class="executive-kpi executive-metric-card executive-kpi--${card.trend?.tone || "neutral"}" ${interaction}><div class="executive-card-heading"><span>${escapeHtml(card.label)}</span>${card.toggle}</div><strong>${executiveFormat(card.current, card.kind)}</strong><small class="executive-card__basis">${escapeHtml(card.basis)}</small>${card.trend ? `<small class="trend trend--${card.trend.tone}">${escapeHtml(card.trend.text)}</small>` : ""}</article>`;
}

function executiveSvgPath(values, width, height, padding, min, max) {
  const range = max - min || 1;
  const lastIndex = Math.max(1, values.length - 1);
  let path = "";
  let drawing = false;
  values.forEach((value, index) => {
    if (!Number.isFinite(value)) {
      drawing = false;
      return;
    }
    const x = padding + ((width - padding * 2) * index) / lastIndex;
    const y = height - padding - ((value - min) / range) * (height - padding * 2);
    path += `${drawing ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)} `;
    drawing = true;
  });
  return path.trim();
}

function renderExecutiveChart({ title, caption, rows, series, source, normalise = false }) {
  const width = 680;
  const height = 210;
  const padding = 18;
  const plotted = series.map((item) => {
    const values = rows.map((row) => executiveValue(row, item.key));
    if (!normalise) return { ...item, values };
    const finite = values.filter((value) => value !== null);
    const minimum = Math.min(...finite);
    const range = Math.max(...finite) - minimum || 1;
    return { ...item, values: values.map((value) => value === null ? null : (value - minimum) / range) };
  });
  const values = plotted.flatMap((item) => item.values).filter((value) => value !== null);
  if (!values.length) return `<article class="executive-panel executive-panel--chart"><div class="executive-panel__heading"><div><p class="eyebrow">${escapeHtml(source)}</p><h3>${escapeHtml(title)}</h3></div></div><p class="executive-empty">There is not enough data in this period to draw this trend.</p></article>`;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const gridLines = [0.15, 0.5, 0.85].map((ratio) => `<line x1="${padding}" x2="${width - padding}" y1="${(height * ratio).toFixed(1)}" y2="${(height * ratio).toFixed(1)}" />`).join("");
  return `<article class="executive-panel executive-panel--chart"><div class="executive-panel__heading"><div><p class="eyebrow">${escapeHtml(source)}</p><h3>${escapeHtml(title)}</h3></div><div class="executive-legend">${plotted.map((item) => `<span><i style="--series-colour:${item.colour}"></i>${escapeHtml(item.label)}</span>`).join("")}</div></div><svg class="executive-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)} trend chart"><g class="executive-chart__grid">${gridLines}</g>${plotted.map((item) => `<path d="${executiveSvgPath(item.values, width, height, padding, min, max)}" style="--series-colour:${item.colour}"></path>`).join("")}</svg><p class="executive-panel__caption">${escapeHtml(caption)}</p></article>`;
}

function executiveCumulativeSeries(key) {
  const byYear = new Map();
  executiveRows().forEach((row) => {
    const year = row.week.slice(0, 4);
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push(executiveValue(row, key));
  });
  const colours = ["#b89221", "#8cae97", "#8a6558", "#171714"];
  return [...byYear.entries()].slice(-4).map(([year, values], index, years) => {
    let total = 0;
    return { label: year, key: "", colour: colours[colours.length - years.length + index] || "#b89221", values: values.map((value) => { total += value || 0; return total; }) };
  });
}

function renderExecutiveCumulativeChart() {
  const width = 680;
  const height = 220;
  const padding = 18;
  const series = executiveCumulativeSeries("salesEx");
  const values = series.flatMap((item) => item.values).filter(Number.isFinite);
  if (!values.length) return "";
  const min = 0;
  const max = Math.max(...values);
  return `<article class="executive-panel executive-panel--wide executive-panel--chart"><div class="executive-panel__heading"><div><p class="eyebrow">ALL SALES</p><h3>Cumulative turnover</h3></div><div class="executive-legend">${series.map((item) => `<span><i style="--series-colour:${item.colour}"></i>${item.label}</span>`).join("")}</div></div><svg class="executive-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Cumulative sales ex VAT by year"><g class="executive-chart__grid"><line x1="${padding}" x2="${width - padding}" y1="${height * .18}" y2="${height * .18}" /><line x1="${padding}" x2="${width - padding}" y1="${height * .5}" y2="${height * .5}" /><line x1="${padding}" x2="${width - padding}" y1="${height * .82}" y2="${height * .82}" /></g>${series.map((item) => `<path d="${executiveSvgPath(item.values, width, height, padding, min, max)}" style="--series-colour:${item.colour}"></path>`).join("")}</svg><p class="executive-panel__caption">Calendar years are overlaid by week, so the current year can be compared with the same stage of each previous year.</p></article>`;
}

function renderExecutiveDriver(options) {
  const card = executiveCardDetails(options);
  const interaction = options.id ? `data-action="open-executive-detail" data-metric="${escapeHtml(options.id)}" tabindex="0" role="button" aria-label="View ${escapeHtml(card.label)} through time"` : "";
  return `<article class="executive-driver executive-metric-card executive-driver--${card.trend?.tone || "neutral"}" ${interaction}><div class="executive-card-heading"><span>${escapeHtml(card.label)}</span>${card.toggle}</div><strong>${executiveFormat(card.current, card.kind)}</strong><small class="executive-card__basis">${escapeHtml(card.basis)}</small>${card.trend ? `<small class="trend trend--${card.trend.tone}">${escapeHtml(card.trend.text)}</small>` : ""}</article>`;
}

const executiveMeasureDefinitions = [
  { id: "sales-ex", label: "Sales ex VAT", key: "salesEx", kind: "currency", aggregate: "sum", basis: "Total for selected period", valueToggle: true, valueToggleLabel: "£ change" },
  { id: "total-covers", label: "Total covers", key: "covers", kind: "number", aggregate: "sum", basis: "Total covers in selected period" },
  { id: "spend-per-head", label: "Average spend per head", kind: "currency", ratio: { valueKey: "salesInc", denominatorKey: "covers", valueKind: "currency", valueLabel: "Sales inc VAT" }, ratioTrendMode: "relative", basis: "Sales inc VAT ÷ covers", suppressValueToggle: true },
  { id: "overall-gp", label: "Overall GP", kind: "percentage", ratio: { valueKey: "overallGpPounds", denominatorKey: "salesEx", valueKind: "currency", valueLabel: "Overall GP" } },
  { id: "total-wages", label: "Total wages as % of sales", kind: "percentage", ratio: { valueKey: "totalWages", denominatorKey: "salesEx", valueKind: "currency", valueLabel: "Total wages" }, lowerIsBetter: true },
  { id: "future-bookings", label: "Future bookings", key: "futureBookings", kind: "number", aggregate: "sum", basis: "Total bookings recorded in selected period" },
  { id: "adjusted-food-gp", label: "Food GP (adjusted)", kind: "percentage", ratio: { valueKey: "adjustedFoodGpPounds", denominatorKey: "foodSalesInc", denominatorScale: 1 / 1.2, valueKind: "currency", valueLabel: "Food GP (adjusted)" } },
  { id: "adjusted-drink-gp", label: "Drink GP (adjusted)", kind: "percentage", ratio: { valueKey: "adjustedDrinkGpPounds", denominatorKey: "drinkSalesInc", denominatorScale: 1 / 1.2, valueKind: "currency", valueLabel: "Drink GP (adjusted)" } },
  { id: "senior-management-wages", label: "Senior management wages", kind: "percentage", ratio: { valueKey: "seniorManagementWages", denominatorKey: "salesEx", valueKind: "currency", valueLabel: "Senior management wages" }, lowerIsBetter: true },
  { id: "comps", label: "Comps as % of sales", kind: "percentage", ratio: { valueKey: "comps", denominatorKey: "salesEx", valueKind: "currency", valueLabel: "Comps" }, lowerIsBetter: true },
  { id: "expenses", label: "Operating expenses", key: "expenses", kind: "currency", aggregate: "sum", basis: "Total for selected period", lowerIsBetter: true },
];

function executiveMeasureDefinition(id) {
  return executiveMeasureDefinitions.find((measure) => measure.id === id) || null;
}

function executiveMeasureDisplay(rows, measure) {
  const showValue = Boolean(measure?.ratio && state.executiveMetricModes?.[measure.id] === "value");
  return {
    value: executiveCardMetric(rows, measure || {}, showValue),
    kind: measure?.ratio && showValue ? measure.ratio.valueKind || "currency" : measure?.kind || "number",
    label: measure?.ratio && showValue ? measure.ratio.valueLabel || measure.label : measure?.label || "Metric",
    isPercentage: Boolean(measure?.ratio && !showValue),
  };
}

function executiveDetailWindow() {
  const allWeeks = executiveRows().map((row) => row.week);
  if (executivePeriodGrain() === "all") {
    const latestYear = allWeeks.at(-1)?.slice(0, 4);
    return { weeks: allWeeks.filter((week) => week.startsWith(`${latestYear}-`)), title: `${latestYear} reporting year to date`, fromAllData: true };
  }
  return { weeks: executivePeriodWeeks(), title: executivePeriodTitle(), fromAllData: false };
}

function executiveOffsetWeek(week, yearsBack) {
  const date = new Date(`${week}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (364 * yearsBack));
  return date.toISOString().slice(0, 10);
}

function executiveSameWeekSets() {
  const window = executiveDetailWindow();
  const entries = state.executive?.rows || {};
  if (executivePeriodGrain() === "month") {
    const month = executiveSelectedPeriod();
    const currentRows = executiveMonthlyRows(month);
    const latestCoveredDate = currentRows.reduce((latest, row) => {
      const candidate = row.week < budgetMonthEnd(month) ? row.week : budgetMonthEnd(month);
      return !latest || candidate > latest ? candidate : latest;
    }, "");
    if (!latestCoveredDate) return { ...window, sets: [] };
    const sets = [];
    for (let yearsBack = 0; yearsBack < 5; yearsBack += 1) {
      const period = shiftMonth(month, -12 * yearsBack);
      const through = new Date(`${latestCoveredDate}T12:00:00Z`);
      through.setUTCFullYear(through.getUTCFullYear() - yearsBack);
      const rows = executiveMonthlyRows(period, { through: through.toISOString().slice(0, 10) });
      if (!rows.length) break;
      sets.push({
        year: period.slice(0, 4),
        weeks: rows.map((row) => row.week),
        rows,
        label: yearsBack === 0 ? window.title : monthTitle(period),
        availableWeekCount: rows.length,
        missingWeekCount: 0,
      });
    }
    return { ...window, sets };
  }
  if (!window.weeks.length) return { ...window, sets: [] };
  const sets = [];
  for (let yearsBack = 0; yearsBack < 5; yearsBack += 1) {
    const weeks = window.weeks.map((week) => executiveOffsetWeek(week, yearsBack));
    const rows = weeks.map((week) => Object.prototype.hasOwnProperty.call(entries, week) ? { week, ...entries[week] } : null).filter(Boolean);
    if (!rows.length) break;
    const year = weeks.at(-1).slice(0, 4);
    const label = yearsBack === 0
      ? window.title
      : window.title === "Latest 13 completed weeks"
        ? `${year} matching 13 weeks`
        : window.title.replace(/\b\d{4}\b/g, year);
    sets.push({ year, weeks, rows, label, availableWeekCount: rows.length, missingWeekCount: window.weeks.length - rows.length });
  }
  return { ...window, sets };
}

function renderExecutiveOverlayChart(measures, rows) {
  const colours = ["#b95246", "#315640", "#b89221", "#6860a5"];
  const plotted = measures.map((measure, index) => {
    const values = rows.map((row) => executiveMeasureDisplay([row], measure).value);
    const finite = values.filter((value) => Number.isFinite(value));
    const minimum = Math.min(...finite);
    const range = Math.max(...finite) - minimum || 1;
    return { label: executiveMeasureDisplay(rows, measure).label, colour: colours[index % colours.length], values: values.map((value) => Number.isFinite(value) ? (value - minimum) / range : null) };
  });
  const values = plotted.flatMap((series) => series.values).filter((value) => value !== null);
  if (!values.length) return `<article class="executive-panel executive-panel--chart"><p class="executive-empty">There is not enough data in this comparison window to draw a trend.</p></article>`;
  const width = 680;
  const height = 210;
  const padding = 18;
  const gridLines = [0.15, 0.5, 0.85].map((ratio) => `<line x1="${padding}" x2="${width - padding}" y1="${(height * ratio).toFixed(1)}" y2="${(height * ratio).toFixed(1)}" />`).join("");
  return `<article class="executive-panel executive-panel--chart executive-detail-chart"><div class="executive-panel__heading"><div><p class="eyebrow">SELECTED COMPARISON WINDOW</p><h3>Weekly movement</h3></div><div class="executive-legend">${plotted.map((series) => `<span><i style="--series-colour:${series.colour}"></i>${escapeHtml(series.label)}</span>`).join("")}</div></div><svg class="executive-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Weekly movement of selected executive measures"><g class="executive-chart__grid">${gridLines}</g>${plotted.map((series) => `<path d="${executiveSvgPath(series.values, width, height, padding, 0, 1)}" style="--series-colour:${series.colour}"></path>`).join("")}</svg><p class="executive-panel__caption">Each line is scaled to its own range, so different measures can be compared by direction and timing. Use the figures above for the actual values.</p></article>`;
}

function renderExecutiveMeasureDetail() {
  const primary = executiveMeasureDefinition(state.executiveDetailMetric);
  if (!primary) return "";
  const comparison = executiveSameWeekSets();
  const sets = state.executiveDetailYearScope === "previous" ? comparison.sets.slice(0, 2) : comparison.sets;
  if (!sets.length) return "";
  const overlays = (state.executiveDetailOverlays || []).map(executiveMeasureDefinition).filter(Boolean).filter((measure) => measure.id !== primary.id);
  const measures = [primary, ...overlays];
  const current = executiveMeasureDisplay(sets[0].rows, primary);
  const overlayOptions = executiveMeasureDefinitions.filter((measure) => measure.id !== primary.id && !overlays.some((overlay) => overlay.id === measure.id));
  return `<section class="executive-detail" id="executive-detail"><div class="executive-detail__heading"><div><p class="eyebrow">METRIC DETAIL</p><h3>${escapeHtml(current.label)} through time</h3><p>${comparison.fromAllData ? `Using the latest ${comparison.title} window—not the combined all-time total.` : `Using ${comparison.title.toLowerCase()}.`} Comparisons use available matching reporting weeks; coverage is shown on each year.</p></div><button class="executive-detail__close" type="button" data-action="close-executive-detail">Close</button></div><div class="executive-detail__year-cards">${sets.map((set, index) => {
    const display = executiveMeasureDisplay(set.rows, primary);
    const trend = index ? executiveTrend(display.value, current.value, { mode: display.isPercentage ? "points" : "value", kind: display.kind, lowerIsBetter: primary.lowerIsBetter, label: `${sets[0].year} same weeks` }) : null;
    const coverage = `${set.availableWeekCount} of ${comparison.weeks.length} matching weeks`;
    return `<article class="executive-detail__year ${index === 0 ? "is-current" : ""}"><span>${escapeHtml(set.label)}</span><strong>${executiveFormat(display.value, display.kind)}</strong><small>${index === 0 ? `${set.availableWeekCount} reporting weeks` : `${escapeHtml(trend?.text || "No comparable period")} · ${coverage}`}</small></article>`;
  }).join("")}</div><div class="executive-detail__controls"><label>Compare years<select data-action="executive-detail-year-scope"><option value="all" ${state.executiveDetailYearScope === "all" ? "selected" : ""}>All comparable years</option><option value="previous" ${state.executiveDetailYearScope === "previous" ? "selected" : ""}>Previous year only</option></select></label><label>Overlay another measure<select data-action="executive-detail-overlay"><option value="">Choose a measure…</option>${overlayOptions.map((measure) => `<option value="${escapeHtml(measure.id)}">${escapeHtml(measure.label)}</option>`).join("")}</select></label>${overlays.length ? `<div class="executive-detail__overlays">${overlays.map((measure) => `<span>${escapeHtml(executiveMeasureDisplay(sets[0].rows, measure).label)}<button type="button" data-action="remove-executive-overlay" data-metric="${escapeHtml(measure.id)}" aria-label="Remove ${escapeHtml(measure.label)}">×</button></span>`).join("")}</div>` : '<p>Select one or more measures to overlay their weekly movement.</p>'}</div>${overlays.length ? `<div class="executive-detail__overlay-figures">${overlays.map((measure) => {
    const display = executiveMeasureDisplay(sets[0].rows, measure);
    const prior = sets[1] ? executiveMeasureDisplay(sets[1].rows, measure) : null;
    const trend = prior ? executiveTrend(display.value, prior.value, { mode: display.isPercentage ? "points" : "value", kind: display.kind, lowerIsBetter: measure.lowerIsBetter, label: `${sets[1].year} same weeks` }) : null;
    return `<article><span>${escapeHtml(display.label)}</span><strong>${executiveFormat(display.value, display.kind)}</strong><small>${escapeHtml(trend?.text || "Current comparison window")}</small></article>`;
  }).join("")}</div>` : ""}${renderExecutiveOverlayChart(measures, sets[0].rows)}</section>`;
}

function executiveScenarioKey() {
  return `${executivePeriodGrain()}:${executiveSelectedPeriod()}`;
}

function executiveScenarioBaseline(rows) {
  const sales = executiveMetric(rows, "salesEx", "sum");
  const covers = executiveMetric(rows, "covers", "sum");
  const spendPerHead = executiveRatioMetric(rows, { numeratorKey: "salesInc", denominatorKey: "covers" });
  const grossProfit = executiveMetric(rows, "overallGpPounds", "sum");
  const wages = executiveMetric(rows, "totalWages", "sum");
  const foodSalesEx = executiveMetric(rows, "foodSalesInc", "sum") / 1.2;
  const drinkSalesEx = executiveMetric(rows, "drinkSalesInc", "sum") / 1.2;
  const foodGrossProfit = executiveMetric(rows, "adjustedFoodGpPounds", "sum");
  const drinkGrossProfit = executiveMetric(rows, "adjustedDrinkGpPounds", "sum");
  const hasFoodDrinkGp = [foodSalesEx, drinkSalesEx, foodGrossProfit, drinkGrossProfit].every(Number.isFinite) && foodSalesEx > 0 && drinkSalesEx > 0;
  if (![sales, covers, spendPerHead, grossProfit, wages].every(Number.isFinite) || sales <= 0 || covers <= 0 || spendPerHead <= 0) return null;
  return {
    sales,
    covers,
    reportingWeeks: rows.length,
    spendPerHead,
    grossProfit,
    grossProfitPercent: grossProfit / sales,
    hasFoodDrinkGp,
    foodSalesEx,
    drinkSalesEx,
    foodGrossProfit,
    drinkGrossProfit,
    foodGpPercent: hasFoodDrinkGp ? foodGrossProfit / foodSalesEx : null,
    drinkGpPercent: hasFoodDrinkGp ? drinkGrossProfit / drinkSalesEx : null,
    otherGrossProfit: hasFoodDrinkGp ? grossProfit - foodGrossProfit - drinkGrossProfit : null,
    wages,
    wagesPercent: wages / sales,
    gpAfterWages: grossProfit - wages,
  };
}

function defaultExecutiveScenario(baseline) {
  return {
    periodKey: executiveScenarioKey(),
    covers: baseline.covers,
    coversMode: "total",
    coversWeeklyAdjustment: 0,
    spendPerHead: baseline.spendPerHead,
    grossProfitPercent: baseline.grossProfitPercent,
    gpCalculationMode: "overall",
    foodGpPercent: baseline.foodGpPercent,
    drinkGpPercent: baseline.drinkGpPercent,
    wagesPercent: baseline.wagesPercent,
    grossProfitMode: "percentage",
    wagesMode: "percentage",
  };
}

function executiveScenarioForRows(rows) {
  const baseline = executiveScenarioBaseline(rows);
  if (!baseline) return { baseline: null, scenario: null };
  const defaultScenario = defaultExecutiveScenario(baseline);
  const scenario = state.executiveScenario?.periodKey === executiveScenarioKey()
    ? { ...defaultScenario, ...state.executiveScenario }
    : defaultScenario;
  return { baseline, scenario };
}

function executiveScenarioMetrics(baseline, scenario) {
  const covers = Math.max(0, scenario.coversMode === "per-week"
    ? baseline.covers + (scenario.coversWeeklyAdjustment || 0) * baseline.reportingWeeks
    : scenario.covers);
  const coverFactor = covers / baseline.covers;
  const spendFactor = scenario.spendPerHead / baseline.spendPerHead;
  const salesFactor = coverFactor * spendFactor;
  const sales = baseline.sales * coverFactor * spendFactor;
  const foodGrossProfit = baseline.hasFoodDrinkGp ? baseline.foodSalesEx * salesFactor * scenario.foodGpPercent : null;
  const drinkGrossProfit = baseline.hasFoodDrinkGp ? baseline.drinkSalesEx * salesFactor * scenario.drinkGpPercent : null;
  const grossProfit = scenario.gpCalculationMode === "separate" && baseline.hasFoodDrinkGp
    ? foodGrossProfit + drinkGrossProfit + baseline.otherGrossProfit * salesFactor
    : sales * scenario.grossProfitPercent;
  const wages = sales * scenario.wagesPercent;
  return {
    sales,
    covers,
    spendPerHead: scenario.spendPerHead,
    grossProfit,
    grossProfitPercent: grossProfit / sales,
    foodGrossProfit,
    drinkGrossProfit,
    foodGpPercent: baseline.hasFoodDrinkGp ? foodGrossProfit / (baseline.foodSalesEx * salesFactor) : null,
    drinkGpPercent: baseline.hasFoodDrinkGp ? drinkGrossProfit / (baseline.drinkSalesEx * salesFactor) : null,
    wages,
    wagesPercent: scenario.wagesPercent,
    gpAfterWages: grossProfit - wages,
  };
}

function executiveScenarioInputValue(value, decimals = 2) {
  return Number.isFinite(value) ? Number(value).toFixed(decimals) : "";
}

function renderExecutiveScenarioResult({ label, value, baseline, kind = "currency", lowerIsBetter = false, supportingText = "" }) {
  const trend = executiveTrend(value, baseline, { mode: kind === "percentage" ? "points" : "value", kind, lowerIsBetter, label: "selected period" });
  const compactTrend = trend.tone === "neutral" ? "No change" : trend.text.replace(/\s+vs selected period$/, "");
  return `<article class="executive-scenario__result executive-scenario__result--${trend.tone}"><span>${escapeHtml(label)}</span><strong>${executiveFormat(value, kind)}</strong>${supportingText ? `<small>${escapeHtml(supportingText)}</small>` : ""}<small class="trend trend--${trend.tone}">${escapeHtml(compactTrend)}</small></article>`;
}

function renderExecutiveScenarioPlanner(rows) {
  if (!state.executiveScenarioOpen) return "";
  const { baseline, scenario } = executiveScenarioForRows(rows);
  if (!baseline || !scenario) return "";
  const metrics = executiveScenarioMetrics(baseline, scenario);
  const gpInput = scenario.grossProfitMode === "value" ? metrics.grossProfit : metrics.grossProfitPercent * 100;
  const wagesInput = scenario.wagesMode === "value" ? metrics.wages : metrics.wagesPercent * 100;
  const gpUnit = scenario.grossProfitMode === "value" ? "£ value" : "% of sales";
  const wagesUnit = scenario.wagesMode === "value" ? "£ value" : "% of sales";
  return `<section class="executive-scenario" id="executive-scenario" aria-label="Scenario planner"><div class="executive-scenario__heading"><div><p class="eyebrow">SCENARIO PLANNER</p><h3>Test a change before it happens</h3><p>Start with the selected period, adjust an assumption, and see the linked sales, margin and wage effect. This does not change the report or your spreadsheet.</p></div><button type="button" data-action="close-executive-scenario">Close</button></div><div class="executive-scenario__inputs"><label>Sales ex VAT<input type="number" inputmode="decimal" min="0" step="1" data-action="edit-executive-scenario" data-field="sales" value="${executiveScenarioInputValue(metrics.sales, 0)}" /><small>Changing sales recalculates spend per head.</small></label><label>Total covers<input type="number" inputmode="numeric" min="0" step="1" data-action="edit-executive-scenario" data-field="covers" value="${executiveScenarioInputValue(scenario.covers, 0)}" /></label><label>Average spend per head<input type="number" inputmode="decimal" min="0" step="0.01" data-action="edit-executive-scenario" data-field="spendPerHead" value="${executiveScenarioInputValue(scenario.spendPerHead)}" /></label><label>Overall GP mode<select data-action="set-executive-scenario-mode" data-field="grossProfit"><option value="percentage" ${scenario.grossProfitMode === "percentage" ? "selected" : ""}>Percentage of sales</option><option value="value" ${scenario.grossProfitMode === "value" ? "selected" : ""}>£ value</option></select><input type="number" inputmode="decimal" min="0" step="${scenario.grossProfitMode === "value" ? "1" : "0.1"}" data-action="edit-executive-scenario" data-field="grossProfit" value="${executiveScenarioInputValue(gpInput, scenario.grossProfitMode === "value" ? 0 : 1)}" /><small>${gpUnit}</small></label><label>Total wages mode<select data-action="set-executive-scenario-mode" data-field="wages"><option value="percentage" ${scenario.wagesMode === "percentage" ? "selected" : ""}>Percentage of sales</option><option value="value" ${scenario.wagesMode === "value" ? "selected" : ""}>£ value</option></select><input type="number" inputmode="decimal" min="0" step="${scenario.wagesMode === "value" ? "1" : "0.1"}" data-action="edit-executive-scenario" data-field="wages" value="${executiveScenarioInputValue(wagesInput, scenario.wagesMode === "value" ? 0 : 1)}" /><small>${wagesUnit}</small></label></div><div class="executive-scenario__footer"><p>Future bookings are intentionally excluded: this is an operating scenario, not a booking forecast.</p><div><button type="button" data-action="apply-executive-scenario">Apply scenario</button><button type="button" data-action="reset-executive-scenario">Reset to selected period</button></div></div><div class="executive-scenario__results"><p>SCENARIO RESULT</p><div>${renderExecutiveScenarioResult({ label: "Sales ex VAT", value: metrics.sales, baseline: baseline.sales })}${renderExecutiveScenarioResult({ label: "Total covers", value: metrics.covers, baseline: baseline.covers, kind: "number" })}${renderExecutiveScenarioResult({ label: "Average spend per head", value: metrics.spendPerHead, baseline: baseline.spendPerHead })}${renderExecutiveScenarioResult({ label: "Overall GP", value: metrics.grossProfit, baseline: baseline.grossProfit, supportingText: `${executiveFormat(metrics.grossProfitPercent, "percentage")} of sales` })}${renderExecutiveScenarioResult({ label: "Total wages", value: metrics.wages, baseline: baseline.wages, lowerIsBetter: true, supportingText: `${executiveFormat(metrics.wagesPercent, "percentage")} of sales` })}${renderExecutiveScenarioResult({ label: "GP after wages", value: metrics.gpAfterWages, baseline: baseline.gpAfterWages, supportingText: "Gross profit less total wages" })}</div></div></section>`;
}

function renderExecutiveScenarioPlannerV2(rows) {
  if (!state.executiveScenarioOpen) return "";
  const { baseline, scenario } = executiveScenarioForRows(rows);
  if (!baseline || !scenario) return "";

  const metrics = executiveScenarioMetrics(baseline, scenario);
  const gpInput = scenario.grossProfitMode === "value" ? metrics.grossProfit : metrics.grossProfitPercent * 100;
  const wagesInput = scenario.wagesMode === "value" ? metrics.wages : metrics.wagesPercent * 100;
  const coversPerWeek = scenario.coversMode === "per-week";
  const coversInput = coversPerWeek ? scenario.coversWeeklyAdjustment : scenario.covers;
  const additionalCovers = Math.round(metrics.covers - baseline.covers);
  const coversExplanation = coversPerWeek
    ? `${additionalCovers >= 0 ? "+" : ""}${additionalCovers.toLocaleString("en-GB")} covers across ${baseline.reportingWeeks} reporting weeks (${Math.round(metrics.covers).toLocaleString("en-GB")} total).`
    : `${Math.round(metrics.covers).toLocaleString("en-GB")} covers across ${baseline.reportingWeeks} reporting weeks.`;
  const moneyInput = (field, value, decimals = 0) => `<div class="executive-scenario__money-field"><span aria-hidden="true">£</span><input type="number" inputmode="decimal" min="0" step="${decimals ? "0.01" : "1"}" data-action="edit-executive-scenario" data-field="${field}" value="${executiveScenarioInputValue(value, decimals)}" /></div>`;

  return `<section class="executive-scenario" id="executive-scenario" aria-label="Scenario planner">
    <header class="executive-scenario__heading">
      <div>
        <p class="eyebrow">SCENARIO PLANNER</p>
        <h3>Test a change before it happens</h3>
        <p>Change one or more assumptions for the selected period. The planner recalculates the linked sales, gross profit and wage effect without changing the report or your spreadsheet.</p>
      </div>
      <button type="button" data-action="close-executive-scenario">Close</button>
    </header>

    <div class="executive-scenario__groups">
      <section class="executive-scenario__group">
        <p class="executive-scenario__group-title">Sales drivers</p>
        <div class="executive-scenario__inputs">
          <label class="executive-scenario__input">
            <span>Adjust covers</span>
            <select data-action="set-executive-scenario-mode" data-field="covers">
              <option value="total" ${!coversPerWeek ? "selected" : ""}>Set total for period</option>
              <option value="per-week" ${coversPerWeek ? "selected" : ""}>Add/remove per reporting week</option>
            </select>
          </label>
          <label class="executive-scenario__input">
            <span>${coversPerWeek ? "Extra covers per reporting week" : "Total covers for this period"}</span>
            <input type="number" inputmode="numeric" ${coversPerWeek ? "" : "min=\"0\""} step="1" data-action="edit-executive-scenario" data-field="covers" value="${executiveScenarioInputValue(coversInput, 0)}" />
            <small>${coversExplanation}</small>
          </label>
          <label class="executive-scenario__input">
            <span>Average spend per head</span>
            ${moneyInput("spendPerHead", scenario.spendPerHead, 2)}
            <small>Changing this moves sales in line with the new spend per head.</small>
          </label>
          <label class="executive-scenario__input executive-scenario__input--wide">
            <span>Sales ex VAT target (optional)</span>
            ${moneyInput("sales", metrics.sales)}
            <small>Use this instead of changing spend per head if you know the sales figure you want to test.</small>
          </label>
        </div>
      </section>

      <section class="executive-scenario__group">
        <p class="executive-scenario__group-title">Margin &amp; labour</p>
        <div class="executive-scenario__inputs">
          <label class="executive-scenario__input">
            <span>Overall GP</span>
            <div class="executive-scenario__field-row">
              <select data-action="set-executive-scenario-mode" data-field="grossProfit">
                <option value="percentage" ${scenario.grossProfitMode === "percentage" ? "selected" : ""}>% of sales</option>
                <option value="value" ${scenario.grossProfitMode === "value" ? "selected" : ""}>£ value</option>
              </select>
              ${scenario.grossProfitMode === "value" ? moneyInput("grossProfit", gpInput) : `<input type="number" inputmode="decimal" min="0" step="0.1" data-action="edit-executive-scenario" data-field="grossProfit" value="${executiveScenarioInputValue(gpInput, 1)}" />`}
            </div>
            <small>${scenario.grossProfitMode === "value" ? "The £ figure is converted to a GP percentage when sales change." : "Set the gross profit percentage to test."}</small>
          </label>
          ${baseline.hasFoodDrinkGp ? `<div class="executive-scenario__gp-breakdown">
            <p>Food &amp; drink GP (optional)</p>
            <div>
              <label>
                <span>Food GP (% of food sales)</span>
                <input type="number" inputmode="decimal" min="0" step="0.1" data-action="edit-executive-scenario" data-field="foodGrossProfit" value="${executiveScenarioInputValue(scenario.foodGpPercent * 100, 1)}" />
              </label>
              <label>
                <span>Drink GP (% of drink sales)</span>
                <input type="number" inputmode="decimal" min="0" step="0.1" data-action="edit-executive-scenario" data-field="drinkGrossProfit" value="${executiveScenarioInputValue(scenario.drinkGpPercent * 100, 1)}" />
              </label>
            </div>
            <small>Changing either figure recalculates Overall GP using the current food and drink sales mix.</small>
          </div>` : ""}
          <label class="executive-scenario__input">
            <span>Total wages</span>
            <div class="executive-scenario__field-row">
              <select data-action="set-executive-scenario-mode" data-field="wages">
                <option value="percentage" ${scenario.wagesMode === "percentage" ? "selected" : ""}>% of sales</option>
                <option value="value" ${scenario.wagesMode === "value" ? "selected" : ""}>£ value</option>
              </select>
              ${scenario.wagesMode === "value" ? moneyInput("wages", wagesInput) : `<input type="number" inputmode="decimal" min="0" step="0.1" data-action="edit-executive-scenario" data-field="wages" value="${executiveScenarioInputValue(wagesInput, 1)}" />`}
            </div>
            <small>${scenario.wagesMode === "value" ? "The £ figure is converted to a wage percentage when sales change." : "Set total wages as a percentage of sales."}</small>
          </label>
        </div>
      </section>
    </div>

    <div class="executive-scenario__footer">
      <p>Future bookings are excluded: this is an operating scenario, not a booking forecast.</p>
      <div><button type="button" data-action="apply-executive-scenario">Apply scenario</button><button type="button" data-action="reset-executive-scenario">Reset to selected period</button></div>
    </div>

    <section class="executive-scenario__results" aria-label="Scenario result">
      <p>What changes</p>
      <div>${renderExecutiveScenarioResult({ label: "Sales ex VAT", value: metrics.sales, baseline: baseline.sales })}${renderExecutiveScenarioResult({ label: "Total covers", value: metrics.covers, baseline: baseline.covers, kind: "number" })}${renderExecutiveScenarioResult({ label: "Average spend per head", value: metrics.spendPerHead, baseline: baseline.spendPerHead })}${renderExecutiveScenarioResult({ label: "Overall GP", value: metrics.grossProfit, baseline: baseline.grossProfit, supportingText: `${executiveFormat(metrics.grossProfitPercent, "percentage")} of sales` })}${baseline.hasFoodDrinkGp ? renderExecutiveScenarioResult({ label: "Food GP", value: metrics.foodGpPercent, baseline: baseline.foodGpPercent, kind: "percentage", supportingText: "of food sales" }) : ""}${baseline.hasFoodDrinkGp ? renderExecutiveScenarioResult({ label: "Drink GP", value: metrics.drinkGpPercent, baseline: baseline.drinkGpPercent, kind: "percentage", supportingText: "of drink sales" }) : ""}${renderExecutiveScenarioResult({ label: "Total wages", value: metrics.wages, baseline: baseline.wages, lowerIsBetter: true, supportingText: `${executiveFormat(metrics.wagesPercent, "percentage")} of sales` })}${renderExecutiveScenarioResult({ label: "GP after wages", value: metrics.gpAfterWages, baseline: baseline.gpAfterWages, supportingText: "Gross profit less total wages" })}</div>
    </section>
  </section>`;
}

function applyExecutiveScenario() {
  const planner = document.querySelector("#executive-scenario");
  const rows = executiveRowsForSelectedPeriod();
  const { baseline, scenario } = executiveScenarioForRows(rows);
  if (!planner || !baseline || !scenario) return;
  const inputFor = (field) => planner.querySelector(`[data-action='edit-executive-scenario'][data-field='${field}']`);
  const read = (field) => {
    const value = inputFor(field)?.value;
    return value === undefined || value === "" ? Number.NaN : Number(value);
  };
  const wasEdited = (field) => {
    const input = inputFor(field);
    return Boolean(input) && input.value !== input.defaultValue;
  };
  const selectedMode = (field) => planner.querySelector(`[data-action='set-executive-scenario-mode'][data-field='${field}']`)?.value;
  const requestedSales = read("sales");
  const requestedCovers = read("covers");
  const requestedSpend = read("spendPerHead");
  const coversMode = selectedMode("covers") || scenario.coversMode || "total";
  const currentCoversInput = coversMode === "per-week" ? scenario.coversWeeklyAdjustment : scenario.covers;
  const current = executiveScenarioMetrics(baseline, scenario);
  const salesChanged = wasEdited("sales") && Number.isFinite(requestedSales);
  const coversChanged = wasEdited("covers") && Number.isFinite(requestedCovers) && Math.abs(requestedCovers - currentCoversInput) > .01;
  const spendChanged = wasEdited("spendPerHead") && Number.isFinite(requestedSpend);
  const next = { ...scenario };
  next.coversMode = coversMode;
  if (coversChanged) {
    if (coversMode === "per-week") next.coversWeeklyAdjustment = requestedCovers;
    else if (requestedCovers >= 0) next.covers = requestedCovers;
  }
  if (spendChanged && requestedSpend >= 0) next.spendPerHead = requestedSpend;
  const coversAfterChange = executiveScenarioMetrics(baseline, next).covers;
  if (salesChanged && requestedSales >= 0 && coversAfterChange > 0) {
    next.spendPerHead = baseline.spendPerHead * (requestedSales / baseline.sales) * (baseline.covers / coversAfterChange);
  }
  next.grossProfitMode = selectedMode("grossProfit") || next.grossProfitMode;
  next.wagesMode = selectedMode("wages") || next.wagesMode;
  const metrics = executiveScenarioMetrics(baseline, next);
  const requestedGrossProfit = read("grossProfit");
  const requestedFoodGp = read("foodGrossProfit");
  const requestedDrinkGp = read("drinkGrossProfit");
  const requestedWages = read("wages");
  const displayedGrossProfit = next.grossProfitMode === "value" ? current.grossProfit : current.grossProfitPercent * 100;
  const displayedWages = next.wagesMode === "value" ? current.wages : current.wagesPercent * 100;
  const grossProfitTolerance = next.grossProfitMode === "value" ? .51 : .051;
  const wagesTolerance = next.wagesMode === "value" ? .51 : .051;
  const foodGpChanged = baseline.hasFoodDrinkGp && wasEdited("foodGrossProfit") && Number.isFinite(requestedFoodGp) && requestedFoodGp >= 0;
  const drinkGpChanged = baseline.hasFoodDrinkGp && wasEdited("drinkGrossProfit") && Number.isFinite(requestedDrinkGp) && requestedDrinkGp >= 0;
  if (foodGpChanged || drinkGpChanged) {
    next.gpCalculationMode = "separate";
    if (foodGpChanged) next.foodGpPercent = requestedFoodGp / 100;
    if (drinkGpChanged) next.drinkGpPercent = requestedDrinkGp / 100;
  } else if (wasEdited("grossProfit") && Number.isFinite(requestedGrossProfit) && requestedGrossProfit >= 0 && Math.abs(requestedGrossProfit - displayedGrossProfit) > grossProfitTolerance) {
    next.gpCalculationMode = "overall";
    next.grossProfitPercent = next.grossProfitMode === "value" && metrics.sales > 0 ? requestedGrossProfit / metrics.sales : requestedGrossProfit / 100;
  }
  if (wasEdited("wages") && Number.isFinite(requestedWages) && requestedWages >= 0 && Math.abs(requestedWages - displayedWages) > wagesTolerance) {
    next.wagesPercent = next.wagesMode === "value" && metrics.sales > 0 ? requestedWages / metrics.sales : requestedWages / 100;
  }
  state = { ...state, executiveScenario: next };
  render();
}

function renderExecutiveDashboard() {
  const allRows = executiveRows();
  if (!allRows.length) return `<section class="executive-page"><button class="back-link" type="button" data-section="hub">&larr; Information Hub</button><div class="page-intro"><p class="eyebrow">EXECUTIVE DASHBOARD</p><h2>Business trajectory</h2><p>Upload the full Master Performance Sheet to prepare the long-term dashboard.</p></div></section>`;
  const grain = executivePeriodGrain();
  const selectedPeriod = executiveSelectedPeriod();
  const periodOptions = executivePeriodOptions(grain);
  const weeks = executivePeriodWeeks();
  const rows = executiveRowsForSelectedPeriod();
  const showingAllAvailableData = grain === "all";
  const comparisonRows = showingAllAvailableData ? [] : executiveComparisonRowsForSelectedPeriod();
  const comparisonNote = showingAllAvailableData
    ? "All reporting data is shown together, without a combined year-on-year comparison."
    : grain === "month" && comparisonRows.length
      ? "Monthly cards use the same weekday-weighted split and the matching calendar days last year."
    : comparisonRows.length === rows.length && rows.length
      ? "Card comparisons use the matching reporting weeks from one year earlier."
      : comparisonRows.length
        ? `Prior-year card comparisons use ${comparisonRows.length} of ${rows.length} matching reporting weeks, so they are directional rather than like-for-like.`
        : "No prior-year reporting weeks are available for this period.";
  const latestThirteen = executiveRows().slice(-13);
  const priorThirteen = executiveRows().slice(-26, -13);
  const forwardSalesTrend = executiveTrend(executiveMetric(latestThirteen, "salesEx", "sum"), executiveMetric(priorThirteen, "salesEx", "sum"), { label: "previous 13 weeks" });
  const forwardWageTrend = executiveTrend(
    executiveRatioMetric(latestThirteen, { numeratorKey: "totalWages", denominatorKey: "salesEx" }),
    executiveRatioMetric(priorThirteen, { numeratorKey: "totalWages", denominatorKey: "salesEx" }),
    { lowerIsBetter: true, label: "previous 13 weeks", mode: "points" },
  );
  const overallGp = { valueKey: "overallGpPounds", denominatorKey: "salesEx", valueKind: "currency", valueLabel: "Overall GP" };
  const totalWages = { valueKey: "totalWages", denominatorKey: "salesEx", valueKind: "currency", valueLabel: "Total wages" };
  const adjustedFoodGp = { valueKey: "adjustedFoodGpPounds", denominatorKey: "foodSalesInc", denominatorScale: 1 / 1.2, valueKind: "currency", valueLabel: "Food GP (adjusted)" };
  const adjustedDrinkGp = { valueKey: "adjustedDrinkGpPounds", denominatorKey: "drinkSalesInc", denominatorScale: 1 / 1.2, valueKind: "currency", valueLabel: "Drink GP (adjusted)" };
  const seniorManagementWages = { valueKey: "seniorManagementWages", denominatorKey: "salesEx", valueKind: "currency", valueLabel: "Senior management wages" };
  const comps = { valueKey: "comps", denominatorKey: "salesEx", valueKind: "currency", valueLabel: "Comps" };
  return `<section class="executive-page">
    <button class="back-link" type="button" data-section="hub">&larr; Information Hub</button>
    <div class="executive-hero"><p class="eyebrow">LARDER EXECUTIVE DASHBOARD</p><h2>Business trajectory</h2><p>See how volume, value, margin and labour have moved together—and which indicators are shaping the next few months.</p><img class="executive-hero__logo" src="./assets/larder-logo.png" alt="Larder Brasserie and Grill" /></div>
    <section class="executive-controls" aria-label="Executive dashboard period"><label>View by<select data-action="executive-grain"><option value="month" ${grain === "month" ? "selected" : ""}>Month</option><option value="quarter" ${grain === "quarter" ? "selected" : ""}>Quarter</option><option value="year" ${grain === "year" ? "selected" : ""}>Calendar year</option><option value="financial-year" ${grain === "financial-year" ? "selected" : ""}>Financial year (May–Apr)</option><option value="latest-13" ${grain === "latest-13" ? "selected" : ""}>Latest 13 weeks</option><option value="all" ${grain === "all" ? "selected" : ""}>All available data</option></select></label>${periodOptions.length ? `<label>Period<select data-action="executive-period">${periodOptions.map((option) => `<option value="${escapeHtml(option.value)}" ${selectedPeriod === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</select></label>` : ""}<button class="executive-scenario-button" type="button" data-action="open-executive-scenario"><span aria-hidden="true">∑</span> Scenario planner</button><p><strong>${escapeHtml(executivePeriodTitle())}</strong><span>${rows.length} ${grain === "month" ? "reporting-week portions · weekday-weighted split" : "reporting weeks"} · ${comparisonNote}</span></p></section>
    <section class="executive-kpis" aria-label="Executive key performance indicators">
      ${renderExecutiveKpi({ id: "sales-ex", label: "Sales ex VAT", key: "salesEx", kind: "currency", aggregate: "sum", basis: "Total for selected period", valueToggle: true, valueToggleLabel: "£ change", rows, comparisonRows })}
      ${renderExecutiveKpi({ id: "total-covers", label: "Total covers", key: "covers", kind: "number", aggregate: "sum", basis: "Total covers in selected period", rows, comparisonRows })}
      ${renderExecutiveKpi({ id: "spend-per-head", label: "Average spend per head", kind: "currency", ratio: { valueKey: "salesInc", denominatorKey: "covers", valueKind: "currency", valueLabel: "Sales inc VAT" }, ratioTrendMode: "relative", basis: "Sales inc VAT ÷ covers", suppressValueToggle: true, rows, comparisonRows })}
      ${renderExecutiveKpi({ id: "overall-gp", label: "Overall GP", kind: "percentage", ratio: overallGp, rows, comparisonRows })}
      ${renderExecutiveKpi({ id: "total-wages", label: "Total wages as % of sales", kind: "percentage", ratio: totalWages, lowerIsBetter: true, rows, comparisonRows })}
      ${renderExecutiveKpi({ id: "future-bookings", label: "Future bookings", key: "futureBookings", kind: "number", aggregate: "sum", basis: "Total bookings recorded in selected period", rows, comparisonRows })}
    </section>
    ${renderExecutiveScenarioPlannerV2(rows)}
    ${renderExecutiveMeasureDetail()}
    <section class="executive-dashboard-grid">
      ${renderExecutiveCumulativeChart()}
      ${renderExecutiveChart({ title: "Covers and spend per head", caption: "Higher cover numbers are strongest when spend per head is stable or improving. Each series is scaled to its own range so both movements remain readable.", rows, source: "COVERS SUMMARY · SPH", normalise: true, series: [{ label: "Covers", key: "covers", colour: "#315640" }, { label: "Spend per head", key: "spendPerHead", colour: "#b89221" }] })}
      ${renderExecutiveChart({ title: "Margin and labour", caption: "Overall GP and total wage ratio are tracked together because growth only adds value when both move in the right direction.", rows, source: "GP OVERALL · WAGES", series: [{ label: "Overall GP", key: "overallGpPercent", colour: "#315640" }, { label: "Total wages", key: "totalWagePercent", colour: "#a84141" }] })}
    </section>
    <section class="executive-outlook"><div><p class="eyebrow">WHERE THE BUSINESS IS GOING</p><h3>Latest 13-week run rate</h3><p>This is a directional view, using the most recent 13 completed weeks rather than a forecast promise.</p></div><div class="executive-outlook__items"><article class="executive-outlook__item executive-outlook__item--${forwardSalesTrend.tone}"><span>Sales ex VAT</span><strong>${executiveFormat(executiveMetric(latestThirteen, "salesEx", "sum"), "currency")}</strong><small>${escapeHtml(forwardSalesTrend.text)}</small></article><article class="executive-outlook__item executive-outlook__item--${forwardWageTrend.tone}"><span>Wage ratio</span><strong>${executiveFormat(executiveRatioMetric(latestThirteen, totalWages), "percentage")}</strong><small>${escapeHtml(forwardWageTrend.text)}</small></article><article class="executive-outlook__item"><span>Future bookings</span><strong>${executiveFormat(executiveMetric(latestThirteen, "futureBookings", "sum"), "number")}</strong><small>Total bookings recorded across the latest 13 weeks</small></article></div></section>
    <section class="executive-drivers"><div class="section-label"><span></span>Key margin and cost drivers</div><div class="executive-drivers__grid">${renderExecutiveDriver({ id: "adjusted-food-gp", label: "Food GP (adjusted)", kind: "percentage", ratio: adjustedFoodGp, rows, comparisonRows })}${renderExecutiveDriver({ id: "adjusted-drink-gp", label: "Drink GP (adjusted)", kind: "percentage", ratio: adjustedDrinkGp, rows, comparisonRows })}${renderExecutiveDriver({ id: "senior-management-wages", label: "Senior management wages", kind: "percentage", ratio: seniorManagementWages, rows, comparisonRows, lowerIsBetter: true })}${renderExecutiveDriver({ id: "comps", label: "Comps as % of sales", kind: "percentage", ratio: comps, rows, comparisonRows, lowerIsBetter: true })}${renderExecutiveDriver({ id: "expenses", label: "Operating expenses", key: "expenses", kind: "currency", aggregate: "sum", basis: "Total for selected period", rows, comparisonRows, lowerIsBetter: true })}</div></section>
    <section class="executive-note"><strong>Data note</strong><span>Functions, shoots, utilities and some expense measures have shorter or intermittent history in this workbook. They are retained as contextual indicators; the core trajectory is based on weekly sales, covers, spend per head, GP and wages.</span></section>
  </section>`;
}

const profitPlanKpis = [
  { id: "covers", label: "Total covers", shortLabel: "Covers", kind: "number", basis: "Total for the selected period", value: (rows) => executiveMetric(rows, "covers", "sum") },
  { id: "food-spend", label: "Food spend per head", shortLabel: "Food SPH", kind: "currency-decimal", basis: "Food sales inc. VAT ÷ covers", value: (rows) => profitPlanRatio(rows, "foodSalesInc", "covers") },
  { id: "drink-spend", label: "Drink spend per head", shortLabel: "Drink SPH", kind: "currency-decimal", basis: "Drink sales inc. VAT ÷ covers", value: (rows) => profitPlanRatio(rows, "drinkSalesInc", "covers") },
  { id: "total-spend", label: "Total spend per head", shortLabel: "Total SPH", kind: "currency-decimal", basis: "Sales inc. VAT ÷ covers", value: (rows) => profitPlanRatio(rows, "salesInc", "covers") },
  { id: "food-gp-percent", label: "Food GP %", shortLabel: "Food GP", kind: "percentage", basis: "Adjusted food GP", value: (rows) => profitPlanRatio(rows, "adjustedFoodGpPounds", "foodSalesInc", 1 / 1.2) },
  { id: "drink-gp-percent", label: "Drink GP %", shortLabel: "Drink GP", kind: "percentage", basis: "Adjusted drink GP", value: (rows) => profitPlanRatio(rows, "adjustedDrinkGpPounds", "drinkSalesInc", 1 / 1.2) },
  { id: "combined-gp-percent", label: "Combined GP %", shortLabel: "Overall GP", kind: "percentage", basis: "Overall GP ÷ sales ex. VAT", value: (rows) => profitPlanRatio(rows, "overallGpPounds", "salesEx") },
  { id: "food-gp-pounds", label: "Food GP £", shortLabel: "Food GP £", kind: "currency", basis: "Adjusted food GP", value: (rows) => executiveMetric(rows, "adjustedFoodGpPounds", "sum") },
  { id: "drink-gp-pounds", label: "Drink GP £", shortLabel: "Drink GP £", kind: "currency", basis: "Adjusted drink GP", value: (rows) => executiveMetric(rows, "adjustedDrinkGpPounds", "sum") },
  { id: "total-gp-pounds", label: "Total GP £", shortLabel: "Total GP £", kind: "currency", basis: "Overall GP", value: (rows) => executiveMetric(rows, "overallGpPounds", "sum") },
  { id: "labour-pounds", label: "Labour £", shortLabel: "Labour £", kind: "currency", lowerIsBetter: true, basis: "Total wages", value: (rows) => executiveMetric(rows, "totalWages", "sum") },
  { id: "labour-percent", label: "Labour %", shortLabel: "Labour %", kind: "percentage", lowerIsBetter: true, basis: "Total wages ÷ sales ex. VAT", value: (rows) => profitPlanRatio(rows, "totalWages", "salesEx") },
];

const localAccountantBudget = localPreviewMode ? {
  financialYear: "2026/27",
  periodLabel: "May 2026 – April 2027",
  sourceLabel: "Budget · original 2026/27 plan",
  priorActual: {
    sales: 901838.27,
    grossProfit: 608257.11,
    overallGpPercent: .6744636264,
    labour: 421969.45,
    labourPercent: .4678992498,
    operatingCosts: 643060.22,
    operatingProfit: -34803.11,
  },
  annual: {
    sales: 958247.37,
    grossProfit: 679397.38,
    overallGpPercent: .709,
    labour: 424624.74,
    labourPercent: .4431264314,
    operatingCosts: 631020.91,
    operatingProfit: 48376.48,
  },
  months: [
    { month: "2026-05", label: "May", sales: 77958.03, grossProfit: 55272.25, labour: 35195.80, operatingProfit: 6693.69 },
    { month: "2026-06", label: "Jun", sales: 67378.75, grossProfit: 47771.53, labour: 34137.88, operatingProfit: -9114.26 },
    { month: "2026-07", label: "Jul", sales: 73391.29, grossProfit: 52034.42, labour: 34739.13, operatingProfit: 3051.76 },
    { month: "2026-08", label: "Aug", sales: 93810.49, grossProfit: 66511.64, labour: 36781.05, operatingProfit: 3088.63 },
    { month: "2026-09", label: "Sep", sales: 77824.74, grossProfit: 55177.74, labour: 35182.47, operatingProfit: 5693.75 },
    { month: "2026-10", label: "Oct", sales: 78354.31, grossProfit: 55553.21, labour: 35235.43, operatingProfit: 5565.31 },
    { month: "2026-11", label: "Nov", sales: 81893.32, grossProfit: 58062.36, labour: 35589.33, operatingProfit: -652.46 },
    { month: "2026-12", label: "Dec", sales: 107013.06, grossProfit: 75872.26, labour: 38101.31, operatingProfit: 23466.90 },
    { month: "2027-01", label: "Jan", sales: 62319.33, grossProfit: 44184.40, labour: 33631.93, operatingProfit: -3671.13 },
    { month: "2027-02", label: "Feb", sales: 83654.05, grossProfit: 59310.72, labour: 35765.40, operatingProfit: 10152.31 },
    { month: "2027-03", label: "Mar", sales: 80856.70, grossProfit: 57327.40, labour: 35485.67, operatingProfit: -62.90 },
    { month: "2027-04", label: "Apr", sales: 73793.31, grossProfit: 52319.45, labour: 34779.33, operatingProfit: 4164.87 },
  ],
} : null;

const profitPlanQuarterLabels = {
  Q1: "Q1 · May–Jul",
  Q2: "Q2 · Aug–Oct",
  Q3: "Q3 · Nov–Jan",
  Q4: "Q4 · Feb–Apr",
};

function profitPlanNumber(value) {
  if (String(value ?? "").trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function profitPlanRatio(rows, numeratorKey, denominatorKey, denominatorScale = 1) {
  return executiveRatioMetric(rows, { numeratorKey, denominatorKey, denominatorScale });
}

function profitPlanAccountingYear(week) {
  const year = Number(String(week).slice(0, 4));
  const month = Number(String(week).slice(5, 7));
  const startYear = month >= 5 ? year : year - 1;
  return `${startYear}/${String(startYear + 1).slice(-2)}`;
}

function profitPlanYears() {
  return [...new Set([
    ...executiveRows().map((row) => profitPlanAccountingYear(row.week)),
    state.profitPlanBudget?.financialYear,
    ...Object.keys(state.profitPlanBudgets || {}),
    localAccountantBudget?.financialYear,
  ].filter(Boolean))].sort();
}

function profitPlanBudgetForYear(year) {
  if (state.profitPlanBudgets?.[year]?.financialYear === year) return state.profitPlanBudgets[year];
  if (state.profitPlanBudget?.financialYear === year) return state.profitPlanBudget;
  return localAccountantBudget?.financialYear === year ? localAccountantBudget : null;
}

function profitPlanFinancialYearRows(year) {
  return executiveRows().filter((row) => profitPlanAccountingYear(row.week) === year);
}

function profitPlanQuarterForWeek(week) {
  const month = Number(String(week).slice(5, 7));
  if (month >= 5 && month <= 7) return "Q1";
  if (month >= 8 && month <= 10) return "Q2";
  if (month === 11 || month === 12 || month === 1) return "Q3";
  return "Q4";
}

function profitPlanQuarterRows(year, quarter) {
  return profitPlanFinancialYearRows(year).filter((row) => profitPlanQuarterForWeek(row.week) === quarter);
}

function profitPlanMonths(year, quarter) {
  return [...new Set(profitPlanQuarterRows(year, quarter).map((row) => row.week.slice(0, 7)))];
}

function profitPlanContribution(rows) {
  const grossProfit = executiveMetric(rows, "overallGpPounds", "sum");
  const wages = executiveMetric(rows, "totalWages", "sum");
  return Number.isFinite(grossProfit) && Number.isFinite(wages) ? grossProfit - wages : null;
}

function profitPlanKpi(id) {
  return profitPlanKpis.find((item) => item.id === id) || null;
}

function profitPlanKpiValue(rows, id) {
  return profitPlanKpi(id)?.value(rows) ?? null;
}

function profitPlanFormatKpi(kpi, value) {
  if (!kpi || !Number.isFinite(value)) return "—";
  if (kpi.kind === "currency-decimal") return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  return executiveFormat(value, kpi.kind);
}

function profitPlanInputValue(kpi, value) {
  if (!Number.isFinite(value)) return "";
  if (kpi?.kind === "percentage") return (value * 100).toFixed(1);
  if (kpi?.kind === "currency-decimal") return value.toFixed(2);
  return kpi?.kind === "number" || kpi?.kind === "currency" ? value.toFixed(0) : String(value);
}

function profitPlanInputNumber(kpi, value) {
  const number = profitPlanNumber(value);
  return number === null ? null : kpi?.kind === "percentage" ? number / 100 : number;
}

function profitPlanKpiOptions(selected = "") {
  return `<option value="">Choose a KPI</option>${profitPlanKpis.map((kpi) => `<option value="${kpi.id}" ${selected === kpi.id ? "selected" : ""}>${escapeHtml(kpi.label)}</option>`).join("")}`;
}

function profitPlanDefault(year) {
  const years = profitPlanYears();
  const index = years.indexOf(year);
  const previousYear = index > 0 ? years[index - 1] : "";
  return {
    financialYear: year,
    baselineOverride: "",
    targetProfit: "",
    confirmedDelivered: "",
    opportunities: [],
    quarters: Object.fromEntries(Object.keys(profitPlanQuarterLabels).map((quarter) => [quarter, { focusKpiId: "", target: "", expectedBenefit: "", owner: "", actions: "", status: "not-started" }])),
    reviews: {},
    previousYear,
  };
}

function profitPlanForYear(year) {
  const fallback = profitPlanDefault(year);
  const saved = state.profitPlans?.[year];
  if (!saved) return fallback;
  return {
    ...fallback,
    ...saved,
    quarters: Object.fromEntries(Object.keys(profitPlanQuarterLabels).map((quarter) => [quarter, { ...fallback.quarters[quarter], ...(saved.quarters?.[quarter] || {}) }])),
    reviews: { ...(saved.reviews || {}) },
    opportunities: Array.isArray(saved.opportunities) ? saved.opportunities : [],
  };
}

function saveProfitPlan(plan, message = "") {
  state = {
    ...state,
    profitPlans: { ...(state.profitPlans || {}), [plan.financialYear]: plan },
    profitPlanYear: plan.financialYear,
    profitPlanMessage: message,
  };
}

function profitPlanSelectedYear() {
  const years = profitPlanYears();
  return years.includes(state.profitPlanYear) ? state.profitPlanYear : years.at(-1) || "";
}

function profitPlanCurrentQuarter(year) {
  const rows = profitPlanFinancialYearRows(year);
  return rows.length ? profitPlanQuarterForWeek(rows.at(-1).week) : "Q1";
}

function profitPlanTone(value, target, lowerIsBetter = false) {
  if (!Number.isFinite(value) || !Number.isFinite(target)) return "neutral";
  const onTarget = lowerIsBetter ? value <= target : value >= target;
  const closeToTarget = lowerIsBetter ? value <= target * 1.05 : value >= target * .95;
  return onTarget ? "positive" : closeToTarget ? "caution" : "negative";
}

function profitPlanStatusLabel(status) {
  return ({ "not-started": "Not started", "in-progress": "In progress", complete: "Complete", "on-hold": "On hold", cancelled: "Cancelled", identified: "Identified", delivered: "Delivered" })[status] || "Identified";
}

function profitPlanPeopleOptions(selected = "") {
  const people = state.taskData?.people || [];
  return `<option value="">Choose an owner</option>${people.map((person) => `<option value="${escapeHtml(person.name)}" ${selected === person.name ? "selected" : ""}>${escapeHtml(person.name)}</option>`).join("")}`;
}

function renderProfitPlanSummaryCard(label, value, note = "", tone = "neutral") {
  return `<article class="profit-plan-summary-card profit-plan-summary-card--${tone}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${note ? `<small>${escapeHtml(note)}</small>` : ""}</article>`;
}

function profitPlanSignedCurrency(value) {
  if (!Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${executiveFormat(value, "currency")}`;
}

function renderProfitPlanBudget(year) {
  const budget = profitPlanBudgetForYear(year);
  if (!budget) return `<section class="profit-plan-panel profit-budget-empty"><div class="profit-plan-panel__heading"><div><p class="eyebrow">YOUR BUDGET</p><h3>Set the financial starting point</h3><p>When the budget is connected, this page will show the annual target, the monthly sales plan and the gap to close.</p></div></div></section>`;
  const priorActual = budget.priorActual || null;
  const salesGrowth = priorActual ? budget.annual.sales - priorActual.sales : null;
  const grossProfitGrowth = priorActual ? budget.annual.grossProfit - priorActual.grossProfit : null;
  const operatingCostSaving = priorActual ? priorActual.operatingCosts - budget.annual.operatingCosts : null;
  const operatingProfitImprovement = priorActual ? budget.annual.operatingProfit - priorActual.operatingProfit : null;
  return `<section class="profit-budget" aria-label="${escapeHtml(budget.financialYear)} accountant budget">
    <div class="profit-budget__heading"><div><p class="eyebrow">YOUR FINANCIAL PLAN</p><h3>${escapeHtml(budget.financialYear)} budget in one view</h3><p>${escapeHtml(budget.periodLabel)} · ${escapeHtml(budget.sourceLabel)}</p></div><span>May–April</span></div>
    ${priorActual ? `<div class="profit-budget__journey"><div><span>Last year’s actual</span><strong>${executiveFormat(priorActual.operatingProfit, "currency")}</strong><small>${priorActual.operatingProfit < 0 ? "Operating loss" : "Operating profit"}</small></div><i>→</i><div><span>Improvement needed</span><strong>${executiveFormat(operatingProfitImprovement, "currency")}</strong><small>To reach the budget</small></div><i>→</i><div><span>This year’s target</span><strong>${executiveFormat(budget.annual.operatingProfit, "currency")}</strong><small>Operating profit</small></div></div>` : `<p class="profit-budget__missing-prior">Prior-year actuals were not found in this workbook. The annual budget is loaded; add a previous actuals tab to show the full improvement journey.</p>`}
    <div class="profit-budget__cards">
      ${renderProfitPlanSummaryCard("Sales budget", executiveFormat(budget.annual.sales, "currency"), priorActual ? `${profitPlanSignedCurrency(salesGrowth)} vs last year` : "Annual budget", "positive")}
      ${renderProfitPlanSummaryCard("Gross profit", executiveFormat(budget.annual.grossProfit, "currency"), `${executiveFormat(budget.annual.overallGpPercent, "percentage")} target`, "positive")}
      ${renderProfitPlanSummaryCard("Labour budget", executiveFormat(budget.annual.labour, "currency"), `${executiveFormat(budget.annual.labourPercent, "percentage")} of sales`, "caution")}
      ${renderProfitPlanSummaryCard("Operating-profit target", executiveFormat(budget.annual.operatingProfit, "currency"), "After labour and operating costs", "positive")}
    </div>
    ${priorActual ? `<div class="profit-budget__drivers"><article><span>Sales growth</span><strong>${profitPlanSignedCurrency(salesGrowth)}</strong><small>Budgeted turnover above last year</small></article><article><span>Gross-profit gain</span><strong>${profitPlanSignedCurrency(grossProfitGrowth)}</strong><small>Sales and margin combined</small></article><article><span>Operating-cost reduction</span><strong>${profitPlanSignedCurrency(operatingCostSaving)}</strong><small>Including labour in the accountant model</small></article></div>` : ""}
    <details class="profit-budget__months"><summary>View the monthly budget</summary><p>Until daily sales are available, reporting weeks that cross a month are allocated using the usual Monday–Sunday sales mix. Only completed months receive a variance; the latest month is clearly shown as a work-in-progress checkpoint.</p><div class="profit-budget__table-wrap"><table><thead><tr><th>Month</th><th>Sales budget</th><th>Actual sales</th><th>Variance</th><th>Operating-profit budget</th></tr></thead><tbody>${budget.months.map((month) => {
      const actualSales = budgetMonthlyActuals(month.month, executiveRows(), budgetSalesCutoff(year)).actualSales;
      const latestLoadedMonth = budgetSalesCutoff(year).slice(0, 7) || "";
      const monthInProgress = month.month === latestLoadedMonth;
      const completed = month.month < latestLoadedMonth;
      const variance = completed && Number.isFinite(actualSales) ? actualSales - month.sales : null;
      const tone = variance === null ? "neutral" : variance >= 0 ? "positive" : "negative";
      const actualText = Number.isFinite(actualSales) ? `${executiveFormat(actualSales, "currency")}${monthInProgress ? " to date" : ""}` : "Not loaded";
      return `<tr class="profit-budget-month--${tone}"><td>${escapeHtml(month.label)}</td><td>${executiveFormat(month.sales, "currency")}</td><td>${actualText}</td><td>${monthInProgress ? "In progress" : variance === null ? "—" : profitPlanSignedCurrency(variance)}</td><td>${executiveFormat(month.operatingProfit, "currency")}</td></tr>`;
    }).join("")}</tbody></table></div></details>
  </section>`;
}

function renderProfitPlanBudgetUpload(year) {
  const budget = profitPlanBudgetForYear(year);
  const source = budget ? `<p class="profit-budget-upload__source"><strong>Loaded:</strong> ${escapeHtml(budget.sourceLabel)}<br><span>${escapeHtml(budget.financialYear)} · ${escapeHtml(budget.periodLabel)}</span></p>` : "";
  return `<section class="profit-budget-upload" aria-label="Budget upload">
    <div><p class="eyebrow">BUDGET FILE</p><h3>Update the financial plan</h3><p>Drag in the Excel budget. We read the 12 monthly P&amp;L values and securely share the plan with Owners and Admins.</p>${source}</div>
    <button class="profit-budget-upload__drop" type="button" data-action="choose-budget-upload"><span aria-hidden="true">⇧</span><strong>Drop the budget here</strong><small>or choose an Excel file</small></button>
    <p class="profit-budget-upload__note">Looks for a May–April budget with Total Turnover, Gross Profit, Total Labour Cost and Operating Profit. The extracted budget figures are stored securely; this does not replace or publish the weekly Master Sheet.</p>
  </section>`;
}

function priorFinancialYear(year) {
  const startYear = Number(year.slice(0, 4));
  return Number.isFinite(startYear) ? `${startYear - 1}/${String(startYear).slice(-2)}` : "";
}

function budgetReportingWeeks(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(monthNumber)) return [];
  const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  const finalDay = new Date(Date.UTC(year, monthNumber, 0));
  const firstSundayOffset = (7 - first.getUTCDay()) % 7;
  const weeks = [];
  // A reporting week ends on Sunday. Include the following Sunday when its
  // Monday–Sunday reporting period contains the last day of this month.
  const finalReportingWeek = new Date(finalDay);
  finalReportingWeek.setUTCDate(finalReportingWeek.getUTCDate() + (7 - finalDay.getUTCDay()) % 7);
  for (let date = new Date(Date.UTC(year, monthNumber - 1, 1 + firstSundayOffset)); date <= finalReportingWeek; date.setUTCDate(date.getUTCDate() + 7)) {
    weeks.push(date.toISOString().slice(0, 10));
  }
  return weeks;
}

function budgetMonthCalendarDays(month) {
  const [year, monthNumber] = plainText(month).split("-").map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(monthNumber)) return 0;
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

const budgetTypicalDailySalesWeights = [0.0001, 0.0806, 0.0991, 0.134, 0.2153, 0.3125, 0.1583];

function budgetDayTradeWeight(date) {
  const weekday = date.getUTCDay();
  const mondayFirstIndex = (weekday + 6) % 7;
  return budgetTypicalDailySalesWeights[mondayFirstIndex] || 0;
}

function budgetMonthTradeWeight(month, through = "") {
  const [year, monthNumber] = plainText(month).split("-").map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(monthNumber)) return 0;
  const start = new Date(Date.UTC(year, monthNumber - 1, 1));
  const finalDay = new Date(Date.UTC(year, monthNumber, 0));
  const throughDate = through ? new Date(`${plainText(through)}T12:00:00Z`) : null;
  const end = throughDate && !Number.isNaN(throughDate.getTime()) ? new Date(Math.min(finalDay.getTime(), throughDate.getTime())) : finalDay;
  let total = 0;
  for (let date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) total += budgetDayTradeWeight(date);
  return total;
}

function budgetWeekMonthAllocation(week, month, through = "") {
  const weekEnd = new Date(`${plainText(week)}T00:00:00Z`);
  const [year, monthNumber] = plainText(month).split("-").map(Number);
  if (Number.isNaN(weekEnd.getTime()) || !Number.isFinite(year) || !Number.isFinite(monthNumber)) return { days: 0, share: 0, tradeWeight: 0 };
  const weekStart = new Date(weekEnd);
  weekStart.setUTCDate(weekStart.getUTCDate() - 6);
  const monthStart = new Date(Date.UTC(year, monthNumber - 1, 1));
  const monthEnd = new Date(Date.UTC(year, monthNumber, 0));
  const throughDate = through ? new Date(`${plainText(through)}T00:00:00Z`) : null;
  const effectiveMonthEnd = throughDate && !Number.isNaN(throughDate.getTime()) ? new Date(Math.min(monthEnd.getTime(), throughDate.getTime())) : monthEnd;
  const overlapStart = Math.max(weekStart.getTime(), monthStart.getTime());
  const overlapEnd = Math.min(weekEnd.getTime(), effectiveMonthEnd.getTime());
  const days = overlapEnd < overlapStart ? 0 : Math.floor((overlapEnd - overlapStart) / 86400000) + 1;
  if (!days) return { days: 0, share: 0, tradeWeight: 0 };
  let tradeWeight = 0;
  for (let date = new Date(overlapStart); date.getTime() <= overlapEnd; date.setUTCDate(date.getUTCDate() + 1)) tradeWeight += budgetDayTradeWeight(date);
  const weekTradeWeight = budgetTypicalDailySalesWeights.reduce((total, value) => total + value, 0);
  return { days, share: weekTradeWeight ? tradeWeight / weekTradeWeight : days / 7, tradeWeight };
}

function budgetMonthlyActuals(month, rows, cutoff = "") {
  const allocations = (rows || []).map((row) => {
    const allocation = budgetWeekMonthAllocation(row?.week, month);
    return { row, ...allocation };
  }).filter(({ row, days }) => days > 0 && row?.week && (!cutoff || row.week <= cutoff));
  const total = (key) => {
    let hasValue = false;
    const value = allocations.reduce((sum, { row, share }) => {
      const amount = executiveValue(row, key);
      if (!Number.isFinite(amount)) return sum;
      hasValue = true;
      return sum + amount * share;
    }, 0);
    return hasValue ? value : null;
  };
  const actualSales = total("salesEx");
  const actualSalesInc = total("salesInc");
  const actualCovers = total("covers");
  const actualCalendarDays = allocations.reduce((sum, { days, row }) => Number.isFinite(executiveValue(row, "salesEx")) ? sum + days : sum, 0);
  const actualTradeWeight = allocations.reduce((sum, { tradeWeight, row }) => Number.isFinite(executiveValue(row, "salesEx")) ? sum + tradeWeight : sum, 0);
  return {
    allocations,
    actualRows: allocations.map(({ row }) => row),
    hasActuals: allocations.length > 0,
    actualSales: actualSales ?? 0,
    actualSalesInc: actualSalesInc ?? 0,
    actualCovers: actualCovers ?? 0,
    actualSpendPerHead: Number.isFinite(actualSalesInc) && Number.isFinite(actualCovers) && actualCovers > 0 ? actualSalesInc / actualCovers : null,
    actualCalendarDays,
    actualTradeWeight,
  };
}

function budgetPreviousYearSpendPerHead(year) {
  const rows = profitPlanFinancialYearRows(priorFinancialYear(year));
  return executiveRatioMetric(rows, { numeratorKey: "salesInc", denominatorKey: "covers" });
}

function budgetSameMonthLastYearSpendPerHead(month) {
  const priorMonth = shiftMonth(month, -12);
  return budgetMonthlyActuals(priorMonth, executiveRows()).actualSpendPerHead;
}

function budgetFormatSpendPerHead(value) {
  if (!Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function budgetMonthEnd(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(monthNumber)) return "";
  return new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
}

function budgetSalesCutoff(year) {
  const weeks = executiveRows().map((row) => row.week).filter(Boolean).sort();
  // Budget & Targets is always a live plan, so it uses the latest actual week
  // loaded from the Master Sheet rather than the date selected in Weekly Reports.
  return weeks.at(-1) || "";
}

function budgetSalesMonthStatus(month, cutoff) {
  if (!cutoff || cutoff < `${month}-01`) return "future";
  return cutoff >= budgetMonthEnd(month) ? "complete" : "active";
}

function budgetSalesPlan(year) {
  const budget = profitPlanBudgetForYear(year);
  const annualPreviousYearSpendPerHead = budgetPreviousYearSpendPerHead(year);
  if (!budget?.months?.length || !Number.isFinite(annualPreviousYearSpendPerHead) || annualPreviousYearSpendPerHead <= 0) return null;
  const overrides = state.budgetSalesAssumptions?.[year] || {};
  const cutoff = budgetSalesCutoff(year);
  const actualSourceRows = executiveRows();
  const seedMonths = budget.months.map((month) => {
    const reportingWeeks = budgetReportingWeeks(month.month);
    const weekCount = reportingWeeks.length;
    const calendarDays = budgetMonthCalendarDays(month.month);
    const monthTradeWeight = budgetMonthTradeWeight(month.month);
    const equivalentWeeks = calendarDays / 7;
    const priorMonth = shiftMonth(month.month, -12);
    const sameMonthLastYearSpendPerHead = budgetSameMonthLastYearSpendPerHead(month.month);
    const hasSameMonthLastYearSpendPerHead = Number.isFinite(sameMonthLastYearSpendPerHead) && sameMonthLastYearSpendPerHead > 0;
    const startingSpendPerHead = hasSameMonthLastYearSpendPerHead ? sameMonthLastYearSpendPerHead : annualPreviousYearSpendPerHead;
    // The accountant budget is ex VAT, while SPH is deliberately shown inc VAT
    // because it is the more familiar operational measure for the team.
    const defaultCoversPerWeek = equivalentWeeks ? (month.sales * 1.2) / startingSpendPerHead / equivalentWeeks : 0;
    const saved = overrides[month.month] || {};
    const hasCoversOverride = plainText(saved.coversPerWeek) !== "" && Number.isFinite(Number(saved.coversPerWeek)) && Number(saved.coversPerWeek) >= 0;
    const hasSpendOverride = plainText(saved.spendPerHead) !== "" && Number.isFinite(Number(saved.spendPerHead)) && Number(saved.spendPerHead) > 0;
    const coversPerWeek = hasCoversOverride ? Number(saved.coversPerWeek) : defaultCoversPerWeek;
    const spendPerHead = hasSpendOverride ? Number(saved.spendPerHead) : startingSpendPerHead;
    const baseSalesTarget = coversPerWeek * equivalentWeeks * spendPerHead / 1.2;
    const actuals = budgetMonthlyActuals(month.month, actualSourceRows, cutoff);
    return {
      ...month,
      reportingWeeks,
      weekCount,
      calendarDays,
      monthTradeWeight,
      equivalentWeeks,
      defaultCoversPerWeek,
      priorMonth,
      startingSpendPerHead,
      usesAnnualSpendFallback: !hasSameMonthLastYearSpendPerHead,
      hasCoversOverride,
      hasSpendOverride,
      coversPerWeek,
      spendPerHead,
      plannedMonthlyCovers: coversPerWeek * equivalentWeeks,
      baseSalesTarget,
      baseSpendPerHeadTarget: coversPerWeek * equivalentWeeks ? baseSalesTarget * 1.2 / (coversPerWeek * equivalentWeeks) : null,
      cutoff,
      status: budgetSalesMonthStatus(month.month, cutoff),
      ...actuals,
    };
  });
  const completedMonths = seedMonths.filter((month) => month.status === "complete");
  const remainingMonths = seedMonths.filter((month) => month.status !== "complete");
  const completedGap = completedMonths.reduce((total, month) => total + month.baseSalesTarget - month.actualSales, 0);
  const remainingBudgetSales = remainingMonths.reduce((total, month) => total + month.baseSalesTarget, 0);
  const sharedSalesUplift = remainingBudgetSales ? completedGap / remainingBudgetSales : 0;
  const months = seedMonths.map((month) => {
    const reforecastSalesTarget = month.status === "complete" ? month.actualSales : month.baseSalesTarget * (1 + sharedSalesUplift);
    const reforecastSpendPerHeadTarget = month.status === "complete"
      ? month.baseSpendPerHeadTarget
      : month.spendPerHead;
    const reforecastMonthlyCovers = reforecastSpendPerHeadTarget > 0 ? reforecastSalesTarget * 1.2 / reforecastSpendPerHeadTarget : 0;
    const reforecastCoversPerWeek = month.equivalentWeeks ? reforecastMonthlyCovers / month.equivalentWeeks : 0;
    const remainingWeeks = month.reportingWeeks.filter((week) => !cutoff || week > cutoff);
    const remainingWeekCount = remainingWeeks.length;
    const remainingSalesNeeded = month.status === "active" ? Math.max(0, reforecastSalesTarget - month.actualSales) : month.status === "future" ? reforecastSalesTarget : 0;
    const remainingCoversNeeded = month.status === "active" ? Math.max(0, reforecastMonthlyCovers - month.actualCovers) : month.status === "future" ? reforecastMonthlyCovers : 0;
    // This is deliberately separate from the covers plan. It answers the
    // operational question: at the SPH actually being achieved so far, how
    // many further covers would deliver the remaining sales target?
    const coversNeededAtCurrentSpend = month.status === "active" && month.actualSpendPerHead > 0
      ? Math.max(0, remainingSalesNeeded * 1.2 / month.actualSpendPerHead)
      : null;
    const coversNeededAtCurrentSpendPerWeek = coversNeededAtCurrentSpend !== null && remainingWeekCount
      ? coversNeededAtCurrentSpend / remainingWeekCount
      : null;
    // Targets remain the agreed budget (or a manual change). A live month can
    // be ahead or behind that plan, but actual SPH never silently becomes a
    // new target. The separate blue bar shows its live covers implication.
    const targetSpendPerHead = month.status === "complete" ? month.baseSpendPerHeadTarget : reforecastSpendPerHeadTarget;
    const actualRowsByWeek = new Map(month.actualRows.map((row) => [row.week, row]));
    const weekly = month.reportingWeeks.map((week) => {
      const actual = actualRowsByWeek.get(week);
      const hasActual = Boolean(actual);
      const { days, share, tradeWeight } = budgetWeekMonthAllocation(week, month.month);
      const tradeShare = month.monthTradeWeight ? tradeWeight / month.monthTradeWeight : 0;
      const weeklySales = hasActual ? executiveValue(actual, "salesEx") : null;
      const weeklyCovers = hasActual ? executiveValue(actual, "covers") : null;
      const actualSales = Number.isFinite(weeklySales) ? weeklySales * share : null;
      const actualCovers = Number.isFinite(weeklyCovers) ? weeklyCovers * share : null;
      const actualSpendPerHead = hasActual ? executiveRatioMetric([actual], { numeratorKey: "salesInc", denominatorKey: "covers" }) : null;
      const pastWeek = Boolean(cutoff && week <= cutoff);
      const salesPlan = month.status === "complete" ? month.baseSalesTarget : reforecastSalesTarget;
      const coversPlan = month.status === "complete" ? month.plannedMonthlyCovers : reforecastMonthlyCovers;
      return {
        week,
        daysInMonth: days,
        tradeWeight,
        tradeShare,
        hasActual,
        pastWeek,
        actualSales,
        actualCovers,
        actualSpendPerHead,
        targetSales: salesPlan * tradeShare,
        targetCovers: coversPlan * tradeShare,
        targetSpendPerHead: month.status === "complete" ? month.baseSpendPerHeadTarget : reforecastSpendPerHeadTarget,
      };
    });
    const actualWeekCount = weekly.filter((week) => week.hasActual).length;
    const summarySalesTarget = month.status === "complete" ? month.baseSalesTarget : reforecastSalesTarget;
    const summaryCoversTarget = month.status === "complete" ? month.plannedMonthlyCovers : reforecastMonthlyCovers;
    const summarySpendPerHeadTarget = month.status === "complete" ? month.baseSpendPerHeadTarget : reforecastSpendPerHeadTarget;
    const reportingProgress = month.status === "active" && month.monthTradeWeight ? month.actualTradeWeight / month.monthTradeWeight : month.status === "complete" ? 1 : 0;
    const summarySalesValue = month.status === "active" && reportingProgress ? month.actualSales / reportingProgress : month.status === "complete" ? month.actualSales : reforecastSalesTarget;
    const summaryCoversValue = month.status === "active" && reportingProgress ? month.actualCovers / reportingProgress : month.status === "complete" ? month.actualCovers : reforecastMonthlyCovers;
    const summarySpendPerHeadValue = month.status === "active" || month.status === "complete" ? month.actualSpendPerHead : reforecastSpendPerHeadTarget;
    const salesPaceTarget = summarySalesTarget * reportingProgress;
    const coversPaceTarget = summaryCoversTarget * reportingProgress;
    return {
      ...month,
      reforecastSalesTarget,
      reforecastSpendPerHeadTarget,
      reforecastMonthlyCovers,
      reforecastCoversPerWeek,
      remainingWeeks,
      remainingWeekCount,
      remainingCalendarDays: Math.max(0, month.calendarDays - month.actualCalendarDays),
      remainingSalesNeeded,
      remainingCoversNeeded,
      coversNeededAtCurrentSpend,
      coversNeededAtCurrentSpendPerWeek,
      targetSpendPerHead,
      weekly,
      actualWeekCount,
      summarySalesTarget,
      summaryCoversTarget,
      summarySpendPerHeadTarget,
      summarySalesValue,
      summaryCoversValue,
      summarySpendPerHeadValue,
      reportingProgress,
      salesPaceTarget,
      coversPaceTarget,
      monthlySalesTarget: reforecastSalesTarget,
      weeklySalesTarget: month.equivalentWeeks ? reforecastSalesTarget / month.equivalentWeeks : 0,
      variance: reforecastSalesTarget - month.sales,
    };
  });
  const totalSalesTarget = months.reduce((total, month) => total + month.monthlySalesTarget, 0);
  const totalBudgetSales = months.reduce((total, month) => total + month.sales, 0);
  return {
    budget,
    annualPreviousYearSpendPerHead,
    cutoff,
    months,
    completedMonths: completedMonths.length,
    remainingMonths: remainingMonths.length,
    completedGap,
    sharedSalesUplift,
    totalBudgetSales,
    totalSalesTarget,
    variance: totalSalesTarget - totalBudgetSales,
  };
}

function budgetSalesVarianceTone(value) {
  if (!Number.isFinite(value) || Math.abs(value) < .5) return "on-budget";
  return value > 0 ? "above-budget" : "below-budget";
}

function budgetSalesBarTone(value, target, { plan = false, kind = "number" } = {}) {
  if (plan || !Number.isFinite(Number(value)) || !Number.isFinite(Number(target))) return "plan";
  const variance = Number(value) - Number(target);
  if (variance >= -.5) return "above-budget";
  const closeToTarget = kind === "currency" ? 2000 : kind === "sph" ? 5 : 200;
  return Math.abs(variance) <= closeToTarget ? "near-target" : "below-budget";
}

function budgetSalesBarScale(value, target, { scaleTarget = null } = {}) {
  const reference = Number(scaleTarget);
  const values = [value, target].map(Number).filter((item) => Number.isFinite(item) && item >= 0);
  const scale = Number.isFinite(reference) && reference > 0 ? reference : Math.max(...values, 1) * 1.12;
  return {
    fill: Number.isFinite(Number(value)) ? Math.min(100, Math.max(0, Number(value) / scale * 100)) : 0,
    marker: Number.isFinite(Number(target)) ? Math.min(100, Math.max(0, Number(target) / scale * 100)) : 0,
  };
}

function budgetSalesBarFormat(value, kind) {
  return kind === "sph" ? budgetFormatSpendPerHead(value) : executiveFormat(value, kind);
}

function renderBudgetSalesMonthBar(label, value, target, kind = "number", valueLabel = "Actual", { plan = false, targetLabel = "Target", comparisonLabel = "target", scaleTarget = null, progressToTotal = true, paceTarget = null, toneOverride = "", changeOverride = "", changeToneOverride = "" } = {}) {
  const fullTarget = Number.isFinite(Number(scaleTarget)) && Number(scaleTarget) > 0 && progressToTotal ? Number(scaleTarget) : target;
  const performanceTarget = paceTarget !== null && paceTarget !== "" && Number.isFinite(Number(paceTarget)) ? Number(paceTarget) : target;
  const tone = toneOverride || budgetSalesBarTone(value, performanceTarget, { plan, kind });
  const { fill, marker } = budgetSalesBarScale(value, progressToTotal ? fullTarget : target, { scaleTarget: progressToTotal ? fullTarget : scaleTarget });
  const difference = Number.isFinite(Number(value)) && Number.isFinite(Number(fullTarget)) ? Number(fullTarget) - Number(value) : null;
  const change = changeOverride || (plan
    ? "Not started"
    : difference === null
      ? "No actuals yet"
      : progressToTotal
        ? Math.abs(difference) < .5 ? "Plan reached" : difference > 0 ? `${budgetSalesBarFormat(difference, kind)} still needed` : `Up ${budgetSalesBarFormat(Math.abs(difference), kind)} vs ${comparisonLabel}`
        : Math.abs(difference) < .5 ? `On ${comparisonLabel}` : difference < 0 ? `Up ${budgetSalesBarFormat(Math.abs(difference), kind)} vs ${comparisonLabel}` : `Down ${budgetSalesBarFormat(difference, kind)} vs ${comparisonLabel}`);
  const changeTone = changeToneOverride || (plan || difference === null ? "" : Math.abs(difference) < .5 ? "reached" : difference > 0 ? "needed" : "up");
  const track = plan ? "" : `<i style="width:${fill.toFixed(2)}%"></i>${progressToTotal ? "" : `<em style="left:${marker.toFixed(2)}%"></em>`}`;
  return `<section class="budget-sales-month-bar budget-sales-month-bar--${tone}"><div><span>${escapeHtml(label)}</span><strong>${budgetSalesBarFormat(value, kind)}</strong></div><p><i>${escapeHtml(valueLabel)}</i><b>${escapeHtml(targetLabel)} ${budgetSalesBarFormat(fullTarget, kind)}</b></p><div class="budget-sales-month-bar__track" role="img" aria-label="${escapeHtml(label)}: ${plan ? "not started" : `${escapeHtml(valueLabel)} ${budgetSalesBarFormat(value, kind)} against ${escapeHtml(targetLabel.toLowerCase())} ${budgetSalesBarFormat(fullTarget, kind)}`}">${track}</div><small class="budget-sales-month-bar__change${changeTone ? ` budget-sales-month-bar__change--${changeTone}` : ""}">${escapeHtml(change)}</small></section>`;
}

function renderBudgetSalesMonthProgress(month) {
  if (month.status !== "active") return "";
  const progress = Math.max(0, Math.min(1, Number(month.reportingProgress) || 0));
  const percentage = Math.round(progress * 100);
  const actualDays = Number(month.actualCalendarDays) || 0;
  const totalDays = Number(month.calendarDays) || 0;
  const dayLabel = totalDays === 1 ? "calendar day" : "calendar days";
  return `<section class="budget-sales-month__progress" aria-label="Month progress"><div><span>Month progress</span><strong>${actualDays} of ${totalDays} ${dayLabel} · ${percentage}% trade-weighted</strong></div><div class="budget-sales-month__progress-track" role="progressbar" aria-label="${escapeHtml(month.label)} trade-weighted month progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percentage}"><i style="width:${percentage}%"></i></div><small>The bar follows the usual Monday–Sunday sales mix until daily sales are available.</small></section>`;
}

function renderBudgetSalesLiveCovers(month) {
  if (month.status !== "active" || month.coversNeededAtCurrentSpend === null) return "";
  const coversStillNeeded = Math.ceil(month.coversNeededAtCurrentSpend);
  const coversForecast = month.actualCovers + month.coversNeededAtCurrentSpend;
  const fullCoversPlan = month.reforecastMonthlyCovers;
  const difference = coversForecast - fullCoversPlan;
  const coverLabel = coversStillNeeded === 1 ? "cover" : "covers";
  const planComparison = Math.abs(difference) < .5
    ? "matches the full covers plan"
    : `${Math.abs(Math.round(difference))} ${Math.abs(Math.round(difference)) === 1 ? "cover" : "covers"} ${difference < 0 ? "fewer" : "more"} than the full covers plan`;
  const needText = month.remainingSalesNeeded <= 0
    ? "Sales target reached"
    : `${coversStillNeeded} ${coverLabel} still needed · ${planComparison}`;
  return renderBudgetSalesMonthBar("Covers forecast at current SPH", coversForecast, fullCoversPlan, "number", "Forecast", {
    targetLabel: "Plan",
    comparisonLabel: "plan",
    progressToTotal: true,
    toneOverride: "live-covers",
    changeOverride: needText,
    changeToneOverride: month.remainingSalesNeeded > .5 ? "needed" : "reached"
  });
}

function renderBudgetSalesProjection(month) {
  if (month.status !== "active") return "";
  const dayLabel = month.actualCalendarDays === 1 ? "calendar day" : "calendar days";
  return `<section class="budget-sales-projection" aria-label="${escapeHtml(month.label)} projected month-end"><header><div><span>Projected month-end</span><strong>Current run-rate forecast</strong></div><small>Based on ${month.actualCalendarDays} ${dayLabel}, weighted to the usual Monday–Sunday sales mix; this does not replace the actual-to-date view.</small></header><div class="budget-sales-projection__bars">${renderBudgetSalesMonthBar("Sales ex VAT", month.summarySalesValue, month.summarySalesTarget, "currency", "Projected")}${renderBudgetSalesMonthBar("Covers", month.summaryCoversValue, month.summaryCoversTarget, "number", "Projected")}${renderBudgetSalesMonthBar("SPH inc VAT", month.summarySpendPerHeadValue, month.summarySpendPerHeadTarget, "sph", "Current actual")}</div></section>`;
}

function renderBudgetSalesWeeklyBar(label, value, target, kind = "number", { projected = false } = {}) {
  const hasValue = value !== null && value !== "" && Number.isFinite(Number(value));
  const tone = budgetSalesBarTone(value, target, { plan: !hasValue, kind });
  const fill = hasValue && Number(target) > 0 ? Math.min(100, Math.max(0, Number(value) / Number(target) * 100)) : 0;
  const difference = hasValue && Number.isFinite(Number(target)) ? Number(target) - Number(value) : null;
  const change = !hasValue ? "Not started" : Math.abs(difference) < .5 ? "Target reached" : difference > 0 ? `${budgetSalesBarFormat(difference, kind)} still needed` : `Up ${budgetSalesBarFormat(Math.abs(difference), kind)} vs target`;
  const changeTone = !hasValue ? "" : Math.abs(difference) < .5 ? "reached" : difference > 0 ? "needed" : "up";
  const track = hasValue ? `<i style="width:${fill.toFixed(2)}%"></i>` : "";
  const valueLabel = projected ? "projected" : "actual";
  return `<div class="budget-sales-week__metric budget-sales-week__metric--${tone}"><div><dt>${escapeHtml(label)}</dt><dd>${hasValue ? budgetSalesBarFormat(value, kind) : "—"}<small>Target ${budgetSalesBarFormat(target, kind)}</small></dd></div><div class="budget-sales-week__track" role="img" aria-label="${escapeHtml(label)}: ${hasValue ? `${valueLabel} ${budgetSalesBarFormat(value, kind)} against target ${budgetSalesBarFormat(target, kind)}` : "not started"}">${track}</div><small class="budget-sales-week__remaining${changeTone ? ` budget-sales-week__remaining--${changeTone}` : ""}">${escapeHtml(change)}</small></div>`;
}

function renderBudgetSalesMetric(label, actual, target, detail, kind = "number") {
  return `<div class="budget-sales-month__metric ${actual === null ? "budget-sales-month__metric--waiting" : ""}"><span>${escapeHtml(label)}</span><strong>${actual === null ? "—" : kind === "sph" ? budgetFormatSpendPerHead(actual) : executiveFormat(actual, kind)}</strong><small>${escapeHtml(detail || `Target ${kind === "sph" ? budgetFormatSpendPerHead(target) : executiveFormat(target, kind)}`)}</small></div>`;
}

function budgetSalesSummaryFormat(value, kind) {
  return kind === "sph" ? budgetFormatSpendPerHead(value) : executiveFormat(value, kind);
}

function renderBudgetSalesSummaryBar(label, value, target, kind = "number", valueLabel = "Actual", { notStarted = false } = {}) {
  const validValue = Number.isFinite(Number(value));
  const validTarget = Number.isFinite(Number(target)) && Number(target) > 0;
  const difference = validValue && validTarget ? Number(value) - Number(target) : null;
  const barTone = budgetSalesBarTone(value, target, { plan: notStarted, kind });
  const tone = barTone === "above-budget" ? "ahead" : barTone === "near-target" ? "on-plan" : barTone === "below-budget" ? "behind" : "plan";
  const fill = validValue && validTarget ? Math.min(100, Math.max(0, Number(value) / Number(target) * 100)) : 0;
  const remaining = validValue && validTarget ? Number(target) - Number(value) : null;
  const change = notStarted ? "Not started — reforecast plan" : difference === null ? "No actuals yet" : Math.abs(remaining) < .5 ? "Target reached" : remaining > 0 ? `${budgetSalesSummaryFormat(remaining, kind)} still needed` : `Up ${budgetSalesSummaryFormat(Math.abs(remaining), kind)} vs target`;
  const changeTone = notStarted || difference === null ? "" : Math.abs(remaining) < .5 ? "reached" : remaining > 0 ? "needed" : "up";
  return `<article class="budget-sales-summary__bar budget-sales-summary__bar--${tone}"><div><span>${escapeHtml(label)}</span><strong>${budgetSalesSummaryFormat(value, kind)}</strong></div><p><i>${escapeHtml(valueLabel)}</i><b>Target ${budgetSalesSummaryFormat(target, kind)}</b></p><div class="budget-sales-summary__track" role="img" aria-label="${escapeHtml(label)}: ${escapeHtml(valueLabel)} ${budgetSalesSummaryFormat(value, kind)} against target ${budgetSalesSummaryFormat(target, kind)}"><i style="width:${fill.toFixed(2)}%"></i></div><small class="budget-sales-summary__change${changeTone ? ` budget-sales-summary__change--${changeTone}` : ""}">${escapeHtml(change)}</small></article>`;
}

function renderBudgetSalesMonthlySummary(month) {
  const mode = month.status === "active" ? "Projected month-end" : month.status === "complete" ? "Final month actuals" : "Reforecast monthly plan";
  const description = month.status === "active" ? `Projection uses ${month.actualCalendarDays} calendar days, weighted to the usual Monday–Sunday sales mix.` : month.status === "complete" ? "Actual performance against the original monthly plan." : "The plan reflects any sales gap shared from completed months.";
  const valueLabel = month.status === "active" ? "Projected" : month.status === "complete" ? "Actual" : "Reforecast";
  const notStarted = month.status === "future";
  return `<section class="budget-sales-summary" aria-label="${escapeHtml(month.label)} monthly summary"><div class="budget-sales-summary__heading"><div><p class="eyebrow">MONTHLY SUMMARY</p><h3>${escapeHtml(mode)}</h3></div><p>${escapeHtml(description)}</p></div><div class="budget-sales-summary__bars">${renderBudgetSalesSummaryBar("Sales ex VAT", month.summarySalesValue, month.summarySalesTarget, "currency", valueLabel, { notStarted })}${renderBudgetSalesSummaryBar("Covers", month.summaryCoversValue, month.summaryCoversTarget, "number", valueLabel, { notStarted })}${renderBudgetSalesSummaryBar("SPH inc VAT", month.summarySpendPerHeadValue, month.summarySpendPerHeadTarget, "sph", valueLabel, { notStarted })}</div><p class="budget-sales-summary__key"><i aria-hidden="true"></i>Coloured bar = ${escapeHtml(valueLabel.toLowerCase())}. The bar end is the target total.</p></section>`;
}

function renderBudgetSalesWeeks(month) {
  const remainingNote = month.status === "active" && month.remainingWeekCount ? month.remainingCalendarDays === 1 ? "The remaining calendar day carries its share of the updated target." : `The remaining ${month.remainingCalendarDays} calendar days carry their share of the updated target.` : month.status === "complete" ? "Actuals are split across the calendar days in this month and compared with the original monthly plan." : "Targets include any reforecast shared from completed months.";
  const canProject = month.status === "active" && month.actualWeekCount > 0 && month.remainingWeekCount > 0;
  const projectionOpen = state.budgetSalesWeekProjectionMonth === month.month;
  const futureWeeks = month.weekly.filter((week) => !week.hasActual && !week.pastWeek);
  const distributeProjection = (forecast, actual) => {
    if (!futureWeeks.length) return [];
    const remaining = Math.round(forecast) - Math.round(actual);
    const remainingTradeWeight = futureWeeks.reduce((total, week) => total + week.tradeWeight, 0);
    let allocated = 0;
    return futureWeeks.map((week, index) => {
      const value = index === futureWeeks.length - 1
        ? remaining - allocated
        : Math.round(remaining * (remainingTradeWeight ? week.tradeWeight / remainingTradeWeight : 1 / futureWeeks.length));
      allocated += value;
      return { week: week.week, value };
    });
  };
  const projectedSalesByWeek = new Map(distributeProjection(month.summarySalesValue, month.actualSales).map((item) => [item.week, item.value]));
  const projectedCoversByWeek = new Map(distributeProjection(month.summaryCoversValue, month.actualCovers).map((item) => [item.week, item.value]));
  return `<section class="budget-sales-weeks" aria-label="${escapeHtml(month.label)} weekly breakdown"><div class="budget-sales-weeks__heading"><strong>Weekly breakdown</strong><span>${escapeHtml(remainingNote)}</span></div>${canProject ? `<button class="budget-sales-weeks__projection-button" type="button" data-action="toggle-budget-sales-week-projection" data-month="${escapeHtml(month.month)}" aria-expanded="${projectionOpen}">${projectionOpen ? "Hide projected remaining weeks" : `View projection for ${month.remainingWeekCount} remaining ${month.remainingWeekCount === 1 ? "week" : "weeks"}`}<b aria-hidden="true">${projectionOpen ? "−" : "+"}</b></button>${projectionOpen ? `<p class="budget-sales-weeks__projection-note">These figures use the same current run rate as the projected month-end view.</p>` : ""}` : ""}<div class="budget-sales-weeks__list">${month.weekly.map((week) => {
    const projected = projectionOpen && !week.hasActual && !week.pastWeek;
    const status = week.hasActual ? "Actual" : projected ? "Projected" : week.pastWeek ? "Awaiting data" : "Target";
    const sales = projected ? projectedSalesByWeek.get(week.week) : week.actualSales;
    const covers = projected ? projectedCoversByWeek.get(week.week) : week.actualCovers;
    const spendPerHead = projected ? month.actualSpendPerHead : week.actualSpendPerHead;
    const dayText = `${week.daysInMonth} ${week.daysInMonth === 1 ? "day" : "days"} in month`;
    return `<article class="budget-sales-week budget-sales-week--${week.hasActual ? "actual" : projected ? "projected" : week.pastWeek ? "missing" : "future"}"><header><span>${escapeHtml(formatDate(week.week, true))}</span><b>${status} · ${dayText}</b></header><dl>${renderBudgetSalesWeeklyBar("Sales ex VAT", sales, week.targetSales, "currency", { projected })}${renderBudgetSalesWeeklyBar("Covers", covers, week.targetCovers, "number", { projected })}${renderBudgetSalesWeeklyBar("SPH inc VAT", spendPerHead, week.targetSpendPerHead, "sph", { projected })}</dl></article>`;
  }).join("")}</div></section>`;
}

function budgetSalesMonthPresentation(month) {
  const varianceTone = budgetSalesVarianceTone(month.variance);
  const expanded = state.budgetSalesExpandedMonth === month.month;
  const varianceText = varianceTone === "on-budget" ? "Matches budget" : `${month.variance > 0 ? "Up" : "Down"} ${executiveFormat(Math.abs(month.variance), "currency")} vs original budget`;
  const startingSpendText = month.usesAnnualSpendFallback
    ? `Annual previous-year SPH used: ${budgetFormatSpendPerHead(month.startingSpendPerHead)} inc VAT`
    : `${accountantBudgetMonthLabel(month.priorMonth)} average SPH: ${budgetFormatSpendPerHead(month.startingSpendPerHead)} inc VAT`;
  const isComplete = month.status === "complete";
  const isActive = month.status === "active";
  const targetSalesLabel = isComplete ? "Original plan" : isActive ? "Current reforecast" : "Reforecast";
  const salesDetail = month.hasActuals ? `${targetSalesLabel} ${executiveFormat(isComplete ? month.baseSalesTarget : month.reforecastSalesTarget, "currency")}` : `Budget ${executiveFormat(month.sales, "currency")}`;
  const coversDetail = isComplete ? `Original plan ${executiveFormat(month.plannedMonthlyCovers)} covers` : `Reforecast ${executiveFormat(month.reforecastMonthlyCovers)} covers`;
  const spendDetail = isComplete
    ? `Budget target ${budgetFormatSpendPerHead(month.targetSpendPerHead)}`
    : `Fixed SPH target ${budgetFormatSpendPerHead(month.targetSpendPerHead)}`;
  const statusText = isComplete ? "Completed month" : isActive ? `Live to ${formatDate(month.cutoff, true)}` : "Not started";
  const statusTarget = isActive ? `${executiveFormat(month.remainingSalesNeeded, "currency")} sales still required` : !isComplete && Math.abs(month.reforecastSalesTarget - month.baseSalesTarget) >= .5 ? `${month.reforecastSalesTarget > month.baseSalesTarget ? "Up" : "Down"} ${executiveFormat(Math.abs(month.reforecastSalesTarget - month.baseSalesTarget), "currency")} from the monthly plan` : `${month.weekCount} reporting weeks`;
  return { varianceTone, expanded, varianceText, startingSpendText, isComplete, isActive, targetSalesLabel, salesDetail, coversDetail, spendDetail, statusText, statusTarget };
}

function budgetSalesMonthHasOverrides(year, month) {
  const assumptions = state.budgetSalesAssumptions?.[year]?.[month] || {};
  return ["coversPerWeek", "spendPerHead"].some((field) => plainText(assumptions[field]) !== "");
}

function renderBudgetSalesMonth(month) {
  const view = budgetSalesMonthPresentation(month);
  const plan = month.status === "future";
  const live = view.isActive;
  const salesValue = live ? month.actualSales : month.summarySalesValue;
  const salesTarget = month.summarySalesTarget;
  const coversValue = live ? month.actualCovers : month.summaryCoversValue;
  const coversTarget = month.summaryCoversTarget;
  const salesTone = budgetSalesBarTone(salesValue, salesTarget, { plan, kind: "currency" });
  const valueLabel = view.isComplete ? "Actual" : live ? "Actual to date" : "Planned";
  const headlineSales = live ? month.actualSales : view.isComplete ? month.summarySalesValue : month.monthlySalesTarget;
  const headlineLabel = view.isComplete ? "Actual sales ex VAT" : live ? "Actual sales ex VAT to date" : "Sales plan ex VAT";
  const projectionOpen = state.budgetSalesProjectionMonth === month.month;
  const salesPlanOptions = { targetLabel: "Plan", comparisonLabel: "plan", scaleTarget: month.summarySalesTarget, progressToTotal: true };
  const coversPlanOptions = { targetLabel: "Plan", comparisonLabel: "plan", scaleTarget: month.summaryCoversTarget, progressToTotal: true };
  return `<article class="budget-sales-month budget-sales-month--${salesTone}" data-budget-month="${escapeHtml(month.month)}">
    <button class="budget-sales-month__toggle" type="button" data-action="open-budget-sales-month" data-month="${escapeHtml(month.month)}"><div class="budget-sales-month__heading"><div><span>${escapeHtml(month.label)}</span><strong>${executiveFormat(headlineSales, "currency")}</strong><small>${headlineLabel}</small></div><div><span>Budget ex VAT</span><b>${executiveFormat(month.sales, "currency")}</b><small>Open month ›</small></div></div>
      <div class="budget-sales-month__week"><span>${escapeHtml(view.statusText)}</span><strong>${escapeHtml(view.statusTarget)}</strong></div>
      ${renderBudgetSalesMonthProgress(month)}
      <div class="budget-sales-month__bars">${renderBudgetSalesMonthBar("Sales ex VAT", salesValue, salesTarget, "currency", valueLabel, live ? salesPlanOptions : { plan })}${renderBudgetSalesMonthBar("Covers", coversValue, coversTarget, "number", valueLabel, live ? coversPlanOptions : { plan })}${renderBudgetSalesLiveCovers(month)}${renderBudgetSalesMonthBar("SPH inc VAT", month.summarySpendPerHeadValue, month.summarySpendPerHeadTarget, "sph", valueLabel, { plan })}</div>
      <p class="budget-sales-month__open">Open the month for weekly performance and planning controls <b aria-hidden="true">›</b></p>
    </button>
    ${live ? `<button class="budget-sales-month__projection-button" type="button" data-action="toggle-budget-sales-projection" data-month="${escapeHtml(month.month)}" aria-expanded="${projectionOpen}">${projectionOpen ? "Hide projected month-end" : "View projected month-end"}<b aria-hidden="true">${projectionOpen ? "−" : "+"}</b></button>${projectionOpen ? renderBudgetSalesProjection(month) : ""}` : ""}
  </article>`;
}

function renderBudgetSalesMonthPage() {
  const year = profitPlanSelectedYear();
  const plan = budgetSalesPlan(year);
  const month = plan?.months.find((item) => item.month === state.budgetSalesDetailMonth);
  if (!month) return `<section class="budget-sales-detail-page"><button class="back-link" type="button" data-action="return-budget-sales-plan">&larr; Budget &amp; targets</button><div class="page-intro"><p class="eyebrow">MONTHLY PLAN</p><h2>Month not available</h2><p>Return to Budget &amp; Targets to choose a month.</p></div></section>`;
  const view = budgetSalesMonthPresentation(month);
  const live = view.isActive;
  const detailHeadline = live ? month.actualSales : view.isComplete ? month.summarySalesValue : month.monthlySalesTarget;
  const detailHeadlineLabel = view.isComplete ? "Actual sales ex VAT" : live ? "Actual sales ex VAT to date" : "Sales plan ex VAT";
  const projectionOpen = state.budgetSalesProjectionMonth === month.month;
  const hasOverrides = budgetSalesMonthHasOverrides(year, month.month);
  const spendTargetExplanation = view.isComplete
    ? ""
    : `<p class="budget-sales-month__automatic"><strong>Fixed SPH target: ${budgetFormatSpendPerHead(month.reforecastSpendPerHeadTarget)}.</strong> It stays at the budget starting value unless you change it here. Covers are then calculated at ${executiveFormat(month.reforecastCoversPerWeek)} per week to deliver the current sales plan of ${executiveFormat(month.reforecastSalesTarget, "currency")}.</p>`;
  return `<section class="budget-sales-detail-page">
    <button class="back-link" type="button" data-action="return-budget-sales-plan">&larr; Budget &amp; targets</button>
    <div class="page-intro"><p class="eyebrow">${escapeHtml(year)} MONTHLY PLAN</p><h2>${escapeHtml(monthTitle(month.month))}</h2><p>Review the month’s actuals, the target still required and each reporting week in one place.</p></div>
    <section class="budget-sales-month-detail" aria-label="${escapeHtml(month.label)} budget detail">
      <div class="budget-sales-month__heading"><div><span>${escapeHtml(month.label)}</span><strong>${executiveFormat(detailHeadline, "currency")}</strong><small>${detailHeadlineLabel}</small></div><div><span>Budget ex VAT</span><b>${executiveFormat(month.sales, "currency")}</b></div></div>
      <div class="budget-sales-month__week"><span>${escapeHtml(view.statusText)}</span><strong>${escapeHtml(view.statusTarget)}</strong></div>
      ${renderBudgetSalesMonthProgress(month)}
      ${renderBudgetSalesLiveCovers(month)}
      ${live ? `<button class="budget-sales-month__projection-button" type="button" data-action="toggle-budget-sales-projection" data-month="${escapeHtml(month.month)}" aria-expanded="${projectionOpen}">${projectionOpen ? "Hide projected month-end" : "View projected month-end"}<b aria-hidden="true">${projectionOpen ? "−" : "+"}</b></button>${projectionOpen ? renderBudgetSalesProjection(month) : ""}` : ""}
      <p class="budget-sales-month__basis">Starting point: ${escapeHtml(view.startingSpendText)}</p>
      <div class="budget-sales-month__inputs"><label>Starting covers / week<input type="number" min="0" step="1" inputmode="numeric" data-action="budget-sales-input" data-month="${escapeHtml(month.month)}" data-field="coversPerWeek" value="${month.coversPerWeek.toFixed(1)}"></label><label>Starting SPH inc VAT (£)<input type="number" min="0.01" step="0.01" inputmode="decimal" data-action="budget-sales-input" data-month="${escapeHtml(month.month)}" data-field="spendPerHead" value="${month.spendPerHead.toFixed(2)}"></label></div>
      <p class="budget-sales-month__input-help">Changes apply when you tap outside the field or press Return. SPH stays fixed until you change it. Changing either starting assumption creates a manual sales-plan change.</p>
      ${spendTargetExplanation}
      ${hasOverrides ? `<button class="budget-sales-month__reset-button" type="button" data-action="reset-budget-sales-month" data-month="${escapeHtml(month.month)}">Return to budget <small>Keeps any sales reforecast from completed months</small></button>` : ""}
      <p class="budget-sales-month__variance budget-sales-month__variance--${view.varianceTone}">${escapeHtml(view.varianceText)}</p>
      ${renderBudgetSalesWeeks(month)}
    </section>
  </section>`;
}

function renderBudgetSalesGuide() {
  return `<section class="budget-sales-guide" aria-label="How Total Sales works"><header><div><span>HOW TOTAL SALES WORKS</span><strong>A simple guide</strong></div><button type="button" data-action="toggle-budget-sales-guide" aria-label="Close Total Sales guide">×</button></header><ol><li><strong>Budget first.</strong> Each month starts with its sales budget. The starting covers target uses that month’s spend per head from the previous financial year.</li><li><strong>Split weeks realistically.</strong> Until daily sales are available, a cross-month reporting week uses the usual sales mix: Monday 0.01%, Tuesday 8.06%, Wednesday 9.91%, Thursday 13.40%, Friday 21.53%, Saturday 31.25% and Sunday 15.83%. Covers use the same temporary pattern so SPH still reconciles.</li><li><strong>Keep targets fixed.</strong> SPH stays at its budget starting value unless you manually change it. When a completed-month sales gap changes a future sales plan, covers recalculate at that fixed SPH so the numbers still reconcile.</li><li><strong>Read the bars.</strong> The large figure is the current total, the figure on the right is the full target total, and the bar fills towards that target. The note underneath shows what is still needed. Green means the target has been met; amber means it is close but short; red means it is materially short.</li><li><strong>Use the same tolerance everywhere.</strong> A result is amber when it is short by no more than £2,000 in sales, 200 covers or £5 SPH. Any result at or above target is green.</li><li><strong>Read the month status.</strong> Completed months show final actuals. A live month shows actuals to date. Future months and weeks are targets only, so their bars stay empty.</li><li><strong>Keep the annual plan whole.</strong> When a month closes above or below budget, the sales gap is applied as the same percentage uplift or reduction across all remaining monthly sales plans.</li><li><strong>Keep the covers KPI honest.</strong> In a live month, “Covers forecast at current SPH” estimates the total covers needed for the month at the SPH achieved so far. Its blue fill is measured against the full covers plan. It is a forecast, not a new target.</li><li><strong>Use projections as a guide.</strong> In a live month, projected month-end and projected remaining weeks use the current run rate. They never change the budget or actual results.</li><li><strong>Adjust with care.</strong> You can change starting Covers per week or starting SPH. This creates a manual sales-plan change. “Return to budget” removes it but keeps any sales uplift or reduction already carried forward from completed months.</li></ol><p><strong>Remember:</strong> sales figures are ex VAT; SPH is shown inc VAT because it is easier to use operationally.</p></section>`;
}

function renderBudgetSalesPlan(year) {
  const plan = budgetSalesPlan(year);
  if (!plan) {
    const budget = profitPlanBudgetForYear(year);
    const previousYear = priorFinancialYear(year);
    const message = !budget
      ? "Upload the annual budget above first. Once it is saved, this area will turn it into monthly sales, covers and spend-per-head targets using the Master Performance Sheet already uploaded to the app."
      : `The current Master Performance Sheet does not yet contain usable sales and covers for ${previousYear}. This page already uses the shared Master Sheet; upload a newer Master only if that earlier-year data is genuinely missing.`;
    return `<section class="budget-sales-plan budget-sales-plan--empty"><div><p class="eyebrow">TOTAL SALES</p><h3>${budget ? "Previous-year cover data is unavailable" : "Connect the annual budget"}</h3><p>${escapeHtml(message)}</p></div></section>`;
  }
  const previousYear = priorFinancialYear(year);
  const totalTone = budgetSalesVarianceTone(plan.variance);
  const totalVariance = totalTone === "on-budget" ? "Matches budget" : `${plan.variance > 0 ? "Up" : "Down"} ${executiveFormat(Math.abs(plan.variance), "currency")} vs budget`;
  const completedNote = !plan.completedMonths ? "No completed months yet, so every month is still on its original plan." : !plan.remainingMonths ? `All months are complete. Final completed-month variance: ${plan.completedGap >= 0 ? "down" : "up"} ${executiveFormat(Math.abs(plan.completedGap), "currency")}.` : plan.completedGap === 0 ? "Completed months match plan, so the remaining months are unchanged." : `${plan.completedGap > 0 ? "Down" : "Up"} ${executiveFormat(Math.abs(plan.completedGap), "currency")} from completed months is applied as an even ${Math.abs(plan.sharedSalesUplift * 100).toFixed(1)}% ${plan.completedGap > 0 ? "uplift" : "reduction"} across the remaining monthly budgets.`;
  const spendTargetNote = "SPH targets remain at their budget starting values unless you change them manually. Actual SPH is shown as performance and as a separate live covers forecast; it does not silently replace the target.";
  const guideOpen = Boolean(state.budgetSalesGuideOpen);
  return `<section class="budget-sales-plan" aria-label="Total sales budget">
    <div class="budget-sales-plan__heading"><div><p class="eyebrow">TOTAL SALES</p><h3>Turn the sales budget into a live monthly plan</h3><p>See actual sales, covers and SPH against each month’s plan. Sales gaps are shared across future sales plans; SPH remains fixed unless you deliberately change it.</p></div><div class="budget-sales-plan__actions"><button type="button" data-action="toggle-budget-sales-guide" aria-expanded="${guideOpen}">ⓘ How this works</button><button type="button" data-action="reset-budget-sales-plan">Reset to budget</button></div></div>
    ${guideOpen ? renderBudgetSalesGuide() : ""}
    <div class="budget-sales-plan__baseline"><div><span>Annual sales budget ex VAT</span><strong>${executiveFormat(plan.totalBudgetSales, "currency")}</strong></div><div><span>Reporting cut-off</span><strong>${plan.cutoff ? escapeHtml(formatDate(plan.cutoff, true)) : "No actuals"}</strong><small>Actuals shown up to this reporting week</small></div><div><span>Starting SPH</span><strong>Same month last year</strong><small>SPH converts to ex VAT for the budget</small></div></div>
    <div class="budget-sales-plan__months">${plan.months.map(renderBudgetSalesMonth).join("")}</div>
    <div class="budget-sales-plan__total budget-sales-plan__total--${totalTone}"><div><span>Annual sales forecast ex VAT</span><strong>${executiveFormat(plan.totalSalesTarget, "currency")}</strong><small>${totalVariance}</small></div><div><span>Annual budget ex VAT</span><strong>${executiveFormat(plan.totalBudgetSales, "currency")}</strong></div></div>
    <p class="budget-sales-plan__reforecast">${escapeHtml(completedNote)}</p>
    <p class="budget-sales-plan__reforecast budget-sales-plan__reforecast--sph">${escapeHtml(spendTargetNote)}</p>
    <p class="budget-sales-plan__note">Each month starts with that same calendar month’s actual SPH from ${escapeHtml(previousYear)}. SPH is shown including VAT, then converted to ex VAT so sales reconcile with the budget. A manual change to starting covers or SPH creates a new sales-plan assumption for that month.</p>
  </section>`;
}

function renderProfitPlanOpportunity(opportunity) {
  const benefit = profitPlanNumber(opportunity.expectedBenefit);
  return `<article class="profit-opportunity profit-opportunity--${escapeHtml(opportunity.priority || "medium")}">
    <div class="profit-opportunity__heading"><div><span>${escapeHtml(opportunity.category || "Other")}</span><h3>${escapeHtml(opportunity.title)}</h3></div><strong>${benefit === null ? "Estimate needed" : executiveFormat(benefit, "currency")}</strong></div>
    <p>${escapeHtml(opportunity.description || "No description added yet.")}</p>
    <dl><div><dt>Baseline</dt><dd>${escapeHtml(opportunity.baseline || "—")}</dd></div><div><dt>Target</dt><dd>${escapeHtml(opportunity.target || "—")}</dd></div><div><dt>Owner</dt><dd>${escapeHtml(opportunity.owner || "Unassigned")}</dd></div><div><dt>Due</dt><dd>${escapeHtml(opportunity.dueDate ? formatDate(opportunity.dueDate) : "Not set")}</dd></div></dl>
    ${opportunity.actions ? `<p class="profit-opportunity__actions"><strong>Actions:</strong> ${escapeHtml(opportunity.actions)}</p>` : ""}
    <form class="profit-opportunity__status" data-profit-opportunity-status><input type="hidden" name="opportunityId" value="${escapeHtml(opportunity.id)}"><label>Status<select name="status"><option value="identified" ${opportunity.status === "identified" ? "selected" : ""}>Identified</option><option value="in-progress" ${opportunity.status === "in-progress" ? "selected" : ""}>In progress</option><option value="delivered" ${opportunity.status === "delivered" ? "selected" : ""}>Delivered</option><option value="on-hold" ${opportunity.status === "on-hold" ? "selected" : ""}>On hold</option><option value="cancelled" ${opportunity.status === "cancelled" ? "selected" : ""}>Cancelled</option></select></label><button type="submit">Save</button><button type="button" data-action="remove-profit-opportunity" data-opportunity-id="${escapeHtml(opportunity.id)}">Remove</button></form>
  </article>`;
}

function renderProfitPlanQuarter(plan, year, quarter) {
  const focus = plan.quarters?.[quarter] || {};
  const kpi = profitPlanKpi(focus.focusKpiId);
  const rows = profitPlanQuarterRows(year, quarter);
  const actual = kpi ? profitPlanKpiValue(rows, kpi.id) : null;
  const prior = kpi ? profitPlanKpiValue(executiveComparableRows(rows.map((row) => row.week)), kpi.id) : null;
  const target = profitPlanNumber(focus.target);
  const active = profitPlanCurrentQuarter(year) === quarter;
  const tone = profitPlanTone(actual, target, kpi?.lowerIsBetter);
  return `<form class="profit-quarter ${active ? "is-active" : ""}" data-profit-quarter-form data-quarter="${quarter}">
    <div class="profit-quarter__heading"><div><span>${profitPlanQuarterLabels[quarter]}</span><h3>${kpi ? escapeHtml(kpi.label) : "Set primary KPI focus"}</h3></div><i class="profit-status profit-status--${tone}">${active ? "Current focus" : profitPlanStatusLabel(focus.status)}</i></div>
    <div class="profit-quarter__metrics"><div><span>Starting point</span><strong>${kpi ? profitPlanFormatKpi(kpi, prior) : "—"}</strong></div><div><span>Current actual</span><strong>${kpi ? profitPlanFormatKpi(kpi, actual) : "—"}</strong></div><div><span>Target</span><strong>${kpi && target !== null ? profitPlanFormatKpi(kpi, target) : "Set target"}</strong></div></div>
    <div class="profit-quarter__fields"><label>Primary KPI<select name="focusKpiId">${profitPlanKpiOptions(focus.focusKpiId)}</select></label><label>Quarter KPI target<input name="target" inputmode="decimal" value="${escapeHtml(kpi ? profitPlanInputValue(kpi, target) : "")}" placeholder="Enter target"></label><label>Expected £ benefit<input name="expectedBenefit" type="number" inputmode="decimal" min="0" step="1" value="${escapeHtml(focus.expectedBenefit || "")}" placeholder="Optional"></label><label>Owner<select name="owner">${profitPlanPeopleOptions(focus.owner)}</select></label><label>Plan status<select name="status"><option value="not-started" ${focus.status === "not-started" ? "selected" : ""}>Not started</option><option value="in-progress" ${focus.status === "in-progress" ? "selected" : ""}>In progress</option><option value="complete" ${focus.status === "complete" ? "selected" : ""}>Complete</option><option value="on-hold" ${focus.status === "on-hold" ? "selected" : ""}>On hold</option><option value="cancelled" ${focus.status === "cancelled" ? "selected" : ""}>Cancelled</option></select></label><label class="profit-quarter__actions">Key actions<textarea name="actions" rows="3" placeholder="What will change this quarter?">${escapeHtml(focus.actions || "")}</textarea></label></div>
    <button type="submit">Save ${quarter} focus</button>
  </form>`;
}

function renderProfitPlanWeeklyTracking(plan, year) {
  const quarter = profitPlanCurrentQuarter(year);
  const focus = plan.quarters?.[quarter] || {};
  const kpi = profitPlanKpi(focus.focusKpiId);
  if (!kpi) return `<section class="profit-plan-panel profit-weekly-tracking"><div class="profit-plan-panel__heading"><div><p class="eyebrow">WEEKLY KPI TRACKING</p><h3>Set ${quarter}’s primary KPI to begin tracking</h3></div></div><p>Weekly actuals, the target, a 13-week average and same-week-last-year comparison will appear here automatically once a quarterly focus is selected.</p></section>`;
  const target = profitPlanNumber(focus.target);
  const weeklyRows = profitPlanQuarterRows(year, quarter).slice(-13);
  const allRows = executiveRows();
  return `<section class="profit-plan-panel profit-weekly-tracking"><div class="profit-plan-panel__heading"><div><p class="eyebrow">WEEKLY KPI TRACKING</p><h3>${escapeHtml(kpi.label)} · ${profitPlanQuarterLabels[quarter]}</h3><p>${escapeHtml(kpi.basis)}. Target: ${target === null ? "not set" : profitPlanFormatKpi(kpi, target)}.</p></div></div><div class="profit-weekly-table-wrap"><table><thead><tr><th>Week</th><th>Actual</th><th>Target</th><th>13-week avg.</th><th>Same week LY</th></tr></thead><tbody>${weeklyRows.map((row) => {
    const actual = profitPlanKpiValue([row], kpi.id);
    const index = allRows.findIndex((item) => item.week === row.week);
    const rollingRows = allRows.slice(Math.max(0, index - 12), index + 1);
    const rolling = rollingRows.map((item) => profitPlanKpiValue([item], kpi.id)).filter(Number.isFinite);
    const rollingAverage = rolling.length ? rolling.reduce((total, value) => total + value, 0) / rolling.length : null;
    const prior = profitPlanKpiValue(executiveComparableRows([row.week]), kpi.id);
    const tone = profitPlanTone(actual, target, kpi.lowerIsBetter);
    return `<tr class="profit-weekly-row--${tone}"><td>${escapeHtml(formatDate(row.week))}</td><td>${profitPlanFormatKpi(kpi, actual)}</td><td>${target === null ? "—" : profitPlanFormatKpi(kpi, target)}</td><td>${profitPlanFormatKpi(kpi, rollingAverage)}</td><td>${profitPlanFormatKpi(kpi, prior)}</td></tr>`;
  }).join("") || '<tr><td colspan="5">No weekly data is available for this quarter yet.</td></tr>'}</tbody></table></div></section>`;
}

function renderProfitPlanReview(plan, year) {
  const quarter = profitPlanCurrentQuarter(year);
  const focus = plan.quarters?.[quarter] || {};
  const kpi = profitPlanKpi(focus.focusKpiId);
  const months = profitPlanMonths(year, quarter);
  const month = months.includes(state.profitPlanReviewMonth) ? state.profitPlanReviewMonth : months.at(-1) || "";
  const review = plan.reviews?.[month] || {};
  const monthRows = profitPlanFinancialYearRows(year).filter((row) => row.week.startsWith(month));
  const quarterToDateRows = profitPlanQuarterRows(year, quarter).filter((row) => row.week <= `${month}-31`);
  const target = profitPlanNumber(focus.target);
  return `<section class="profit-plan-panel profit-monthly-review"><div class="profit-plan-panel__heading"><div><p class="eyebrow">MONTHLY REVIEW</p><h3>${month ? monthTitle(month) : "Monthly checkpoint"}</h3></div></div><form data-profit-review-form><label>Review month<select name="month" data-action="profit-plan-review-month">${months.map((item) => `<option value="${item}" ${item === month ? "selected" : ""}>${monthTitle(item)}</option>`).join("")}</select></label><div class="profit-review__metrics"><div><span>Target KPI</span><strong>${kpi ? escapeHtml(kpi.label) : "Choose a quarterly focus"}</strong></div><div><span>Month actual</span><strong>${kpi ? profitPlanFormatKpi(kpi, profitPlanKpiValue(monthRows, kpi.id)) : "—"}</strong></div><div><span>Quarter to date</span><strong>${kpi ? profitPlanFormatKpi(kpi, profitPlanKpiValue(quarterToDateRows, kpi.id)) : "—"}</strong></div><div><span>Target</span><strong>${kpi && target !== null ? profitPlanFormatKpi(kpi, target) : "—"}</strong></div></div><label>Management review<textarea name="comments" rows="3" placeholder="What happened, what was learned, and what will change next month?">${escapeHtml(review.comments || "")}</textarea></label><label>Decision for next month<textarea name="decision" rows="2" placeholder="Keep, adjust, pause or escalate the plan.">${escapeHtml(review.decision || "")}</textarea></label><button type="submit">Save monthly review</button></form></section>`;
}

function renderProfitImprovementPlan() {
  const years = profitPlanYears();
  if (!years.length) return `<section class="profit-plan-page"><button class="back-link" type="button" data-section="hub">&larr; Information Hub</button><div class="page-intro"><p class="eyebrow">BUDGET &amp; TARGETS</p><h2>Set the financial plan</h2><p>Upload the full Master Performance Sheet to begin tracking an annual budget.</p></div></section>`;
  const year = profitPlanSelectedYear();
  const yearRows = profitPlanFinancialYearRows(year);
  return `<section class="profit-plan-page">
    <button class="back-link" type="button" data-section="hub">&larr; Information Hub</button>
    <div class="profit-plan-hero"><p class="eyebrow">BUDGET &amp; TARGETS</p><h2>Lay out the budget, properly.</h2><p>Start with the annual sales plan, turn it into monthly and weekly targets, then build the rest of the budget from the same clear structure.</p></div>
    <section class="profit-plan-controls"><label>Financial year<select data-action="profit-plan-year">${years.map((item) => `<option value="${item}" ${item === year ? "selected" : ""}>${item} · May–April</option>`).join("")}</select></label><p><strong>${escapeHtml(year)} budget</strong><span>${yearRows.length} reporting weeks loaded from the Master Performance Sheet</span></p></section>
    <p class="profit-plan-local-note"><strong>Shared budget:</strong> uploaded budget figures and planning adjustments are available to Owners and Admins. This does not alter the weekly Master Sheet.</p>
    ${renderSensitiveAccessCheck()}
    ${state.profitPlanMessage ? `<p class="profit-plan-message">${escapeHtml(state.profitPlanMessage)}</p>` : ""}
    ${renderProfitPlanBudgetUpload(year)}
    ${renderProfitPlanBudget(year)}
    ${renderBudgetSalesPlan(year)}
  </section>`;
}

function renderNoReport() {
  if (canPublishReport()) return renderUpdateReport();
  return `<section class="auth-page"><div class="auth-card"><p class="eyebrow">WEEKLY REPORTS</p><h2>Your account is ready</h2><p>There is no weekly report published yet. An Admin or Owner will upload it shortly.</p><button class="auth-link" type="button" data-section="hub">Back to Information Hub</button><button class="auth-link" type="button" data-action="sign-out">Sign out</button></div></section>`;
}

function renderPreviewBanner() {
  if (!state.previewUser) return "";
  return `<section class="preview-banner"><div><p class="eyebrow">READ-ONLY PREVIEW</p><strong>Viewing ${escapeHtml(state.previewUser.name)}’s report</strong><span>${escapeHtml(state.previewUser.email || "")}</span></div><button type="button" data-action="exit-preview">Back to Admin</button></section>`;
}

function renderSensitiveAccessCheck() {
  if (state.access?.role === "admin") return state.adminMessage ? `<p class="admin-action-message">${escapeHtml(state.adminMessage)}</p>` : "";
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

function taskPeopleForEditor(excludeUserId = "") {
  return (state.adminUsers || []).filter((person) => person.enabled && person.id !== excludeUserId);
}

function renderTaskAccessEditor(savedAccess = null, excludeUserId = "") {
  const access = savedAccess || { canCreate: false, assigneeIds: [] };
  const selected = new Set(access.assigneeIds || []);
  const people = taskPeopleForEditor(excludeUserId);
  return `<details class="permission-area task-permission-area"><summary>Task permissions</summary><label class="permission-toggle"><input type="checkbox" name="taskCanCreate" ${access.canCreate ? "checked" : ""}><span>Can set tasks</span></label><div class="permission-field-group"><strong>May assign tasks to</strong>${people.length ? `<div class="permission-options">${people.map((person) => `<label><input type="checkbox" name="taskAssigneeIds" value="${escapeHtml(person.id)}" ${selected.has(person.id) ? "checked" : ""}><span>${escapeHtml(person.name || person.email)}</span></label>`).join("")}</div>` : '<p class="permission-empty">Create or enable another account first, then choose who this person can assign tasks to.</p>'}</div><p class="permission-date-note">Task setters can only assign tasks to the people ticked here. Admins and Owners always have full task access.</p></details>`;
}

function renderAdmin() {
  const users = state.adminUsers;
  return `<section class="admin-page">
    <button class="back-link" type="button" data-section="hub">&larr; Information Hub</button>
    <div class="page-intro"><p class="eyebrow">WEEKLY REPORTS</p><h2>Report viewing permissions</h2><p>Choose the report-ending dates, overview cards, sections, headings, and figures each Viewer can see. Account setup and activity are managed in Users.</p></div>
    ${renderSensitiveAccessCheck()}
    <section class="admin-people"><div class="section-label"><span></span>People and report access</div>${users === null ? '<p class="admin-loading">Loading people…</p>' : users.map(renderReportAccessUser).join("")}</section>
  </section>`;
}

function formatActivityTime(value) {
  if (!value) return "No activity recorded yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No activity recorded yet";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function renderUserActivitySummary(person) {
  const activity = person.activity || {};
  return `<div class="user-activity__summary"><span><b>${Number(activity.appViews || 0)}</b> app ${Number(activity.appViews || 0) === 1 ? "visit" : "visits"}</span><span>Last activity: ${escapeHtml(formatActivityTime(activity.lastViewedAt || person.lastSignInAt))}</span></div>`;
}

function renderUserActivity(person) {
  const activity = person.activity || {};
  const recent = Array.isArray(activity.recentViews) ? activity.recentViews.slice(0, 5) : [];
  return `<section class="user-activity">${renderUserActivitySummary(person)}${recent.length ? `<details open><summary>Recent views</summary><ul>${recent.map((item) => `<li><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(formatActivityTime(item.at))}</span></li>`).join("")}</ul></details>` : '<p>No Hub activity has been recorded for this account yet.</p>'}</section>`;
}

function renderUsers() {
  const users = state.adminUsers;
  const isAdmin = state.access?.role === "admin";
  return `<section class="admin-page users-page">
    <button class="back-link" type="button" data-section="hub">&larr; Information Hub</button>
    <div class="page-intro"><p class="eyebrow">ACCOUNT MANAGEMENT</p><h2>Users</h2><p>Create accounts, manage who can sign in, and review how people are using the Information Hub. Report viewing permissions are set separately in Weekly reports.</p></div>
    <button class="activity-page-button" type="button" data-section="activity"><span>◷</span> View recent activity</button>
    ${renderSensitiveAccessCheck()}
    <section class="admin-create"><h3>Add a user</h3><form data-account-form="create"><label>Name<input name="name" autocomplete="name" placeholder="Optional"></label><label>Email address<input required name="email" type="email" autocomplete="email" placeholder="person@example.com"></label><label>Temporary password<input required minlength="12" name="password" type="password" autocomplete="new-password" placeholder="At least 12 characters"></label><label>Role<select name="role"><option value="viewer">Viewer</option>${isAdmin ? '<option value="owner">Owner</option>' : ""}</select></label><p class="account-setup-note">New Viewers have no report content until their viewing permissions are selected in Weekly reports.</p><button class="auth-submit" type="submit">Create account</button></form></section>
    <section class="admin-people"><div class="section-label"><span></span>Accounts and activity</div>${users === null ? '<p class="admin-loading">Loading accounts…</p>' : users.map((person) => renderUserAccount(person, isAdmin)).join("")}</section>
  </section>`;
}

function renderActivity() {
  const users = state.adminUsers;
  return `<section class="admin-page activity-page">
    <button class="back-link" type="button" data-section="hub">&larr; Information Hub</button>
    <div class="page-intro"><p class="eyebrow">ACCOUNT ACTIVITY</p><h2>Recent activity</h2><p>See how often each person has opened the Information Hub and the most recent areas they have viewed.</p></div>
    <section class="admin-people"><div class="section-label"><span></span>Activity by account</div>${users === null ? '<p class="admin-loading">Loading account activity…</p>' : users.map((person) => `<article class="admin-user-card activity-user-card"><div><strong>${escapeHtml(person.name || person.email)}</strong><span>${escapeHtml(person.email)} · ${escapeHtml(person.role)}</span></div>${renderUserActivity(person)}</article>`).join("")}</section>
  </section>`;
}

function renderTaskAdmin() {
  const users = state.adminUsers;
  return `<section class="admin-page task-admin-page">
    <button class="back-link" type="button" data-section="hub">&larr; Information Hub</button>
    <div class="page-intro"><p class="eyebrow">TASK ADMIN CONTROL CENTRE</p><h2>Task permissions</h2><p>Choose who can set tasks and exactly who they are allowed to assign tasks to. Admins and Owners always have full task access.</p></div>
    ${renderSensitiveAccessCheck()}
    <section class="admin-people"><div class="section-label"><span></span>People and task access</div>${users === null ? '<p class="admin-loading">Loading people…</p>' : users.map((person) => {
      if (person.role === "admin" || person.role === "owner") return `<article class="admin-user-card task-admin-user-card"><div><strong>${escapeHtml(person.name || person.email)}</strong><span>${escapeHtml(person.email)}</span></div><p>${person.role === "admin" ? "Admin" : "Owner"} · Full task access</p></article>`;
      return `<form class="admin-user-card task-admin-user-card" data-task-admin-form><input type="hidden" name="userId" value="${escapeHtml(person.id)}"><div><strong>${escapeHtml(person.name || person.email)}</strong><span>${escapeHtml(person.email)}</span></div>${renderTaskAccessEditor(person.taskAccess, person.id)}<div class="admin-user-card__actions"><button type="submit">Save task permissions</button></div></form>`;
    }).join("")}</section>
  </section>`;
}

function renderReportAccessUser(person) {
  const fullAccess = person.role === "admin" || person.role === "owner";
  if (fullAccess) return `<article class="admin-user-card"><div><strong>${escapeHtml(person.name || person.email)}</strong><span>${escapeHtml(person.email)}</span></div><p>${person.isInitialAdmin ? "Primary administrator" : "Owner account"} · Full report access</p>${renderPreviewButton(person)}</article>`;
  return `<form class="admin-user-card" data-report-access-form><input type="hidden" name="userId" value="${escapeHtml(person.id)}"><div class="admin-user-card__identity"><strong>${escapeHtml(person.name || person.email)}</strong><span>${escapeHtml(person.email)}</span></div>${renderAccessEditor(person.view, person.sections, false, person.dateAccess)}<div class="admin-user-card__actions">${renderPreviewButton(person)}<button type="submit">Save report permissions</button></div></form>`;
}

function renderUserAccount(person, isAdmin) {
  const canEdit = !person.isInitialAdmin && (isAdmin || person.role === "viewer");
  const activity = renderUserActivitySummary(person);
  if (!canEdit) return `<article class="admin-user-card user-account-card"><div><strong>${escapeHtml(person.name || person.email)}</strong><span>${escapeHtml(person.email)}</span></div><p>${person.isInitialAdmin ? "Primary administrator" : "Owner account"} · Full account access</p>${activity}</article>`;
  const owner = person.role === "owner";
  return `<form class="admin-user-card user-account-card" data-account-form="update"><input type="hidden" name="userId" value="${escapeHtml(person.id)}"><div class="admin-user-card__identity"><label>Name<input name="name" value="${escapeHtml(person.name || "")}" autocomplete="name"></label><span>${escapeHtml(person.email)}</span></div><div class="admin-user-card__controls"><label>Role<select name="role"><option value="viewer" ${!owner ? "selected" : ""}>Viewer</option>${isAdmin ? `<option value="owner" ${owner ? "selected" : ""}>Owner</option>` : ""}</select></label><label class="admin-toggle"><input name="enabled" type="checkbox" ${person.enabled ? "checked" : ""}><span>Can sign in</span></label></div>${activity}<div class="admin-user-card__actions"><button type="submit">Save account</button></div></form>`;
}

function setDrawerHeading(kicker, title) {
  drawerKicker.textContent = kicker;
  drawerTitle.textContent = title;
  drawer.setAttribute("aria-label", `${title} menu`);
}

function renderDrawerFooter() {
  const footer = document.querySelector(".drawer-footer");
  if (footer) footer.innerHTML = `<span>${escapeHtml(state.user?.email || "")}</span><button type="button" data-action="sign-out">Sign out</button>`;
}

function renderMenu() {
  const inTaskArea = state.menuMode === "tasks";
  if (inTaskArea) {
    setDrawerHeading("TASKS MENU", "My tasks");
    const taskMenuItems = [
      `<button class="menu-item" data-section="hub"><span class="menu-item__icon">⌂</span><span>Information Hub</span><span class="menu-item__chevron">›</span></button>`,
      renderTaskMenuItem(state.section === "tasks"),
      ...(state.taskData?.canCreate ? [`<button class="menu-item ${state.section === "set-task" ? "is-active" : ""}" data-section="set-task"><span class="menu-item__icon">+</span><span>Set a task</span><span class="menu-item__chevron">›</span></button>`] : []),
    ];
    if (canManageUsers() && !state.previewUser) {
      taskMenuItems.push(`<button class="menu-item menu-item--admin ${state.section === "admin" ? "is-active" : ""}" data-section="admin"><span class="menu-item__icon">⚙</span><span>Admin control centre</span><span class="menu-item__chevron">›</span></button>`);
    }
    sectionMenu.innerHTML = taskMenuItems.join("");
    renderDrawerFooter();
    return;
  }
  const inUserArea = state.menuMode === "users";
  if (inUserArea) {
    setDrawerHeading("USERS MENU", "Account management");
    const userMenuItems = [
      `<button class="menu-item" data-section="hub"><span class="menu-item__icon">⌂</span><span>Information Hub</span><span class="menu-item__chevron">›</span></button>`,
      `<button class="menu-item ${state.section === "users" ? "is-active" : ""}" data-section="users"><span class="menu-item__icon">♙</span><span>Users</span><span class="menu-item__chevron">›</span></button>`,
      `<button class="menu-item ${state.section === "activity" ? "is-active" : ""}" data-section="activity"><span class="menu-item__icon">◷</span><span>Recent activity</span><span class="menu-item__chevron">›</span></button>`,
    ];
    sectionMenu.innerHTML = userMenuItems.join("");
    renderDrawerFooter();
    return;
  }
  if (state.section === "executive") {
    setDrawerHeading("EXECUTIVE MENU", "Business trajectory");
    sectionMenu.innerHTML = [
      `<button class="menu-item" data-section="hub"><span class="menu-item__icon">⌂</span><span>Information Hub</span><span class="menu-item__chevron">›</span></button>`,
      `<button class="menu-item menu-item--executive is-active" data-section="executive"><span class="menu-item__icon">↗</span><span>Executive dashboard</span><span class="menu-item__chevron">›</span></button>`,
    ].join("");
    renderDrawerFooter();
    return;
  }
  if (state.section === "profit-plan") {
    setDrawerHeading("BUDGET & TARGETS", "Financial plan");
    sectionMenu.innerHTML = [
      `<button class="menu-item" data-section="hub"><span class="menu-item__icon">⌂</span><span>Information Hub</span><span class="menu-item__chevron">›</span></button>`,
      `<button class="menu-item menu-item--profit-plan is-active" data-section="profit-plan"><span class="menu-item__icon">↟</span><span>Budget &amp; targets</span><span class="menu-item__chevron">›</span></button>`,
    ].join("");
    renderDrawerFooter();
    return;
  }
  if (state.section === "hub") {
    setDrawerHeading("HUB MENU", "Information Hub");
    sectionMenu.innerHTML = [
      `<button class="menu-item is-active" data-section="hub"><span class="menu-item__icon">⌂</span><span>Information Hub</span><span class="menu-item__chevron">›</span></button>`,
      `<button class="menu-item" data-section="overview"><span class="menu-item__icon">▦</span><span>Weekly reports</span><span class="menu-item__chevron">›</span></button>`,
      renderTaskMenuItem(),
      ...(canManageUsers() && !state.previewUser ? [`<button class="menu-item" data-section="users"><span class="menu-item__icon">♙</span><span>Users</span><span class="menu-item__chevron">›</span></button>`] : []),
      ...(canViewExecutiveDashboard() ? [`<button class="menu-item menu-item--executive" data-section="executive"><span class="menu-item__icon">↗</span><span>Executive dashboard</span><span class="menu-item__chevron">›</span></button>`] : []),
      ...(canViewProfitPlan() ? [`<button class="menu-item menu-item--profit-plan" data-section="profit-plan"><span class="menu-item__icon">↟</span><span>Budget &amp; targets</span><span class="menu-item__chevron">›</span></button>`] : []),
    ].join("");
    renderDrawerFooter();
    return;
  }
  if (state.section === "admin" || state.section === "update-report") {
    const isUpdatePage = state.section === "update-report";
    setDrawerHeading("WEEKLY REPORTS", isUpdatePage ? "Update report" : "Report permissions");
    sectionMenu.innerHTML = [
      `<button class="menu-item" data-section="hub"><span class="menu-item__icon">⌂</span><span>Information Hub</span><span class="menu-item__chevron">›</span></button>`,
      `<button class="menu-item" data-section="overview"><span class="menu-item__icon">▦</span><span>Weekly reports</span><span class="menu-item__chevron">›</span></button>`,
      isUpdatePage
        ? `<button class="menu-item menu-item--update is-active" data-section="update-report"><span class="menu-item__icon">↥</span><span>Update report</span><span class="menu-item__chevron">›</span></button>`
        : `<button class="menu-item menu-item--admin is-active" data-section="admin"><span class="menu-item__icon">⚙</span><span>Report viewing permissions</span><span class="menu-item__chevron">›</span></button>`,
    ].join("");
    renderDrawerFooter();
    return;
  }
  setDrawerHeading("REPORT MENU", "Weekly reports");
  const isReportLanding = state.section === "overview";
  const menuItems = [
    `<button class="menu-item ${state.section === "hub" ? "is-active" : ""}" data-section="hub"><span class="menu-item__icon">⌂</span><span>Information Hub</span><span class="menu-item__chevron">›</span></button>`,
    `<button class="menu-item ${state.section === "overview" ? "is-active" : ""}" data-section="overview"><span class="menu-item__icon">▦</span><span>Weekly reports</span><span class="menu-item__chevron">›</span></button>`,
    ...(isReportLanding && canManageUsers() && !state.previewUser ? [`<button class="menu-item menu-item--admin" data-section="admin"><span class="menu-item__icon">⚙</span><span>Report viewing permissions</span><span class="menu-item__chevron">›</span></button>`] : []),
    ...(isReportLanding && canPublishReport() && !state.previewUser ? [`<button class="menu-item menu-item--update" data-section="update-report"><span class="menu-item__icon">↥</span><span>Update report</span><span class="menu-item__chevron">›</span></button>`] : []),
    ...(report?.sections || []).map((section) => `<button class="menu-item ${state.section === section.id ? "is-active" : ""}" data-section="${section.id}">
      <span class="menu-item__icon accent-${section.accent}">${sectionIcon(section)}</span>
      <span>${escapeHtml(section.label)}</span><span class="menu-item__chevron">›</span>
    </button>`),
  ];
  sectionMenu.innerHTML = menuItems.join("");
  renderDrawerFooter();
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

function financialYearDates(year) {
  const startYear = Number(year.slice(0, 4));
  return {
    start: `${startYear}-05-01`,
    end: `${startYear + 1}-04-30`,
  };
}

function financialYearProgress(selectedWeek, year) {
  const { start, end } = financialYearDates(year);
  const day = 86_400_000;
  const startTime = Date.parse(`${start}T12:00:00Z`);
  const endTime = Date.parse(`${end}T12:00:00Z`);
  const selectedTime = Date.parse(`${selectedWeek}T12:00:00Z`);
  if (![startTime, endTime, selectedTime].every(Number.isFinite)) return null;
  return Math.max(0, Math.min(1, (selectedTime - startTime + day) / (endTime - startTime + day)));
}

function financialYearPaceData() {
  const selectedWeek = report?.selectedWeek;
  if (!selectedWeek) return null;
  const financialYear = profitPlanAccountingYear(selectedWeek);
  const budget = profitPlanBudgetForYear(financialYear);
  if (!budget?.annual) return null;
  const values = [budget.annual.sales, budget.annual.grossProfit, budget.annual.labour];
  if (!values.every(Number.isFinite)) return null;
  const progress = financialYearProgress(selectedWeek, financialYear);
  if (progress === null) return null;
  const access = state.previewAccess || state.access;
  const unrestricted = ["admin", "owner"].includes(access?.role) || access?.dateAccess?.scope === "all";
  const permittedWeeks = new Set(state.availableWeeks || []);
  const rows = executiveRows().filter((row) => (
    profitPlanAccountingYear(row.week) === financialYear
    && row.week <= selectedWeek
    && (unrestricted || permittedWeeks.has(row.week))
  ));
  if (!rows.length) return { financialYear, progress, budget, rows, restricted: !unrestricted, measures: [] };
  const actuals = {
    sales: executiveMetric(rows, "salesEx", "sum"),
    grossProfit: executiveMetric(rows, "overallGpPounds", "sum"),
    labour: executiveMetric(rows, "totalWages", "sum"),
  };
  const measures = [
    { id: "sales", label: "Sales ex VAT", actual: actuals.sales, annualBudget: budget.annual.sales, lowerIsBetter: false },
    { id: "gross-profit", label: "Gross profit", actual: actuals.grossProfit, annualBudget: budget.annual.grossProfit, lowerIsBetter: false },
    { id: "wages", label: "Wage spend", actual: actuals.labour, annualBudget: budget.annual.labour, lowerIsBetter: true },
  ].filter((item) => Number.isFinite(item.actual));
  return { financialYear, progress, budget, rows, restricted: !unrestricted, measures };
}

function financialYearPaceTone(measure, progress) {
  const planned = measure.annualBudget * progress;
  const gap = measure.lowerIsBetter ? planned - measure.actual : measure.actual - planned;
  const tolerance = measure.annualBudget * .005;
  return Math.abs(gap) <= tolerance ? "on-pace" : gap > 0 ? "ahead" : "behind";
}

function renderFinancialYearPaceMeasure(measure, progress) {
  const planned = measure.annualBudget * progress;
  const gap = measure.lowerIsBetter ? planned - measure.actual : measure.actual - planned;
  const tone = financialYearPaceTone(measure, progress);
  const actualProgress = Math.max(0, Math.min(1, measure.actual / measure.annualBudget));
  const paceLabel = tone === "on-pace" ? "On planned pace" : tone === "ahead" ? measure.lowerIsBetter ? "Under planned wage pace" : "Ahead of planned pace" : measure.lowerIsBetter ? "Above planned wage pace" : "Behind planned pace";
  const gapText = tone === "on-pace" ? "Matches the budget pace" : `${executiveFormat(Math.abs(gap), "currency")} ${tone === "ahead" ? "favourable" : "off pace"}`;
  return `<article class="financial-year-pace__measure financial-year-pace__measure--${tone}">
    <div class="financial-year-pace__measure-heading"><div><span>${escapeHtml(measure.label)}</span><strong>${executiveFormat(measure.actual, "currency")}</strong></div><div><span>Annual budget</span><b>${executiveFormat(measure.annualBudget, "currency")}</b></div></div>
    <div class="financial-year-pace__track" role="progressbar" aria-label="${escapeHtml(measure.label)} against annual budget" aria-valuemin="0" aria-valuemax="${Math.round(measure.annualBudget)}" aria-valuenow="${Math.round(measure.actual)}"><i style="width:${(actualProgress * 100).toFixed(2)}%"></i><em style="left:${(progress * 100).toFixed(2)}%" aria-hidden="true"></em></div>
    <div class="financial-year-pace__measure-note"><span>${paceLabel}</span><strong>${gapText}</strong><small>Planned to date: ${executiveFormat(planned, "currency")}</small></div>
  </article>`;
}

function renderFinancialYearPace() {
  const pace = financialYearPaceData();
  if (!pace) return "";
  const open = state.overviewPaceOpen;
  const period = financialYearDates(pace.financialYear);
  const measures = pace.measures.length ? `<div class="financial-year-pace__measures">${pace.measures.map((measure) => renderFinancialYearPaceMeasure(measure, pace.progress)).join("")}</div>` : `<p class="financial-year-pace__unavailable">There are no weekly figures available for this selected financial year yet.</p>`;
  const restrictedNote = pace.restricted ? `<p class="financial-year-pace__access-note">This account does not have access to every week in the financial year, so this view uses only its permitted report weeks.</p>` : "";
  return `<section class="financial-year-pace-wrap">
    <button class="financial-year-pace-button" type="button" data-action="toggle-financial-year-pace" aria-expanded="${open ? "true" : "false"}"><span class="financial-year-pace-button__icon" aria-hidden="true">↗</span><span><strong>Financial year pace</strong><small>Sales, gross profit and wages against budget</small></span><b aria-hidden="true">${open ? "−" : "+"}</b></button>
    ${open ? `<section class="financial-year-pace" aria-label="Financial year pace against budget"><div class="financial-year-pace__heading"><div><p class="eyebrow">${escapeHtml(pace.financialYear)} BUDGET PACE</p><h3>Are we running to plan?</h3><p>When the coloured progress bars line up with the gold time marker, the business is following the annual budget.</p></div><span>To ${escapeHtml(formatDate(report.selectedWeek, true))}</span></div><div class="financial-year-pace__time"><div><span>Financial year elapsed</span><strong>${Math.round(pace.progress * 100)}%</strong></div><div class="financial-year-pace__time-track"><i style="width:${(pace.progress * 100).toFixed(2)}%"></i></div><small>${escapeHtml(formatDate(period.start, true))} to ${escapeHtml(formatDate(period.end, true))}</small></div>${measures}${restrictedNote}<p class="financial-year-pace__key"><i aria-hidden="true"></i>Gold marker = how far through the financial year we are. Coloured fill = the proportion of that measure’s annual budget used or delivered.</p></section>` : ""}
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
    <button class="back-link" type="button" data-section="hub">&larr; Information Hub</button>
    <section class="page-intro overview-intro">
      <p class="eyebrow">WEEKLY REPORTS</p>
      <h2>At a glance</h2>
    </section>

    <section class="week-hero" aria-label="Selected report week">
      <div>${renderWeekPicker()}</div>
      <button class="text-button" type="button" data-action="open-menu">Browse sections <span>&rarr;</span></button>
    </section>

    ${renderFinancialYearPace()}
    ${corePerformance}
    ${salesPerformance}
    ${detailLinks}`;
}

function renderUpdateReport() {
  return `
    <section class="update-report-page">
      <button class="back-link" type="button" data-section="hub">&larr; Information Hub</button>
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
      <button class="back-link" type="button" data-section="hub">&larr; Information Hub</button>
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
  const page = state.section === "hub" ? renderHub() : state.section === "tasks" ? renderTasks() : state.section === "set-task" ? renderSetTask() : state.section === "users" ? renderUsers() : state.section === "activity" ? renderActivity() : state.section === "executive" ? renderExecutiveDashboard() : state.section === "profit-plan" ? renderProfitImprovementPlan() : state.section === "budget-month" ? renderBudgetSalesMonthPage() : state.section === "admin" ? (state.menuMode === "tasks" ? renderTaskAdmin() : renderAdmin()) : !report ? renderNoReport() : state.section === "overview" ? renderOverview() : state.section === "update-report" ? renderUpdateReport() : renderSection(getSection(state.section));
  app.innerHTML = `${renderPreviewBanner()}${page}`;
  attachDynamicListeners();
  if ((state.section === "admin" || state.section === "users" || state.section === "activity") && state.adminUsers === null) void loadAdminUsers();
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
  const permitted = section === "hub"
    || section === "tasks"
    || (section === "set-task" && Boolean(state.taskData?.canCreate))
    || (section === "users" && canManageUsers() && !state.previewUser)
    || (section === "activity" && canManageUsers() && !state.previewUser)
    || (section === "executive" && canViewExecutiveDashboard())
    || (section === "profit-plan" && canViewProfitPlan())
    || section === "overview"
    || (section === "update-report" && canPublishReport() && !state.previewUser)
    || (section === "admin" && canManageUsers() && !state.previewUser)
    || report?.sections.some((item) => item.id === section);
  if (!permitted) return;
  const taskRoute = section === "tasks" || section === "set-task";
  const userRoute = section === "users" || section === "activity";
  state = { ...state, section, menuMode: taskRoute ? "tasks" : userRoute ? "users" : section === "admin" ? state.menuMode : section === "profit-plan" ? "profit-plan" : "report" };
  recordSectionActivity(section);
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
  lastActivityKey = "";
  state = { ...state, authMode: "login", authMessage: message, user: null, access: null };
  render();
}

function recordActivity(kind, detail = "") {
  if (localPreviewMode || !state.user?.id) return;
  const key = `${kind}|${detail}`;
  if (key === lastActivityKey) return;
  lastActivityKey = key;
  void fetch(activityEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, detail }),
  }).catch(() => { lastActivityKey = ""; });
}

function recordSectionActivity(section) {
  if (section === "hub") return recordActivity("hub");
  if (section === "tasks" || section === "set-task") return recordActivity("tasks");
  if (section === "users") return recordActivity("users");
  if (section === "activity") return recordActivity("user-activity");
  if (section === "executive") return recordActivity("executive-dashboard");
  if (section === "profit-plan") return;
  if (section === "admin") return recordActivity("report-permissions");
  if (section === "update-report") return recordActivity("report-update");
  if (section === "overview") return recordActivity("report-overview", formatDate(report?.selectedWeek || state.week));
  const reportSection = getSection(section);
  if (reportSection) return recordActivity("report-section", `${reportSection.label} · ${formatDate(report?.selectedWeek || state.week)}`);
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
    recordActivity("app-open");
    const loaded = await loadSharedReport();
    if (!state.user) return;
    if (!loaded) {
      state = { ...state, authMode: "authenticated", section: requestedStartSection(), authMessage: "" };
      void loadTasks({ renderAfterLoad: false });
      render();
      if (!reportPolling) reportPolling = window.setInterval(() => { if (!state.previewUser) void loadSharedReport({ renderAfterLoad: true, week: report?.selectedWeek || "" }); }, sharedReportPollInterval);
      return;
    }
    if (state.access?.canManageUsers) await loadSharedBudget(profitPlanAccountingYear(report?.selectedWeek || state.executive?.currentWeek || ""));
    state = { ...state, authMode: "authenticated", section: requestedStartSection(), authMessage: "" };
    void loadTasks({ renderAfterLoad: false });
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
  if (state.section === "admin" || state.section === "users" || state.section === "activity") render();
}

function updateTaskBadge(count = 0) {
  if (typeof navigator === "undefined") return;
  if (count > 0 && typeof navigator.setAppBadge === "function") void navigator.setAppBadge(count).catch(() => {});
  if (!count && typeof navigator.clearAppBadge === "function") void navigator.clearAppBadge().catch(() => {});
}

function applyTaskData(taskData, message = state.taskMessage) {
  state = { ...state, taskData, taskMessage: message };
  updateTaskBadge(Number(taskData?.outstandingCount || 0));
}

async function loadTasks({ renderAfterLoad = true } = {}) {
  if (localPreviewMode || !isSignedIn()) return;
  try {
    const response = await fetch(tasksEndpoint, { cache: "no-store", headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Your tasks could not be loaded.");
    applyTaskData(payload, "");
  } catch (error) {
    state = { ...state, taskMessage: error.message || "Your tasks could not be loaded." };
  }
  if (renderAfterLoad && (state.section === "hub" || state.section === "tasks")) render();
}

function taskBodyFromForm(form, submitter) {
  const data = new FormData(form);
  const asIso = (value) => {
    const date = new Date(String(value || ""));
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  };
  return {
    action: form.dataset.taskForm,
    taskId: plainText(data.get("taskId")),
    title: plainText(data.get("title")),
    description: plainText(data.get("description")),
    assigneeId: plainText(data.get("assigneeId")),
    watcherIds: data.getAll("watcherIds").map(String),
    dueAt: asIso(data.get("dueAt")),
    reminderAt: asIso(data.get("reminderAt")),
    recurrence: plainText(data.get("recurrence")),
    completionNote: plainText(data.get("completionNote")),
    reviewNote: plainText(data.get("reviewNote")),
    decision: submitter?.value || plainText(data.get("decision")),
  };
}

function countOutstandingTasks(tasks) {
  return (tasks || []).filter((task) => task.assigneeId === state.user?.id && ["open", "declined"].includes(task.status)).length;
}

function addLocalTaskNotification(taskData, title, message) {
  taskData.notifications = [{ id: `local-note-${Date.now()}`, taskId: "", title, message, createdAt: new Date().toISOString(), readAt: "" }, ...(taskData.notifications || [])].slice(0, 50);
}

function submitLocalTask(body) {
  const taskData = structuredClone(state.taskData || { tasks: [], people: [], notifications: [], canCreate: true, canManageAll: true });
  const currentName = state.user?.name || state.user?.email || "You";
  if (body.action === "create") {
    const assignee = taskData.people.find((person) => person.id === body.assigneeId);
    if (!body.title || !assignee || !body.dueAt) {
      state = { ...state, taskMessage: "Add a title, person, and due date before setting the task." };
      render();
      return;
    }
    const watchers = taskData.people.filter((person) => body.watcherIds.includes(person.id) && person.id !== assignee.id);
    taskData.tasks.unshift({ id: `local-task-${Date.now()}`, title: body.title, description: body.description, assigneeId: assignee.id, assigneeName: assignee.name, creatorId: state.user.id, creatorName: currentName, watcherIds: watchers.map((person) => person.id), watcherNames: watchers.map((person) => person.name), dueAt: body.dueAt, reminders: body.reminderAt ? [{ at: body.reminderAt, sentAt: "" }] : [], recurrence: body.recurrence || "none", status: "open", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), completionNote: "", reviewNote: "" });
    addLocalTaskNotification(taskData, body.title, `Task assigned to ${assignee.name}.`);
  } else {
    const task = taskData.tasks.find((item) => item.id === body.taskId);
    if (!task) return;
    if (body.action === "complete") {
      task.status = "awaiting_approval";
      task.completionNote = body.completionNote;
      task.updatedAt = new Date().toISOString();
      addLocalTaskNotification(taskData, task.title, "Marked completed and sent for approval.");
    }
    if (body.action === "review") {
      const approved = body.decision === "approve";
      task.status = approved ? "completed" : "declined";
      task.reviewNote = body.reviewNote;
      task.updatedAt = new Date().toISOString();
      addLocalTaskNotification(taskData, task.title, approved ? "Completion accepted." : "Completion declined.");
    }
  }
  taskData.outstandingCount = countOutstandingTasks(taskData.tasks);
  applyTaskData(taskData, body.action === "create" ? "Task set." : body.action === "complete" ? "Task sent for approval." : "Task review saved.");
  render();
}

async function submitTaskForm(form, submitter) {
  const body = taskBodyFromForm(form, submitter);
  if (localPreviewMode) {
    submitLocalTask(body);
    return;
  }
  state = { ...state, taskMessage: body.action === "create" ? "Setting task…" : "Saving task update…" };
  render();
  try {
    const response = await fetch(tasksEndpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "The task could not be saved.");
    applyTaskData(payload, body.action === "create" ? "Task set and notifications sent." : body.action === "complete" ? "Task sent for approval." : "Task review saved.");
  } catch (error) {
    state = { ...state, taskMessage: error.message || "The task could not be saved." };
  }
  render();
}

async function markTaskNotificationsRead() {
  if (localPreviewMode) {
    const taskData = structuredClone(state.taskData || {});
    taskData.notifications?.forEach((note) => { note.readAt = new Date().toISOString(); });
    applyTaskData(taskData, "");
    render();
    return;
  }
  try {
    const response = await fetch(tasksEndpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "mark-notifications-read" }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Task updates could not be marked as read.");
    applyTaskData(payload, "");
  } catch (error) {
    state = { ...state, taskMessage: error.message || "Task updates could not be marked as read." };
  }
  render();
}

function vapidKeyToBytes(value) {
  const padded = String(value || "").replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(String(value || "").length / 4) * 4, "=");
  const decoded = atob(padded);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

async function enablePhoneNotifications() {
  if (localPreviewMode) {
    state = { ...state, taskMessage: "Phone reminders are enabled on the secure live Hub after notification keys are added." };
    render();
    return;
  }
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    state = { ...state, taskMessage: "This browser does not support phone notifications. You can still see every task in the Hub." };
    render();
    return;
  }
  const push = state.taskData?.push;
  if (!push?.enabled || !push.publicKey) {
    state = { ...state, taskMessage: "Phone reminders are being prepared. Your in-app task updates are already available." };
    render();
    return;
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") throw new Error("Allow notifications in your phone settings to receive task reminders.");
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyToBytes(push.publicKey) });
    const response = await fetch(tasksEndpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "subscribe", subscription: subscription.toJSON() }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Phone reminders could not be enabled.");
    applyTaskData(payload, "Phone reminders are enabled for this device.");
  } catch (error) {
    state = { ...state, taskMessage: error.message || "Phone reminders could not be enabled." };
  }
  render();
}

async function registerTaskServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol !== "https:") return;
  try {
    await navigator.serviceWorker.register("/sw.js");
  } catch (error) {
    console.warn("The task notification service could not be prepared.", error);
  }
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

function taskAccessFromForm(form) {
  const formData = new FormData(form);
  return {
    canCreate: formData.get("taskCanCreate") === "on",
    assigneeIds: formData.getAll("taskAssigneeIds").map(String),
  };
}

function localSectionsFromView(view) {
  return Object.entries(view?.sections || {}).filter(([, selection]) => selection?.enabled).map(([section]) => section);
}

function localUserWithAccount(current, body) {
  const role = body.role === "owner" ? "owner" : "viewer";
  return {
    ...current,
    id: current?.id || `local-${Date.now()}`,
    name: plainText(body.name),
    email: plainText(body.email) || current?.email || "",
    role,
    enabled: body.enabled !== false,
    sections: role === "owner" ? [] : (current?.sections || []),
    view: role === "owner" ? null : (current?.view || null),
    dateAccess: role === "owner" ? { scope: "all" } : (current?.dateAccess || { scope: "current" }),
    taskAccess: role === "owner" ? { canCreate: true, assigneeIds: ["*"] } : (current?.taskAccess || { canCreate: false, assigneeIds: [] }),
    activity: current?.activity || { appViews: 0, totalViews: 0, lastViewedAt: "", recentViews: [] },
    isInitialAdmin: false,
  };
}

async function submitAccountForm(form) {
  const formData = new FormData(form);
  const action = form.dataset.accountForm === "create" ? "create-account" : "update-account";
  const body = action === "create-account"
    ? { action, name: formData.get("name"), email: formData.get("email"), password: formData.get("password"), role: formData.get("role") }
    : { action, userId: formData.get("userId"), name: formData.get("name"), role: formData.get("role"), enabled: formData.get("enabled") === "on" };
  if (localPreviewMode) {
    const users = state.adminUsers || [];
    const nextUsers = action === "create-account"
      ? [...users, localUserWithAccount(null, body)]
      : users.map((person) => String(person.id) === String(body.userId) ? localUserWithAccount(person, body) : person);
    state = { ...state, adminUsers: nextUsers, adminMessage: action === "create-account" ? "Local account created for preview only." : "Local account saved." };
    render();
    return;
  }
  state = { ...state, adminMessage: action === "create-account" ? "Creating account…" : "Saving account…" };
  render();
  try {
    const response = await fetch(adminEndpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 428) throw new Error("Confirm your own password above before making this change.");
    if (!response.ok) throw new Error(payload.error || "The account could not be saved.");
    state = { ...state, adminUsers: payload.users || [], adminMessage: action === "create-account" ? "Account created. Share the temporary password with the person securely." : "Account saved." };
  } catch (error) {
    state = { ...state, adminMessage: error.message || "The account could not be saved." };
  }
  render();
}

async function submitReportAccessForm(form) {
  const body = { action: "update-report-access", userId: formValue(form, "userId"), view: accessViewFromForm(form), dateAccess: dateAccessFromForm(form) };
  if (localPreviewMode) {
    const view = body.view;
    const users = (state.adminUsers || []).map((person) => String(person.id) === String(body.userId) ? { ...person, sections: localSectionsFromView(view), view, dateAccess: body.dateAccess } : person);
    state = { ...state, adminUsers: users, adminMessage: "Report viewing permissions saved for the local preview." };
    render();
    return;
  }
  state = { ...state, adminMessage: "Saving report viewing permissions…" };
  render();
  try {
    const response = await fetch(adminEndpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 428) throw new Error("Confirm your own password above before making this change.");
    if (!response.ok) throw new Error(payload.error || "Report viewing permissions could not be saved.");
    state = { ...state, adminUsers: payload.users || [], adminMessage: "Report viewing permissions saved." };
  } catch (error) {
    state = { ...state, adminMessage: error.message || "Report viewing permissions could not be saved." };
  }
  render();
}

async function submitTaskAdminForm(form) {
  const body = { action: "update-task-access", userId: formValue(form, "userId"), taskAccess: taskAccessFromForm(form) };
  if (localPreviewMode) {
    const users = (state.adminUsers || []).map((person) => String(person.id) === String(body.userId) ? { ...person, taskAccess: body.taskAccess } : person);
    state = { ...state, adminUsers: users, adminMessage: "Task permissions saved for the local preview." };
    render();
    return;
  }
  state = { ...state, adminMessage: "Saving task permissions…" };
  render();
  try {
    const response = await fetch(adminEndpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 428) throw new Error("Confirm your own password above before making this change.");
    if (!response.ok) throw new Error(payload.error || "Task permissions could not be saved.");
    state = { ...state, adminUsers: payload.users || [], adminMessage: "Task permissions saved." };
  } catch (error) {
    state = { ...state, adminMessage: error.message || "Task permissions could not be saved." };
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
  lastActivityKey = "";
  state = { section: "hub", week: "", sourceName: "", isUploaded: false, authMode: "login", authMessage: "You have signed out.", authToken: "", user: null, access: null, adminUsers: null, adminMessage: "", availableWeeks: [], taskData: null, taskMessage: "", menuMode: "report", executive: null, executivePeriod: "", executiveMetricModes: {}, executiveDetailMetric: "", executiveDetailYearScope: "all", executiveScenarioOpen: false, executiveScenario: null, profitPlans: {}, profitPlanYear: "", profitPlanMessage: "", profitPlanReviewMonth: "", profitPlanBudget: null, profitPlanBudgets: {}, overviewPaceOpen: false, budgetSalesAssumptions: {}, budgetSalesExpandedMonth: "", budgetSalesDetailMonth: "", budgetSalesProjectionMonth: "", budgetSalesWeekProjectionMonth: "" };
  updateTaskBadge(0);
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

function updateSelectedProfitPlan(mutator, message) {
  const year = profitPlanSelectedYear();
  if (!year) return;
  const plan = profitPlanForYear(year);
  mutator(plan);
  saveProfitPlan(plan, message);
  render();
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
  document.querySelectorAll("[data-action='toggle-financial-year-pace']").forEach((button) => button.addEventListener("click", () => {
    state = { ...state, overviewPaceOpen: !state.overviewPaceOpen };
    render();
  }));
  document.querySelectorAll("[data-action='calendar-month']").forEach((button) => button.addEventListener("click", () => {
    state = { ...state, calendarOpen: true, calendarMonth: shiftMonth(state.calendarMonth || monthKey(report?.selectedWeek), Number(button.dataset.monthOffset || 0)) };
    render();
  }));
  document.querySelectorAll("[data-action='choose-calendar-week']").forEach((button) => button.addEventListener("click", () => { void changeReportWeek(button.dataset.week); }));
  document.querySelectorAll("[data-action='executive-grain']").forEach((select) => select.addEventListener("change", () => {
    const grain = select.value;
    state = { ...state, executiveGrain: grain, executivePeriod: defaultExecutivePeriodForGrain(grain), executiveDetailMetric: "", executiveDetailOverlays: [], executiveScenarioOpen: false, executiveScenario: null };
    render();
  }));
  document.querySelectorAll("[data-action='executive-period']").forEach((select) => select.addEventListener("change", () => {
    state = { ...state, executivePeriod: select.value, executiveDetailMetric: "", executiveDetailOverlays: [], executiveScenarioOpen: false, executiveScenario: null };
    render();
  }));
  document.querySelectorAll("[data-action='open-executive-scenario']").forEach((button) => button.addEventListener("click", () => {
    const rows = executiveRowsForSelectedPeriod();
    const baseline = executiveScenarioBaseline(rows);
    if (!baseline) return;
    state = { ...state, executiveScenarioOpen: true, executiveScenario: defaultExecutiveScenario(baseline), executiveDetailMetric: "", executiveDetailOverlays: [] };
    render();
    document.querySelector("#executive-scenario")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  document.querySelectorAll("[data-action='close-executive-scenario']").forEach((button) => button.addEventListener("click", () => {
    state = { ...state, executiveScenarioOpen: false };
    render();
  }));
  document.querySelectorAll("[data-action='reset-executive-scenario']").forEach((button) => button.addEventListener("click", () => {
    const rows = executiveRowsForSelectedPeriod();
    const baseline = executiveScenarioBaseline(rows);
    if (!baseline) return;
    state = { ...state, executiveScenario: defaultExecutiveScenario(baseline) };
    render();
  }));
  document.querySelectorAll("[data-action='apply-executive-scenario']").forEach((button) => button.addEventListener("click", () => {
    applyExecutiveScenario();
  }));
  document.querySelectorAll("[data-action='set-executive-scenario-mode']").forEach((select) => select.addEventListener("change", () => {
    const rows = executiveRowsForSelectedPeriod();
    const { baseline, scenario } = executiveScenarioForRows(rows);
    if (!baseline || !scenario) return;
    const next = { ...scenario };
    if (select.dataset.field === "covers") next.coversMode = select.value;
    if (select.dataset.field === "grossProfit") next.grossProfitMode = select.value;
    if (select.dataset.field === "wages") next.wagesMode = select.value;
    state = { ...state, executiveScenario: next };
    render();
  }));
  document.querySelectorAll("[data-action='toggle-executive-value']").forEach((button) => button.addEventListener("click", () => {
    const metric = button.dataset.metric;
    if (!metric) return;
    const modes = { ...(state.executiveMetricModes || {}) };
    modes[metric] = modes[metric] === "value" ? "percentage" : "value";
    state = { ...state, executiveMetricModes: modes };
    render();
  }));
  document.querySelectorAll("[data-action='open-executive-detail']").forEach((card) => {
    const openDetail = () => {
      const metric = card.dataset.metric;
      if (!metric) return;
      state = { ...state, executiveDetailMetric: metric, executiveDetailOverlays: [], executiveDetailYearScope: "all" };
      render();
      document.querySelector("#executive-detail")?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    card.addEventListener("click", (event) => {
      if (event.target.closest("[data-action='toggle-executive-value']")) return;
      openDetail();
    });
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openDetail();
      }
    });
  });
  document.querySelectorAll("[data-action='close-executive-detail']").forEach((button) => button.addEventListener("click", () => {
    state = { ...state, executiveDetailMetric: "", executiveDetailOverlays: [], executiveDetailYearScope: "all" };
    render();
  }));
  document.querySelectorAll("[data-action='executive-detail-overlay']").forEach((select) => select.addEventListener("change", () => {
    const metric = select.value;
    if (!metric || (state.executiveDetailOverlays || []).includes(metric)) return;
    state = { ...state, executiveDetailOverlays: [...(state.executiveDetailOverlays || []), metric].slice(0, 3) };
    render();
  }));
  document.querySelectorAll("[data-action='executive-detail-year-scope']").forEach((select) => select.addEventListener("change", () => {
    state = { ...state, executiveDetailYearScope: select.value };
    render();
  }));
  document.querySelectorAll("[data-action='remove-executive-overlay']").forEach((button) => button.addEventListener("click", () => {
    state = { ...state, executiveDetailOverlays: (state.executiveDetailOverlays || []).filter((metric) => metric !== button.dataset.metric) };
    render();
  }));
  document.querySelectorAll("[data-action='profit-plan-year']").forEach((select) => select.addEventListener("change", () => {
    state = { ...state, profitPlanYear: select.value, profitPlanReviewMonth: "", profitPlanMessage: "", budgetSalesExpandedMonth: "", budgetSalesDetailMonth: "", budgetSalesProjectionMonth: "", budgetSalesWeekProjectionMonth: "" };
    render();
    void loadSharedBudget(select.value, { renderAfterLoad: true });
  }));
  document.querySelectorAll("[data-action='choose-budget-upload']").forEach((button) => {
    button.addEventListener("click", () => budgetInput?.click());
    button.addEventListener("dragover", (event) => { event.preventDefault(); button.classList.add("is-dragging"); });
    button.addEventListener("dragleave", () => button.classList.remove("is-dragging"));
    button.addEventListener("drop", (event) => {
      event.preventDefault();
      button.classList.remove("is-dragging");
      void handleBudgetUpload(event.dataTransfer.files);
    });
  });
  document.querySelectorAll("[data-action='budget-sales-input']").forEach((input) => {
    const saveSalesInput = () => {
    const year = profitPlanSelectedYear();
    const month = input.dataset.month;
    const field = input.dataset.field;
    const value = plainText(input.value);
    if (!month || !["coversPerWeek", "spendPerHead"].includes(field)) return;
    const number = profitPlanNumber(value);
    if (value && (number === null || number < 0 || (field === "spendPerHead" && number === 0))) {
      state = { ...state, profitPlanMessage: field === "spendPerHead" ? "Spend per head must be greater than zero." : "Covers per week cannot be negative." };
      render();
      return;
    }
    const yearAssumptions = { ...(state.budgetSalesAssumptions?.[year] || {}) };
    const monthAssumptions = { ...(yearAssumptions[month] || {}) };
    if (!value) delete monthAssumptions[field];
    else monthAssumptions[field] = value;
    yearAssumptions[month] = monthAssumptions;
    state = {
      ...state,
      budgetSalesAssumptions: { ...(state.budgetSalesAssumptions || {}), [year]: yearAssumptions },
      profitPlanMessage: localPreviewMode ? "Sales plan updated locally." : "Saving sales plan for everyone…",
    };
    render();
    void saveSharedBudgetAssumptions(year, yearAssumptions);
    };
    // Keep the field stable while someone is typing. Saving on every keystroke
    // re-renders the page and can interrupt a covers or SPH edit on mobile.
    input.addEventListener("change", saveSalesInput);
    input.addEventListener("blur", saveSalesInput);
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      saveSalesInput();
    });
  });
  document.querySelectorAll("[data-action='open-budget-sales-month']").forEach((button) => button.addEventListener("click", () => {
    const month = button.dataset.month || "";
    if (!month) return;
    state = { ...state, section: "budget-month", budgetSalesDetailMonth: month, budgetSalesExpandedMonth: "", budgetSalesProjectionMonth: "", budgetSalesWeekProjectionMonth: "" };
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }));
  document.querySelectorAll("[data-action='toggle-budget-sales-projection']").forEach((button) => button.addEventListener("click", () => {
    const month = button.dataset.month || "";
    if (!month) return;
    state = { ...state, budgetSalesProjectionMonth: state.budgetSalesProjectionMonth === month ? "" : month };
    render();
  }));
  document.querySelectorAll("[data-action='toggle-budget-sales-week-projection']").forEach((button) => button.addEventListener("click", () => {
    const month = button.dataset.month || "";
    if (!month) return;
    state = { ...state, budgetSalesWeekProjectionMonth: state.budgetSalesWeekProjectionMonth === month ? "" : month };
    render();
  }));
  document.querySelectorAll("[data-action='return-budget-sales-plan']").forEach((button) => button.addEventListener("click", () => {
    state = { ...state, section: "profit-plan", budgetSalesDetailMonth: "", budgetSalesProjectionMonth: "", budgetSalesWeekProjectionMonth: "" };
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }));
  document.querySelectorAll("[data-action='toggle-budget-sales-guide']").forEach((button) => button.addEventListener("click", () => {
    state = { ...state, budgetSalesGuideOpen: !state.budgetSalesGuideOpen };
    render();
  }));
  document.querySelectorAll("[data-action='reset-budget-sales-plan']").forEach((button) => button.addEventListener("click", () => {
    const year = profitPlanSelectedYear();
    state = {
      ...state,
      budgetSalesAssumptions: { ...(state.budgetSalesAssumptions || {}), [year]: {} },
      budgetSalesExpandedMonth: "",
      budgetSalesDetailMonth: "",
      budgetSalesProjectionMonth: "",
      budgetSalesWeekProjectionMonth: "",
      profitPlanMessage: localPreviewMode ? "Sales plan reset to the budget and last-year inc-VAT SPH." : "Returning sales plan to the shared budget…",
    };
    render();
    void saveSharedBudgetAssumptions(year, {});
  }));
  document.querySelectorAll("[data-action='reset-budget-sales-month']").forEach((button) => button.addEventListener("click", () => {
    const year = profitPlanSelectedYear();
    const month = button.dataset.month || "";
    if (!month) return;
    const yearAssumptions = { ...(state.budgetSalesAssumptions?.[year] || {}) };
    delete yearAssumptions[month];
    state = {
      ...state,
      budgetSalesAssumptions: { ...(state.budgetSalesAssumptions || {}), [year]: yearAssumptions },
      budgetSalesProjectionMonth: "",
      budgetSalesWeekProjectionMonth: "",
      profitPlanMessage: localPreviewMode ? `${monthTitle(month)} targets returned to the adjusted budget.` : "Returning this month to the shared budget…",
    };
    render();
    void saveSharedBudgetAssumptions(year, yearAssumptions);
  }));
  document.querySelectorAll("[data-profit-plan-form='summary']").forEach((form) => form.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = new FormData(form);
    updateSelectedProfitPlan((plan) => {
      plan.baselineOverride = values.get("baselineOverride")?.trim() || "";
      plan.targetProfit = values.get("targetProfit")?.trim() || "";
      plan.confirmedDelivered = values.get("confirmedDelivered")?.trim() || "";
    }, "Management targets saved locally.");
  }));
  document.querySelectorAll("[data-profit-opportunity-form]").forEach((form) => form.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = new FormData(form);
    const expectedBenefit = profitPlanNumber(values.get("expectedBenefit"));
    const title = values.get("title")?.trim();
    if (!title || expectedBenefit === null) {
      state = { ...state, profitPlanMessage: "Add an opportunity title and an estimated annual £ benefit." };
      render();
      return;
    }
    updateSelectedProfitPlan((plan) => {
      plan.opportunities = [...plan.opportunities, {
        id: `local-profit-opportunity-${Date.now()}`,
        category: values.get("category")?.trim() || "Other",
        title,
        baseline: values.get("baseline")?.trim() || "",
        target: values.get("target")?.trim() || "",
        expectedBenefit: String(expectedBenefit),
        priority: values.get("priority")?.trim() || "medium",
        owner: values.get("owner")?.trim() || "",
        dueDate: values.get("dueDate")?.trim() || "",
        description: values.get("description")?.trim() || "",
        actions: values.get("actions")?.trim() || "",
        status: "identified",
      }];
    }, "Opportunity added locally.");
  }));
  document.querySelectorAll("[data-profit-opportunity-status]").forEach((form) => form.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = new FormData(form);
    const opportunityId = values.get("opportunityId");
    updateSelectedProfitPlan((plan) => {
      plan.opportunities = plan.opportunities.map((opportunity) => opportunity.id === opportunityId ? { ...opportunity, status: values.get("status") } : opportunity);
    }, "Opportunity status saved locally.");
  }));
  document.querySelectorAll("[data-action='remove-profit-opportunity']").forEach((button) => button.addEventListener("click", () => {
    updateSelectedProfitPlan((plan) => {
      plan.opportunities = plan.opportunities.filter((opportunity) => opportunity.id !== button.dataset.opportunityId);
    }, "Opportunity removed from this local plan.");
  }));
  document.querySelectorAll("[data-profit-quarter-form]").forEach((form) => form.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = new FormData(form);
    const quarter = form.dataset.quarter;
    const kpi = profitPlanKpi(values.get("focusKpiId"));
    updateSelectedProfitPlan((plan) => {
      plan.quarters[quarter] = {
        ...plan.quarters[quarter],
        focusKpiId: kpi?.id || "",
        target: kpi ? (profitPlanInputNumber(kpi, values.get("target")) ?? "") : "",
        expectedBenefit: values.get("expectedBenefit")?.trim() || "",
        owner: values.get("owner")?.trim() || "",
        actions: values.get("actions")?.trim() || "",
        status: values.get("status")?.trim() || "not-started",
      };
    }, `${quarter} focus saved locally.`);
  }));
  document.querySelectorAll("[data-action='profit-plan-review-month']").forEach((select) => select.addEventListener("change", () => {
    state = { ...state, profitPlanReviewMonth: select.value };
    render();
  }));
  document.querySelectorAll("[data-profit-review-form]").forEach((form) => form.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = new FormData(form);
    const month = values.get("month")?.trim();
    if (!month) return;
    updateSelectedProfitPlan((plan) => {
      plan.reviews = {
        ...plan.reviews,
        [month]: { comments: values.get("comments")?.trim() || "", decision: values.get("decision")?.trim() || "", updatedAt: new Date().toISOString() },
      };
    }, `${monthTitle(month)} review saved locally.`);
  }));
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
  document.querySelectorAll("[data-task-form]").forEach((form) => form.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitTaskForm(form, event.submitter);
  }));
  document.querySelectorAll("[data-action='mark-task-notifications-read']").forEach((button) => button.addEventListener("click", () => { void markTaskNotificationsRead(); }));
  document.querySelectorAll("[data-action='enable-phone-notifications']").forEach((button) => button.addEventListener("click", () => { void enablePhoneNotifications(); }));
  document.querySelectorAll("[data-account-form]").forEach((form) => form.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitAccountForm(form);
  }));
  document.querySelectorAll("[data-report-access-form]").forEach((form) => form.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitReportAccessForm(form);
  }));
  document.querySelectorAll("[data-task-admin-form]").forEach((form) => form.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitTaskAdminForm(form);
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
    recordSectionActivity(state.section);
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  const loaded = await loadSharedReport({ week, renderAfterLoad: true, previewUserId: state.previewUser?.id || "" });
  if (loaded) {
    recordSectionActivity(state.section);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
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
    || (activeSection === "users" && nextAccess?.canManageUsers && !previewing)
    || (activeSection === "activity" && nextAccess?.canManageUsers && !previewing)
    || (activeSection === "executive" && nextAccess?.canManageUsers && !previewing)
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
    executive: payload.executive || null,
    executivePeriod: payload.executive?.currentWeek?.slice(0, 4) || "",
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
  const selectedPerson = state.adminUsers?.find((user) => user.id === userId);
  recordActivity("report-preview", selectedPerson?.name || selectedPerson?.email || "another user");
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

function isSharedBudgetPayload(payload) {
  const budget = payload?.budget;
  return Boolean(budget?.financialYear && Array.isArray(budget.months) && budget.months.length === 12 && budget.annual);
}

function applySharedBudget(payload, { renderAfterLoad = false } = {}) {
  if (!isSharedBudgetPayload(payload)) return false;
  const budget = payload.budget;
  const year = budget.financialYear;
  state = {
    ...state,
    profitPlanBudget: budget,
    profitPlanBudgets: { ...(state.profitPlanBudgets || {}), [year]: budget },
    budgetSalesAssumptions: { ...(state.budgetSalesAssumptions || {}), [year]: payload.assumptions || {} },
  };
  if (renderAfterLoad) render();
  return true;
}

async function loadSharedBudget(year, { renderAfterLoad = false } = {}) {
  if (localPreviewMode || location.protocol !== "https:" || !canManageUsers() || !year) return false;
  try {
    const response = await fetch(`${budgetEndpoint}?year=${encodeURIComponent(year)}`, { cache: "no-store", headers: { Accept: "application/json" } });
    if (response.status === 404) return false;
    if (response.status === 401) {
      if (isSignedIn()) await signOut();
      return false;
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "The shared budget could not be loaded.");
    return applySharedBudget(payload, { renderAfterLoad });
  } catch (error) {
    console.warn("The shared budget could not be loaded.", error);
    if (renderAfterLoad && state.profitPlanYear === year) {
      state = { ...state, profitPlanMessage: error.message || "The shared budget could not be loaded." };
      render();
    }
    return false;
  }
}

async function publishSharedBudget(budget, sourceName) {
  const response = await fetch(budgetEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "save-budget", budget, sourceName }),
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 428) throw new Error("Confirm your own account password on this page before updating the shared budget.");
  if (response.status === 401) throw new Error("Your sign-in has expired. Please sign in again.");
  if (!response.ok) throw new Error(payload.error || "The budget could not be saved for everyone.");
  if (!isSharedBudgetPayload(payload)) throw new Error("The budget was saved, but its confirmation was incomplete.");
  return payload;
}

async function saveSharedBudgetAssumptions(year, assumptions) {
  if (localPreviewMode || location.protocol !== "https:" || !canManageUsers() || !year) return;
  try {
    const response = await fetch(budgetEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save-assumptions", financialYear: year, assumptions }),
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 428) throw new Error("Confirm your own account password on this page before changing the shared sales plan.");
    if (!response.ok) throw new Error(payload.error || "The shared sales plan could not be saved.");
    applySharedBudget(payload);
    if (state.profitPlanYear === year) {
      state = { ...state, profitPlanMessage: "Sales plan saved for everyone." };
      render();
    }
  } catch (error) {
    console.error(error);
    if (state.profitPlanYear === year) {
      state = { ...state, profitPlanMessage: error.message || "The shared sales plan could not be saved." };
      render();
    }
  }
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
      saveLocalPreviewMaster(model, file.name);
      state = { ...state, section: "overview", week: report.selectedWeek, sourceName: file.name, availableWeeks: model?.availableWeeks || [report.selectedWeek], executive: model?.executive || null, executivePeriod: model?.executive?.currentWeek?.slice(0, 4) || "", calendarOpen: false, calendarMonth: monthKey(report.selectedWeek), adminMessage: "Master workbook loaded for local preview only." };
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

function accountantBudgetNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const source = plainText(value).replace(/,/g, "").replace(/[£$]/g, "");
  if (!source) return null;
  const parenthesised = /^\(.*\)$/.test(source);
  const parsed = Number(source.replace(/[()]/g, "").replace(/[^0-9.+-]/g, ""));
  return Number.isFinite(parsed) ? parenthesised ? -Math.abs(parsed) : parsed : null;
}

function accountantBudgetLabel(value) {
  return plainText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function accountantBudgetMonthKey(value) {
  const date = dateFromExcel(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.slice(0, 7) : "";
}

function accountantBudgetMonthLabel(month) {
  const [year, number] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" }).format(new Date(year, number - 1, 1));
}

function accountantBudgetRows(sheet) {
  if (!sheet?.["!ref"]) return [];
  return window.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
}

function accountantBudgetMonthColumns(rows) {
  const candidates = rows.map((row, rowIndex) => ({
    rowIndex,
    columns: row.map((value, columnIndex) => ({ columnIndex, month: accountantBudgetMonthKey(value) })).filter((item) => item.month),
  })).filter((item) => item.columns.length >= 10);
  return candidates.sort((left, right) => right.columns.length - left.columns.length)[0] || null;
}

const accountantBudgetMonthNames = ["may", "june", "july", "august", "september", "october", "november", "december", "january", "february", "march", "april"];

function accountantBudgetStartYear(sheetName, rows) {
  const sources = [sheetName, ...rows.slice(0, 30).flat()].map((value) => plainText(value));
  for (const source of sources) {
    const match = /\b(20\d{2}|\d{2})\s*[-/]\s*(20\d{2}|\d{2})\b/.exec(source);
    if (!match) continue;
    const start = Number(match[1].length === 2 ? `20${match[1]}` : match[1]);
    const end = Number(match[2].length === 2 ? `20${match[2]}` : match[2]);
    if (Number.isFinite(start) && end === start + 1) return start;
  }
  return null;
}

function accountantBudgetNamedMonthColumns(rows, sheetName) {
  const startYear = accountantBudgetStartYear(sheetName, rows);
  if (!Number.isFinite(startYear)) return null;
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const labels = row.map(accountantBudgetLabel);
    for (let startColumn = 0; startColumn <= labels.length - accountantBudgetMonthNames.length; startColumn += 1) {
      const matchesSequence = accountantBudgetMonthNames.every((name, offset) => labels[startColumn + offset] === name);
      if (!matchesSequence) continue;
      return {
        rowIndex,
        columns: accountantBudgetMonthNames.map((name, offset) => {
          const monthNumber = offset < 8 ? offset + 5 : offset - 7;
          const year = offset < 8 ? startYear : startYear + 1;
          return { columnIndex: startColumn + offset, month: `${year}-${String(monthNumber).padStart(2, "0")}` };
        }),
      };
    }
  }
  return null;
}

function accountantBudgetHeader(rows, sheetName) {
  // Accountant workbooks commonly show a clear May–April name row above the
  // P&L, while date cells elsewhere can sit in historic comparison panels.
  // Prefer that named month sequence and fall back to date headings.
  return accountantBudgetNamedMonthColumns(rows, sheetName) || accountantBudgetMonthColumns(rows);
}

function accountantBudgetRow(rows, labels, labelColumnIndex = null) {
  const wanted = labels.map(accountantBudgetLabel);
  if (Number.isInteger(labelColumnIndex) && labelColumnIndex >= 0) {
    const aligned = rows.find((row) => wanted.includes(accountantBudgetLabel(row[labelColumnIndex])));
    if (aligned) return aligned;
  }
  return rows.find((row) => row.some((value) => wanted.includes(accountantBudgetLabel(value)))) || null;
}

function accountantBudgetValue(rows, labels, columnIndex, labelColumnIndex = null) {
  const row = accountantBudgetRow(rows, labels, labelColumnIndex);
  return row ? accountantBudgetNumber(row[columnIndex]) : null;
}

function accountantBudgetFinancialYear(sheet, sheetName = "") {
  const header = accountantBudgetHeader(accountantBudgetRows(sheet), sheetName);
  const firstMonth = header?.columns
    .map((item) => item.month)
    .sort()
    .find(Boolean);
  if (!firstMonth) return "";
  const startYear = Number(firstMonth.slice(0, 4));
  return Number.isFinite(startYear) ? `${startYear}/${String(startYear + 1).slice(-2)}` : "";
}

function accountantBudgetSheetScore(sheetName, sheet, preferredFinancialYear = "") {
  const rows = accountantBudgetRows(sheet);
  const headers = accountantBudgetHeader(rows, sheetName);
  if (!headers) return -Infinity;
  const labels = rows.flatMap((row) => row.map(accountantBudgetLabel));
  const expected = ["total turnover", "gross profit", "total labour cost", "operating profit"];
  const matched = expected.filter((label) => labels.includes(label)).length;
  const name = accountantBudgetLabel(sheetName);
  const financialYear = accountantBudgetFinancialYear(sheet, sheetName);
  const preferred = financialYear && financialYear === preferredFinancialYear ? 1_000 : 0;
  return preferred + (matched * 20) + headers.columns.length + (/budget/.test(name) ? 12 : 0) + (/orig/.test(name) ? 4 : 0) - (/actual|forecast/.test(name) ? 5 : 0);
}

function accountantBudgetPnl(sheetName, sheet, { requireBudget = false } = {}) {
  const rows = accountantBudgetRows(sheet);
  const header = accountantBudgetHeader(rows, sheetName);
  if (!header) throw new Error(`I could not find 12 monthly columns in the ${sheetName} tab.`);
  const monthColumns = header.columns.sort((left, right) => left.columnIndex - right.columnIndex);
  const first = monthColumns[0];
  const last = monthColumns.at(-1);
  const totalColumn = last.columnIndex + 1;
  // Budget workbooks often repeat the same labels in comparison panels on the
  // right-hand side. Use the column immediately before the monthly values so
  // each total is read from the main P&L, rather than a heading elsewhere.
  const labelColumn = Math.max(0, first.columnIndex - 1);
  const sales = accountantBudgetValue(rows, ["Total Turnover", "Total Sales"], totalColumn, labelColumn);
  const grossProfit = accountantBudgetValue(rows, ["Gross Profit"], totalColumn, labelColumn);
  const labour = accountantBudgetValue(rows, ["Total Labour Cost", "Total Labour"], totalColumn, labelColumn);
  const operatingProfit = accountantBudgetValue(rows, ["Operating Profit"], totalColumn, labelColumn);
  const missing = [["Total Turnover", sales], ["Gross Profit", grossProfit], ["Total Labour Cost", labour], ["Operating Profit", operatingProfit]].filter(([, value]) => !Number.isFinite(value)).map(([label]) => label);
  if (missing.length) throw new Error(`${sheetName} is not a usable budget P&L. I could not read ${missing.join(", ")}.`);
  const operatingCosts = accountantBudgetValue(rows, ["Total Administrative Costs", "Operating Costs"], totalColumn, labelColumn) ?? grossProfit - operatingProfit;
  const overallGpPercent = accountantBudgetValue(rows, ["Overall GP", "Overall GP %"], totalColumn, labelColumn);
  const labourPercent = accountantBudgetValue(rows, ["Labour %", "Total Labour %"], totalColumn, labelColumn);
  const months = monthColumns.map(({ columnIndex, month }) => ({
    month,
    label: accountantBudgetMonthLabel(month),
    sales: accountantBudgetValue(rows, ["Total Turnover", "Total Sales"], columnIndex, labelColumn),
    grossProfit: accountantBudgetValue(rows, ["Gross Profit"], columnIndex, labelColumn),
    labour: accountantBudgetValue(rows, ["Total Labour Cost", "Total Labour"], columnIndex, labelColumn),
    operatingProfit: accountantBudgetValue(rows, ["Operating Profit"], columnIndex, labelColumn),
  }));
  if (requireBudget && months.some((month) => !Number.isFinite(month.sales) || !Number.isFinite(month.grossProfit) || !Number.isFinite(month.operatingProfit))) {
    throw new Error(`${sheetName} needs monthly Total Turnover, Gross Profit and Operating Profit values for all 12 months.`);
  }
  const startYear = Number(first.month.slice(0, 4));
  return {
    financialYear: `${startYear}/${String(startYear + 1).slice(-2)}`,
    periodLabel: `${accountantBudgetMonthLabel(first.month)} – ${accountantBudgetMonthLabel(last.month)}`,
    months,
    annual: {
      sales,
      grossProfit,
      overallGpPercent: Number.isFinite(overallGpPercent) ? overallGpPercent : grossProfit / sales,
      labour,
      labourPercent: Number.isFinite(labourPercent) ? labourPercent : labour / sales,
      operatingCosts,
      operatingProfit,
    },
  };
}

function accountantBudgetFromWorkbook(workbook, sourceName, preferredFinancialYear = "") {
  const candidates = workbook.SheetNames.map((sheetName) => ({ sheetName, sheet: workbook.Sheets[sheetName] }))
    .map((item) => ({ ...item, score: accountantBudgetSheetScore(item.sheetName, item.sheet, preferredFinancialYear) }))
    .filter((item) => Number.isFinite(item.score))
    .sort((left, right) => right.score - left.score);
  const usableBudgets = [];
  for (const candidate of candidates) {
    if (candidate.score < 85) continue;
    try {
      usableBudgets.push({ ...candidate, budget: accountantBudgetPnl(candidate.sheetName, candidate.sheet, { requireBudget: true }) });
    } catch (error) {
      console.warn(`${candidate.sheetName} was not used as the budget source.`, error);
    }
  }
  const budgetSheet = usableBudgets[0];
  if (!budgetSheet) throw new Error("I could not identify a usable accountant budget P&L. It needs monthly Total Turnover, Gross Profit, Total Labour Cost and Operating Profit lines.");
  const budget = budgetSheet.budget;
  let priorActual = null;
  const previousYear = `${Number(budget.financialYear.slice(0, 4)) - 1}/${budget.financialYear.slice(2, 4)}`;
  for (const candidate of candidates) {
    if (candidate.sheetName === budgetSheet.sheetName || !/actual/i.test(candidate.sheetName)) continue;
    try {
      const actual = accountantBudgetPnl(candidate.sheetName, candidate.sheet);
      if (actual.financialYear !== previousYear) continue;
      priorActual = actual.annual;
      break;
    } catch (error) {
      console.warn("Previous-year actuals were not imported.", error);
    }
  }
  return {
    ...budget,
    priorActual,
    sourceLabel: `${sourceName} · ${budgetSheet.sheetName}`,
  };
}

async function handleBudgetUpload(files) {
  const file = files?.[0];
  if (!file) return;
  if (!/\.(xlsx|xlsm|xls)$/i.test(file.name)) {
    state = { ...state, profitPlanMessage: "Please choose an Excel .xlsx, .xlsm or .xls budget file." };
    render();
    return;
  }
  if (!window.XLSX) {
    state = { ...state, profitPlanMessage: "The Excel reader is unavailable. Check your internet connection and reload the app." };
    render();
    return;
  }
  if (!localPreviewMode && !canManageUsers()) {
    state = { ...state, profitPlanMessage: "Only an Administrator or Owner can update the shared budget." };
    render();
    return;
  }
  state = { ...state, profitPlanMessage: "Reading the budget…" };
  render();
  try {
    const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    const budget = accountantBudgetFromWorkbook(workbook, file.name, profitPlanSelectedYear());
    if (localPreviewMode) {
      state = {
        ...state,
        profitPlanBudget: budget,
        profitPlanBudgets: { ...(state.profitPlanBudgets || {}), [budget.financialYear]: budget },
        profitPlanYear: budget.financialYear,
        budgetSalesAssumptions: { ...(state.budgetSalesAssumptions || {}), [budget.financialYear]: {} },
        budgetSalesExpandedMonth: "",
        budgetSalesDetailMonth: "",
        budgetSalesProjectionMonth: "",
        budgetSalesWeekProjectionMonth: "",
        profitPlanMessage: `${budget.financialYear} budget loaded locally. Review the sales plan and adjust monthly covers or spend per head if needed.`,
      };
    } else {
      state = { ...state, profitPlanMessage: "Saving the shared budget…" };
      render();
      const saved = await publishSharedBudget(budget, file.name);
      applySharedBudget(saved);
      state = {
        ...state,
        profitPlanYear: saved.budget.financialYear,
        budgetSalesExpandedMonth: "",
        budgetSalesDetailMonth: "",
        budgetSalesProjectionMonth: "",
        budgetSalesWeekProjectionMonth: "",
        profitPlanMessage: `${saved.budget.financialYear} budget saved securely for Owners and Admins.`,
      };
    }
  } catch (error) {
    console.error(error);
    state = { ...state, profitPlanMessage: error.message || "The accountant budget could not be read." };
  } finally {
    budgetInput.value = "";
    render();
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

function executiveDataFromWorkbook(workbook, currentWeek) {
  const rows = {};
  const salesWeeks = new Set();
  const addSheet = (sheetName, dateColumn, fields, { salesAnchor = false } = {}) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet?.["!ref"]) return;
    const range = window.XLSX.utils.decode_range(sheet["!ref"]);
    for (let row = range.s.r + 1; row <= range.e.r; row += 1) {
      const week = dateFromExcel(cellValue(sheet, row, dateColumn));
      if (!week || week > currentWeek) continue;
      const values = Object.fromEntries(Object.entries(fields).map(([key, column]) => {
        const value = cellValue(sheet, row, column);
        return [key, typeof value === "number" && Number.isFinite(value) ? value : null];
      }));
      // Some freshly updated Master Sheets have the inc-VAT total available
      // before the ex-VAT formula column refreshes. Either genuine weekly
      // sales total is enough to make the week available; blank future rows
      // remain excluded.
      if (salesAnchor && Math.max(Number(values.salesEx) || 0, Number(values.salesInc) || 0) > 1000) salesWeeks.add(week);
      if (!Object.values(values).some((value) => value !== null)) continue;
      rows[week] = { ...(rows[week] || {}), ...Object.fromEntries(Object.entries(values).filter(([, value]) => value !== null)) };
    }
  };

  addSheet("All Sales", 8, { salesInc: 42, salesEx: 43, foodSalesInc: 17, drinkSalesInc: 29 }, { salesAnchor: true });
  addSheet("Covers Summary", 2, { covers: 70 });
  addSheet("SPH", 0, { spendPerHead: 15 });
  addSheet("Function Info", 2, { functionSalesEx: 15, functionSalesInc: 16, functionFoodCovers: 18, functionSpendPerHead: 22 });
  addSheet("GP Overall", 0, { overallGpPounds: 4, overallGpPercent: 5 });
  addSheet("GP Food and Drink", 6, { foodGpPounds: 9, foodGpPercent: 10 });
  addSheet("GP Food and Drink", 21, { drinkGpPounds: 24, drinkGpPercent: 25 });
  addSheet("GP Food and Drink Adjusted", 0, { adjustedFoodGpPounds: 8, adjustedFoodGpPercent: 9 });
  addSheet("GP Food and Drink Adjusted", 20, { adjustedDrinkGpPounds: 28, adjustedDrinkGpPercent: 29 });
  addSheet("Wages", 69, { totalWages: 79, totalWagePercent: 80 });
  addSheet("Wages", 1, { fohWages: 7, fohWagePercent: 8 });
  addSheet("Wages", 18, { chefWages: 24, chefWagePercent: 25 });
  addSheet("Wages", 35, { cleanerWages: 41, cleanerWagePercent: 42 });
  addSheet("Wages", 52, { seniorManagementWages: 58, seniorManagementWagePercent: 59 });
  addSheet("Comps", 8, { comps: 52, compsPercentSales: 53, compsGpImpact: 61 });
  addSheet("Discounts", 36, { discounts: 37, discountPercentSales: 49 });
  addSheet("Shoots Breakdown", 2, { shoots: 3, shootRevenue: 9, shootMaterialCost: 15, shootGpPounds: 17, shootLabourCost: 23, shootGpImpact: 33 });
  addSheet("Expenses", 6, { expenses: 11 });
  addSheet("Future Bookings", 6, { futureBookings: 7 });
  addSheet("Utilities", 8, { electricUsage: 10, gasUsage: 14 });

  const weeks = [...salesWeeks].sort();
  if (!weeks.length) return null;
  return {
    version: 1,
    currentWeek,
    weeks,
    rows: Object.fromEntries(weeks.map((week) => [week, rows[week] || {}])),
  };
}

function latestSalesWeekFromWorkbook(workbook) {
  const sheet = workbook.Sheets["All Sales"];
  if (!sheet?.["!ref"]) return "";
  const range = window.XLSX.utils.decode_range(sheet["!ref"]);
  let latestWeek = "";
  for (let row = range.s.r + 1; row <= range.e.r; row += 1) {
    const week = dateFromExcel(cellValue(sheet, row, 8));
    const salesInc = Number(cellValue(sheet, row, 42));
    const salesEx = Number(cellValue(sheet, row, 43));
    if (week && Math.max(Number.isFinite(salesInc) ? salesInc : 0, Number.isFinite(salesEx) ? salesEx : 0) > 1000 && week > latestWeek) latestWeek = week;
  }
  return latestWeek;
}

function masterReportModelFromWorkbook(workbook, reportSheet) {
  const selectedReportWeek = dateFromExcel(cellValue(reportSheet, 1, 13));
  const currentWeek = latestSalesWeekFromWorkbook(workbook) || selectedReportWeek;
  if (!currentWeek) throw new Error("I could not find a week-ending date in the Master Sheet.");
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
    executive: executiveDataFromWorkbook(workbook, currentWeek),
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
budgetInput.addEventListener("change", (event) => { void handleBudgetUpload(event.target.files); });
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
  void registerTaskServiceWorker();
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
    const savedMaster = readSavedLocalPreviewMaster();
    let localExecutive = null;
    let localSourceName = "Local preview report";
    let localAvailableWeeks = [];
    if (savedMaster) {
      localPreviewModel = savedMaster.model;
      const restoredReport = reportForWeek(localPreviewModel, localPreviewModel.currentWeek);
      if (!restoredReport) throw new Error("The saved local Master Sheet could not be restored.");
      localPreviewSource = withOverviewTones(restoredReport);
      localExecutive = localPreviewModel.executive || null;
      localSourceName = plainText(savedMaster.sourceName) || "Saved local Master Sheet";
      localAvailableWeeks = localPreviewModel.availableWeeks || [restoredReport.selectedWeek];
    } else {
      const [response, executiveResponse] = await Promise.all([
        fetch("./data/report-data.json", { cache: "no-store" }),
        fetch("./data/executive-dashboard.json", { cache: "no-store" }),
      ]);
      if (!response.ok) throw new Error("The local sample report could not be loaded.");
      localPreviewSource = withOverviewTones(await response.json());
      localExecutive = executiveResponse.ok ? await executiveResponse.json() : null;
      localAvailableWeeks = [localPreviewSource.selectedWeek];
    }
    report = localPreviewSource;
    const viewerView = defaultAccessView(["sales", "covers", "wages"]);
    viewerView.overview.cards = ["sales-inc", "covers", "wages"];
    viewerView.sections.sales.fields = ["1", "4", "5", "6", "7", "8", "9", "10"];
    viewerView.sections.covers.fields = ["1", "2", "3", "4", "5", "6", "7"];
    viewerView.sections.wages.fields = ["1", "2", "3", "4", "5", "6"];
    const previewPeople = [
      { id: "preview-admin", name: "Admin preview", email: "admin@example.com" },
      { id: "preview-viewer", name: "Jordan Viewer", email: "jordan@example.com" },
      { id: "preview-owner", name: "Morgan Owner", email: "morgan@example.com" },
    ];
    const previewTasks = [
      { id: "local-task-1", title: "Check next week’s bookings", description: "Review the bookings report and flag any large tables that need a deposit.", assigneeId: "preview-admin", assigneeName: "Admin preview", creatorId: "preview-owner", creatorName: "Morgan Owner", watcherIds: ["preview-owner"], watcherNames: ["Morgan Owner"], dueAt: new Date(Date.now() + 86_400_000).toISOString(), reminders: [], recurrence: "weekly", status: "open", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), completionNote: "", reviewNote: "" },
      { id: "local-task-2", title: "Confirm the new menu briefing", description: "Share the final briefing with the front of house team.", assigneeId: "preview-admin", assigneeName: "Admin preview", creatorId: "preview-viewer", creatorName: "Jordan Viewer", watcherIds: [], watcherNames: [], dueAt: new Date(Date.now() + 172_800_000).toISOString(), reminders: [], recurrence: "none", status: "open", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), completionNote: "", reviewNote: "" },
    ];
    state = {
      ...state,
      section: "hub",
      week: report.selectedWeek,
      sourceName: localSourceName,
      availableWeeks: localAvailableWeeks,
      authMode: "authenticated",
      user: { id: "preview-admin", email: "admin@example.com", name: "Admin preview" },
      access: { enabled: true, role: "admin", sections: report.sections.map((section) => section.id), dateAccess: { scope: "all" }, canManageUsers: true, canPublish: true },
      executive: localExecutive,
      executivePeriod: localExecutive?.currentWeek?.slice(0, 4) || "",
      adminUsers: [
        { id: "preview-admin", name: "Admin preview", email: "admin@example.com", role: "admin", enabled: true, sections: report.sections.map((section) => section.id), view: null, dateAccess: { scope: "all" }, taskAccess: { canCreate: true, assigneeIds: ["*"] }, activity: { appViews: 18, lastViewedAt: new Date().toISOString(), recentViews: [{ label: "Weekly reports · 19 July 2026", at: new Date().toISOString() }, { label: "My tasks", at: new Date(Date.now() - 86_400_000).toISOString() }] }, isInitialAdmin: true },
        { id: "preview-viewer", name: "Jordan Viewer", email: "jordan@example.com", role: "viewer", enabled: true, sections: ["sales", "covers", "wages"], view: viewerView, dateAccess: { scope: "current" }, taskAccess: { canCreate: true, assigneeIds: ["preview-admin"] }, activity: { appViews: 7, lastViewedAt: new Date(Date.now() - 7_200_000).toISOString(), recentViews: [{ label: "Report section · Sales · 19 July 2026", at: new Date(Date.now() - 7_200_000).toISOString() }, { label: "Weekly reports · 19 July 2026", at: new Date(Date.now() - 7_300_000).toISOString() }] }, isInitialAdmin: false },
        { id: "preview-owner", name: "Morgan Owner", email: "morgan@example.com", role: "owner", enabled: true, sections: report.sections.map((section) => section.id), view: null, dateAccess: { scope: "all" }, taskAccess: { canCreate: true, assigneeIds: ["*"] }, activity: { appViews: 26, lastViewedAt: new Date(Date.now() - 3_600_000).toISOString(), recentViews: [{ label: "Update report", at: new Date(Date.now() - 3_600_000).toISOString() }, { label: "Information Hub", at: new Date(Date.now() - 3_700_000).toISOString() }] }, isInitialAdmin: false },
      ],
      taskData: { tasks: previewTasks, people: previewPeople, canCreate: true, canManageAll: true, outstandingCount: 2, notifications: [{ id: "local-notification-1", taskId: "local-task-1", title: "Check next week’s bookings", message: "Morgan Owner assigned you a task.", createdAt: new Date().toISOString(), readAt: "" }], push: { enabled: false, publicKey: "" } },
    };
    updateTaskBadge(2);
    render();
  } catch (error) {
    authFailure(error.message || "The local permissions preview could not be started.");
  }
}
