import { getStore } from "@netlify/blobs";

export const sectionIds = [
  "sales", "covers", "lunch", "dinner", "sph", "bookings", "overall-gp",
  "food-gp", "drink-gp", "wages", "foh", "chefs", "cleaners",
];

const accessKey = "user-access";
const reauthenticationPrefix = "reauthentication:";
const reauthenticationWindowMs = 5 * 60 * 1000;

function accessStore() {
  return getStore({ name: "larder-report-access", consistency: "strong" });
}

function normaliseEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function initialAdminEmails() {
  return String(process.env.INITIAL_ADMIN_EMAILS || "")
    .split(",")
    .map(normaliseEmail)
    .filter(Boolean);
}

export function isInitialAdmin(user) {
  return initialAdminEmails().includes(normaliseEmail(user?.email));
}

function validSectionId(value) {
  return /^[a-z0-9][a-z0-9-]{0,79}$/.test(String(value || ""));
}

function validSections(value) {
  const values = Array.isArray(value) ? value : [];
  return [...new Set(values.map((section) => String(section || "").trim()).filter(validSectionId))].slice(0, 100);
}

function validWeek(value) {
  const week = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) return "";
  const date = new Date(`${week}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === week ? week : "";
}

export function normaliseDateAccess(value) {
  const access = value && typeof value === "object" ? value : {};
  if (access.scope === "all") return { scope: "all" };
  const start = validWeek(access.start);
  const end = validWeek(access.end);
  if (access.scope === "range" && start && end && start <= end) return { scope: "range", start, end };
  return { scope: "current" };
}

export function normaliseAccessView(value) {
  if (!value || typeof value !== "object") return null;
  const overview = value.overview && typeof value.overview === "object" ? value.overview : {};
  const sections = value.sections && typeof value.sections === "object" ? value.sections : {};
  return {
    overview: {
      enabled: overview.enabled !== false,
      cards: Array.isArray(overview.cards) ? [...new Set(overview.cards.map((card) => String(card).slice(0, 80)).filter(Boolean))].slice(0, 100) : [],
    },
    sections: Object.fromEntries(Object.entries(sections)
      .filter(([section, selection]) => validSectionId(section) && selection && typeof selection === "object")
      .slice(0, 100)
      .map(([section, selection]) => [section, {
        enabled: selection.enabled !== false,
        fields: Array.isArray(selection.fields)
          ? [...new Set(selection.fields.map((field) => String(field).slice(0, 80)).filter(Boolean))].slice(0, 200)
          : [],
      }])),
  };
}

export function selectedSectionsFromView(view) {
  if (!view?.sections) return [];
  return validSections(Object.entries(view.sections)
    .filter(([, selection]) => selection?.enabled !== false)
    .map(([section]) => section));
}

export async function getAccessMap() {
  return (await accessStore().get(accessKey, { type: "json" })) || { users: {} };
}

export async function saveAccess(userId, access) {
  const current = await getAccessMap();
  const users = { ...(current.users || {}) };
  users[userId] = {
    enabled: access.enabled !== false,
    role: access.role === "owner" ? "owner" : "viewer",
    sections: validSections(access.sections),
    view: normaliseAccessView(access.view),
    dateAccess: normaliseDateAccess(access.dateAccess),
    canPublish: Boolean(access.canPublish),
    updatedAt: new Date().toISOString(),
  };
  await accessStore().setJSON(accessKey, { users });
  return users[userId];
}

export async function getAccessProfile(user) {
  const isAdmin = isInitialAdmin(user) || user?.role === "admin" || user?.roles?.includes("admin");
  const isOwner = !isAdmin && (user?.role === "owner" || user?.roles?.includes("owner"));
  const saved = (await getAccessMap()).users?.[user?.id] || {};
  const role = isAdmin ? "admin" : isOwner ? "owner" : "viewer";
  const enabled = isAdmin || isOwner || saved.enabled !== false;
  const hasFullAccess = isAdmin || isOwner;

  return {
    enabled,
    role,
    sections: hasFullAccess ? [] : validSections(saved.sections),
    view: hasFullAccess ? null : saved.view || null,
    dateAccess: hasFullAccess ? { scope: "all" } : normaliseDateAccess(saved.dateAccess),
    canManageUsers: hasFullAccess,
    canPublish: hasFullAccess || Boolean(saved.canPublish),
  };
}

export function publicAccessProfile(access) {
  return {
    enabled: access.enabled,
    role: access.role,
    sections: access.sections,
    view: access.view,
    dateAccess: access.dateAccess,
    canManageUsers: access.canManageUsers,
    canPublish: access.canPublish,
  };
}

export async function markReauthenticated(userId) {
  await accessStore().setJSON(`${reauthenticationPrefix}${userId}`, { at: Date.now() });
}

export async function hasRecentReauthentication(userId) {
  const verification = await accessStore().get(`${reauthenticationPrefix}${userId}`, { type: "json" });
  return Number(verification?.at) > Date.now() - reauthenticationWindowMs;
}
