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
const drawerKicker = document.querySelector("#drawer-kicker");
const drawerTitle = document.querySelector("#drawer-title");
const topWeek = document.querySelector("#top-week");
const weekButton = document.querySelector("#week-button");
const uploadInput = document.querySelector("#weekly-report-input");

const sharedReportEndpoint = "/.netlify/functions/report";
const authEndpoint = "/.netlify/functions/auth";
const adminEndpoint = "/.netlify/functions/admin";
const tasksEndpoint = "/.netlify/functions/tasks";
const activityEndpoint = "/.netlify/functions/activity";
const sharedReportPollInterval = 60_000;
const localPreviewMode = location.hostname === "localhost" && new URLSearchParams(location.search).has("local-preview");
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
};
let expandedTable = null;
let sharedReportVersion = "";
let reportPolling = null;
let localPreviewSource = null;
let localPreviewModel = null;
let lastActivityKey = "";

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
  const startYear = month >= 4 ? year : year - 1;
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

function executiveComparableRows(weeks) {
  const entries = state.executive?.rows || {};
  const sameWeeksLastYear = weeks.map((week) => {
    const date = new Date(`${week}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - 364);
    return date.toISOString().slice(0, 10);
  });
  return executiveRowsForWeeks(sameWeeksLastYear).filter((row) => Object.keys(row).length > 1);
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

function executiveCardDetails({ id, label, key, kind, aggregate = "mean", lowerIsBetter = false, rows, comparisonRows, ratio, basis, valueToggle = false, valueToggleLabel = "£ value" }) {
  const showValue = Boolean((ratio || valueToggle) && state.executiveMetricModes?.[id] === "value");
  const current = executiveCardMetric(rows, { key, aggregate, ratio }, showValue);
  const previous = executiveCardMetric(comparisonRows, { key, aggregate, ratio }, showValue);
  const trend = comparisonRows.length ? executiveTrend(current, previous, {
    lowerIsBetter,
    mode: ratio ? showValue ? "value" : "points" : showValue ? "value" : "relative",
    kind: ratio?.valueKind || kind,
  }) : null;
  return {
    current,
    trend,
    kind: ratio && showValue ? ratio.valueKind || "currency" : kind,
    label: ratio && showValue ? ratio.valueLabel || label : label,
    basis: ratio ? showValue ? "Total for selected period" : "Percentage of sales for selected period" : basis || (aggregate === "sum" ? "Total for selected period" : "Average per reporting week"),
    toggle: ratio || valueToggle ? `<button class="executive-value-toggle" type="button" data-action="toggle-executive-value" data-metric="${escapeHtml(id)}">${showValue ? "Show %" : escapeHtml(valueToggleLabel)}</button>` : "",
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
  { id: "spend-per-head", label: "Average spend per head", key: "spendPerHead", kind: "currency", basis: "Average per reporting week" },
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
  const spendPerHead = executiveMetric(rows, "spendPerHead", "mean");
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
  const rows = executiveRowsForWeeks(executivePeriodWeeks());
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
  const rows = executiveRowsForWeeks(weeks);
  const showingAllAvailableData = grain === "all";
  const comparisonRows = showingAllAvailableData ? [] : executiveComparableRows(weeks);
  const comparisonNote = showingAllAvailableData
    ? "All reporting data is shown together, without a combined year-on-year comparison."
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
    <section class="executive-controls" aria-label="Executive dashboard period"><label>View by<select data-action="executive-grain"><option value="month" ${grain === "month" ? "selected" : ""}>Month</option><option value="quarter" ${grain === "quarter" ? "selected" : ""}>Quarter</option><option value="year" ${grain === "year" ? "selected" : ""}>Calendar year</option><option value="financial-year" ${grain === "financial-year" ? "selected" : ""}>Financial year (Apr–Mar)</option><option value="latest-13" ${grain === "latest-13" ? "selected" : ""}>Latest 13 weeks</option><option value="all" ${grain === "all" ? "selected" : ""}>All available data</option></select></label>${periodOptions.length ? `<label>Period<select data-action="executive-period">${periodOptions.map((option) => `<option value="${escapeHtml(option.value)}" ${selectedPeriod === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</select></label>` : ""}<button class="executive-scenario-button" type="button" data-action="open-executive-scenario"><span aria-hidden="true">∑</span> Scenario planner</button><p><strong>${escapeHtml(executivePeriodTitle())}</strong><span>${rows.length} reporting weeks · ${comparisonNote}</span></p></section>
    <section class="executive-kpis" aria-label="Executive key performance indicators">
      ${renderExecutiveKpi({ id: "sales-ex", label: "Sales ex VAT", key: "salesEx", kind: "currency", aggregate: "sum", basis: "Total for selected period", valueToggle: true, valueToggleLabel: "£ change", rows, comparisonRows })}
      ${renderExecutiveKpi({ id: "total-covers", label: "Total covers", key: "covers", kind: "number", aggregate: "sum", basis: "Total covers in selected period", rows, comparisonRows })}
      ${renderExecutiveKpi({ id: "spend-per-head", label: "Average spend per head", key: "spendPerHead", kind: "currency", basis: "Average per reporting week", rows, comparisonRows })}
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
  if (state.section === "hub") {
    setDrawerHeading("HUB MENU", "Information Hub");
    sectionMenu.innerHTML = [
      `<button class="menu-item is-active" data-section="hub"><span class="menu-item__icon">⌂</span><span>Information Hub</span><span class="menu-item__chevron">›</span></button>`,
      `<button class="menu-item" data-section="overview"><span class="menu-item__icon">▦</span><span>Weekly reports</span><span class="menu-item__chevron">›</span></button>`,
      renderTaskMenuItem(),
      ...(canManageUsers() && !state.previewUser ? [`<button class="menu-item" data-section="users"><span class="menu-item__icon">♙</span><span>Users</span><span class="menu-item__chevron">›</span></button>`] : []),
      ...(canViewExecutiveDashboard() ? [`<button class="menu-item menu-item--executive" data-section="executive"><span class="menu-item__icon">↗</span><span>Executive dashboard</span><span class="menu-item__chevron">›</span></button>`] : []),
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
  const page = state.section === "hub" ? renderHub() : state.section === "tasks" ? renderTasks() : state.section === "set-task" ? renderSetTask() : state.section === "users" ? renderUsers() : state.section === "activity" ? renderActivity() : state.section === "executive" ? renderExecutiveDashboard() : state.section === "admin" ? (state.menuMode === "tasks" ? renderTaskAdmin() : renderAdmin()) : !report ? renderNoReport() : state.section === "overview" ? renderOverview() : state.section === "update-report" ? renderUpdateReport() : renderSection(getSection(state.section));
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
    || section === "overview"
    || (section === "update-report" && canPublishReport() && !state.previewUser)
    || (section === "admin" && canManageUsers() && !state.previewUser)
    || report?.sections.some((item) => item.id === section);
  if (!permitted) return;
  const taskRoute = section === "tasks" || section === "set-task";
  const userRoute = section === "users" || section === "activity";
  state = { ...state, section, menuMode: taskRoute ? "tasks" : userRoute ? "users" : section === "admin" ? state.menuMode : "report" };
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
  state = { section: "hub", week: "", sourceName: "", isUploaded: false, authMode: "login", authMessage: "You have signed out.", authToken: "", user: null, access: null, adminUsers: null, adminMessage: "", availableWeeks: [], taskData: null, taskMessage: "", menuMode: "report", executive: null, executivePeriod: "", executiveMetricModes: {}, executiveDetailMetric: "", executiveDetailOverlays: [], executiveDetailYearScope: "all", executiveScenarioOpen: false, executiveScenario: null };
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
    const rows = executiveRowsForWeeks(executivePeriodWeeks());
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
    const rows = executiveRowsForWeeks(executivePeriodWeeks());
    const baseline = executiveScenarioBaseline(rows);
    if (!baseline) return;
    state = { ...state, executiveScenario: defaultExecutiveScenario(baseline) };
    render();
  }));
  document.querySelectorAll("[data-action='apply-executive-scenario']").forEach((button) => button.addEventListener("click", () => {
    applyExecutiveScenario();
  }));
  document.querySelectorAll("[data-action='set-executive-scenario-mode']").forEach((select) => select.addEventListener("change", () => {
    const rows = executiveRowsForWeeks(executivePeriodWeeks());
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
      if (salesAnchor && Number(values.salesEx) > 1000) salesWeeks.add(week);
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
    const [response, executiveResponse] = await Promise.all([
      fetch("./data/report-data.json", { cache: "no-store" }),
      fetch("./data/executive-dashboard.json", { cache: "no-store" }),
    ]);
    if (!response.ok) throw new Error("The local sample report could not be loaded.");
    localPreviewSource = withOverviewTones(await response.json());
    const localExecutive = executiveResponse.ok ? await executiveResponse.json() : null;
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
      sourceName: "Local preview report",
      availableWeeks: [report.selectedWeek],
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
