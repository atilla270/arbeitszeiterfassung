// 01. CACHE-KONFIGURATION

const CACHE_NAME = "arbeitszeit-v6.1";

const APP_FILES = [
    "./",
    "./index.html",
    "./style.css?v=6.1",
    "./app.js?v=6.1",
    "./config.js",
    "./manifest.json",
    "./icons/icon-192.png",
    "./icons/icon-512.png"
];


// 02. SERVICE WORKER INSTALLIEREN

self.addEventListener("install", event => {

    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(APP_FILES))
            .then(() => self.skipWaiting())
    );

});


// 03. ALTE CACHE-VERSIONEN ENTFERNEN

self.addEventListener("activate", event => {

    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys
                    .filter(key =>
                        key.startsWith("arbeitszeit-") &&
                        key !== CACHE_NAME
                    )
                    .map(key => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );

});


// 04. APP-DATEIEN LADEN

self.addEventListener("fetch", event => {

    const request = event.request;

    if (request.method !== "GET") return;

    const url = new URL(request.url);

    if (url.origin !== self.location.origin) return;

    const allowed = APP_FILES.some(file =>
        new URL(file, self.registration.scope).href
            === url.href
    );

    if (!allowed) return;

    event.respondWith(

        fetch(request)

            .then(async response => {

                if (response.ok) {

                    const cache =
                        await caches.open(CACHE_NAME);

                    await cache.put(
                        request,
                        response.clone()
                    );

                }

                return response;

            })

            .catch(async () => {

                const cached =
                    await caches.match(request);

                return cached || Response.error();

            })

    );

});
