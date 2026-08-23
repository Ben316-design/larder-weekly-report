self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data?.json() || {};
  } catch {
    payload = { body: event.data?.text() || "You have a task update." };
  }
  event.waitUntil(self.registration.showNotification(payload.title || "Larder Information Hub", {
    body: payload.body || "You have a task update.",
    data: { url: payload.url || "/?open=tasks" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/?open=tasks";
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const matching = windows.find((windowClient) => windowClient.url.includes("open=tasks"));
    if (matching) return matching.focus();
    return clients.openWindow(url);
  }));
});
