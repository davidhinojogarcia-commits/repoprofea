import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const callerClient = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "No autenticado" }, 401);

  const { data: callerData, error: callerError } = await callerClient.auth.getUser(token);
  if (callerError || !callerData.user) return json({ error: "Sesión no válida" }, 401);

  const { data: callerProfile, error: callerProfileError } = await admin
    .from("profiles")
    .select("role,active")
    .eq("id", callerData.user.id)
    .maybeSingle();
  if (callerProfileError || !callerProfile || callerProfile.role !== "admin" || callerProfile.active !== true) {
    return json({ error: "Solo un administrador activo puede realizar esta operación" }, 403);
  }

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");

  try {
    if (action === "create") {
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const role = body.role === "admin" ? "admin" : "user";
      if (!email || password.length < 8) return json({ error: "Email y contraseña válida son obligatorios" }, 400);

      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { nombre: body.nombre || "", apellidos: body.apellidos || "" },
        app_metadata: { role },
      });
      if (error) throw error;
      if (!data.user) throw new Error("No se pudo crear el usuario");

      const profile = {
        id: data.user.id,
        email,
        nombre: body.nombre || "",
        apellidos: body.apellidos || "",
        role,
        active: body.active !== false,
        created_by: callerData.user.id,
      };
      const { error: profileError } = await admin.from("profiles").upsert(profile, { onConflict: "id" });
      if (profileError) {
        await admin.auth.admin.deleteUser(data.user.id).catch(() => undefined);
        throw profileError;
      }
      await admin.from("users").update({ email, nombre: profile.nombre, apellidos: profile.apellidos, role, active: profile.active, created_by: callerData.user.id }).eq("id", data.user.id);
      await admin.from("user_permissions").upsert({ user_id: data.user.id }, { onConflict: "user_id" });
      await audit(admin, callerData.user, "CREATE_USER", data.user.id, { email, role });
      return json({ ok: true, uid: data.user.id, email, role });
    }

    const uid = String(body.uid || "");
    if (!uid) return json({ error: "Falta uid" }, 400);

    if (action === "update_profile") {
      const email = String(body.email || "").trim().toLowerCase();
      if (!email) return json({ error: "Email obligatorio" }, 400);
      const patch = { email, nombre: body.nombre || "", apellidos: body.apellidos || "" };
      const { error: authError } = await admin.auth.admin.updateUserById(uid, {
        email,
        user_metadata: { nombre: patch.nombre, apellidos: patch.apellidos },
      });
      if (authError) throw authError;
      const { error } = await admin.from("profiles").update(patch).eq("id", uid);
      if (error) throw error;
      await admin.from("users").update(patch).eq("id", uid);
      await audit(admin, callerData.user, "UPDATE_USER", uid, { fields: ["email", "nombre", "apellidos"] });
      return json({ ok: true });
    }

    if (action === "role") {
      if (uid === callerData.user.id) return json({ error: "No puedes cambiar tu propio rol" }, 400);
      const role = body.role === "admin" ? "admin" : "user";
      const { error: authError } = await admin.auth.admin.updateUserById(uid, { app_metadata: { role } });
      if (authError) throw authError;
      const { error } = await admin.from("profiles").update({ role }).eq("id", uid);
      if (error) throw error;
      await admin.from("users").update({ role }).eq("id", uid);
      await audit(admin, callerData.user, "UPDATE_USER", uid, { role });
      return json({ ok: true });
    }

    if (action === "status") {
      const active = body.active === true;
      if (uid === callerData.user.id && !active) return json({ error: "No puedes desactivar tu propia cuenta" }, 400);
      const { error } = await admin.from("profiles").update({ active }).eq("id", uid);
      if (error) throw error;
      await admin.from("users").update({ active }).eq("id", uid);
      await audit(admin, callerData.user, "UPDATE_USER", uid, { active });
      return json({ ok: true });
    }

    if (action === "permissions") {
      const { error } = await admin.from("user_permissions").upsert({ user_id: uid, modules: body.modules || {} }, { onConflict: "user_id" });
      if (error) throw error;
      await audit(admin, callerData.user, "UPDATE_PERMISSIONS", uid, {});
      return json({ ok: true });
    }

    if (action === "delete") {
      if (uid === callerData.user.id) return json({ error: "No puedes eliminar tu propia cuenta" }, 400);
      await audit(admin, callerData.user, "DELETE_USER", uid, {});
      const { error } = await admin.auth.admin.deleteUser(uid);
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "reset_password") {
      const { data: userData, error: userError } = await admin.auth.admin.getUserById(uid);
      if (userError || !userData.user?.email) throw userError ?? new Error("Usuario sin email");
      const { data, error } = await admin.auth.admin.generateLink({
        type: "recovery",
        email: userData.user.email,
        options: { redirectTo: req.headers.get("origin") || undefined },
      });
      if (error) throw error;
      await audit(admin, callerData.user, "RESET_PASSWORD", uid, {});
      return json({ ok: true, email: userData.user.email, resetLink: data.properties?.action_link || "" });
    }

    return json({ error: "Acción no soportada" }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

async function audit(admin: ReturnType<typeof createClient>, user: { id: string; email?: string | null }, action: string, resourceId: string, details: Record<string, unknown>) {
  await admin.from("audit_logs").insert({
    user_id: user.id,
    user_email: user.email || "",
    action,
    resource_type: "users",
    resource_id: resourceId,
    details,
  });
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
