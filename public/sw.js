/* RezPoint Service Worker v3 */
const CACHE_NAME = "rezpoint-v3";

self.addEventListener("install", () => {
  /* skipWaiting burada YOK — bilerek. SW bekleme durumuna girmeli ki
     App.jsx banner gösterebilsin ve kullanıcı güncellemeyi onaylasın. */
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => clients.claim())
  );
});

/* Kullanıcı "Güncelle" düğmesine basınca buraya mesaj gelir */
self.addEventListener("message", e => {
  if (e.data?.type === "SKIP_WAITING") self.skipWaiting();
});

/* Push bildirimleri */
self.addEventListener("push", e => {
  if (!e.data) return;
  let p;
  try { p = e.data.json(); } catch { p = { title: "RezPoint", body: e.data.text() }; }

  e.waitUntil(self.registration.showNotification(p.title || "RezPoint", {
    body:    p.body || "",
    icon:    "/icon-192.png",
    badge:   "/icon-192.png",
    tag:     p.tag  || "rezpoint",
    data:    p.data || {},
    vibrate: [200, 100, 200],
  }));
});

/* Bildirime tıklanınca uygulamayı öne getir */
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
