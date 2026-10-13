import { supabase } from '../lib/supabase';
export type ForemanPushReceipt = { status: string; accepted: number; failed: number; total?: number };
export function foremanPushHelp(): string | null {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios && !(navigator as any).standalone && !window.matchMedia('(display-mode: standalone)').matches) return 'En iPhone o iPad, añade el portal a la pantalla de inicio y ábrelo desde su icono para activar los avisos.';
  if (!window.isSecureContext || !('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return 'Este navegador no admite avisos móviles. Abre el portal con un navegador compatible.';
  return null;
}
async function worker() {
  const registration = await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  return registration;
}
async function save(token: string, subscription: PushSubscription) {
  await supabase.rpc('register_foreman_push_subscription', { p_token: token, p_subscription: subscription.toJSON() });
}
export async function activateForemanPush(token: string) {
  const help = foremanPushHelp(); if (help) throw Error(help);
  // Request directly from the button gesture, before any network await (Safari).
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw Error('Permite las notificaciones en los ajustes del navegador para recibir los avisos.');
  const response = await fetch('/api/foreman-push', { cache: 'no-store' });
  if (!response.ok) throw Error('No se pudo consultar la configuración de avisos.');
  const config = await response.json();
  if (!config.configured || !config.publicKey) throw Error('Los avisos móviles están pendientes de configuración en el servidor.');
  const key = Uint8Array.from(atob(config.publicKey.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const registration = await worker();
  let subscription = await registration.pushManager.getSubscription();
  if (subscription?.options.applicationServerKey && !Array.from(new Uint8Array(subscription.options.applicationServerKey)).every((v, i) => v === key[i])) {
    await subscription.unsubscribe(); subscription = null;
  }
  const created = !subscription;
  subscription ||= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  try { await save(token, subscription); } catch (error) { if (created) await subscription.unsubscribe(); throw error; }
}
export async function restoreForemanPush(token: string): Promise<boolean> {
  if (foremanPushHelp() || Notification.permission !== 'granted') return false;
  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = await registration?.pushManager?.getSubscription();
  if (!subscription) return false;
  await save(token, subscription); return true;
}
export async function disableForemanPush(token: string) {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = await registration?.pushManager?.getSubscription();
  if (!subscription) return;
  // Remove the server registration first; failed removal must not claim deactivation.
  await supabase.rpc('unregister_foreman_push_subscription', { p_token: token, p_endpoint: subscription.endpoint });
  await subscription.unsubscribe();
}
export async function dispatchForemanDocumentPush(documentId: string): Promise<ForemanPushReceipt> {
  try {
    const { data } = await supabase.auth.getSession();
    if (!data.session?.access_token) throw Error('Sesión necesaria');
    const response = await fetch('/api/foreman-push', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify({ documentId }), signal: AbortSignal.timeout(55_000) });
    if (!response.ok) throw Error('Aviso no confirmado');
    const receipt = await response.json();
    if (!['accepted','partial','pending','no_devices','unconfigured'].includes(receipt?.status) || !Number.isFinite(receipt.accepted) || !Number.isFinite(receipt.failed)) throw Error('Respuesta no válida');
    return receipt;
  } catch { return { status: 'unconfirmed', accepted: 0, failed: 1 }; }
}
export function foremanPushReceiptMessage(receipt: ForemanPushReceipt): string {
  if (receipt.status === 'no_devices') return 'Aviso móvil: ningún encargado de esta obra ha activado todavía las notificaciones.';
  if (receipt.status === 'unconfigured') return 'Aviso móvil: pendiente de configurar en el servidor.';
  if (receipt.status === 'accepted') return `Aviso móvil aceptado por el servicio de notificaciones para ${receipt.accepted} dispositivo(s). Esto no confirma que el encargado lo haya leído.`;
  if (receipt.status === 'pending') return 'Aviso móvil: hay un envío en curso. Puedes volver a comprobarlo sin reenviar el documento.';
  return `Documento publicado. Aviso móvil sin confirmar en ${receipt.failed} dispositivo(s); aceptado en ${receipt.accepted}. Puedes reintentar solo el aviso.`;
}
