// Service Worker para Sistema de Registro PROFEA - Diputación de Cádiz
// Gestión de Caché Estático y Notificaciones Push (Citas Médicas y Contratos)

const CACHE_NAME = 'profea-static-v16';
const RUNTIME_CACHE = 'profea-runtime-v16';
const PDF_LIB_CDN = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';
const STATIC_ASSETS = ['/','/manifest.webmanifest','/manifest-encargados.webmanifest','/icons/profea-icon-v4-32.png','/icons/profea-icon-v4-180.png','/icons/profea-icon-v4-192.png','/icons/profea-icon-v4-512.png','/icons/profea-icon-v4-maskable-512.png','/logo-diputacion-profea.svg','/logo-diputacion-profea-dark.svg'];

// 1. INSTALACIÓN: Guardar en caché recursos estáticos básicos
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Precachado de recursos estáticos finalizado');
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// 2. ACTIVACIÓN: Limpiar cachés antiguas y tomar control de los clientes
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME && cache !== RUNTIME_CACHE) {
            console.log('[Service Worker] Eliminando caché antigua:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. RED Y CACHÉ
// La aplicación debe poder arrancar sin cobertura después de haberse abierto al menos
// una vez con conexión. Los bundles de Vite llevan hash de contenido, por lo que es
// seguro conservarlos; la navegación usa network-first para evitar servir una versión
// antigua cuando sí existe conexión.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  if (url.href === PDF_LIB_CDN) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok || response.type === 'opaque') {
            const copy = response.clone();
            event.waitUntil(caches.open(RUNTIME_CACHE).then((cache) => cache.put(event.request, copy)));
          }
          return response;
        });
      })
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(caches.open(RUNTIME_CACHE).then((cache) => cache.put('/', copy)));
          }
          return response;
        })
        .catch(async () => {
          return (await caches.match(event.request)) ||
            (await caches.match('/')) ||
            new Response(
              '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PROFEA sin conexión</title><body style="font-family:system-ui;padding:2rem"><h1>PROFEA</h1><p>Sin conexión y todavía no hay una copia local de la aplicación. Ábrela una vez con internet para habilitar el trabajo offline.</p></body></html>',
              { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
            );
        })
    );
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(caches.open(RUNTIME_CACHE).then((cache) => cache.put(event.request, copy)));
          }
          return response;
        });
      })
    );
    return;
  }

  if (STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)));
        }
        return response;
      }))
    );
  }
});

// 4. EVENTO PUSH: Manejar notificaciones enviadas desde el servidor o trigger push
self.addEventListener('push', (event) => {


  let data = {
    title: 'Aviso PROFEA - Diputación de Cádiz',
    body: 'Tienes eventos o citaciones pendientes en el sistema.',
    icon: '/icons/profea-icon-v4-192.png',
    badge: '/icons/profea-icon-v4-192.png',
    url: '/',
    tag: 'profea-notification'
  };

  if (event.data) {
    try {
      const payload = event.data.json();
      data = { ...data, ...payload };
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || '/icons/profea-icon-v4-192.png',
    badge: data.badge || '/icons/profea-icon-v4-192.png',
    tag: data.tag || 'profea-alert',
    renotify: false,
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/', documentId: data.documentId || null
    },
    actions: [
      { action: 'open', title: 'Ver en Sistema' },
      { action: 'close', title: 'Descartar' }
    ]
  };

  event.waitUntil(
    Promise.all([self.registration.showNotification(data.title, options),
      data.kind==='FOREMAN_DOCUMENT_AVAILABLE' ? self.clients.matchAll({type:'window',includeUncontrolled:true}).then(windows=>{
        for(const client of windows){const u=new URL(client.url);if(u.origin===self.location.origin&&u.pathname.replace(/\/$/,'')==='/encargados')client.postMessage({type:'FOREMAN_DOCUMENT_AVAILABLE',documentId:data.documentId});}
      }) : data.kind==='PARTS_UPDATED' ? self.clients.matchAll({type:'window',includeUncontrolled:true}).then(windows=>{
        for(const client of windows){const u=new URL(client.url);if(u.origin===self.location.origin)client.postMessage({type:'PARTS_UPDATED'});}
      }) : Promise.resolve()])
  );
});

// 5. INTERACCIÓN CON LA NOTIFICACIÓN: Click en la alerta
self.addEventListener('notificationclick', (event) => {

  event.notification.close();

  if (event.action === 'close') return;

  let targetUrl='/';
  try{const u=new URL(event.notification.data?.url||'/',self.location.origin);
    if(u.origin===self.location.origin&&(u.pathname==='/'||u.pathname.replace(/\/$/,'')==='/encargados'))targetUrl=u.href;
  }catch{}
  const portalTarget=new URL(targetUrl,self.location.origin).pathname.replace(/\/$/,'')==='/encargados';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Si la aplicación ya está abierta en alguna pestaña, la enfocamos
      for (const client of windowClients) {
        const clientUrl=new URL(client.url);
        if(clientUrl.origin!==self.location.origin||(portalTarget&&clientUrl.pathname.replace(/\/$/,'')!=='/encargados'))continue;
        if ('navigate' in client && targetUrl) {
          return client.navigate(targetUrl).then((navigatedClient) =>
            navigatedClient && 'focus' in navigatedClient ? navigatedClient.focus() : client.focus()
          ).catch(() => client.focus());
        }
        if ('focus' in client) return client.focus();
      }
      // Si no hay pestaña abierta, abrimos una nueva
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// 6. MENSAJES DESDE EL CLIENTE WEB (Intercomunicación)
self.addEventListener('message', (event) => {
  if (!event.data) return;

  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  // Notificación local de prueba o programada generada por la app
  if (event.data.type === 'SHOW_LOCAL_NOTIFICATION') {
    const { title, body, icon, tag, url } = event.data;
    self.registration.showNotification(title || 'Aviso PROFEA', {
      body: body || 'Alerta de citación médica o finalización de contrato.',
      icon: icon || '/icons/profea-icon-v4-192.png',
      badge: '/icons/profea-icon-v4-192.png',
      tag: tag || 'profea-local',
      vibrate: [200, 100, 200],
      data: { url: url || '/' }
    });
  }
});


