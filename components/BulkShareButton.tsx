import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Share2, Users, X, Loader2, Eye, Pencil, Search, CheckCircle2 } from 'lucide-react';
import { getSessionUser, supabase } from '../src/lib/supabase';
import { listShareableProfiles } from '../src/lib/functions';
import { showAppToast } from '../src/lib/appToast';

type Access = 'read' | 'read_write';
type Profile = { id: string; email: string; nombre?: string; apellidos?: string };
type Props = { resourceType: string; resourceIds: Array<string | number>; label?: string; className?: string };

const tableForResource = (resourceType: string) => resourceType === 'obra' ? 'obras' : resourceType;
const chunks = <T,>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));

export const BulkShareButton: React.FC<Props> = ({ resourceType, resourceIds, label = 'Compartir seleccionados', className = '' }) => {
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [access, setAccess] = useState<Access>('read');
  const [currentUserId, setCurrentUserId] = useState('');

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError('');
    setSearch('');
    setSelectedUsers([]);
    setAccess('read');

    Promise.all([listShareableProfiles(), getSessionUser()])
      .then(async ([profiles, sessionUser]) => {
        if (!active) return;
        const userId = sessionUser?.id || '';
        setUsers(profiles || []);
        setCurrentUserId(userId);
      })
      .catch((e: any) => {
        const message = e?.message || 'No se pudieron cargar los usuarios.';
        setError(message);
        showAppToast(message, 'error');
      })
      .finally(() => active && setLoading(false));

    return () => { active = false; };
  }, [open]);

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    return users.filter(user => !term || `${user.nombre || ''} ${user.apellidos || ''} ${user.email || ''}`.toLowerCase().includes(term));
  }, [users, search]);

  const allVisibleSelected = filteredUsers.length > 0 && filteredUsers.every(user => selectedUsers.includes(user.id));
  const toggleUser = (userId: string) => setSelectedUsers(previous => previous.includes(userId) ? previous.filter(id => id !== userId) : [...previous, userId]);
  const toggleAllVisible = () => setSelectedUsers(previous => {
    const visibleIds = filteredUsers.map(user => user.id);
    return allVisibleSelected
      ? previous.filter(id => !visibleIds.includes(id))
      : Array.from(new Set([...previous, ...visibleIds]));
  });

  const loadOwners = async () => {
    const table = tableForResource(resourceType);
    if (resourceType === 'trabajadores') {
      const rows: any[] = [];
      for (const group of chunks(resourceIds, 150)) {
        const numeric = group.map(id => Number(id)).filter(Number.isFinite);
        if (!numeric.length) continue;
        const part = await supabase.query(table, { query: `select=id,owner_id&id=in.(${numeric.join(',')})` });
        rows.push(...(part || []));
      }
      const byId = new Map(rows.map(row => [String(row.id), row.owner_id]));
      return resourceIds.map(resourceId => ({ resourceId, ownerId: byId.get(String(resourceId)) || '' }));
    }

    return Promise.all(resourceIds.map(async resourceId => {
      const rows = await supabase.query(table, { query: `select=id,owner_id&id=eq.${encodeURIComponent(String(resourceId))}&limit=1` });
      return { resourceId, ownerId: rows?.[0]?.owner_id || '' };
    }));
  };

  const apply = async () => {
    if (selectedUsers.length === 0 || resourceIds.length === 0) return;
    setBusy(true);
    setError('');
    try {
      const owners = await loadOwners();
      const invalid = owners.filter(item => !item.ownerId);
      if (invalid.length) throw new Error(`No se pudo identificar el propietario de ${invalid.length} registro(s) seleccionado(s).`);

      const shareable = owners.filter(item => item.ownerId === currentUserId);
      const skipped = owners.length - shareable.length;
      if (shareable.length === 0) throw new Error('Los registros seleccionados no son tuyos. Solo el propietario puede compartirlos.');

      const body = shareable.flatMap(({ resourceId, ownerId }) => selectedUsers.map(userId => ({
        resource_type: resourceType,
        resource_id: String(resourceId),
        owner_id: ownerId,
        user_id: userId,
        can_read: true,
        can_update: access === 'read_write',
        can_delete: false,
      })));

      for (const group of chunks(body, 500)) {
        await supabase.query('data_permissions', {
          method: 'POST',
          prefer: 'resolution=merge-duplicates,return=minimal',
          query: 'on_conflict=resource_type,resource_id,user_id',
          body: group,
        });
      }

      const skippedText = skipped > 0 ? ` ${skipped} registro(s) compartido(s) contigo por otra persona se han omitido.` : '';
      showAppToast(`${shareable.length} registro${shareable.length === 1 ? '' : 's'} compartido${shareable.length === 1 ? '' : 's'} con ${selectedUsers.length} usuario${selectedUsers.length === 1 ? '' : 's'}.${skippedText}`, 'success');
      setOpen(false);
    } catch (e: any) {
      const message = e?.message || 'No se pudieron compartir todos los registros seleccionados.';
      setError(message);
      showAppToast(message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (resourceIds.length === 0) return null;

  const modal = open && typeof document !== 'undefined' ? createPortal(
    <div className="profea-modal-overlay fixed inset-0 flex items-center justify-center bg-slate-900/45 dark:bg-slate-950/65 backdrop-blur-sm" onClick={() => !busy && setOpen(false)}>
      <div className="w-full max-w-xl max-h-full flex flex-col overflow-hidden rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl" onClick={event => event.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300"><Users size={19} /></div>
            <div>
              <h3 className="font-bold">Compartir {resourceIds.length} registros</h3>
              <p className="text-xs text-slate-500">Solo se compartirán los registros de los que seas propietario.</p>
            </div>
          </div>
          <button type="button" disabled={busy} onClick={() => setOpen(false)} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{error}</div>}
          <label className="relative block">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar usuario por nombre o email…" className="w-full rounded-xl border border-slate-200 dark:border-slate-700 pl-9 pr-3 py-2.5 text-sm bg-transparent" />
          </label>

          {loading ? (
            <div className="py-8 flex justify-center gap-2 text-sm text-slate-500"><Loader2 size={18} className="animate-spin" />Cargando usuarios…</div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 text-xs">
                <button type="button" onClick={toggleAllVisible} className="font-semibold text-blue-700 dark:text-blue-300 hover:underline">{allVisibleSelected ? 'Desmarcar visibles' : 'Seleccionar todos los visibles'}</button>
                <span className="text-slate-500">{selectedUsers.length} seleccionado{selectedUsers.length === 1 ? '' : 's'}</span>
              </div>
              <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-200 dark:divide-slate-700">
                {filteredUsers.map(user => {
                  const name = [user.nombre, user.apellidos].filter(Boolean).join(' ').trim() || user.email;
                  return (
                    <label key={user.id} className="flex items-center gap-3 px-4 py-3 cursor-pointer">
                      <input type="checkbox" checked={selectedUsers.includes(user.id)} onChange={() => toggleUser(user.id)} />
                      <span className="min-w-0"><span className="block text-sm font-semibold truncate">{name}</span><span className="block text-xs text-slate-500 truncate">{user.email}</span></span>
                    </label>
                  );
                })}
                {!filteredUsers.length && <div className="p-6 text-center text-sm text-slate-500">No hay usuarios que coincidan con la búsqueda.</div>}
              </div>
            </>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setAccess('read')} className={`rounded-xl border px-3 py-3 text-sm font-semibold flex items-center justify-center gap-2 ${access === 'read' ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-200 dark:border-slate-700'}`}><Eye size={16} />Lectura</button>
            <button type="button" onClick={() => setAccess('read_write')} className={`rounded-xl border px-3 py-3 text-sm font-semibold flex items-center justify-center gap-2 ${access === 'read_write' ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-200 dark:border-slate-700'}`}><Pencil size={16} />Lectura + escritura</button>
          </div>

          <button type="button" disabled={selectedUsers.length === 0 || busy} onClick={apply} className="w-full rounded-xl bg-brand-primary text-white px-4 py-3 font-semibold disabled:opacity-50 flex items-center justify-center gap-2">
            {busy ? <Loader2 size={17} className="animate-spin" /> : <CheckCircle2 size={17} />}Aplicar a {resourceIds.length} registro{resourceIds.length === 1 ? '' : 's'} y {selectedUsers.length} usuario{selectedUsers.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`flex items-center justify-center bg-violet-50 hover:bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 px-3 py-1.5 rounded-lg text-xs font-bold border border-violet-200 dark:border-violet-800/80 ${className}`}>
        <Share2 className="w-3.5 h-3.5 mr-1.5" />{label}
      </button>
      {modal}
    </>
  );
};
