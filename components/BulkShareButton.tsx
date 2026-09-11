import React,{useEffect,useMemo,useState} from 'react';
import {createPortal} from 'react-dom';
import {Share2,Users,X,Loader2,Eye,Pencil,Search,CheckCircle2} from 'lucide-react';
import {supabase} from '../src/lib/supabase';
import {setDataPermission} from '../src/lib/functions';

type Access='read'|'read_write';
type Profile={id:string;email:string;nombre?:string;apellidos?:string;role?:string;active?:boolean};

type Props={
  resourceType:string;
  resourceIds:Array<string|number>;
  label?:string;
  className?:string;
};

const tableForResource=(resourceType:string)=>resourceType==='obra'?'obras':resourceType;

export const BulkShareButton:React.FC<Props>=({resourceType,resourceIds,label='Compartir seleccionados',className=''})=>{
  const [open,setOpen]=useState(false);
  const [users,setUsers]=useState<Profile[]>([]);
  const [loading,setLoading]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [search,setSearch]=useState('');
  const [selectedUser,setSelectedUser]=useState('');
  const [access,setAccess]=useState<Access>('read');

  useEffect(()=>{
    if(!open)return;
    setLoading(true);setError('');setSearch('');setSelectedUser('');setAccess('read');
    supabase.query('profiles',{query:'select=id,email,nombre,apellidos,role,active&active=eq.true&role=eq.user&order=nombre.asc,apellidos.asc,email.asc'})
      .then(rows=>setUsers(rows||[]))
      .catch((e:any)=>setError(e?.message||'No se pudieron cargar los usuarios.'))
      .finally(()=>setLoading(false));
  },[open]);

  const filteredUsers=useMemo(()=>{
    const term=search.trim().toLowerCase();
    if(!term)return users;
    return users.filter(user=>`${user.nombre||''} ${user.apellidos||''} ${user.email||''}`.toLowerCase().includes(term));
  },[users,search]);

  const apply=async()=>{
    if(!selectedUser||resourceIds.length===0)return;
    setBusy(true);setError('');
    try{
      const table=tableForResource(resourceType);
      const owners=await Promise.all(resourceIds.map(async resourceId=>{
        const rows=await supabase.query(table,{query:`select=id,owner_id&id=eq.${encodeURIComponent(String(resourceId))}&limit=1`});
        const ownerId=rows?.[0]?.owner_id;
        if(!ownerId)throw new Error('No se pudo identificar el propietario de uno de los registros seleccionados.');
        return {resourceId,ownerId};
      }));
      await Promise.all(owners.map(({resourceId,ownerId})=>setDataPermission({
        resourceType,
        resourceId,
        ownerId,
        userId:selectedUser,
        canRead:true,
        canUpdate:access==='read_write',
        canDelete:false,
      })));
      setOpen(false);
    }catch(e:any){setError(e?.message||'No se pudieron compartir todos los registros seleccionados.');}
    finally{setBusy(false);}
  };

  if(resourceIds.length===0)return null;

  const modal=open&&typeof document!=='undefined'?createPortal(
    <div className="profea-modal-overlay fixed inset-0 flex items-center justify-center bg-slate-900/45 dark:bg-slate-950/65 backdrop-blur-sm" onClick={()=>!busy&&setOpen(false)}>
      <div className="w-full max-w-xl max-h-full flex flex-col overflow-hidden rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3"><div className="p-2 rounded-xl bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300"><Users size={19}/></div><div><h3 className="font-bold">Compartir {resourceIds.length} registros</h3><p className="text-xs text-slate-500">Elige usuario y nivel de acceso</p></div></div>
          <button type="button" disabled={busy} onClick={()=>setOpen(false)} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"><X size={18}/></button>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto">
          {error&&<div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</div>}
          <label className="relative block"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar usuario por nombre o email…" className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent pl-9 pr-3 py-2.5 text-sm"/></label>
          {loading?<div className="py-8 flex justify-center gap-2 text-sm text-slate-500"><Loader2 size={18} className="animate-spin"/>Cargando usuarios…</div>:<div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
            {filteredUsers.map(user=>{const name=[user.nombre,user.apellidos].filter(Boolean).join(' ').trim()||user.email;return <label key={user.id} className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60"><input type="radio" name="bulk-share-user" checked={selectedUser===user.id} onChange={()=>setSelectedUser(user.id)}/><span className="min-w-0"><span className="block text-sm font-semibold truncate">{name}</span><span className="block text-xs text-slate-500 truncate">{user.email}</span></span></label>})}
            {!filteredUsers.length&&<div className="p-6 text-center text-sm text-slate-500">No hay usuarios que coincidan con la búsqueda.</div>}
          </div>}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={()=>setAccess('read')} className={`rounded-xl border px-3 py-3 text-sm font-semibold flex items-center justify-center gap-2 ${access==='read'?'bg-blue-600 text-white border-blue-600':'border-slate-200 dark:border-slate-700'}`}><Eye size={16}/>Lectura</button>
            <button type="button" onClick={()=>setAccess('read_write')} className={`rounded-xl border px-3 py-3 text-sm font-semibold flex items-center justify-center gap-2 ${access==='read_write'?'bg-blue-600 text-white border-blue-600':'border-slate-200 dark:border-slate-700'}`}><Pencil size={16}/>Lectura + escritura</button>
          </div>
          <button type="button" disabled={!selectedUser||busy} onClick={apply} className="w-full rounded-xl bg-brand-primary text-white px-4 py-3 font-semibold disabled:opacity-50 flex items-center justify-center gap-2">{busy?<Loader2 size={17} className="animate-spin"/>:<CheckCircle2 size={17}/>}Aplicar a {resourceIds.length} registros</button>
        </div>
      </div>
    </div>,document.body):null;

  return <>
    <button type="button" onClick={()=>setOpen(true)} className={`flex items-center justify-center bg-violet-50 hover:bg-violet-100 dark:bg-violet-950/40 dark:hover:bg-violet-900/50 text-violet-700 dark:text-violet-300 px-3 py-1.5 rounded-lg transition-colors text-xs font-bold shadow-sm border border-violet-200 dark:border-violet-800/80 ${className}`}>
      <Share2 className="w-3.5 h-3.5 mr-1.5"/>{label}
    </button>
    {modal}
  </>;
};
