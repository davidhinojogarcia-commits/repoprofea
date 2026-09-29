// Helper para el Registro de Service Worker y Gestión de Notificaciones Push
import { Person } from '../../types';

export interface SWRegistrationState {
  supported: boolean;
  registered: boolean;
  permission: NotificationPermission;
  subscription: PushSubscription | null;
  scope?: string;
  active?: boolean;
}

export interface NotificationPreferences {
  alertCitasVencidas: boolean;
  alertCitasHoyManana: boolean;
  alertContratosVencidos: boolean;
  alertContratosProximos: boolean;
}

const PREFS_STORAGE_KEY = 'profea_notification_preferences';

const localDateKey = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export function getNotificationPreferences(): NotificationPreferences {
  if (typeof localStorage === 'undefined') {
    return {
      alertCitasVencidas: true,
      alertCitasHoyManana: true,
      alertContratosVencidos: true,
      alertContratosProximos: true
    };
  }
  const saved = localStorage.getItem(PREFS_STORAGE_KEY);
  if (!saved) {
    return {
      alertCitasVencidas: true,
      alertCitasHoyManana: true,
      alertContratosVencidos: true,
      alertContratosProximos: true
    };
  }
  try {
    return JSON.parse(saved);
  } catch (e) {
    return {
      alertCitasVencidas: true,
      alertCitasHoyManana: true,
      alertContratosVencidos: true,
      alertContratosProximos: true
    };
  }
}

export function saveNotificationPreferences(prefs: NotificationPreferences): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
}

// Registro del Service Worker
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) {
    console.warn('[SW] Service Worker no soportado en este navegador');
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register('/service-worker.js', {
      scope: '/',
      updateViaCache: 'none'
    });
    console.log('[SW] Service Worker registrado exitosamente con scope:', registration.scope);
    
    // Verificar si hay actualizaciones
    registration.onupdatefound = () => {
      const installingWorker = registration.installing;
      if (installingWorker) {
        installingWorker.onstatechange = () => {
          if (installingWorker.state === 'installed') {
            if (navigator.serviceWorker.controller) {
              console.log('[SW] Nueva versión de Service Worker disponible');
            } else {
              console.log('[SW] Contenido en caché para uso offline');
            }
          }
        };
      }
    };

    return registration;
  } catch (error) {
    console.error('[SW] Error al registrar el Service Worker:', error);
    return null;
  }
}

export async function getSWRegistrationInfo(): Promise<SWRegistrationState> {
  const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'Notification' in window;
  const permission: NotificationPermission = (supported && window.Notification) ? window.Notification.permission : 'default';

  if (!supported) {
    return { supported: false, registered: false, permission: 'denied', subscription: null };
  }

  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    return {
      supported: true,
      registered: !!reg,
      permission,
      subscription: null,
      scope: reg?.scope,
      active: !!reg?.active
    };
  } catch {
    return { supported: true, registered: false, permission, subscription: null };
  }
}

// Solicitar permisos de Notificación al usuario
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window) || !window.Notification) {
    console.warn('[Notificaciones] El navegador no soporta notificaciones web');
    return 'denied';
  }

  if (window.Notification.permission === 'granted') {
    return 'granted';
  }

  try {
    const permission = await window.Notification.requestPermission();
    console.log('[Notificaciones] Permiso de notificación concedido:', permission);
    return permission;
  } catch (error) {
    console.error('[Notificaciones] Error solicitando permisos de notificación:', error);
    return 'denied';
  }
}

// Disparar una notificación directa vía Service Worker
export async function sendLocalSWNotification(
  title: string,
  body: string,
  tag = 'profea-alert',
  url = '/'
): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window) || !window.Notification) return false;
  if (!('serviceWorker' in navigator)) return false;

  const reg = await navigator.serviceWorker.ready;
  if (!reg) return false;

  if (window.Notification.permission !== 'granted') {
    const perm = await requestNotificationPermission();
    if (perm !== 'granted') return false;
  }

  if (reg.showNotification) {
    const options: any = {
      body,
      icon: '/favicon.png',
      badge: '/favicon.png',
      tag,
      vibrate: [100, 50, 100],
      data: { url },
      actions: [
        { action: 'open', title: 'Ver en Aplicación' },
        { action: 'close', title: 'Cerrar' }
      ]
    };
    await reg.showNotification(title, options);
    return true;
  } else if (reg.active) {
    reg.active.postMessage({
      type: 'SHOW_LOCAL_NOTIFICATION',
      title,
      body,
      tag,
      url
    });
    return true;
  }

  return false;
}

export interface AlertsSummary {
  citasVencidas: Person[];
  citasHoy: Person[];
  citasManana: Person[];
  contratosVencidos: Person[];
  contratosProximos: Person[];
  totalAlertas: number;
}

export function getNotificationAlertsSummary(people: Person[]): AlertsSummary {
  const todayStr = localDateKey(new Date());

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = localDateKey(tomorrow);

  const threeDays = new Date();
  threeDays.setDate(threeDays.getDate() + 3);
  const threeDaysStr = localDateKey(threeDays);

  const citasVencidas: Person[] = [];
  const citasHoy: Person[] = [];
  const citasManana: Person[] = [];
  const contratosVencidos: Person[] = [];
  const contratosProximos: Person[] = [];

  for (const person of people) {
    // 1. Citas Médicas
    if (person.citaDia) {
      if (person.citaDia < todayStr) {
        citasVencidas.push(person);
      } else if (person.citaDia === todayStr) {
        citasHoy.push(person);
      } else if (person.citaDia === tomorrowStr) {
        citasManana.push(person);
      }
    }

    // 2. Fines de Contrato
    if (person.periodoFin) {
      if (person.periodoFin < todayStr) {
        contratosVencidos.push(person);
      } else if (person.periodoFin >= todayStr && person.periodoFin <= threeDaysStr) {
        contratosProximos.push(person);
      }
    }
  }

  const totalAlertas = citasVencidas.length + citasHoy.length + citasManana.length + contratosVencidos.length + contratosProximos.length;

  return {
    citasVencidas,
    citasHoy,
    citasManana,
    contratosVencidos,
    contratosProximos,
    totalAlertas
  };
}

