import { foremanPushHelp } from "./foremanPushService";
import { partsRequest } from "./partsService";
export async function activatePartsPush(token?: string) {
  const help = foremanPushHelp();
  if (help) throw new Error(help);
  const permission = await Notification.requestPermission();
  if (permission !== "granted")
    throw new Error(
      "Las notificaciones están desactivadas. El registro de partes sigue disponible.",
    );
  const config = await partsRequest({ action: "push-config" }, token);
  if (!config.configured || !config.publicKey)
    throw new Error(
      "Web Push pendiente de configuración. Los avisos quedan registrados dentro del módulo.",
    );
  const registration = await navigator.serviceWorker.register(
    "/service-worker.js",
    { scope: "/" },
  );
  await navigator.serviceWorker.ready;
  const key = Uint8Array.from(
    atob(config.publicKey.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0),
  );
  let subscription = await registration.pushManager.getSubscription();
  if (
    subscription?.options.applicationServerKey &&
    !Array.from(
      new Uint8Array(subscription.options.applicationServerKey),
    ).every((v, i) => v === key[i])
  )
    throw new Error(
      "El dispositivo utiliza otra configuración de avisos. No se ha alterado la suscripción existente.",
    );
  const created = !subscription;
  subscription ||= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key,
  });
  try {
    await partsRequest(
      { action: "push-register", subscription: subscription.toJSON() },
      token,
    );
  } catch (e) {
    if (created) await subscription.unsubscribe();
    throw e;
  }
}
export async function disablePartsPush(token?: string) {
  const registration = await navigator.serviceWorker?.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription)
    await partsRequest(
      { action: "push-disable", endpoint: subscription.endpoint },
      token,
    );
  // Other modules share this browser subscription; disable only this module's server registration.
}
export function partsPushMessage(status?: string) {
  return (
    (
      {
        accepted:
          "aceptado por el servicio de avisos; no acredita recepción en el móvil",
        partial: "pendiente en algunos dispositivos",
        unconfigured:
          "pendiente de configuración; el aviso interno está registrado",
        unconfirmed: "sin confirmación; puedes reintentarlo",
        no_pending_devices: "sin dispositivos pendientes de envío",
        registered: "dispositivo registrado",
      } as Record<string, string>
    )[status || ""] || "sin confirmación"
  );
}
