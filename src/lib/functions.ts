import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from './firebase';

export const functions = getFunctions(app);

type EmptyPayload = Record<string, never>;

export const bootstrapFirstAdmin = httpsCallable<EmptyPayload, { ok: boolean; role: 'admin' }>(
  functions,
  'bootstrapFirstAdmin'
);

export const touchLogin = httpsCallable<EmptyPayload, { ok: boolean; email: string }>(
  functions,
  'touchLogin'
);
