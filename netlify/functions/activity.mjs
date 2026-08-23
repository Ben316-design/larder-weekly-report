import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { getStore } from "@netlify/blobs";
import { getAccessProfile } from "./access.mjs";

const maxRecentViews = 24;
const allowedKinds = new Set(["app-open", "hub", "tasks", "users", "user-activity", "report-overview", "report-section", "report-preview", "report-permissions", "report-update"]);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" },
  });
}

function activityStore() {
  return getStore({ name: "larder-user-activity", consistency: "strong" });
}

function activityKey(userId) {
  return `activity:${String(userId || "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120)}`;
}

function safeText(value, maximum = 120) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maximum);
}

function emptyActivity() {
  return { appViews: 0, totalViews: 0, lastViewedAt: "", recentViews: [] };
}

function normaliseActivity(value) {
  const source = value && typeof value === "object" ? value : {};
  const recentViews = Array.isArray(source.recentViews) ? source.recentViews : [];
  return {
    appViews: Math.max(0, Math.min(Number(source.appViews) || 0, 1_000_000)),
    totalViews: Math.max(0, Math.min(Number(source.totalViews) || 0, 1_000_000)),
    lastViewedAt: safeText(source.lastViewedAt, 40),
    recentViews: recentViews.slice(0, maxRecentViews).map((item) => ({
      kind: safeText(item?.kind, 40),
      label: safeText(item?.label, 140),
      at: safeText(item?.at, 40),
    })).filter((item) => item.label && item.at),
  };
}

function activityLabel(kind, detail) {
  const value = safeText(detail, 100);
  if (kind === "app-open") return "Opened the Information Hub";
  if (kind === "hub") return "Information Hub";
  if (kind === "tasks") return "My tasks";
  if (kind === "users") return "Users";
  if (kind === "user-activity") return "Account activity";
  if (kind === "report-overview") return value ? `Weekly reports · ${value}` : "Weekly reports";
  if (kind === "report-section") return value ? `Report section · ${value}` : "Report section";
  if (kind === "report-preview") return value ? `Previewed report · ${value}` : "Previewed a report";
  if (kind === "report-permissions") return "Report viewing permissions";
  if (kind === "report-update") return "Update report";
  return "Information Hub";
}

export async function getActivityMap(userIds) {
  const ids = [...new Set((Array.isArray(userIds) ? userIds : []).map(String).filter(Boolean))];
  const entries = await Promise.all(ids.map(async (userId) => {
    const saved = await activityStore().get(activityKey(userId), { type: "json" });
    return [userId, normaliseActivity(saved)];
  }));
  return Object.fromEntries(entries);
}

export async function recordActivity(userId, event) {
  const kind = allowedKinds.has(event?.kind) ? event.kind : "hub";
  const current = normaliseActivity(await activityStore().get(activityKey(userId), { type: "json" }));
  const at = new Date().toISOString();
  const next = {
    ...current,
    appViews: current.appViews + (kind === "app-open" ? 1 : 0),
    totalViews: current.totalViews + 1,
    lastViewedAt: at,
    recentViews: [{ kind, label: activityLabel(kind, event?.detail), at }, ...current.recentViews].slice(0, maxRecentViews),
  };
  await activityStore().setJSON(activityKey(userId), next);
  return next;
}

export default async function activity(request) {
  const user = await getUser();
  if (!user) return json({ error: "Please sign in." }, 401);
  const access = await getAccessProfile(user);
  if (!access.enabled) return json({ error: "This account does not have access." }, 403);

  if (request.method === "GET") {
    return json({ activity: (await getActivityMap([user.id]))[user.id] || emptyActivity() });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    verifyRequestOrigin(request);
  } catch {
    return json({ error: "This request must come from the Larder Information Hub." }, 403);
  }
  const body = await request.json().catch(() => ({}));
  return json({ activity: await recordActivity(user.id, body) }, 201);
}
