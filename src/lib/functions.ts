import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from './firebase';

export const functions = getFunctions(app);

export const bootstrapFirstAdmin = httpsCallable<void, { ok: boolean; role: 'admin' }>(
  functions,
  'bootstrapFirstAdmin'
);
