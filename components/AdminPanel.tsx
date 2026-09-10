import React, { useEffect, useMemo, useState } from 'react';
import { initializeApp, getApps } from 'firebase/app';
import { createUserWithEmailAndPassword, getAuth, sendPasswordResetEmail } from 'firebase/auth';
import { collection, deleteDoc, doc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { db } from '../src/lib/firebase';

type Role = 'admin' | 'user';
type UserRow = {
  uid: string;
  email: string;
  displayName: string;
  role: Role;
  active: boolean;
  permissions: Record<string, boolean>;
};

const MODULES = ['dashboard', 'trabajadores', 'citas', 'calendario', 'subcontratas', 'papelera', 'configuracion'];

const secondaryAuth = () => {
  const name = 'admin-user-creator';
  const app = getApps().find(a => a.name === name) || initializeApp(firebaseConfig, name);
  return getAuth(app);
};

export const AdminPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const snap = await getDocs(collection(db, 'users'));
      setUsers(snap.docs.map(d => ({ uid: d.id, ...(d.data() as any) })) as UserRow[]);
    } catch (e: any) {
      setError(e?.message || 'No se han podido cargar los usuarios.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const createUser = async () => {
    setBusy(true);
    setError('');
    try {
      const credential = await createUserWithEmailAndPassword(secondaryAuth(), email.trim(), password);
      const permissions = Object.fromEntries(MODULES.map(m => [m, true]));
      await setDoc(doc(db, 'users', credential.user.uid), {
        uid: credential.user.uid,
        email: email.trim().toLowerCase(),
        displayName: name.trim() || email.trim().split('@')[0],
        role: 'user',
        active: true,
        permissions,
        createdAt: new Date().toISOString(),
      });
      setEmail(''); setPassword(''); setName('');
      await load();
    } catch (e: any) {
      setError(e?.message || 'No se ha podido crear el usuario.');
    } finally {
      setBusy(false);
    }
  };

  const patchUser = async (user: UserRow, patch: Partial<UserRow>) => {
    setError('');
    try {
      await updateDoc(doc(db, 'users', user.uid), patch as any);
      await load();
    } catch (e: any) {
      setError(e?.message || 'No se ha podido actualizar el usuario.');
    }
  };

  const removeUser = async (user: UserRow) => {
    if (!confirm(`¿Eliminar el perfil de ${user.email}?`)) return;
    try {
      await deleteDoc(doc(db, 'users', user.uid));
      await load();
    } catch (e: any) {
      setError(e?.message || 'No se ha podido eliminar el perfil.');
    }
  };

  const reset = async (user: UserRow) => {
    try {
      await sendPasswordResetEmail(secondaryAuth(), user.email);
      alert(`Se ha enviado un correo de restablecimiento a ${user.email}.`);
    } catch (e: any) {
      setError(e?.message || 'No se ha podido enviar el restablecimiento.');
    }
  };

  const orderedUsers = useMemo(() => [...users].sort((a, b) => a.email.localeCompare(b.email)), [users]);

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 p-4 md:p-8 overflow-auto">
      <div className="max-w-6xl mx-auto bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 p-6 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div><h2 className="text-2xl font-bold">Administración de usuarios</h2><p className="text-sm text-slate-500">Roles, activación, permisos por módulo y recuperación de contraseña.</p></div>
          <button onClick={onClose} className="rounded-xl border px-4 py-2">Cerrar</button>
        </div>
        {error && <div className="rounded-xl bg-red-50 text-red-700 p-3 text-sm">{error}</div>}
        <div className="grid md:grid-cols-4 gap-3 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800">
          <input className="rounded-xl border p-2 bg-transparent" placeholder="Nombre" value={name} onChange={e => setName(e.target.value)} />
          <input className="rounded-xl border p-2 bg-transparent" placeholder="Correo" type="email" value={email} onChange={e => setEmail(e.target.value)} />
          <input className="rounded-xl border p-2 bg-transparent" placeholder="Contraseña inicial" type="password" value={password} onChange={e => setPassword(e.target.value)} />
          <button disabled={busy || !email || password.length < 6} onClick={createUser} className="rounded-xl bg-blue-700 text-white px-4 disabled:opacity-50">Crear usuario</button>
        </div>
        {loading ? <p>Cargando usuarios…</p> : <div className="space-y-3">
          {orderedUsers.map(user => (
            <div key={user.uid} className="rounded-2xl border p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><div className="font-semibold">{user.displayName || user.email}</div><div className="text-sm text-slate-500">{user.email}</div></div>
                <div className="flex gap-2">
                  <select value={user.role} onChange={e => patchUser(user, { role: e.target.value as Role })} className="rounded-lg border p-2 bg-transparent"><option value="user">user</option><option value="admin">admin</option></select>
                  <button onClick={() => patchUser(user, { active: !user.active })} className="rounded-lg border px-3 py-2">{user.active ? 'Desactivar' : 'Activar'}</button>
                  <button onClick={() => reset(user)} className="rounded-lg border px-3 py-2">Restablecer</button>
                  <button onClick={() => removeUser(user)} className="rounded-lg border px-3 py-2 text-red-600">Eliminar</button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {MODULES.map(module => {
                  const enabled = user.permissions?.[module] === true;
                  return <label key={module} className="text-xs rounded-lg border px-2 py-1 flex items-center gap-1"><input type="checkbox" checked={enabled} onChange={e => patchUser(user, { permissions: { ...(user.permissions || {}), [module]: e.target.checked } })} />{module}</label>;
                })}
              </div>
            </div>
          ))}
          {orderedUsers.length === 0 && <p className="text-sm text-slate-500">No hay perfiles todavía.</p>}
        </div>}
      </div>
    </div>
  );
};