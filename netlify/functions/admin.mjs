import { admin, getUser, verifyRequestOrigin } from "@netlify/identity";
import {
  getAccessMap,
  getAccessProfile,
  hasRecentReauthentication,
  initialAdminEmails,
  normaliseAccessView,
  normaliseDateAccess,
  normaliseTaskAccess,
  publicAccessProfile,
  saveAccess,
  selectedSectionsFromView,
} from "./access.mjs";
import { getActivityMap } from "./activity.mjs";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" },
  });
}

function safeText(value, maximum = 160) {
  return String(value || "").trim().slice(0, maximum);
}

function validEmail(value) {
  const email = safeText(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function validRole(value) {
  return value === "owner" ? "owner" : "viewer";
}

function requestedAccess(body, role) {
  const view = normaliseAccessView(body.view);
  const selected = view ? selectedSectionsFromView(view) : (Array.isArray(body.sections) ? body.sections : []);
  return {
    enabled: body.enabled !== false,
    role,
    sections: selected,
    view,
    dateAccess: normaliseDateAccess(body.dateAccess),
    canPublish: role === "owner",
    taskAccess: normaliseTaskAccess(body.taskAccess),
  };
}

function savedAccountAccess(saved, role, enabled) {
  const previous = saved && typeof saved === "object" ? saved : {};
  if (role === "owner") {
    return {
      enabled: true,
      role,
      sections: [],
      view: null,
      dateAccess: { scope: "all" },
      canPublish: true,
      taskAccess: { canCreate: true, assigneeIds: ["*"] },
    };
  }
  return {
    enabled: enabled !== false,
    role: "viewer",
    sections: previous.sections || [],
    view: previous.view || null,
    dateAccess: normaliseDateAccess(previous.dateAccess),
    canPublish: false,
    taskAccess: normaliseTaskAccess(previous.taskAccess),
  };
}

function savedReportAccess(saved, body) {
  const view = normaliseAccessView(body.view);
  return {
    enabled: saved?.enabled !== false,
    role: "viewer",
    sections: selectedSectionsFromView(view),
    view,
    dateAccess: normaliseDateAccess(body.dateAccess),
    canPublish: false,
    taskAccess: normaliseTaskAccess(saved?.taskAccess),
  };
}

function initialAdmin(user) {
  return initialAdminEmails().includes(String(user?.email || "").trim().toLowerCase());
}

async function requireManager(request, { requireRecentPassword = false } = {}) {
  const user = await getUser();
  if (!user) return { error: json({ error: "Please sign in." }, 401) };
  const access = await getAccessProfile(user);
  if (!access.enabled || !access.canManageUsers) return { error: json({ error: "You do not have access to the Admin Control Centre." }, 403) };
  if (requireRecentPassword && access.role === "owner" && !(await hasRecentReauthentication(user.id))) {
    return { error: json({ error: "Confirm your account password before making this change." }, 428) };
  }
  return { user, access };
}

async function listUsers() {
  const [identityUsers, accessMap] = await Promise.all([admin.listUsers({ perPage: 100 }), getAccessMap()]);
  const activityMap = await getActivityMap(identityUsers.map((user) => user.id));
  return identityUsers.map((user) => {
    const saved = accessMap.users?.[user.id] || {};
    const administrator = initialAdmin(user) || user.role === "admin" || user.roles?.includes("admin");
    const owner = !administrator && (user.role === "owner" || user.roles?.includes("owner"));
    const role = administrator ? "admin" : owner ? "owner" : "viewer";
    return {
      id: user.id,
      email: user.email || "",
      name: user.name || "",
      role,
      enabled: administrator || owner || saved.enabled !== false,
      sections: administrator || owner ? [] : (saved.sections || []),
      view: administrator || owner ? null : saved.view || null,
      dateAccess: administrator || owner ? { scope: "all" } : normaliseDateAccess(saved.dateAccess),
      canPublish: administrator || owner,
      taskAccess: administrator || owner ? { canCreate: true, assigneeIds: ["*"] } : normaliseTaskAccess(saved.taskAccess),
      lastSignInAt: user.lastSignInAt || "",
      activity: activityMap[user.id],
      isInitialAdmin: administrator && initialAdmin(user),
    };
  }).sort((left, right) => left.email.localeCompare(right.email));
}

export default async function manageUsers(request) {
  if (request.method === "GET") {
    const manager = await requireManager(request);
    if (manager.error) return manager.error;
    return json({ access: publicAccessProfile(manager.access), users: await listUsers() });
  }

  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    verifyRequestOrigin(request);
  } catch {
    return json({ error: "This request must come from the Larder report app." }, 403);
  }
  const manager = await requireManager(request, { requireRecentPassword: true });
  if (manager.error) return manager.error;
  const body = await request.json().catch(() => ({}));

  if (body.action === "create" || body.action === "create-account") {
    const email = validEmail(body.email);
    const password = String(body.password || "");
    const role = validRole(body.role);
    if (!email) return json({ error: "Enter a valid email address." }, 400);
    if (password.length < 12) return json({ error: "Use a temporary password with at least 12 characters." }, 400);
    if (manager.access.role === "owner" && role !== "viewer") return json({ error: "Only an Admin can create another Owner." }, 403);
    try {
      const user = await admin.createUser({
        email,
        password,
        data: {
          role,
          app_metadata: { roles: [role] },
          user_metadata: { full_name: safeText(body.name, 80) },
        },
      });
      const access = body.action === "create-account"
        ? savedAccountAccess({}, role, true)
        : requestedAccess(body, role);
      await saveAccess(user.id, access);
      return json({ users: await listUsers() }, 201);
    } catch {
      return json({ error: "That email address is already in use, or the account could not be created." }, 400);
    }
  }

  if (body.action === "update-account") {
    const userId = safeText(body.userId, 100);
    if (!userId) return json({ error: "Choose a user to update." }, 400);
    let target;
    try {
      target = await admin.getUser(userId);
    } catch {
      return json({ error: "That user could not be found." }, 404);
    }
    if (initialAdmin(target)) return json({ error: "The initial Admin account cannot be changed here." }, 403);
    const targetProfile = await getAccessProfile(target);
    const role = validRole(body.role);
    if (manager.access.role === "owner" && (targetProfile.role !== "viewer" || role !== "viewer")) {
      return json({ error: "Owners can only change Viewer accounts." }, 403);
    }
    await admin.updateUser(target.id, {
      role,
      app_metadata: { ...(target.appMetadata || {}), roles: [role] },
      user_metadata: { ...(target.userMetadata || {}), full_name: safeText(body.name, 80) },
    });
    const saved = (await getAccessMap()).users?.[target.id] || {};
    await saveAccess(target.id, savedAccountAccess(saved, role, body.enabled !== false));
    return json({ users: await listUsers() });
  }

  if (body.action === "update-report-access") {
    const userId = safeText(body.userId, 100);
    if (!userId) return json({ error: "Choose a user to update." }, 400);
    let target;
    try {
      target = await admin.getUser(userId);
    } catch {
      return json({ error: "That user could not be found." }, 404);
    }
    if (initialAdmin(target)) return json({ error: "The initial Admin always has full report access." }, 403);
    const targetProfile = await getAccessProfile(target);
    if (targetProfile.role !== "viewer") return json({ error: "Owner report access is always unrestricted." }, 403);
    if (manager.access.role === "owner" && targetProfile.role !== "viewer") return json({ error: "Owners can only change Viewer accounts." }, 403);
    const saved = (await getAccessMap()).users?.[target.id] || {};
    await saveAccess(target.id, savedReportAccess(saved, body));
    return json({ users: await listUsers() });
  }

  if (body.action === "update") {
    const userId = safeText(body.userId, 100);
    if (!userId) return json({ error: "Choose a user to update." }, 400);
    let target;
    try {
      target = await admin.getUser(userId);
    } catch {
      return json({ error: "That user could not be found." }, 404);
    }
    if (initialAdmin(target)) return json({ error: "The initial Admin account cannot be changed here." }, 403);
    const targetProfile = await getAccessProfile(target);
    const role = validRole(body.role);
    if (manager.access.role === "owner" && (targetProfile.role !== "viewer" || role !== "viewer")) {
      return json({ error: "Owners can only change Viewer accounts." }, 403);
    }
    await admin.updateUser(target.id, {
      role,
      app_metadata: { ...(target.appMetadata || {}), roles: [role] },
      user_metadata: { ...(target.userMetadata || {}), full_name: safeText(body.name, 80) },
    });
    await saveAccess(target.id, requestedAccess(body, role));
    return json({ users: await listUsers() });
  }

  if (body.action === "update-task-access") {
    const userId = safeText(body.userId, 100);
    if (!userId) return json({ error: "Choose a person to update." }, 400);
    let target;
    try {
      target = await admin.getUser(userId);
    } catch {
      return json({ error: "That user could not be found." }, 404);
    }
    if (initialAdmin(target)) return json({ error: "Admin task access is always unrestricted." }, 403);
    const targetProfile = await getAccessProfile(target);
    if (targetProfile.role !== "viewer") return json({ error: "Owner task access is always unrestricted." }, 403);
    if (manager.access.role === "owner" && targetProfile.role !== "viewer") return json({ error: "Owners can only change Viewer accounts." }, 403);
    const saved = (await getAccessMap()).users?.[target.id] || {};
    await saveAccess(target.id, {
      ...saved,
      enabled: saved.enabled !== false,
      role: "viewer",
      taskAccess: normaliseTaskAccess(body.taskAccess),
    });
    return json({ users: await listUsers() });
  }

  return json({ error: "Invalid admin action." }, 400);
}
