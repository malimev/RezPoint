/* RezPoint Service Worker — Push + Update */
const CACHE_NAME = "rezpoint-v2";

self.addEventListener("install", e => {
  /* Yeni SW hemen beklemeden devreye girsin */
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  /* Eski cache'leri temizle */
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => clients.claim())
  );
});

/* Güncelleme mesajı — sayfa SW'ye "güncelle" der */
self.addEventListener("message", e => {
  if (e.data?.type === "SKIP_WAITING") self.skipWaiting();
});

/* Push bildirimleri */
self.addEventListener("push", e => {
  if (!e.data) return;
  let payload;
  try { payload = e.data.json(); }
  catch { payload = { title: "RezPoint", body: e.data.text() }; }

  e.waitUntil(self.registration.showNotification(payload.title || "RezPoint", {
    body:    payload.body  || "",
    icon:    "/icon-192.png",
    badge:   "/icon-192.png",
    tag:     payload.tag   || "rezpoint",
    data:    payload.data  || {},
    vibrate: [200, 100, 200],
    requireInteraction: false,
    actions: payload.actions || [],
  }));
});

/* Bildirime tıklanınca */
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = e.notification.data?.url || "/";
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
