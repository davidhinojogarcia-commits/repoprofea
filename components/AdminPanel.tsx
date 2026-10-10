import React, { useEffect, useMemo, useState } from "react";
import ModalPortal from './ModalPortal';
import { appConfirm } from '../src/lib/appDialog';
import {
  Filter,
  KeyRound,
  Loader2,
  Pencil,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserCheck,
  Users,
  UserX,
  X,
} from "lucide-react";
import { supabase } from "../src/lib/supabase";
import {
  createManagedUser,
  deleteManagedUser,
  sendManagedPasswordReset,
  setManagedUserActive,
  setManagedUserRole,
  updateManagedPermissions,
  updateManagedUserProfile,
} from "../src/lib/functions";
import { showAppToast } from "../src/lib/appToast";
import { AdminShareManager } from "./AdminShareManager";
import { PageHeader } from "./ui/PageHeader";

type Role = "admin" | "user";
type ModuleName =
  | "contratacion"
  | "trabajadores"
  | "obras"
  | "reconocimientos"
  | "subcontratas"
  | "citas";
type PermissionSet = Record<"read" | "create" | "update" | "delete", boolean>;
type Modules = Record<ModuleName, PermissionSet>;
interface AdminPanelProps {
  onClose: () => void;
}
interface UserForm {
  nombre: string;
  apellidos: string;
  email: string;
  telefono: string;
  password: string;
  role: Role;
}
const moduleLabels: Record<ModuleName, string> = {
  contratacion: "Contratación",
  trabajadores: "Trabajadores",
  obras: "Obras",
  reconocimientos: "Reconocimientos",
  subcontratas: "Subcontratas",
  citas: "Citas",
};
const defaultPermissions = (): Modules =>
  Object.fromEntries(
    Object.keys(moduleLabels).map((k) => [
      k,
      { read: true, create: true, update: true, delete: true },
    ]),
  ) as Modules;
const emptyForm = (): UserForm => ({
  nombre: "",
  apellidos: "",
  email: "",
  telefono: "",
  password: "",
  role: "user",
});
const dateValue = (v: any) => (v ? new Date(v).toLocaleString("es-ES") : "Sin acceso registrado");
const auditActionOptions = [
  ["CREATE", "Crear"],
  ["INSERT", "Insertar"],
  ["UPDATE", "Actualizar"],
  ["DELETE", "Eliminar"],
  ["LOGIN", "Inicio de sesión"],
  ["CREATE_USER", "Crear usuario"],
  ["UPDATE_USER", "Actualizar usuario"],
  ["RESET_PASSWORD", "Restablecer contraseña"],
] as const;
const auditResourceOptions = [
  ["trabajadores", "Trabajadores"],
  ["trash", "Papelera"],
  ["subcontratas", "Subcontratas"],
  ["contrataciones", "Contrataciones"],
  ["reconocimientos", "Reconocimientos médicos"],
  ["citas", "Citas"],
  ["obras", "Obras"],
  ["profiles", "Administración / Usuarios"],
  ["auth", "Autenticación"],
] as const;

