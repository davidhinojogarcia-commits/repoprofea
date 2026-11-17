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

export const isGoogleCalendarDirectConnectionAvailable = () => Boolean(GOOGLE_CLIENT_ID);
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

const normalizeEmail = (value: unknown) => String(value || '').trim().toLowerCase();

export async function connectGoogleCalendar(expectedEmail?: string): Promise<GoogleCalendarConnection> {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error('Falta configurar VITE_GOOGLE_CLIENT_ID para conectar Google Calendar.');
  }

  const requiredEmail = normalizeEmail(expectedEmail);
  const cached = getGoogleCalendarConnection();
  if (cached) {
    if (!requiredEmail || normalizeEmail(cached.email) === requiredEmail) return cached;
    disconnectGoogleCalendar();
  }

  await loadGoogleIdentityServices();

  const tokenResponse = await new Promise<any>((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: GOOGLE_SCOPE,
      prompt: 'select_account consent',
      ...(requiredEmail ? { login_hint: requiredEmail } : {}),
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
  const connectedEmail = normalizeEmail(profile?.email);

  if (requiredEmail && connectedEmail !== requiredEmail) {
    if (window.google?.accounts?.oauth2?.revoke) {
      try {
        window.google.accounts.oauth2.revoke(accessToken, () => undefined);
      } catch {
        // El rechazo local sigue siendo válido aunque falle la revocación remota.
      }
    }
    connectionCache = null;
    throw new Error(`Debes conectar la cuenta corporativa ${expectedEmail}. La cuenta seleccionada (${connectedEmail || 'sin correo identificable'}) no coincide con tu usuario PROFEA.`);
  }

  connectionCache = {
    connected: true,
    email: String(profile?.email || '').trim(),
    accessToken,
    expiresAt: Date.now() + Math.max(60, Number(tokenResponse?.expires_in || 3600)) * 1000,
  };

  return { ...connectionCache };
}

// A calendar day must be formatted using its local civil date, never UTC.
const formatCivilDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const formatCivilDateTime = (date: Date) =>
  `${formatCivilDate(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;

const toGoogleDateTime = (date: string, time: string) => {
  const safeTime = /^\d{2}:\d{2}$/.test(time) ? time : '09:00';
  return `${date}T${safeTime}:00`;
};

export async function createGoogleCalendarEvent(
  eventInput: CalendarEventInput,
  expectedEmail?: string,
): Promise<{ id: string; htmlLink: string }> {
  const requiredEmail = normalizeEmail(expectedEmail);
  let connection = getGoogleCalendarConnection();
  if (!connection || (requiredEmail && normalizeEmail(connection.email) !== requiredEmail)) {
    connection = await connectGoogleCalendar(expectedEmail);
  }

  const hasTime = Boolean(eventInput.time?.trim());
  const startDateTime = hasTime ? toGoogleDateTime(eventInput.startIsoDate, eventInput.time!.trim()) : '';
  const durationMinutes = Math.max(15, Number(eventInput.durationMinutes || 60));
  let endDateTime = '';

  if (hasTime) {
    const start = new Date(startDateTime);
    endDateTime = formatCivilDateTime(new Date(start.getTime() + durationMinutes * 60_000));
  }

  const endAllDay = eventInput.endIsoDate || eventInput.startIsoDate;
  const endAllDayDate = new Date(`${endAllDay}T00:00:00`);
  endAllDayDate.setDate(endAllDayDate.getDate() + 1);
  const exclusiveEndDate = formatCivilDate(endAllDayDate);

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

export function buildGoogleCalendarWebUrl(eventInput: CalendarEventInput, accountEmail?: string): string {
  const title = encodeURIComponent(eventInput.summary);
  const details = encodeURIComponent(eventInput.description || 'Sistema de Contratación PROFEA - Diputación de Cádiz');
  const location = encodeURIComponent(eventInput.location || 'Diputación de Cádiz');

  let datesParam = '';
  if (eventInput.time && eventInput.time.trim()) {
    const [hours, minutes] = eventInput.time.trim().split(':').map(Number);
    const durationMinutes = Math.max(15, Number(eventInput.durationMinutes || 60));
    const startDate = new Date(`${eventInput.startIsoDate}T00:00:00`);
    startDate.setHours(Number.isFinite(hours) ? hours : 9, Number.isFinite(minutes) ? minutes : 0, 0, 0);
    const endDate = new Date(startDate.getTime() + durationMinutes * 60_000);
    const formatLocal = (date: Date) =>
      `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}00`;
    datesParam = `${formatLocal(startDate)}/${formatLocal(endDate)}`;
  } else {
    const startFormatted = eventInput.startIsoDate.replace(/-/g, '');
    const endBase = new Date(`${eventInput.endIsoDate || eventInput.startIsoDate}T00:00:00`);
    endBase.setDate(endBase.getDate() + 1);
    const endFormatted = `${endBase.getFullYear()}${String(endBase.getMonth() + 1).padStart(2, '0')}${String(endBase.getDate()).padStart(2, '0')}`;
    datesParam = `${startFormatted}/${endFormatted}`;
  }

  const authUser = normalizeEmail(accountEmail);
  const accountParam = authUser ? `&authuser=${encodeURIComponent(authUser)}` : '';
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${datesParam}&details=${details}&location=${location}&ctz=Europe%2FMadrid${accountParam}`;
}
