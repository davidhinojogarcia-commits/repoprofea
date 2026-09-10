import React, { useEffect, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { Loader2, ShieldCheck, Users, X, RefreshCw, Trash2, UserX, UserCheck, KeyRound, Pencil, Share2 } from 'lucide-react';
import { db } from '../src/lib/firebase';
import {
  createManagedUser,
  deleteDataPermission,
  deleteManagedUser,
  sendManagedPasswordReset,
  setDataPermission,
  setManagedUserActive,
  setManagedUserRole,
  updateManagedPermissions,
  updateManagedUserProfile,
} from '../src/lib/functions';

type Role = 'admin' | 'user';
type ModuleName = 'contratacion' | 'trabajadores' | 'obras' | 'reconocimientos' | 'subcontratas' | 'citas';
type PermissionSet = Record<'read' | 'create' | 'update' | 'delete', boolean>;
type Modules = Record<ModuleName, PermissionSet>;

const moduleLabels: Record<ModuleName, string> = {
  contratacion: 'Contratación', trabajadores: 'Trabajadores', obras: 'Obras', reconocimientos: 'Reconocimientos', subcontratas: 'Subcontratas', citas: 'Citas'
};
const defaultPermissions = (): Modules => Object.fromEntries(Object.keys(moduleLabels).map(key => [key, { read: true, create: true, update: true, delete: true }])) as Modules;
const dateValue = (value: any) => value?.toDate ? value.toDate().toLocaleString('es-ES') : '—';

interface AdminPanelProps { onClose: () => void; }
interface UserForm { nombre: string; apellidos: string; email: string; password: string; role: Role; }

export function AdminPanel({ onClose }: AdminPanelProps) {
  const [tab, setTab] = useState<'users' | 'permissions' | 'audit'>('users');
  const [users, setUsers] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [permissions, setPermissions] = useState<Record<string, Modules>>({});
  const [selectedUid, setSelectedUid] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editUid, setEditUid] = useState('');
  const [form, setForm] = useState<UserForm>({ nombre: '', apellidos: '', email: '', password: '', role: 'user' });
  const [share, setShare] = useState({ resourceType: 'trabajadores', resourceId: '', ownerId: '', userId: '', canRead: true, canUpdate: false, canDelete: false });

  const load = async () => {
    setError('');
    const [userSnap, permSnap] = await Promise.all([getDocs(collection(db, 'users')), getDocs(collection(db, 'userPermissions'))]);
    setUsers(userSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    setPermissions(Object.fromEntries(permSnap.docs.map(d => [d.id, (d.data().modules || defaultPermissions()) as Modules])));
  };

  const loadAudit = async () => {
    const snapshot = await getDocs(query(collection(db, 'auditLogs'), orderBy('timestamp', 'desc')));
    setAuditLogs(snapshot.docs.slice(0, 200).map(d => ({ id: d.id, ...d.data() })));
  };

  useEffect(() => { load().catch(e => setError(e?.message || 'No se pudieron cargar los usuarios.')); }, []);
  useEffect(() => { if (tab === 'audit') loadAudit().catch(e => setError(e?.message || 'No se pudo cargar la auditoría.')); }, [tab]);

  const run = async (operation: () => Promise<unknown>, reload = true) => {
    setBusy(true); setError('');
    try { await operation(); if (reload) await load(); }
    catch (e: any) { setError(e?.message || 'La operación no se pudo completar.'); }
    finally { setBusy(false); }
  };

  const createUser = async (event: React.FormEvent) => {
    event.preventDefault();
    await run(async () => { await createManagedUser(form); setCreateOpen(false); setForm({ nombre: '', apellidos: '', email: '', password: '', role: 'user' }); });
  };

  const saveEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editUid) return;
    await run(async () => { await updateManagedUserProfile({ uid: editUid, email: form.email, nombre: form.nombre, apellidos: form.apellidos }); setEditUid(''); });
  };

  const resetPassword = async (uid: string) => {
    await run(async () => {
      const result = await sendManagedPasswordReset({ uid });
      window.prompt('Enlace de restablecimiento (cópialo y envíalo al usuario):', result.data.resetLink);
    }, false);
  };

  const savePermissions = async () => {
    if (!selectedUid) return;
    await run(() => updateManagedPermissions({ uid: selectedUid, modules: permissions[selectedUid] || defaultPermissions() }));
  };

  const saveShare = async () => {
    if (!share.resourceId || !share.ownerId || !share.userId) { setError('Indica recurso, propietario y usuario destinatario.'); return; }
    await run(() => setDataPermission(share));
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="relative w-full max-w-6xl max-h-[92vh] overflow-hidden rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col">
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3"><ShieldCheck className="text-slate-700 dark:text-slate-200" /><div><h2 className="text-xl font-bold">Administración</h2><p className="text-xs text-slate-500">Usuarios, permisos y auditoría</p></div></div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"><X /></button>
        </header>
        <nav className="flex gap-2 px-6 pt-4">
          {([['users','Usuarios'],['permissions','Permisos'],['audit','Auditoría']] as const).map(([key,label]) => <button type="button" key={key} onClick={() => setTab(key)} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === key ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}>{label}</button>)}
        </nav>
        <div className="flex-1 overflow-auto p-6">
          {error && <div role="alert" className="mb-4 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</div>}

          {tab === 'users' && <>
            <div className="flex justify-between items-center mb-4"><h3 className="font-semibold flex items-center gap-2"><Users size={18}/> Usuarios</h3><div className="flex gap-2"><button type="button" onClick={() => load()} className="p-2 rounded-lg border" title="Actualizar"><RefreshCw size={17}/></button><button type="button" onClick={() => setCreateOpen(true)} className="rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900 px-4 py-2 text-sm font-semibold">Crear usuario</button></div></div>
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800"><table className="w-full text-sm"><thead className="bg-slate-50 dark:bg-slate-800/60"><tr>{['Nombre','Email','Rol','Estado','Creación','Último acceso','Acciones'].map(x => <th key={x} className="text-left px-4 py-3 font-semibold whitespace-nowrap">{x}</th>)}</tr></thead><tbody>
              {users.map(u => <tr key={u.id} className="border-t border-slate-200 dark:border-slate-800"><td className="px-4 py-3">{u.nombre} {u.apellidos}</td><td className="px-4 py-3">{u.email}</td><td className="px-4 py-3"><select value={u.role || 'user'} onChange={e => run(() => setManagedUserRole({ uid: u.id, role: e.target.value }))} disabled={busy} className="rounded border bg-transparent px-2 py-1"><option value="user">user</option><option value="admin">admin</option></select></td><td className="px-4 py-3">{u.active === false ? 'Inactivo' : 'Activo'}</td><td className="px-4 py-3 whitespace-nowrap">{dateValue(u.createdAt)}</td><td className="px-4 py-3 whitespace-nowrap">{dateValue(u.lastAccessAt)}</td><td className="px-4 py-3"><div className="flex gap-1"><button type="button" title="Editar usuario" onClick={() => { setEditUid(u.id); setForm({ nombre: u.nombre || '', apellidos: u.apellidos || '', email: u.email || '', password: '', role: u.role || 'user' }); }} className="p-2 rounded hover:bg-slate-100 dark:hover:bg-slate-800"><Pencil size={16}/></button><button type="button" title="Activar/desactivar" onClick={() => run(() => setManagedUserActive({ uid: u.id, active: u.active === false }))} disabled={busy} className="p-2 rounded hover:bg-slate-100 dark:hover:bg-slate-800">{u.active === false ? <UserCheck size={16}/> : <UserX size={16}/>}</button><button type="button" title="Restablecer contraseña" onClick={() => resetPassword(u.id)} disabled={busy} className="p-2 rounded hover:bg-slate-100 dark:hover:bg-slate-800"><KeyRound size={16}/></button><button type="button" title="Gestionar permisos" onClick={() => {setSelectedUid(u.id);setTab('permissions')}} className="p-2 rounded hover:bg-slate-100 dark:hover:bg-slate-800"><ShieldCheck size={16}/></button><button type="button" title="Eliminar" onClick={() => {if(confirm(`¿Eliminar ${u.email}?`)) run(() => deleteManagedUser({uid:u.id}))}} disabled={busy} className="p-2 rounded text-red-600 hover:bg-red-50"><Trash2 size={16}/></button></div></td></tr>)}
            </tbody></table></div>
          </>}

          {tab === 'permissions' && <div className="space-y-8">
            <section className="space-y-4"><div><label className="text-sm font-medium">Usuario</label><select value={selectedUid} onChange={e=>setSelectedUid(e.target.value)} className="mt-2 w-full rounded-lg border px-3 py-2 bg-transparent"><option value="">Selecciona un usuario</option>{users.map(u=><option key={u.id} value={u.id}>{u.nombre} {u.apellidos} — {u.email}</option>)}</select></div>{selectedUid && <div className="rounded-xl border overflow-hidden"><table className="w-full text-sm"><thead className="bg-slate-50 dark:bg-slate-800/60"><tr><th className="text-left p-3">Módulo</th><th>Ver</th><th>Crear</th><th>Editar</th><th>Eliminar</th></tr></thead><tbody>{Object.entries(moduleLabels).map(([key,label])=>{const module=key as ModuleName;const value=permissions[selectedUid]?.[module]||{read:false,create:false,update:false,delete:false};return <tr key={key} className="border-t"><td className="p-3 font-medium">{label}</td>{(['read','create','update','delete'] as const).map(action=><td key={action} className="text-center"><input type="checkbox" checked={value[action]} disabled={busy} onChange={e=>setPermissions(prev=>({...prev,[selectedUid]:{...(prev[selectedUid]||defaultPermissions()),[module]:{...value,[action]:e.target.checked}}}))}/></td>)}</tr>})}</tbody></table></div>}<button type="button" disabled={!selectedUid||busy} onClick={savePermissions} className="rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900 px-5 py-2.5 font-semibold disabled:opacity-50">Guardar permisos</button></section>
            <section className="rounded-xl border p-5 space-y-4"><div className="flex items-center gap-2"><Share2 size={18}/><div><h3 className="font-semibold">Compartir un registro</h3><p className="text-xs text-slate-500">Concede acceso granular a un usuario sin cambiar el propietario.</p></div></div><div className="grid md:grid-cols-2 gap-3"><input value={share.resourceType} onChange={e=>setShare(s=>({...s,resourceType:e.target.value}))} placeholder="Tipo de recurso" className="rounded-lg border px-3 py-2 bg-transparent"/><input value={share.resourceId} onChange={e=>setShare(s=>({...s,resourceId:e.target.value}))} placeholder="ID del registro" className="rounded-lg border px-3 py-2 bg-transparent"/><select value={share.ownerId} onChange={e=>setShare(s=>({...s,ownerId:e.target.value}))} className="rounded-lg border px-3 py-2 bg-transparent"><option value="">Propietario</option>{users.map(u=><option key={u.id} value={u.id}>{u.email}</option>)}</select><select value={share.userId} onChange={e=>setShare(s=>({...s,userId:e.target.value}))} className="rounded-lg border px-3 py-2 bg-transparent"><option value="">Usuario destinatario</option>{users.map(u=><option key={u.id} value={u.id}>{u.email}</option>)}</select></div><div className="flex flex-wrap gap-5 text-sm"><label><input type="checkbox" checked={share.canRead} onChange={e=>setShare(s=>({...s,canRead:e.target.checked}))}/> Ver</label><label><input type="checkbox" checked={share.canUpdate} onChange={e=>setShare(s=>({...s,canUpdate:e.target.checked}))}/> Editar</label><label><input type="checkbox" checked={share.canDelete} onChange={e=>setShare(s=>({...s,canDelete:e.target.checked}))}/> Eliminar</label></div><button type="button" disabled={busy} onClick={saveShare} className="rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900 px-5 py-2.5 font-semibold disabled:opacity-50">Guardar compartición</button></section>
          </div>}

          {tab === 'audit' && <div><div className="flex justify-between mb-4"><h3 className="font-semibold">Registro de auditoría</h3><button type="button" onClick={()=>loadAudit()} className="p-2 rounded-lg border"><RefreshCw size={17}/></button></div><div className="space-y-2">{auditLogs.map(log=><div key={log.id} className="rounded-lg border p-3 text-sm"><div className="flex justify-between gap-4"><strong>{log.action}</strong><span className="text-slate-500">{dateValue(log.timestamp)}</span></div><div className="text-slate-600 dark:text-slate-300">{log.resourceType} / {log.resourceId} · {log.userEmail || log.userId}</div>{log.details && <pre className="mt-2 whitespace-pre-wrap text-xs text-slate-500">{JSON.stringify(log.details)}</pre>}</div>)}</div></div>}
        </div>
        {busy && <div className="absolute bottom-6 right-6 rounded-full bg-slate-900 text-white px-4 py-2 flex items-center gap-2 text-sm"><Loader2 size={16} className="animate-spin"/> Procesando…</div>}
      </div>

      {(createOpen || editUid) && <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4"><form onSubmit={editUid ? saveEdit : createUser} className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-4"><div className="flex justify-between"><h3 className="text-lg font-bold">{editUid ? 'Editar usuario' : 'Crear usuario'}</h3><button type="button" onClick={()=>{setCreateOpen(false);setEditUid('')}}><X size={18}/></button></div>{[['nombre','Nombre'],['apellidos','Apellidos'],['email','Email']].map(([key,label])=><div key={key}><label className="text-sm font-medium">{label}</label><input required={key!=='apellidos'} type={key==='email'?'email':'text'} value={(form as any)[key]} onChange={e=>setForm(prev=>({...prev,[key]:e.target.value}))} className="mt-1 w-full rounded-lg border px-3 py-2 bg-transparent"/></div>)}{!editUid && <><div><label className="text-sm font-medium">Contraseña temporal</label><input required minLength={6} type="password" value={form.password} onChange={e=>setForm(prev=>({...prev,password:e.target.value}))} className="mt-1 w-full rounded-lg border px-3 py-2 bg-transparent"/></div><div><label className="text-sm font-medium">Rol</label><select value={form.role} onChange={e=>setForm(prev=>({...prev,role:e.target.value as Role}))} className="mt-1 w-full rounded-lg border px-3 py-2 bg-transparent"><option value="user">user</option><option value="admin">admin</option></select></div></>}<button disabled={busy} className="w-full rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900 py-2.5 font-semibold disabled:opacity-50">{editUid ? 'Guardar cambios' : 'Crear usuario'}</button></form></div>}
    </div>
  );
}
