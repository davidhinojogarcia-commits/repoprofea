import React, { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, getDocs, orderBy, query } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { auth, db } from '../src/lib/firebase';
import { Loader2, ShieldCheck, Users, X, RefreshCw, Trash2, UserX, UserCheck, KeyRound } from 'lucide-react';

type Role = 'admin' | 'user';
type ModuleName = 'contratacion' | 'trabajadores' | 'obras' | 'reconocimientos' | 'subcontratas' | 'citas';
type PermissionSet = Record<'read' | 'create' | 'update' | 'delete', boolean>;
type Modules = Record<ModuleName, PermissionSet>;

const moduleLabels: Record<ModuleName, string> = {
  contratacion: 'Contratación', trabajadores: 'Trabajadores', obras: 'Obras', reconocimientos: 'Reconocimientos', subcontratas: 'Subcontratas', citas: 'Citas'
};
const defaultPermissions = (): Modules => Object.fromEntries(Object.keys(moduleLabels).map(key => [key, { read: true, create: true, update: true, delete: true }])) as Modules;

interface AdminPanelProps { onClose: () => void; }

export function AdminPanel({ onClose }: AdminPanelProps) {
  const [tab, setTab] = useState<'users' | 'permissions' | 'audit'>('users');
  const [users, setUsers] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [permissions, setPermissions] = useState<Record<string, Modules>>({});
  const [selectedUid, setSelectedUid] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ nombre: '', apellidos: '', email: '', password: '', role: 'user' as Role });

  const functions = useMemo(() => getFunctions(), []);
  const call = <T, R>(name: string) => httpsCallable<T, R>(functions, name);

  const load = async () => {
    setError('');
    const [userSnap, permSnap] = await Promise.all([
      getDocs(collection(db, 'users')),
      getDocs(collection(db, 'userPermissions')),
    ]);
    setUsers(userSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    setPermissions(Object.fromEntries(permSnap.docs.map(d => [d.id, (d.data().modules || defaultPermissions()) as Modules])));
  };

  const loadAudit = async () => {
    const snapshot = await getDocs(query(collection(db, 'auditLogs'), orderBy('timestamp', 'desc')));
    setAuditLogs(snapshot.docs.slice(0, 200).map(d => ({ id: d.id, ...d.data() })));
  };

  useEffect(() => { load().catch(e => setError(e?.message || 'No se pudieron cargar los usuarios.')); }, []);
  useEffect(() => { if (tab === 'audit') loadAudit().catch(e => setError(e?.message || 'No se pudo cargar la auditoría.')); }, [tab]);

  const createUser = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await call<typeof form, unknown>('createManagedUser')(form);
      setCreateOpen(false); setForm({ nombre: '', apellidos: '', email: '', password: '', role: 'user' });
      await load();
    } catch (e: any) { setError(e?.message || 'No se pudo crear el usuario.'); } finally { setBusy(false); }
  };

  const invoke = async (name: string, data: any) => {
    setBusy(true); setError('');
    try { await call<any, unknown>(name)(data); await load(); }
    catch (e: any) { setError(e?.message || 'La operación no se pudo completar.'); }
    finally { setBusy(false); }
  };

  const resetPassword = async (uid: string) => {
    setBusy(true); setError('');
    try {
      const result = await call<{ uid: string }, { email?: string; resetLink: string }>('sendManagedPasswordReset')({ uid });
      window.prompt('Enlace de restablecimiento (cópialo y envíalo al usuario):', result.data.resetLink);
      await loadAudit();
    } catch (e: any) { setError(e?.message || 'No se pudo generar el enlace.'); } finally { setBusy(false); }
  };

  const savePermissions = async () => {
    if (!selectedUid) return;
    await invoke('updateManagedPermissions', { uid: selectedUid, modules: permissions[selectedUid] || defaultPermissions() });
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-6xl max-h-[92vh] overflow-hidden rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col">
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3"><ShieldCheck className="text-slate-700 dark:text-slate-200" /><div><h2 className="text-xl font-bold">Administración</h2><p className="text-xs text-slate-500">Usuarios, permisos y auditoría</p></div></div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"><X /></button>
        </header>

        <nav className="flex gap-2 px-6 pt-4">
          {([['users','Usuarios'],['permissions','Permisos'],['audit','Auditoría']] as const).map(([key,label]) => <button key={key} onClick={() => setTab(key)} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === key ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}>{label}</button>)}
        </nav>

        <div className="flex-1 overflow-auto p-6">
          {error && <div role="alert" className="mb-4 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</div>}

          {tab === 'users' && <>
            <div className="flex justify-between items-center mb-4"><h3 className="font-semibold flex items-center gap-2"><Users size={18}/> Usuarios</h3><div className="flex gap-2"><button onClick={() => load()} className="p-2 rounded-lg border"><RefreshCw size={17}/></button><button onClick={() => setCreateOpen(true)} className="rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900 px-4 py-2 text-sm font-semibold">Crear usuario</button></div></div>
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800"><table className="w-full text-sm"><thead className="bg-slate-50 dark:bg-slate-800/60"><tr>{['Nombre','Email','Rol','Estado','Creación','Acciones'].map(x => <th key={x} className="text-left px-4 py-3 font-semibold">{x}</th>)}</tr></thead><tbody>
              {users.map(u => <tr key={u.id} className="border-t border-slate-200 dark:border-slate-800"><td className="px-4 py-3">{u.nombre} {u.apellidos}</td><td className="px-4 py-3">{u.email}</td><td className="px-4 py-3"><select value={u.role || 'user'} onChange={e => invoke('setManagedUserRole',{uid:u.id,role:e.target.value})} className="rounded border bg-transparent px-2 py-1"><option value="user">user</option><option value="admin">admin</option></select></td><td className="px-4 py-3">{u.active === false ? 'Inactivo' : 'Activo'}</td><td className="px-4 py-3">{u.createdAt?.toDate ? u.createdAt.toDate().toLocaleString('es-ES') : '—'}</td><td className="px-4 py-3"><div className="flex gap-1"><button title="Activar/desactivar" onClick={() => invoke('setManagedUserActive',{uid:u.id,active:u.active === false})} className="p-2 rounded hover:bg-slate-100 dark:hover:bg-slate-800">{u.active === false ? <UserCheck size={16}/> : <UserX size={16}/>}</button><button title="Restablecer contraseña" onClick={() => resetPassword(u.id)} className="p-2 rounded hover:bg-slate-100 dark:hover:bg-slate-800"><KeyRound size={16}/></button><button title="Gestionar permisos" onClick={() => {setSelectedUid(u.id);setTab('permissions')}} className="p-2 rounded hover:bg-slate-100 dark:hover:bg-slate-800"><ShieldCheck size={16}/></button><button title="Eliminar" onClick={() => {if(confirm(`¿Eliminar ${u.email}?`)) invoke('deleteManagedUser',{uid:u.id})}} className="p-2 rounded text-red-600 hover:bg-red-50"><Trash2 size={16}/></button></div></td></tr>)}
            </tbody></table></div>
          </>}

          {tab === 'permissions' && <div className="space-y-5"><div><label className="text-sm font-medium">Usuario</label><select value={selectedUid} onChange={e=>setSelectedUid(e.target.value)} className="mt-2 w-full rounded-lg border px-3 py-2 bg-transparent"><option value="">Selecciona un usuario</option>{users.map(u=><option key={u.id} value={u.id}>{u.nombre} {u.apellidos} — {u.email}</option>)}</select></div>{selectedUid && <div className="rounded-xl border overflow-hidden"><table className="w-full text-sm"><thead className="bg-slate-50 dark:bg-slate-800/60"><tr><th className="text-left p-3">Módulo</th><th>Ver</th><th>Crear</th><th>Editar</th><th>Eliminar</th></tr></thead><tbody>{Object.entries(moduleLabels).map(([key,label])=>{const module=key as ModuleName;const value=permissions[selectedUid]?.[module]||{read:false,create:false,update:false,delete:false};return <tr key={key} className="border-t"><td className="p-3 font-medium">{label}</td>{(['read','create','update','delete'] as const).map(action=><td key={action} className="text-center"><input type="checkbox" checked={value[action]} onChange={e=>setPermissions(prev=>({...prev,[selectedUid]:{...(prev[selectedUid]||defaultPermissions()),[module]:{...value,[action]:e.target.checked}}}))}/></td>)}</tr>})}</tbody></table></div>}<button disabled={!selectedUid||busy} onClick={savePermissions} className="rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900 px-5 py-2.5 font-semibold disabled:opacity-50">Guardar permisos</button></div>}

          {tab === 'audit' && <div><div className="flex justify-between mb-4"><h3 className="font-semibold">Registro de auditoría</h3><button onClick={()=>loadAudit()} className="p-2 rounded-lg border"><RefreshCw size={17}/></button></div><div className="space-y-2">{auditLogs.map(log=><div key={log.id} className="rounded-lg border p-3 text-sm"><div className="flex justify-between gap-4"><strong>{log.action}</strong><span className="text-slate-500">{log.timestamp?.toDate ? log.timestamp.toDate().toLocaleString('es-ES') : '—'}</span></div><div className="text-slate-600 dark:text-slate-300">{log.resourceType} / {log.resourceId} · {log.userEmail || log.userId}</div></div>)}</div></div>}
        </div>

        {busy && <div className="absolute bottom-6 right-6 rounded-full bg-slate-900 text-white px-4 py-2 flex items-center gap-2 text-sm"><Loader2 size={16} className="animate-spin"/> Procesando…</div>}
      </div>

      {createOpen && <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4"><form onSubmit={createUser} className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-4"><div className="flex justify-between"><h3 className="text-lg font-bold">Crear usuario</h3><button type="button" onClick={()=>setCreateOpen(false)}><X size={18}/></button></div>{[['nombre','Nombre'],['apellidos','Apellidos'],['email','Email'],['password','Contraseña temporal']].map(([key,label])=><div key={key}><label className="text-sm font-medium">{label}</label><input required={key!=='apellidos'} type={key==='password'?'password':key==='email'?'email':'text'} minLength={key==='password'?6:undefined} value={(form as any)[key]} onChange={e=>setForm(prev=>({...prev,[key]:e.target.value}))} className="mt-1 w-full rounded-lg border px-3 py-2 bg-transparent"/></div>)}<div><label className="text-sm font-medium">Rol</label><select value={form.role} onChange={e=>setForm(prev=>({...prev,role:e.target.value as Role}))} className="mt-1 w-full rounded-lg border px-3 py-2 bg-transparent"><option value="user">user</option><option value="admin">admin</option></select></div><button disabled={busy} className="w-full rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900 py-2.5 font-semibold disabled:opacity-50">Crear usuario</button></form></div>}
    </div>
  );
}
