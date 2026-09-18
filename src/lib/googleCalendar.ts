export interface CalendarEventInput {
  summary: string;
  description?: string;
  location?: string;
  startIsoDate: string;
  endIsoDate?: string;
  time?: string;
  durationMinutes?: number;
  reminderMinutes?: number;
}

export interface GoogleCalendarConnection {
  connected: boolean;
  email: string;
  accessToken: string;
  expiresAt: number;
}

declare global {
  interface Window {
    google?: any;
  }
}

const GOOGLE_CLIENT_ID = String(import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim();
const GOOGLE_SCOPE = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.events',
].join(' ');

let connectionCache: GoogleCalendarConnection | null = null;
let googleScriptPromise: Promise<void> | null = null;

const loadGoogleIdentityServices = async (): Promise<void> => {
  if (window.google?.accounts?.oauth2) return;
  if (googleScriptPromise) return googleScriptPromise;

  googleScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-profea-google-identity="1"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('No se pudo cargar Google Identity Services.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.profeaGoogleIdentity = '1';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('No se pudo cargar Google Identity Services.'));
    document.head.appendChild(script);
  });

  return googleScriptPromise;
};

export const getGoogleCalendarConnection = (): GoogleCalendarConnection | null => {
  if (!connectionCache) return null;
  if (Date.now() >= connectionCache.expiresAt - 60_000) {
    connectionCache = null;
    return null;
  }
  return { ...connectionCache };
};

export const disconnectGoogleCalendar = () => {
  const current = connectionCache;
  connectionCache = null;
  if (current?.accessToken && window.google?.accounts?.oauth2?.revoke) {
    try {
      window.google.accounts.oauth2.revoke(current.accessToken, () => undefined);
    } catch {
      // La desconexión local sigue siendo válida aunque Google no responda al revoke.
    }
  }
};

export async function connectGoogleCalendar(): Promise<GoogleCalendarConnection> {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error('Falta configurar VITE_GOOGLE_CLIENT_ID para conectar Google Calendar.');
  }

  const cached = getGoogleCalendarConnection();
  if (cached) return cached;

  await loadGoogleIdentityServices();

  const tokenResponse = await new Promise<any>((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: GOOGLE_SCOPE,
      prompt: 'select_account consent',
      callback: (response: any) => {
        if (response?.error) reject(new Error(response.error_description || response.error));
        else resolve(response);
      },
      error_callback: (error: any) => reject(new Error(error?.message || 'No se pudo conectar con Google Calendar.')),
    });
    client.requestAccessToken();
  });

  const accessToken = String(tokenResponse?.access_token || '').trim();
  if (!accessToken) throw new Error('Google no devolvió un token de acceso válido.');

  const profileResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!profileResponse.ok) throw new Error('No se pudo identificar la cuenta de Google conectada.');
  const profile = await profileResponse.json();

  connectionCache = {
    connected: true,
    email: String(profile?.email || '').trim(),
    accessToken,
    expiresAt: Date.now() + Math.max(60, Number(tokenResponse?.expires_in || 3600)) * 1000,
  };

  return { ...connectionCache };
}

const toGoogleDateTime = (date: string, time: string) => {
  const safeTime = /^\d{2}:\d{2}$/.test(time) ? time : '09:00';
  return `${date}T${safeTime}:00`;
};

export async function createGoogleCalendarEvent(eventInput: CalendarEventInput): Promise<{ id: string; htmlLink: string }> {
  const connection = getGoogleCalendarConnection() || await connectGoogleCalendar();

  const hasTime = Boolean(eventInput.time?.trim());
  const startDateTime = hasTime ? toGoogleDateTime(eventInput.startIsoDate, eventInput.time!.trim()) : '';
  const durationMinutes = Math.max(15, Number(eventInput.durationMinutes || 60));
  let endDateTime = '';

  if (hasTime) {
    const start = new Date(startDateTime);
    endDateTime = new Date(start.getTime() + durationMinutes * 60_000)
      .toISOString()
      .slice(0, 19);
  }

  const endAllDay = eventInput.endIsoDate || eventInput.startIsoDate;
  const endAllDayDate = new Date(`${endAllDay}T00:00:00`);
  endAllDayDate.setDate(endAllDayDate.getDate() + 1);
  const exclusiveEndDate = endAllDayDate.toISOString().slice(0, 10);

  const body: any = {
    summary: eventInput.summary,
    description: eventInput.description || 'Sistema de Contratación PROFEA - Diputación de Cádiz',
    location: eventInput.location || undefined,
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: Math.max(0, Number(eventInput.reminderMinutes ?? 60)) },
      ],
    },
  };

  if (hasTime) {
    body.start = { dateTime: startDateTime, timeZone: 'Europe/Madrid' };
    body.end = { dateTime: endDateTime, timeZone: 'Europe/Madrid' };
  } else {
    body.start = { date: eventInput.startIsoDate };
    body.end = { date: exclusiveEndDate };
  }

  const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${connection.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (response.status === 401) {
    connectionCache = null;
    throw new Error('La sesión de Google Calendar ha caducado. Vuelve a conectar tu cuenta.');
  }

  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail?.error?.message || 'Google Calendar no pudo crear el evento.');
  }

  const data = await response.json();
  return { id: String(data?.id || ''), htmlLink: String(data?.htmlLink || '') };
}

export function buildGoogleCalendarWebUrl(eventInput: CalendarEventInput): string {
  const title = encodeURIComponent(eventInput.summary);
  const details = encodeURIComponent(eventInput.description || 'Sistema de Contratación PROFEA - Diputación de Cádiz');
  const location = encodeURIComponent(eventInput.location || 'Diputación de Cádiz');

  let datesParam = '';
  if (eventInput.time && eventInput.time.trim()) {
    const startStr = eventInput.startIsoDate.replace(/-/g, '') + 'T' + eventInput.time.trim().replace(':', '') + '00';
    const startDate = new Date(`${eventInput.startIsoDate}T${eventInput.time.trim()}:00`);
    const durationMs = (eventInput.durationMinutes || 60) * 60 * 1000;
    const endDate = new Date(startDate.getTime() + durationMs);
    const endIso = endDate.toISOString().replace(/[-:]/g, '').split('.')[0];
    datesParam = `${startStr}/${endIso}`;
  } else {
    const startFormatted = eventInput.startIsoDate.replace(/-/g, '');
    const endBase = eventInput.endIsoDate ? new Date(eventInput.endIsoDate) : new Date(eventInput.startIsoDate);
    endBase.setDate(endBase.getDate() + 1);
    const endFormatted = endBase.toISOString().split('T')[0].replace(/-/g, '');
    datesParam = `${startFormatted}/${endFormatted}`;
  }

  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${datesParam}&details=${details}&location=${location}`;
}
