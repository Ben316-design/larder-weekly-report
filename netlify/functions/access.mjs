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

function validSections(value) {
  const values = Array.isArray(value) ? value : [];
  return sectionIds.filter((section) => values.includes(section));
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
    sections: hasFullAccess ? [...sectionIds] : validSections(saved.sections),
    canManageUsers: hasFullAccess,
    canPublish: hasFullAccess || Boolean(saved.canPublish),
  };
}

export function publicAccessProfile(access) {
  return {
    role: access.role,
    sections: access.sections,
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
