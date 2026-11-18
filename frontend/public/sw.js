/*
 * LUPIN staff service worker. It only shows "new order" push notifications on staff phones and
 * computers, and opens the order when one is tapped. It does not touch page loads or caching.
 * Registered with scope /admin/ from the dashboard (features/admin/push.ts).
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: event.data ? event.data.text() : "" };
  }
  const title = data.title || "LUPIN — طلب جديد";
  // Only our own pages may be opened from a notification.
  const url = typeof data.url === "string" && data.url.startsWith("/admin") ? data.url : "/admin";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      icon: "/brand/app-icon-512.png",
      badge: "/brand/favicon.png",
      lang: "ar",
      dir: "auto",
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/admin", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).pathname.startsWith("/admin") && "focus" in client) {
          await client.focus();
          if ("navigate" in client) await client.navigate(url);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
