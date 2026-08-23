import { admin, getUser, verifyRequestOrigin } from "@netlify/identity";
import { getStore } from "@netlify/blobs";
import { getAccessMap, getAccessProfile, initialAdminEmails, isInitialAdmin } from "./access.mjs";
import { sendTaskPushNotifications } from "./task-notifications.mjs";

const taskDataKey = "task-data";
const maxTasks = 1_000;
const maxNotifications = 5_000;

function taskStore() {
  return getStore({ name: "larder-information-hub-tasks", consistency: "strong" });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" },
  });
}

function safeText(value, maximum = 500) {
  return String(value || "").trim().slice(0, maximum);
}

function validId(value) {
  const id = safeText(value, 120);
  return /^[A-Za-z0-9_-]{1,120}$/.test(id) ? id : "";
}

function validDateTime(value) {
  const date = new Date(String(value || ""));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function uniqueIds(value) {
  const values = Array.isArray(value) ? value : [];
  return [...new Set(values.map(validId).filter(Boolean))].slice(0, 100);
}

function recurrenceFrom(value) {
  return value === "weekly" || value === "monthly" ? value : "none";
}

function emptyTaskData() {
  return { tasks: [], notifications: [], subscriptions: {} };
}

async function readTaskData() {
  const stored = await taskStore().get(taskDataKey, { type: "json" });
  return {
    tasks: Array.isArray(stored?.tasks) ? stored.tasks.slice(0, maxTasks) : [],
    notifications: Array.isArray(stored?.notifications) ? stored.notifications.slice(-maxNotifications) : [],
    subscriptions: stored?.subscriptions && typeof stored.subscriptions === "object" ? stored.subscriptions : {},
  };
}

async function saveTaskData(data) {
  await taskStore().setJSON(taskDataKey, {
    tasks: Array.isArray(data.tasks) ? data.tasks.slice(-maxTasks) : [],
    notifications: Array.isArray(data.notifications) ? data.notifications.slice(-maxNotifications) : [],
    subscriptions: data.subscriptions && typeof data.subscriptions === "object" ? data.subscriptions : {},
  });
}

function roleForUser(user) {
  const email = String(user?.email || "").trim().toLowerCase();
  const administrator = initialAdminEmails().includes(email) || user?.role === "admin" || user?.roles?.includes("admin");
  if (administrator) return "admin";
  return user?.role === "owner" || user?.roles?.includes("owner") ? "owner" : "viewer";
}

function personName(user) {
  return safeText(user?.name || user?.userMetadata?.full_name || user?.email, 100) || "Larder user";
}

async function peopleWithAccess() {
  const [identityUsers, accessMap] = await Promise.all([admin.listUsers({ perPage: 100 }), getAccessMap()]);
  return identityUsers.map((user) => {
    const role = roleForUser(user);
    const saved = accessMap.users?.[user.id] || {};
    return {
      id: user.id,
      name: personName(user),
      email: safeText(user.email, 254),
      role,
      enabled: role !== "viewer" || saved.enabled !== false,
    };
  }).filter((person) => person.enabled);
}

function canManageAllTasks(access) {
  return access.role === "admin" || access.role === "owner";
}

function canCreateTasks(access) {
  return canManageAllTasks(access) || Boolean(access.taskAccess?.canCreate);
}

function assignablePeople(access, people) {
  if (!canCreateTasks(access)) return [];
  if (canManageAllTasks(access) || access.taskAccess?.assigneeIds?.includes("*")) return people;
  const allowed = new Set(access.taskAccess?.assigneeIds || []);
  return people.filter((person) => allowed.has(person.id));
}

function notify(data, userIds, task, kind, message) {
  const createdAt = new Date().toISOString();
  const unique = [...new Set(userIds.map(validId).filter(Boolean))];
  return unique.map((userId) => {
    const notification = {
      id: crypto.randomUUID(),
      userId,
      taskId: task.id,
      kind,
      title: task.title,
      message: safeText(message, 240),
      createdAt,
      readAt: "",
    };
    data.notifications.push(notification);
    return notification;
  });
}

function addRecurringDate(value, recurrence) {
  const date = new Date(value);
  if (recurrence === "weekly") date.setUTCDate(date.getUTCDate() + 7);
  if (recurrence === "monthly") date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString();
}

function nextRecurringTask(task) {
  if (task.recurrence === "none" || !task.dueAt) return null;
  const dueAt = addRecurringDate(task.dueAt, task.recurrence);
  const priorDue = new Date(task.dueAt).getTime();
  const nextDue = new Date(dueAt).getTime();
  const reminders = (task.reminders || []).map((reminder) => {
    const priorReminder = new Date(reminder.at).getTime();
    const leadTime = Math.max(0, priorDue - priorReminder);
    return { at: new Date(nextDue - leadTime).toISOString(), sentAt: "" };
  });
  return {
    ...task,
    id: crypto.randomUUID(),
    status: "open",
    dueAt,
    reminders,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    submittedAt: "",
    completedAt: "",
    completionNote: "",
    reviewNote: "",
    parentTaskId: task.id,
  };
}

function taskForClient(task, people) {
  const names = new Map(people.map((person) => [person.id, person.name]));
  return {
    ...task,
    assigneeName: names.get(task.assigneeId) || "Assigned user",
    creatorName: names.get(task.creatorId) || "Task setter",
    watcherNames: (task.watcherIds || []).map((userId) => names.get(userId)).filter(Boolean),
  };
}

function taskRecipients(task) {
  return [...new Set([task.creatorId, ...(task.watcherIds || [])])];
}

function responsePayload(data, user, access, people) {
  const fullAccess = canManageAllTasks(access);
  const relevant = data.tasks.filter((task) => fullAccess
    || task.assigneeId === user.id
    || task.creatorId === user.id
    || task.watcherIds?.includes(user.id));
  const assigned = relevant.filter((task) => task.assigneeId === user.id && ["open", "declined"].includes(task.status));
  const notifications = data.notifications.filter((note) => note.userId === user.id).slice(-50).reverse();
  return {
    tasks: relevant.sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""))).map((task) => taskForClient(task, people)),
    people: assignablePeople(access, people).map(({ id, name, email }) => ({ id, name, email })),
    canCreate: canCreateTasks(access),
    canManageAll: fullAccess,
    outstandingCount: assigned.length,
    notifications,
    push: { enabled: Boolean(process.env.VAPID_PUBLIC_KEY), publicKey: process.env.VAPID_PUBLIC_KEY || "" },
  };
}

