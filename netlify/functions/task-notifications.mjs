import webpush from "web-push";

let vapidConfigured = false;

function pushEnabled() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

function configureVapid() {
  if (!pushEnabled() || vapidConfigured) return pushEnabled();
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:tasks@larderlichfield.com",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
  vapidConfigured = true;
  return true;
}

export async function sendTaskPushNotifications(data, notifications) {
  if (!configureVapid() || !Array.isArray(notifications) || !notifications.length) return;
  const expiredEndpoints = new Set();
  await Promise.allSettled(notifications.flatMap((notification) => {
    const subscriptions = Array.isArray(data.subscriptions?.[notification.userId]) ? data.subscriptions[notification.userId] : [];
    const payload = JSON.stringify({
      title: `Larder tasks: ${notification.title}`,
      body: notification.message,
      url: "/?open=tasks",
    });
    return subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(subscription, payload, { TTL: 60 * 60 });
      } catch (error) {
        if (error?.statusCode === 404 || error?.statusCode === 410) expiredEndpoints.add(subscription.endpoint);
        else console.warn("Task push notification could not be sent.", error?.message || error);
      }
    });
  }));
  if (expiredEndpoints.size) {
    Object.entries(data.subscriptions || {}).forEach(([userId, subscriptions]) => {
      data.subscriptions[userId] = (subscriptions || []).filter((subscription) => !expiredEndpoints.has(subscription.endpoint));
    });
  }
}

