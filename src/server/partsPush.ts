import webpush from "web-push";
import { allowedPushEndpoint } from "./foremanPushHandler.js";
import type { PartActor } from "../lib/parts/domain.js";
type DB = (path: string, body?: any, method?: string) => Promise<any>;
export function partsPushConfig() {
  return {
    configured: !!(
      process.env.FOREMAN_PUSH_VAPID_PUBLIC_KEY &&
      process.env.FOREMAN_PUSH_VAPID_PRIVATE_KEY &&
      process.env.FOREMAN_PUSH_VAPID_SUBJECT
    ),
    publicKey: process.env.FOREMAN_PUSH_VAPID_PUBLIC_KEY || null,
  };
}
export async function registerPartsPush(
  db: DB,
  owner: string,
  actor: PartActor,
  access: any,
  subscription: any,
) {
  if (
    !subscription ||
    !allowedPushEndpoint(subscription.endpoint) ||
    subscription.endpoint.length > 2048 ||
    !/^[-_A-Za-z0-9]{20,200}$/.test(subscription.keys?.p256dh || "") ||
    !/^[-_A-Za-z0-9]{10,100}$/.test(subscription.keys?.auth || "")
  )
    throw Object.assign(new Error("Suscripción de avisos no válida."), {
      status: 400,
    });
  await db("rpc/parts_register_push", {
    p_owner: owner,
    p_access: access?.id || null,
    p_role: actor.role,
    p_access_hash: access?.token_hash || null,
    p_endpoint: subscription.endpoint,
    p_keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
  });
  return { status: "registered" };
}
export async function dispatchPartsPush(
  db: DB,
  id: string,
  revision: number,
  send = webpush.sendNotification,
) {
  if (!partsPushConfig().configured)
    return { status: "unconfigured", accepted: 0, failed: 0 };
  try {
    const jobs = await db("rpc/parts_claim_push", {
      p_id: id,
      p_revision: revision,
    });
    let accepted = 0,
      failed = 0;
    for (let offset = 0; offset < jobs.length; offset += 4)
      await Promise.all(
        jobs.slice(offset, offset + 4).map(async (job: any) => {
          let status = 0;
          if (allowedPushEndpoint(job.endpoint))
            try {
              const result = await send(
                { endpoint: job.endpoint, keys: job.keys },
                JSON.stringify({
                  title: "GestionProfea",
                  body: job.message,
                  url:
                    job.role === "foreman"
                      ? "/encargados?parts=1"
                      : "/?parts=1",
                  tag: "parts-" + job.id,
                  kind: "PARTS_UPDATED",
                }),
                {
                  vapidDetails: {
                    subject: process.env.FOREMAN_PUSH_VAPID_SUBJECT!,
                    publicKey: process.env.FOREMAN_PUSH_VAPID_PUBLIC_KEY!,
                    privateKey: process.env.FOREMAN_PUSH_VAPID_PRIVATE_KEY!,
                  },
                  TTL: 86400,
                  timeout: 8000,
                  topic: job.id.replace(/-/g, ""),
                },
              );
              status = result.statusCode;
            } catch (e: any) {
              status = Number(e?.statusCode || 0);
            }
          const persisted = await db("rpc/parts_finish_push", {
            p_id: job.id,
            p_lease: job.lease,
            p_status: status,
          });
          if (persisted && status >= 200 && status < 300) accepted++;
          else failed++;
        }),
      );
    return {
      status: failed
        ? "partial"
        : jobs.length
          ? "accepted"
          : "no_pending_devices",
      accepted,
      failed,
    };
  } catch {
    return { status: "unconfirmed", accepted: 0, failed: 1 };
  }
}
