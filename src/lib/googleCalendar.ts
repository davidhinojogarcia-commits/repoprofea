import { googleSignIn, getAccessToken } from './firebase';

export interface CalendarEventInput {
  summary: string;
  description?: string;
  location?: string;
  startIsoDate: string; // Format "YYYY-MM-DD"
  endIsoDate?: string;   // Format "YYYY-MM-DD"
  time?: string;         // Format "HH:MM" e.g. "09:30"
  durationMinutes?: number;
}

/**
 * Creates an event directly in Google Calendar via Google API v3
 */
export async function createGoogleCalendarEvent(eventInput: CalendarEventInput): Promise<{ id: string; htmlLink: string }> {
  let token = await getAccessToken();

  if (!token) {
    const loginRes = await googleSignIn();
    if (!loginRes || !loginRes.accessToken) {
      throw new Error('Debe iniciar sesión con su cuenta de Google para sincronizar con Google Calendar.');
    }
    token = loginRes.accessToken;
  }

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Madrid';

  let startObj: { dateTime?: string; date?: string; timeZone?: string };
  let endObj: { dateTime?: string; date?: string; timeZone?: string };

  if (eventInput.time && eventInput.time.trim()) {
    const startLocal = `${eventInput.startIsoDate}T${eventInput.time.trim()}:00`;
    const startDate = new Date(startLocal);
    const durationMs = (eventInput.durationMinutes || 60) * 60 * 1000;
    const endDate = new Date(startDate.getTime() + durationMs);

    startObj = { dateTime: startDate.toISOString(), timeZone };
    endObj = { dateTime: endDate.toISOString(), timeZone };
  } else {
    startObj = { date: eventInput.startIsoDate };
    
    // Google Calendar all-day end date is exclusive
    const endBase = eventInput.endIsoDate ? new Date(eventInput.endIsoDate) : new Date(eventInput.startIsoDate);
    endBase.setDate(endBase.getDate() + 1);
    const endStr = endBase.toISOString().split('T')[0];
    
    endObj = { date: endStr };
  }

  const payload = {
    summary: eventInput.summary,
    description: eventInput.description || 'Registrado desde el Sistema de Contratación PROFEA - Diputación de Cádiz.',
    location: eventInput.location || 'Diputación de Cádiz / Centro de Reconocimiento Médico',
    start: startObj,
    end: endObj,
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 1440 }, // 1 día antes
        { method: 'popup', minutes: 120 },  // 2 horas antes
      ],
    },
  };

  const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    if (response.status === 401) {
      // Token expired or invalid, trigger sign in popup
      const loginRes = await googleSignIn();
      if (loginRes?.accessToken) {
        return createGoogleCalendarEvent(eventInput);
      }
    }
    throw new Error(errorData?.error?.message || `Error de Google Calendar API (${response.status})`);
  }

  const data = await response.json();
  return {
    id: data.id,
    htmlLink: data.htmlLink,
  };
}

/**
 * Builds a direct web URL to Google Calendar event creation page
 */
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
