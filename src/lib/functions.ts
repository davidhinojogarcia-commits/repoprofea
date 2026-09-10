import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from './firebase';

export const functions = getFunctions(app);

type EmptyPayload = Record<string, never>;
type PermissionAction = 'read' | 'create' | 'update' | 'delete';
type ModulePermissions = Record<PermissionAction, boolean>;
type Modules = Record<string, ModulePermissions>;

export const bootstrapFirstAdmin = httpsCallable<EmptyPayload, { ok: boolean; role: 'admin' }>(functions, 'bootstrapFirstAdmin');
export const touchLogin = httpsCallable<EmptyPayload, { ok: boolean; email: string }>(functions, 'touchLogin');

export const createManagedUser = httpsCallable<any, { uid: string; email: string; role: 'admin' | 'user' }>(functions, 'createManagedUser');
export const updateManagedUserProfile = httpsCallable<any, { ok: boolean }>(functions, 'updateManagedUserProfile');
export const updateManagedUserRole = httpsCallable<any, { ok: boolean }>(functions, 'updateManagedUserRole');
export const setManagedUserRole = httpsCallable<any, { ok: boolean }>(functions, 'setManagedUserRole');
export const updateManagedUserStatus = httpsCallable<any, { ok: boolean }>(functions, 'updateManagedUserStatus');
export const setManagedUserActive = httpsCallable<any, { ok: boolean }>(functions, 'setManagedUserActive');
export const deleteManagedUser = httpsCallable<any, { ok: boolean }>(functions, 'deleteManagedUser');
export const updateManagedUserPermissions = httpsCallable<any, { ok: boolean }>(functions, 'updateManagedUserPermissions');
export const updateManagedPermissions = httpsCallable<any, { ok: boolean }>(functions, 'updateManagedPermissions');
export const resetManagedUserPassword = httpsCallable<any, { email: string; resetLink: string }>(functions, 'resetManagedUserPassword');
export const sendManagedPasswordReset = httpsCallable<any, { email: string; resetLink: string }>(functions, 'sendManagedPasswordReset');
export const setDataPermission = httpsCallable<any, { ok: boolean; permissionId: string }>(functions, 'setDataPermission');
export const deleteDataPermission = httpsCallable<any, { ok: boolean }>(functions, 'deleteDataPermission');
export const writeAuditEvent = httpsCallable<any, { ok: boolean }>(functions, 'writeAuditEvent');
