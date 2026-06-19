/* RezPoint Service Worker — Push Notifications */
const CACHE = "rezpoint-v1";

self.addEventListener("install", e => {
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(clients.claim());
});

/* Push event — bildirim göster */
self.addEventListener("push", e => {
  if (!e.data) return;

  let payload;
  try { payload = e.data.json(); }
  catch { payload = { title: "RezPoint", body: e.data.text() }; }

  const title = payload.title || "RezPoint";
  const options = {
    body:    payload.body  || "",
    icon:    payload.icon  || "/favicon.svg",
    badge:   "/favicon.svg",
    tag:     payload.tag   || "rezpoint",
    data:    payload.data  || {},
    vibrate: [200, 100, 200],
    requireInteraction: payload.requireInteraction || false,
    actions: payload.actions || [],
  };

  e.waitUntil(self.registration.showNotification(title, options));
});

/* Bildirime tıklanınca uygulamayı aç */
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";

  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes(self.location.origin) && "focus" in c) {
          c.postMessage({ type: "NOTIFICATION_CLICK", url });
          return c.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