// Analizar lista de trabajadores y generar avisos push para citas médicas (vencidas, hoy, mañana) y contratos
export async function checkAndTriggerUpcomingAlerts(
  people: Person[],
  force = false
): Promise<{
  citasVencidas: number;
  citasHoy: number;
  citasManana: number;
  contratosVencidos: number;
  contratosProximos: number;
  notificacionesEnviadas: number;
}> {
  let citasVencidas = 0;
  let citasHoy = 0;
  let citasManana = 0;
  let contratosVencidos = 0;
  let contratosProximos = 0;
  let notificacionesEnviadas = 0;

  if (typeof window === 'undefined' || !('Notification' in window) || !window.Notification) {
    return { citasVencidas, citasHoy, citasManana, contratosVencidos, contratosProximos, notificacionesEnviadas };
  }

  if (window.Notification.permission !== 'granted') {
    return { citasVencidas, citasHoy, citasManana, contratosVencidos, contratosProximos, notificacionesEnviadas };
  }

  const prefs = getNotificationPreferences();
  const todayStr = localDateKey(new Date());
  const storageKey = `profea_sent_notifications_${todayStr}`;
  let sentSet = new Set<string>();

  if (!force && typeof localStorage !== 'undefined') {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        sentSet = new Set(JSON.parse(stored));
      }
    } catch (e) {
      // Ignore JSON parse error
    }
  }

  const summary = getNotificationAlertsSummary(people);

  citasVencidas = summary.citasVencidas.length;
  citasHoy = summary.citasHoy.length;
  citasManana = summary.citasManana.length;
  contratosVencidos = summary.contratosVencidos.length;
  contratosProximos = summary.contratosProximos.length;

  // Process Citas Vencidas
  if (prefs.alertCitasVencidas) {
    for (const person of summary.citasVencidas) {
      const tag = `cita-vencida-${person.id}`;
      if (force || !sentSet.has(tag)) {
        const ok = await sendLocalSWNotification(
          `🔴 Cita Médica VENCIDA: ${person.apellidosNombre}`,
          `La cita programada el ${person.citaDia} a las ${person.citaHora || 'S/H'} en ${person.sitioReconocimiento || 'Centro Médico'} está vencida. Obra: ${person.obra || 'N/A'}.`,
          tag
        );
        if (ok) {
          sentSet.add(tag);
          notificacionesEnviadas++;
        }
      }
    }
  }

  // Process Citas Hoy
  if (prefs.alertCitasHoyManana) {
    for (const person of summary.citasHoy) {
      const tag = `cita-hoy-${person.id}`;
      if (force || !sentSet.has(tag)) {
        const ok = await sendLocalSWNotification(
          `🩺 Cita Médica HOY: ${person.apellidosNombre}`,
          `Tiene cita médica hoy a las ${person.citaHora || 'S/H'} en ${person.sitioReconocimiento || 'Centro Médico'}. Obra: ${person.obra || 'N/A'}.`,
          tag
        );
        if (ok) {
          sentSet.add(tag);
          notificacionesEnviadas++;
        }
      }
    }

    // Process Citas Mañana
    for (const person of summary.citasManana) {
      const tag = `cita-manana-${person.id}`;
      if (force || !sentSet.has(tag)) {
        const ok = await sendLocalSWNotification(
          `⏰ Cita Médica MAÑANA: ${person.apellidosNombre}`,
          `Cita médica programada para mañana a las ${person.citaHora || 'S/H'}. Obra: ${person.obra || 'N/A'}.`,
          tag
        );
        if (ok) {
          sentSet.add(tag);
          notificacionesEnviadas++;
        }
      }
    }
  }

  // Process Contratos Vencidos
  if (prefs.alertContratosVencidos) {
    for (const person of summary.contratosVencidos) {
      const tag = `fin-contrato-vencido-${person.id}`;
      if (force || !sentSet.has(tag)) {
        const ok = await sendLocalSWNotification(
          `⛔ Contrato VENCIDO (${person.periodoFin}): ${person.apellidosNombre}`,
          `El contrato en la obra ${person.obra || 'N/A'} finalizó el ${person.periodoFin}.`,
          tag
        );
        if (ok) {
          sentSet.add(tag);
          notificacionesEnviadas++;
        }
      }
    }
  }

  // Process Contratos Próximos
  if (prefs.alertContratosProximos) {
    for (const person of summary.contratosProximos) {
      const tag = `fin-contrato-proximo-${person.id}`;
      if (force || !sentSet.has(tag)) {
        const ok = await sendLocalSWNotification(
          `📄 Próximo Fin de Contrato (${person.periodoFin}): ${person.apellidosNombre}`,
          `El contrato laboral en la obra ${person.obra || 'N/A'} finaliza el día ${person.periodoFin}.`,
          tag
        );
        if (ok) {
          sentSet.add(tag);
          notificacionesEnviadas++;
        }
      }
    }
  }

  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(storageKey, JSON.stringify(Array.from(sentSet)));
    } catch (e) {
      // Ignore
    }
  }

  return {
    citasVencidas,
    citasHoy,
    citasManana,
    contratosVencidos,
    contratosProximos,
    notificacionesEnviadas
  };
}
