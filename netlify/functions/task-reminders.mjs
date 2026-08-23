import { getStore } from "@netlify/blobs";
import { sendTaskPushNotifications } from "./task-notifications.mjs";

const taskDataKey = "task-data";

function taskStore() {
  return getStore({ name: "larder-information-hub-tasks", consistency: "strong" });
}

function safeText(value, maximum = 240) {
  return String(value || "").trim().slice(0, maximum);
}

function validId(value) {
  const id = safeText(value, 120);
  return /^[A-Za-z0-9_-]{1,120}$/.test(id) ? id : "";
}

function taskReminderNotification(userId, task, message) {
  return {
    id: crypto.randomUUID(),
    userId,
    taskId: task.id,
    kind: "reminder",
    title: safeText(task.title, 140),
    message: safeText(message),
    createdAt: new Date().toISOString(),
    readAt: "",
  };
}

export default async function taskReminders() {
  const data = (await taskStore().get(taskDataKey, { type: "json" })) || { tasks: [], notifications: [], subscriptions: {} };
  const now = Date.now();
  const notifications = [];
  let changed = false;
  (data.tasks || []).forEach((task) => {
    if (!["open", "declined"].includes(task.status)) return;
    (task.reminders || []).forEach((reminder) => {
      const at = new Date(reminder.at).getTime();
      if (!reminder.sentAt && Number.isFinite(at) && at <= now) {
        reminder.sentAt = new Date().toISOString();
        task.updatedAt = reminder.sentAt;
        const assigneeId = validId(task.assigneeId);
        if (assigneeId) notifications.push(taskReminderNotification(assigneeId, task, "This task has a reminder due now."));
        changed = true;
      }
    });
  });
  if (!changed) return new Response(null, { status: 204 });
  data.notifications = [...(data.notifications || []), ...notifications].slice(-5_000);
  await taskStore().setJSON(taskDataKey, data);
  await sendTaskPushNotifications(data, notifications);
  await taskStore().setJSON(taskDataKey, data);
  return new Response(null, { status: 204 });
}

export const config = {
  schedule: "*/15 * * * *",
};