function createTask(body, user, people) {
  const title = safeText(body.title, 140);
  const assigneeId = validId(body.assigneeId);
  const validPeople = new Set(people.map((person) => person.id));
  const dueAt = validDateTime(body.dueAt);
  const reminderAt = validDateTime(body.reminderAt);
  if (!title) throw new Error("Enter a task title.");
  if (!validPeople.has(assigneeId)) throw new Error("Choose a permitted person for this task.");
  if (!dueAt) throw new Error("Choose a due date and time.");
  if (reminderAt && new Date(reminderAt).getTime() >= new Date(dueAt).getTime()) throw new Error("A reminder must be before the due time.");
  const watcherIds = uniqueIds(body.watcherIds).filter((id) => validPeople.has(id) && id !== assigneeId && id !== user.id);
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title,
    description: safeText(body.description, 2_000),
    creatorId: user.id,
    assigneeId,
    watcherIds,
    dueAt,
    reminders: reminderAt ? [{ at: reminderAt, sentAt: "" }] : [],
    recurrence: recurrenceFrom(body.recurrence),
    status: "open",
    createdAt: now,
    updatedAt: now,
    submittedAt: "",
    completedAt: "",
    completionNote: "",
    reviewNote: "",
    parentTaskId: "",
  };
}

export default async function tasks(request) {
  const user = await getUser();
  if (!user) return json({ error: "Please sign in to use My tasks." }, 401);
  const access = await getAccessProfile(user);
  if (!access.enabled) return json({ error: "Your account does not have access to the Hub." }, 403);
  const [data, people] = await Promise.all([readTaskData(), peopleWithAccess()]);

  if (request.method === "GET") return json(responsePayload(data, user, access, people));
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    verifyRequestOrigin(request);
  } catch {
    return json({ error: "This request must come from the Larder Information Hub." }, 403);
  }
  const body = await request.json().catch(() => ({}));

  if (body.action === "subscribe") {
    const subscription = body.subscription && typeof body.subscription === "object" ? body.subscription : {};
    const endpoint = safeText(subscription.endpoint, 1_000);
    const keys = subscription.keys && typeof subscription.keys === "object" ? subscription.keys : {};
    if (!/^https:\/\//.test(endpoint) || !safeText(keys.p256dh, 400) || !safeText(keys.auth, 400)) return json({ error: "That phone notification request was not valid." }, 400);
    const current = Array.isArray(data.subscriptions[user.id]) ? data.subscriptions[user.id] : [];
    data.subscriptions[user.id] = [...current.filter((item) => item.endpoint !== endpoint), { endpoint, keys: { p256dh: safeText(keys.p256dh, 400), auth: safeText(keys.auth, 400) }, createdAt: new Date().toISOString() }].slice(-5);
    await saveTaskData(data);
    return json(responsePayload(data, user, access, people));
  }

  if (body.action === "mark-notifications-read") {
    data.notifications.forEach((note) => {
      if (note.userId === user.id && !note.readAt) note.readAt = new Date().toISOString();
    });
    await saveTaskData(data);
    return json(responsePayload(data, user, access, people));
  }

  if (body.action === "create") {
    if (!canCreateTasks(access)) return json({ error: "You do not have permission to set tasks." }, 403);
    const permittedPeople = assignablePeople(access, people);
    let task;
    try {
      task = createTask(body, user, permittedPeople);
    } catch (error) {
      return json({ error: error.message || "The task could not be created." }, 400);
    }
    data.tasks.push(task);
    const notifications = notify(data, [task.assigneeId, ...task.watcherIds], task, "assigned", `${personName(user)} assigned you a task.`);
    await saveTaskData(data);
    await sendTaskPushNotifications(data, notifications);
    await saveTaskData(data);
    return json(responsePayload(data, user, access, people), 201);
  }

  const task = data.tasks.find((item) => item.id === validId(body.taskId));
  if (!task) return json({ error: "That task could not be found." }, 404);
  const now = new Date().toISOString();

  if (body.action === "complete") {
    if (task.assigneeId !== user.id || !["open", "declined"].includes(task.status)) return json({ error: "Only the assigned person can complete this task." }, 403);
    task.status = "awaiting_approval";
    task.submittedAt = now;
    task.completionNote = safeText(body.completionNote, 1_000);
    task.updatedAt = now;
    const notifications = notify(data, taskRecipients(task), task, "awaiting_approval", `${personName(user)} marked this task as completed.`);
    await saveTaskData(data);
    await sendTaskPushNotifications(data, notifications);
    await saveTaskData(data);
    return json(responsePayload(data, user, access, people));
  }

  if (body.action === "review") {
    if (task.status !== "awaiting_approval" || (task.creatorId !== user.id && !canManageAllTasks(access))) return json({ error: "Only the task setter can review this completion." }, 403);
    const approved = body.decision === "approve";
    task.status = approved ? "completed" : "declined";
    task.completedAt = approved ? now : "";
    task.reviewNote = safeText(body.reviewNote, 1_000);
    task.updatedAt = now;
    const notifications = notify(data, [task.assigneeId, ...task.watcherIds], task, approved ? "approved" : "declined", approved ? `${personName(user)} approved this completed task.` : `${personName(user)} asked for this task to be completed again.`);
    if (approved) {
      const nextTask = nextRecurringTask(task);
      if (nextTask) {
        data.tasks.push(nextTask);
        notifications.push(...notify(data, [nextTask.assigneeId, ...nextTask.watcherIds], nextTask, "recurring", "A new recurring task is ready."));
      }
    }
    await saveTaskData(data);
    await sendTaskPushNotifications(data, notifications);
    await saveTaskData(data);
    return json(responsePayload(data, user, access, people));
  }

  return json({ error: "Invalid task action." }, 400);
}
