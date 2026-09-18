import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SECRET_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const resendKey = Deno.env.get("RESEND_API_KEY") || "";
  const fromEmail = Deno.env.get("INVENTORY_INVITE_FROM_EMAIL") || "";
  const appUrl = Deno.env.get("APP_URL") || "https://gestionprofea.vercel.app/";

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "No autenticado" }, 401);

  const callerClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: callerData, error: callerError } =
    await callerClient.auth.getUser(token);
  if (callerError || !callerData.user) {
    return json({ error: "Sesión no válida" }, 401);
  }

  const body = await req.json().catch(() => ({}));
  const invitationId = String(body.invitationId || "").trim();
  if (!invitationId) return json({ error: "Falta invitationId" }, 400);

  const { data: invitation, error: invitationError } = await admin
    .from("inventory_park_invitations")
    .select("id,park_id,invited_user_id,invited_email,invited_by,status")
    .eq("id", invitationId)
    .maybeSingle();

  if (invitationError || !invitation) {
    return json({ error: "Invitación no encontrada" }, 404);
  }
  if (invitation.invited_by !== callerData.user.id) {
    return json({ error: "No puedes enviar una invitación creada por otro usuario" }, 403);
  }
  if (invitation.status !== "pending") {
    return json({ error: "La invitación ya no está pendiente" }, 409);
  }

  const [{ data: park }, { data: inviter }, { data: invitee }] = await Promise.all([
    admin
      .from("inventory_parks")
      .select("nombre,zona")
      .eq("id", invitation.park_id)
      .maybeSingle(),
    admin
      .from("profiles")
      .select("nombre,apellidos,email")
      .eq("id", invitation.invited_by)
      .maybeSingle(),
    admin
      .from("profiles")
      .select("nombre,apellidos,email")
      .eq("id", invitation.invited_user_id)
      .maybeSingle(),
  ]);

  const inviterName =
    [inviter?.nombre, inviter?.apellidos].filter(Boolean).join(" ").trim() ||
    inviter?.email ||
    "Un supervisor de GestionPROFEA";
  const inviteeName =
    [invitee?.nombre, invitee?.apellidos].filter(Boolean).join(" ").trim() ||
    invitation.invited_email;
  const parkName = [park?.zona, park?.nombre].filter(Boolean).join(" · ") ||
    "Parque de herramientas y maquinaria";

  if (!resendKey || !fromEmail) {
    return json({
      ok: false,
      delivery: "not_configured",
      error:
        "El correo automático requiere RESEND_API_KEY e INVENTORY_INVITE_FROM_EMAIL en Supabase.",
    }, 503);
  }

  const targetUrl = new URL(appUrl);
  targetUrl.searchParams.set("inventoryInvite", invitation.id);

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#172033">
      <h2 style="color:#00548e">Invitación a compartir parque de maquinaria</h2>
      <p>Hola ${escapeHtml(inviteeName)},</p>
      <p><strong>${escapeHtml(inviterName)}</strong> te invita a compartir el parque
      <strong>${escapeHtml(parkName)}</strong> en GestionPROFEA.</p>
      <p>La invitación no concede acceso hasta que la aceptes dentro de la aplicación.</p>
      <p style="margin:28px 0">
        <a href="${targetUrl.toString()}"
           style="background:#00548e;color:white;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700">
          Abrir GestionPROFEA y responder
        </a>
      </p>
      <p style="font-size:12px;color:#64748b">
        Al aceptar, el parque quedará compartido de forma permanente hasta que se revoque el acceso.
      </p>
    </div>
  `;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [invitation.invited_email],
      subject: `GestionPROFEA · Invitación a compartir ${parkName}`,
      html,
    }),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    return json(
      { error: result?.message || "No se pudo enviar el correo de invitación" },
      502,
    );
  }

  return json({ ok: true, delivery: "sent", id: result?.id || null });
});

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
