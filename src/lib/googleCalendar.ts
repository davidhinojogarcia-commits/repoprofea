export interface CalendarEventInput {
  summary: string;
  description?: string;
  location?: string;
  startIsoDate: string;
  endIsoDate?: string;
  time?: string;
  durationMinutes?: number;
}

/**
 * La autenticación principal de PROFEA es exclusivamente Supabase email/password.
 * No se reutiliza el JWT de Supabase contra APIs de Google. Para añadir una cita a
 * Google Calendar se genera la URL oficial de creación, sin introducir otro proveedor
 * de autenticación en la aplicación.
 */
export async function createGoogleCalendarEvent(eventInput: CalendarEventInput): Promise<{ id: string; htmlLink: string }> {
  const htmlLink = buildGoogleCalendarWebUrl(eventInput);
  return { id: 'calendar-web-template', htmlLink };
}

/** Builds a direct web URL to Google Calendar event creation page. */
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
