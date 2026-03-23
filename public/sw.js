"use strict";
(() => {
  // src/client/sw.ts
  var CACHE_NAME = "agent-runner-v1";
  var APP_SHELL = ["/", "/index.html", "/app.js"];
  self.addEventListener("install", (event) => {
    event.waitUntil(
      caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
    );
    self.skipWaiting();
  });
  self.addEventListener("activate", (event) => {
    event.waitUntil(
      caches.keys().then(
        (keys) => Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        )
      )
    );
    self.clients.claim();
  });
  self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);
    if (event.request.method !== "GET") return;
    if (url.protocol === "ws:" || url.protocol === "wss:") return;
    if (url.pathname.startsWith("/api/")) {
      event.respondWith(
        fetch(event.request).catch(
          () => caches.match(event.request).then((cached) => cached || new Response('{"error":"offline"}', {
            status: 503,
            headers: { "Content-Type": "application/json" }
          }))
        )
      );
      return;
    }
    if (url.pathname.match(/^\/api\/sessions\/[^/]+\/log$/)) {
      event.respondWith(
        fetch(event.request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        }).catch(
          () => caches.match(event.request).then((cached) => cached || new Response('{"error":"offline"}', {
            status: 503,
            headers: { "Content-Type": "application/json" }
          }))
        )
      );
      return;
    }
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
  });
  self.addEventListener("push", (event) => {
    if (!event.data) return;
    let payload;
    try {
      payload = event.data.json();
    } catch {
      payload = { title: "Agent Runner", body: event.data.text() };
    }
    const title = payload.title || "Agent Runner";
    const options = {
      body: payload.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: payload.data || {}
    };
    event.waitUntil(self.registration.showNotification(title, options));
  });
  self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const data = event.notification.data || {};
    let targetUrl = "/";
    if (data.sessionId) {
      targetUrl = `/#/sessions/${data.sessionId}`;
    } else if (data.projectId) {
      targetUrl = `/#/projects/${data.projectId}`;
    }
    event.waitUntil(
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
        for (const client of clients) {
          if (new URL(client.url).origin === self.location.origin) {
            client.navigate(targetUrl);
            return client.focus();
          }
        }
        return self.clients.openWindow(targetUrl);
      })
    );
  });
})();
