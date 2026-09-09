// Service Worker para Sistema de Registro PROFEA - Diputación de Cádiz
// Gestión de Caché Estático y Notificaciones Push (Citas Médicas y Contratos)

const CACHE_NAME = 'profea-cache-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/favicon.png',
  '/logo.png',
  '/logo-diputacion-profea.png'
];

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
          if (cache !== CACHE_NAME) {
            console.log('[Service Worker] Eliminando caché antigua:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. ESTRATEGIA DE RED / CACHÉ (Network First con fallback a Caché para resiliencia offline)
self.addEventListener('fetch', (event) => {
  // Ignorar peticiones que no sean GET o que sean de APIs externas/analytics
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // Para navegación HTML o activos estáticos
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // Fallback a la caché si no hay conexión a internet
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
        });
      })
  );
});

// 4. EVENTO PUSH: Manejar notificaciones enviadas desde el servidor o trigger push
self.addEventListener('push', (event) => {
  console.log('[Service Worker] Evento Push recibido:', event);

  let data = {
    title: 'Aviso PROFEA - Diputación de Cádiz',
    body: 'Tienes eventos o citaciones pendientes en el sistema.',
    icon: '/favicon.png',
    badge: '/favicon.png',
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
    icon: data.icon || '/favicon.png',
    badge: data.badge || '/favicon.png',
    tag: data.tag || 'profea-alert',
    renotify: true,
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/'
    },
    actions: [
      { action: 'open', title: 'Ver en Sistema' },
      { action: 'close', title: 'Descartar' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// 5. INTERACCIÓN CON LA NOTIFICACIÓN: Click en la alerta
self.addEventListener('notificationclick', (event) => {
  console.log('[Service Worker] Click en Notificación:', event.notification.tag);
  event.notification.close();

  if (event.action === 'close') return;

  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Si la aplicación ya está abierta en alguna pestaña, la enfocamos
      for (let client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
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
      icon: icon || '/favicon.png',
      badge: '/favicon.png',
      tag: tag || 'profea-local',
      vibrate: [200, 100, 200],
      data: { url: url || '/' }
    });
  }
});
