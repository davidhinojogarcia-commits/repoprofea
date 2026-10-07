// Local clock checks make no network requests. Three windows, in Spanish time.
export const FOREMAN_SCHEDULE_CHECK_MS = 60_000;
const spanishTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
});
export function morningRefreshSlot(now = new Date()): string | null {
  const parts = Object.fromEntries(spanishTime.formatToParts(now).map(p => [p.type, p.value]));
  const hour = Number(parts.hour);
  if (hour < 8 || hour >= 14) return null;
  return `${parts.year}-${parts.month}-${parts.day}:${Math.floor((hour - 8) / 2)}`;
}

// One claim per owner/channel/window survives closing and reopening the screen.
// If storage is unavailable, stop automatic checks; manual actions remain usable.
export function claimMorningRefresh(ownerId: string, channel: 'documents' | 'mail', now = new Date()): boolean {
  const slot = morningRefreshSlot(now);
  if (!ownerId || !slot) return false;
  try {
    const key = `profea:morning-refresh:v1:${ownerId}:${channel}`;
    if (localStorage.getItem(key) === slot) return false;
    localStorage.setItem(key, slot);
    return true;
  } catch { return false; }
}
