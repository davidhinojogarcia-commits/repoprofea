export type ActionHistoryStep =
  | {
      kind: 'rest';
      table: string;
      method: 'POST' | 'PATCH' | 'DELETE';
      query?: string;
      body?: any;
      prefer?: string;
    }
  | {
      kind: 'rpc';
      name: string;
      body?: any;
    };

export type ActionHistoryEntry = {
  id: string;
  userId: string;
  label: string;
  createdAt: number;
  undo: ActionHistoryStep[];
  redo: ActionHistoryStep[];
};

export type ActionHistoryState = {
  canUndo: boolean;
  canRedo: boolean;
  undoCount: number;
  redoCount: number;
  busy: boolean;
  undoLabel: string;
  redoLabel: string;
};

type Executor = (step: ActionHistoryStep) => Promise<void>;

const HISTORY_LIMIT = 500;
const listeners = new Set<(state: ActionHistoryState) => void>();

let executor: Executor | null = null;
let activeUserId = '';
let past: ActionHistoryEntry[] = [];
let future: ActionHistoryEntry[] = [];
let busy = false;
let replaying = false;

const currentState = (): ActionHistoryState => ({
  canUndo: past.length > 0 && !busy,
  canRedo: future.length > 0 && !busy,
  undoCount: past.length,
  redoCount: future.length,
  busy,
  undoLabel: past[past.length - 1]?.label || '',
  redoLabel: future[future.length - 1]?.label || '',
});

const emit = () => {
  const state = currentState();
  listeners.forEach(listener => listener(state));
};

const ensureUser = (userId: string) => {
  if (!userId) return;
  if (activeUserId && activeUserId !== userId) {
    past = [];
    future = [];
  }
  activeUserId = userId;
};

export function setActionHistoryExecutor(next: Executor) {
  executor = next;
}

export function isReplayingActionHistory() {
  return replaying;
}

export function getActionHistoryState(): ActionHistoryState {
  return currentState();
}

export function subscribeActionHistory(listener: (state: ActionHistoryState) => void) {
  listeners.add(listener);
  listener(currentState());
  return () => { listeners.delete(listener); };
}

export function recordActionHistory(
  entry: Omit<ActionHistoryEntry, 'id' | 'createdAt'> & { id?: string; createdAt?: number },
) {
  if (replaying || busy || !entry.userId || entry.undo.length === 0 || entry.redo.length === 0) return;
  ensureUser(entry.userId);
  past = [
    ...past,
    {
      ...entry,
      id: entry.id || crypto.randomUUID(),
      createdAt: entry.createdAt || Date.now(),
    },
  ].slice(-HISTORY_LIMIT);
  future = [];
  emit();
}

export function clearActionHistory() {
  past = [];
  future = [];
  emit();
}

export async function undoActionHistory(userId: string): Promise<ActionHistoryEntry | null> {
  if (busy || past.length === 0) return null;
  if (!executor) throw new Error('El historial global todavía no está preparado.');
  ensureUser(userId);
  const entry = past[past.length - 1];
  if (!entry || entry.userId !== userId) return null;

  past = past.slice(0, -1);
  busy = true;
  replaying = true;
  emit();
  try {
    for (const step of entry.undo) await executor(step);
    future = [...future, entry].slice(-HISTORY_LIMIT);
    return entry;
  } catch (error) {
    past = [...past, entry].slice(-HISTORY_LIMIT);
    throw error;
  } finally {
    replaying = false;
    busy = false;
    emit();
  }
}

export async function redoActionHistory(userId: string): Promise<ActionHistoryEntry | null> {
  if (busy || future.length === 0) return null;
  if (!executor) throw new Error('El historial global todavía no está preparado.');
  ensureUser(userId);
  const entry = future[future.length - 1];
  if (!entry || entry.userId !== userId) return null;

  future = future.slice(0, -1);
  busy = true;
  replaying = true;
  emit();
  try {
    for (const step of entry.redo) await executor(step);
    past = [...past, entry].slice(-HISTORY_LIMIT);
    return entry;
  } catch (error) {
    future = [...future, entry].slice(-HISTORY_LIMIT);
    throw error;
  } finally {
    replaying = false;
    busy = false;
    emit();
  }
}