export function AdminPanel({ onClose }: AdminPanelProps) {
  const [tab, setTab] = useState<"users" | "permissions" | "audit">("users");
  const [users, setUsers] = useState<any[]>([]),
    [permissions, setPermissions] = useState<Record<string, Modules>>({}),
    [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [selectedUid, setSelectedUid] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false),
    [editUid, setEditUid] = useState(""),
    [form, setForm] = useState<UserForm>(emptyForm());
  const [auditUserFilter, setAuditUserFilter] = useState(""),
    [auditActionFilter, setAuditActionFilter] = useState(""),
    [auditResourceFilter, setAuditResourceFilter] = useState(""),
    [auditDateFrom, setAuditDateFrom] = useState(""),
    [auditDateTo, setAuditDateTo] = useState("");
  const selectedUser = users.find((u) => u.id === selectedUid);
  const load = async () => {
    setError("");
    const [us, ps] = await Promise.all([
      supabase.query("profiles", {
        query:
          "select=id,email,nombre,apellidos,telefono,role,active,created_at,last_access_at&order=created_at.asc",
      }),
      supabase.query("user_permissions", { query: "select=user_id,modules" }),
    ]);
    setUsers(us || []);
    setPermissions(
      Object.fromEntries(
        (ps || []).map((p: any) => [
          p.user_id,
          p.modules || defaultPermissions(),
        ]),
      ),
    );
  };
  useEffect(() => {
    load().catch((e) =>
      setError(e?.message || "No se pudieron cargar los usuarios."),
    );
  }, []);
  const loadAudit = async () => {
    const f: string[] = [];
    if (auditUserFilter)
      f.push(`user_id=eq.${encodeURIComponent(auditUserFilter)}`);
    if (auditActionFilter)
      f.push(`action=eq.${encodeURIComponent(auditActionFilter)}`);
    if (auditResourceFilter)
      f.push(`resource_type=eq.${encodeURIComponent(auditResourceFilter)}`);
    if (auditDateFrom)
      f.push(
        `timestamp=gte.${encodeURIComponent(new Date(`${auditDateFrom}T00:00:00`).toISOString())}`,
      );
    if (auditDateTo)
      f.push(
        `timestamp=lte.${encodeURIComponent(new Date(`${auditDateTo}T23:59:59.999`).toISOString())}`,
      );
    const rows = await supabase.query("audit_logs", {
      query: `select=id,user_id,user_email,action,resource_type,resource_id,timestamp,details${f.length ? `&${f.join("&")}` : ""}&order=timestamp.desc&limit=100`,
    });
    setAuditLogs(rows || []);
  };
  useEffect(() => {
    if (tab !== "audit") return;
    // Evita una consulta por cada cambio rápido en los filtros.
    const timer = window.setTimeout(() => {
      loadAudit().catch((e) =>
        setError(e?.message || "No se pudo cargar la auditoría."),
      );
    }, 400);
    return () => window.clearTimeout(timer);
  }, [
    tab,
    auditUserFilter,
    auditActionFilter,
    auditResourceFilter,
    auditDateFrom,
    auditDateTo,
  ]);
  const run = async (
    op: () => Promise<any>,
    success?: string,
    reload = true,
  ) => {
    setBusy(true);
    setError("");
    try {
      await op();
      if (reload) await load();
      if (success) showAppToast(success, "success");
    } catch (e: any) {
      const m = e?.message || "La operación no se pudo completar.";
      setError(m);
      showAppToast(m, "error");
    } finally {
      setBusy(false);
    }
  };
  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    await run(async () => {
      await createManagedUser(form);
      setCreateOpen(false);
      setForm(emptyForm());
    }, "Usuario creado correctamente.");
  };
  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editUid) return;
    const current = users.find((u) => u.id === editUid);
    await run(async () => {
      await updateManagedUserProfile({
        uid: editUid,
        email: form.email,
        nombre: form.nombre,
        apellidos: form.apellidos,
        telefono: form.telefono,
      });
      if (current && (current.role || "user") !== form.role)
        await setManagedUserRole({ uid: editUid, role: form.role });
      setEditUid("");
    }, "Usuario actualizado correctamente.");
  };
  const savePermissions = async () => {
    if (!selectedUid) return;
    await run(
      () =>
        updateManagedPermissions({
          uid: selectedUid,
          modules: permissions[selectedUid] || defaultPermissions(),
        }),
      "Permisos de módulo guardados.",
    );
  };
  const clearAudit = () => {
    setAuditUserFilter("");
    setAuditActionFilter("");
    setAuditResourceFilter("");
    setAuditDateFrom("");
    setAuditDateTo("");
  };
  const filteredUserLabel = useMemo(
    () => users.find((u) => u.id === auditUserFilter),
    [users, auditUserFilter],
  );
  const hasAuditFilters = Boolean(
    auditUserFilter ||
      auditActionFilter ||
      auditResourceFilter ||
      auditDateFrom ||
      auditDateTo,
  );
  return (
    <section className="w-full bg-transparent">
      <div className="w-full max-w-none mx-auto p-3 sm:p-4 lg:p-6 space-y-5">
        <PageHeader
          eyebrow="Sistema"
          title="Administración"
          description="Usuarios, permisos, compartición y trazabilidad de la actividad."
          icon={<ShieldCheck size={20} />}
          actions={
            onClose ? (
              <button
                type="button"
                onClick={onClose}
                className="ui-button-ghost px-3 py-2"
                aria-label="Cerrar administración"
              >
                <X size={20} />
              </button>
            ) : undefined
          }
        />
        <nav className="ui-surface p-2 flex flex-wrap gap-2">
          {(
            [
              ["users", "Usuarios"],
              ["permissions", "Permisos"],
              ["audit", "Auditoría"],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`px-4 py-2.5 rounded-xl text-sm font-semibold ${tab === k ? "bg-brand-primary text-white" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}
            >
              {l}
            </button>
          ))}
        </nav>
        <div className="ui-surface min-w-0 p-4 sm:p-5 lg:p-6 relative min-h-[420px]">
          {error && (
            <div
              role="alert"
              className="mb-4 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 px-4 py-3 text-sm text-red-700 dark:text-red-300"
            >
              {error}
            </div>
          )}
          {tab === "users" && (
            <>
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4">
                <h2 className="font-semibold flex items-center gap-2">
                  <Users size={18} />
                  Usuarios
                </h2>
                <div className="flex gap-2">
                  <button
                    type="button"
                    aria-label="Actualizar usuarios"
                    onClick={() => load()}
                    className="p-2.5 rounded-lg border"
                  >
                    <RefreshCw size={17} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreateOpen(true)}
                    className="rounded-lg bg-brand-primary text-white px-4 py-2.5 text-sm font-semibold"
                  >
                    Crear usuario
                  </button>
                </div>
              </div>
              <div className="hidden xl:block overflow-x-auto rounded-xl border">
                <table className="w-full min-w-[1040px] text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-800/60">
                    <tr>
                      {[
                        "Nombre",
                        "Email",
                        "Teléfono",
                        "Rol",
                        "Estado",
                        "Creación",
                        "Último acceso",
                        "Acciones",
                      ].map((x) => (
                        <th
                          key={x}
                          className="text-left px-4 py-3 font-semibold whitespace-nowrap"
                        >
                          {x}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id} className="border-t">
                        <td className="px-4 py-3">
                          {u.nombre} {u.apellidos}
                        </td>
                        <td className="px-4 py-3">{u.email}</td>
                        <td className="px-4 py-3">{u.telefono || "—"}</td>
                        <td className="px-4 py-3">
                          {u.role === "admin" ? "Administrador" : "Usuario"}
                        </td>
                        <td className="px-4 py-3">
                          {u.active === false ? "Inactivo" : "Activo"}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {u.created_at ? dateValue(u.created_at) : '—'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {dateValue(u.last_access_at)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1">
                            <button
                              title="Editar"
                              onClick={() => {
                                setEditUid(u.id);
                                setForm({
                                  nombre: u.nombre || "",
                                  apellidos: u.apellidos || "",
                                  email: u.email || "",
                                  telefono: u.telefono || "",
                                  password: "",
                                  role: u.role || "user",
                                });
                              }}
                              className="p-2 rounded"
                            >
                              <Pencil size={16} />
                            </button>
                            <button
                              title="Activar/desactivar"
                              onClick={() =>
                                run(
                                  () =>
                                    setManagedUserActive({
                                      uid: u.id,
                                      active: u.active === false,
                                    }),
                                  u.active === false
                                    ? "Usuario activado."
                                    : "Usuario desactivado.",
                                )
                              }
                              disabled={busy}
                              className="p-2 rounded"
                            >
                              {u.active === false ? (
                                <UserCheck size={16} />
                              ) : (
                                <UserX size={16} />
                              )}
                            </button>
                            <button
                              title="Restablecer contraseña"
                              onClick={() =>
                                run(
                                  () => sendManagedPasswordReset({ uid: u.id }),
                                  "Correo de restablecimiento enviado.",
                                  false,
                                )
                              }
                              disabled={busy}
                              className="p-2 rounded"
                            >
                              <KeyRound size={16} />
                            </button>
                            <button
                              title="Permisos"
                              onClick={() => {
                                setSelectedUid(u.id);
                                setTab("permissions");
                              }}
                              className="p-2 rounded"
                            >
                              <ShieldCheck size={16} />
                            </button>
                            <button
                              title="Eliminar"
                              onClick={async () => {
                                if (await appConfirm(`¿Eliminar ${u.email}?`, { title: 'Eliminar usuario', confirmLabel: 'Eliminar' }))
                                  run(
                                    () => deleteManagedUser({ uid: u.id }),
                                    "Usuario eliminado.",
                                  );
                              }}
                              disabled={busy}
                              className="p-2 rounded text-red-600"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="xl:hidden space-y-3">
                {users.map((u) => (
                  <article
                    key={u.id}
                    className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-bold text-slate-900 dark:text-white break-words">
                          {u.nombre} {u.apellidos}
                        </h3>
                        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300 break-all">
                          {u.email}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${u.active === false ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"}`}
                      >
                        {u.active === false ? "Inactivo" : "Activo"}
                      </span>
                    </div>
                    <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                      <div>
                        <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Rol
                        </dt>
                        <dd className="mt-1">
                          {u.role === "admin" ? "Administrador" : "Usuario"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Teléfono
                        </dt>
                        <dd className="mt-1 break-words">
                          {u.telefono || "—"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Creación
                        </dt>
                        <dd className="mt-1">{u.created_at ? dateValue(u.created_at) : '—'}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Último acceso
                        </dt>
                        <dd className="mt-1">{dateValue(u.last_access_at)}</dd>
                      </div>
                    </dl>
                    <div className="mt-4 grid grid-cols-5 gap-1 border-t border-slate-200 dark:border-slate-700 pt-3">
                      <button
                        aria-label={`Editar ${u.email}`}
                        title="Editar"
                        onClick={() => {
                          setEditUid(u.id);
                          setForm({
                            nombre: u.nombre || "",
                            apellidos: u.apellidos || "",
                            email: u.email || "",
                            telefono: u.telefono || "",
                            password: "",
                            role: u.role || "user",
                          });
                        }}
                        className="flex min-h-10 items-center justify-center rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700"
                      >
                        <Pencil size={18} />
                      </button>
                      <button
                        aria-label={`${u.active === false ? "Activar" : "Desactivar"} ${u.email}`}
                        title="Activar/desactivar"
                        onClick={() =>
                          run(
                            () =>
                              setManagedUserActive({
                                uid: u.id,
                                active: u.active === false,
                              }),
                            u.active === false
                              ? "Usuario activado."
                              : "Usuario desactivado.",
                          )
                        }
                        disabled={busy}
                        className="flex min-h-10 items-center justify-center rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700"
                      >
                        {u.active === false ? (
                          <UserCheck size={18} />
                        ) : (
                          <UserX size={18} />
                        )}
                      </button>
                      <button
                        aria-label={`Restablecer contraseña de ${u.email}`}
                        title="Restablecer contraseña"
                        onClick={() =>
                          run(
                            () => sendManagedPasswordReset({ uid: u.id }),
                            "Correo de restablecimiento enviado.",
                            false,
                          )
                        }
                        disabled={busy}
                        className="flex min-h-10 items-center justify-center rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700"
                      >
                        <KeyRound size={18} />
                      </button>
                      <button
                        aria-label={`Permisos de ${u.email}`}
                        title="Permisos"
                        onClick={() => {
                          setSelectedUid(u.id);
                          setTab("permissions");
                        }}
                        className="flex min-h-10 items-center justify-center rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700"
                      >
                        <ShieldCheck size={18} />
                      </button>
                      <button
                        aria-label={`Eliminar ${u.email}`}
                        title="Eliminar"
                        onClick={async () => {
                          if (await appConfirm(`¿Eliminar ${u.email}?`, { title: 'Eliminar usuario', confirmLabel: 'Eliminar' }))
                            run(
                              () => deleteManagedUser({ uid: u.id }),
                              "Usuario eliminado.",
                            );
                        }}
                        disabled={busy}
                        className="flex min-h-10 items-center justify-center rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
          {tab === "permissions" && (
            <div className="space-y-8">
              <section className="space-y-4">
                <label className="text-sm font-medium">
                  Usuario
                  <select
                    value={selectedUid}
                    onChange={(e) => setSelectedUid(e.target.value)}
                    className="mt-2 w-full rounded-lg border px-3 py-2 bg-transparent"
                  >
                    <option value="">Selecciona un usuario</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.nombre} {u.apellidos} — {u.email}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedUid && (
                  <div className="rounded-xl border overflow-x-auto">
                    <table className="w-full min-w-[620px] text-sm">
                      <thead className="bg-slate-50 dark:bg-slate-800/60">
                        <tr>
                          <th className="text-left p-3">Módulo</th>
                          <th>Ver</th>
                          <th>Crear</th>
                          <th>Editar</th>
                          <th>Eliminar</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(moduleLabels).map(([key, label]) => {
                          const m = key as ModuleName,
                            v = permissions[selectedUid]?.[m] || {
                              read: false,
                              create: false,
                              update: false,
                              delete: false,
                            };
                          return (
                            <tr key={key} className="border-t">
                              <td className="p-3 font-medium">{label}</td>
                              {(
                                ["read", "create", "update", "delete"] as const
                              ).map((a) => (
                                <td key={a} className="text-center">
                                  <input
                                    type="checkbox"
                                    checked={v[a]}
                                    disabled={busy}
                                    onChange={(e) =>
                                      setPermissions((prev) => ({
                                        ...prev,
                                        [selectedUid]: {
                                          ...(prev[selectedUid] ||
                                            defaultPermissions()),
                                          [m]: { ...v, [a]: e.target.checked },
                                        },
                                      }))
                                    }
                                  />
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                <button
                  disabled={!selectedUid || busy}
                  onClick={savePermissions}
                  className="rounded-lg bg-brand-primary text-white px-5 py-2.5 font-semibold disabled:opacity-50"
                >
                  Guardar permisos de módulo
                </button>
              </section>
              {selectedUid && (
                <AdminShareManager
                  key={selectedUid}
                  userId={selectedUid}
                  userName={
                    [selectedUser?.nombre, selectedUser?.apellidos]
                      .filter(Boolean)
                      .join(" ") ||
                    selectedUser?.email ||
                    "usuario"
                  }
                />
              )}
            </div>
          )}
          {tab === "audit" && (
            <div className="min-w-0">
              <div className="mb-5">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-semibold">Registro de auditoría</h2>
                    <p className="text-xs text-slate-500 mt-1">
                      Filtra la actividad por usuario, acción, sección y rango
                      de fechas.
                    </p>
                  </div>
                  <button
                    onClick={loadAudit}
                    className="p-2.5 rounded-lg border"
                  >
                    <RefreshCw size={17} />
                  </button>
                </div>
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
                  <label className="min-w-0 text-xs font-medium">
                    <span className="flex items-center gap-1 mb-1">
                      <Filter size={13} />
                      Usuario
                    </span>
                    <select
                      value={auditUserFilter}
                      onChange={(e) => setAuditUserFilter(e.target.value)}
                      className="w-full min-w-0 rounded-lg border px-3 py-2 bg-transparent"
                    >
                      <option value="">Todos</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.nombre} {u.apellidos} — {u.email}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="min-w-0 text-xs font-medium">
                    Acción
                    <select
                      value={auditActionFilter}
                      onChange={(e) => setAuditActionFilter(e.target.value)}
                      className="mt-1 w-full min-w-0 rounded-lg border px-3 py-2 bg-transparent"
                    >
                      <option value="">Todas</option>
                      {auditActionOptions.map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="min-w-0 text-xs font-medium">
                    Módulo / sección
                    <select
                      value={auditResourceFilter}
                      onChange={(e) => setAuditResourceFilter(e.target.value)}
                      className="mt-1 w-full min-w-0 rounded-lg border px-3 py-2 bg-transparent"
                    >
                      <option value="">Todas</option>
                      {auditResourceOptions.map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="min-w-0 text-xs font-medium">
                    Desde
                    <input
                      type="date"
                      value={auditDateFrom}
                      onChange={(e) => setAuditDateFrom(e.target.value)}
                      className="mt-1 w-full min-w-0 rounded-lg border px-3 py-2 bg-transparent"
                    />
                  </label>
                  <label className="min-w-0 text-xs font-medium">
                    Hasta
                    <input
                      type="date"
                      value={auditDateTo}
                      onChange={(e) => setAuditDateTo(e.target.value)}
                      className="mt-1 w-full min-w-0 rounded-lg border px-3 py-2 bg-transparent"
                    />
                  </label>
                </div>
                {hasAuditFilters && (
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span className="min-w-0 break-words rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2">
                      Filtros activos
                      {filteredUserLabel ? (
                        <>
                          {" "}
                          ·{" "}
                          <strong>
                            {filteredUserLabel.nombre}{" "}
                            {filteredUserLabel.apellidos}
                          </strong>
                        </>
                      ) : null}
                    </span>
                    <button
                      type="button"
                      onClick={clearAudit}
                      className="rounded-lg border px-3 py-2"
                    >
                      Limpiar filtros
                    </button>
                  </div>
                )}
              </div>
              <div className="min-w-0 space-y-2">
                {auditLogs.length === 0 ? (
                  <div className="py-12 text-center text-sm text-slate-500">
                    No hay eventos para estos filtros.
                  </div>
                ) : (
                  auditLogs.map((log) => (
                    <article
                      key={log.id}
                      className="min-w-0 overflow-hidden rounded-lg border p-3 text-sm"
                    >
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                        <strong className="min-w-0 break-words">
                          {log.action}
                        </strong>
                        <span className="shrink-0 text-slate-500">
                          {dateValue(log.timestamp)}
                        </span>
                      </div>
                      <div className="mt-1 min-w-0 break-all text-slate-600 dark:text-slate-300">
                        {log.resource_type} / {log.resource_id} ·{" "}
                        {log.user_email}
                      </div>
                      {log.details && (
                        <pre className="mt-2 max-w-full whitespace-pre-wrap break-all text-xs text-slate-500">
                          {JSON.stringify(log.details)}
                        </pre>
                      )}
                    </article>
                  ))
                )}
              </div>
            </div>
          )}
          {busy && (
            <div className="fixed bottom-6 right-6 rounded-full bg-slate-900 text-white px-4 py-2 flex items-center gap-2 text-sm shadow-xl">
              <Loader2 size={16} className="animate-spin" />
              Procesando…
            </div>
          )}
        </div>
      </div>
      {(createOpen || editUid) && (
        <ModalPortal label="AdminPanel"><div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4">
          <form
            onSubmit={editUid ? saveEdit : createUser}
            className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-4"
          >
            <div className="flex justify-between">
              <h3 className="text-lg font-bold">
                {editUid ? "Editar usuario" : "Crear usuario"}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setCreateOpen(false);
                  setEditUid("");
                  setForm(emptyForm());
                }}
              >
                <X />
              </button>
            </div>
            <input
              required
              value={form.nombre}
              onChange={(e) =>
                setForm((f) => ({ ...f, nombre: e.target.value }))
              }
              placeholder="Nombre"
              className="w-full rounded-lg border px-3 py-2 bg-transparent"
            />
            <input
              required
              value={form.apellidos}
              onChange={(e) =>
                setForm((f) => ({ ...f, apellidos: e.target.value }))
              }
              placeholder="Apellidos"
              className="w-full rounded-lg border px-3 py-2 bg-transparent"
            />
            <input
              required
              type="email"
              value={form.email}
              onChange={(e) =>
                setForm((f) => ({ ...f, email: e.target.value }))
              }
              placeholder="Email"
              className="w-full rounded-lg border px-3 py-2 bg-transparent"
            />
            <input
              type="tel"
              value={form.telefono}
              onChange={(e) =>
                setForm((f) => ({ ...f, telefono: e.target.value }))
              }
              placeholder="Teléfono (opcional)"
              className="w-full rounded-lg border px-3 py-2 bg-transparent"
            />
            {!editUid && (
              <input
                required
                type="password"
                minLength={8}
                value={form.password}
                onChange={(e) =>
                  setForm((f) => ({ ...f, password: e.target.value }))
                }
                placeholder="Contraseña inicial"
                className="w-full rounded-lg border px-3 py-2 bg-transparent"
              />
            )}
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Rol</span>
              <select
                value={form.role}
                onChange={(e) =>
                  setForm((f) => ({ ...f, role: e.target.value as Role }))
                }
                className="w-full rounded-lg border px-3 py-2 bg-transparent"
              >
                <option value="user">Usuario</option>
                <option value="admin">Administrador</option>
              </select>
            </label>
            <button
              disabled={busy}
              className="w-full rounded-lg bg-brand-primary text-white px-4 py-2.5 font-semibold"
            >
              {editUid ? "Guardar cambios" : "Crear usuario"}
            </button>
          </form>
        </div></ModalPortal>
      )}
    </section>
  );
}
