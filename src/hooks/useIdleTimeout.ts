import { useCallback, useEffect, useRef, useState } from 'react';

export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const IDLE_WARNING_MS = 2 * 60 * 1000;
const CHECK_INTERVAL_MS = 10 * 1000;
const ACTIVITY_WRITE_THROTTLE_MS = 1000;

const activityKey = (userId: string) => `profea:lastActivityAt:${userId}`;
const channelName = (userId: string) => `profea:activity:${userId}`;

export function initializeUserActivity(userId: string, at = Date.now()) {
  try {
    localStorage.setItem(activityKey(userId), String(at));
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(channelName(userId));
      channel.postMessage({ type: 'activity', at });
      channel.close();
    }
  } catch {
    // El timeout sigue funcionando en memoria aunque el almacenamiento no esté disponible.
  }
}

export function clearUserActivity(userId: string) {
  try { localStorage.removeItem(activityKey(userId)); } catch { /* noop */ }
}

function readStoredActivity(userId: string): number | null {
  try {
    const value = Number(localStorage.getItem(activityKey(userId)));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

interface IdleTimeoutOptions {
  userId: string | null;
  onTimeout: () => void | Promise<void>;
}

export function useIdleTimeout({ userId, onTimeout }: IdleTimeoutOptions) {
  const [warningOpen, setWarningOpen] = useState(false);
  const [remainingMs, setRemainingMs] = useState(IDLE_TIMEOUT_MS);
  const lastActivityRef = useRef(Date.now());
  const lastWriteRef = useRef(0);
  const timingOutRef = useRef(false);
  const onTimeoutRef = useRef(onTimeout);

  useEffect(() => { onTimeoutRef.current = onTimeout; }, [onTimeout]);

  const recordActivity = useCallback((force = false) => {
    if (!userId || timingOutRef.current) return;
    const now = Date.now();
    lastActivityRef.current = now;
    setRemainingMs(IDLE_TIMEOUT_MS);
    setWarningOpen(false);
    if (!force && now - lastWriteRef.current < ACTIVITY_WRITE_THROTTLE_MS) return;
    lastWriteRef.current = now;
    try { localStorage.setItem(activityKey(userId), String(now)); } catch { /* noop */ }
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        const channel = new BroadcastChannel(channelName(userId));
        channel.postMessage({ type: 'activity', at: now });
        channel.close();
      }
    } catch { /* noop */ }
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setWarningOpen(false);
      timingOutRef.current = false;
      return;
    }

    timingOutRef.current = false;
    const stored = readStoredActivity(userId);
    lastActivityRef.current = stored ?? Date.now();
    if (!stored) initializeUserActivity(userId, lastActivityRef.current);

    let channel: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        channel = new BroadcastChannel(channelName(userId));
        channel.onmessage = event => {
          const at = Number(event.data?.at);
          if (event.data?.type === 'activity' && Number.isFinite(at) && at > lastActivityRef.current) {
            lastActivityRef.current = at;
            setWarningOpen(false);
          }
        };
      }
    } catch { channel = null; }

    const checkIdle = () => {
      if (timingOutRef.current) return;
      const storedAt = readStoredActivity(userId);
      if (storedAt && storedAt > lastActivityRef.current) lastActivityRef.current = storedAt;
      const idleFor = Math.max(0, Date.now() - lastActivityRef.current);
      const remaining = Math.max(0, IDLE_TIMEOUT_MS - idleFor);
      setRemainingMs(remaining);

      if (idleFor >= IDLE_TIMEOUT_MS) {
        timingOutRef.current = true;
        setWarningOpen(false);
        void onTimeoutRef.current();
        return;
      }
      setWarningOpen(idleFor >= IDLE_TIMEOUT_MS - IDLE_WARNING_MS);
    };

    const activityHandler = () => recordActivity(false);
    const visibilityHandler = () => {
      if (document.visibilityState === 'visible') checkIdle();
    };
    const focusHandler = () => checkIdle();
    const routeHandler = () => {
      checkIdle();
      if (!timingOutRef.current) recordActivity(true);
    };
    const storageHandler = (event: StorageEvent) => {
      if (event.key !== activityKey(userId) || !event.newValue) return;
      const at = Number(event.newValue);
      if (Number.isFinite(at) && at > lastActivityRef.current) {
        lastActivityRef.current = at;
        setWarningOpen(false);
      }
    };

    const activityEvents: Array<keyof WindowEventMap> = ['click', 'mousedown', 'keydown', 'touchstart', 'scroll'];
    activityEvents.forEach(eventName => window.addEventListener(eventName, activityHandler, { passive: true }));
    window.addEventListener('focus', focusHandler);
    window.addEventListener('popstate', routeHandler);
    window.addEventListener('hashchange', routeHandler);
    window.addEventListener('storage', storageHandler);
    document.addEventListener('visibilitychange', visibilityHandler);

    const interval = window.setInterval(checkIdle, CHECK_INTERVAL_MS);
    checkIdle();

    return () => {
      window.clearInterval(interval);
      activityEvents.forEach(eventName => window.removeEventListener(eventName, activityHandler));
      window.removeEventListener('focus', focusHandler);
      window.removeEventListener('popstate', routeHandler);
      window.removeEventListener('hashchange', routeHandler);
      window.removeEventListener('storage', storageHandler);
      document.removeEventListener('visibilitychange', visibilityHandler);
      channel?.close();
    };
  }, [userId, recordActivity]);

  return {
    warningOpen,
    remainingMs,
    continueSession: () => recordActivity(true),
  };
}
