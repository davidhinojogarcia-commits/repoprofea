import React,{useEffect,useMemo,useState} from 'react';
import {createPortal} from 'react-dom';
import {Share2,Users,X,Loader2,UserMinus,CheckCircle2,Eye,Pencil,Search} from 'lucide-react';
import {supabase} from '../src/lib/supabase';
import {getRecordShares,shareRecordWithUser,unshareRecordWithUser} from '../src/lib/functions';

type Props={
  resourceType:'trabajadores'|'contrataciones'|'reconocimientos'|'citas'|'subcontratas'|'obra'|string;
  resourceId:string|number;
  ownerId?:string;
  label?:string;
  compact?:boolean;
  className?:string;
  onClick?:React.MouseEventHandler<HTMLButtonElement>;
};

type Profile={id:string;email:string;nombre?:string;apellidos?:string;role?:string;active?:boolean};
type ShareRow={id:string;user_id:string;can_read:boolean;can_update:boolean;can_delete:boolean};
type ShareAccess='read'|'read_write';

const tableForResource=(resourceType:string)=>resourceType==='obra'?'obras':resourceType;
const resourceLabel=(resourceType:string)=>({
  trabajadores:'trabajador',
  contrataciones:'contratación',
  reconocimientos:'reconocimiento médico',
  citas:'cita',
  subcontratas:'subcontrata',
  obra:'obra',
}[resourceType]||'registro');

let adminStatusPromise:Promise<boolean>|null=null;
const getAdminStatus=()=>{
  if(adminStatusPromise)return adminStatusPromise;
  adminStatusPromise=(async()=>{
    try{
      const authUser=(await supabase.auth.getUser()).data.user;
      if(!authUser)return false;
      const rows=await supabase.query('profiles',{query:`select=role,active&id=eq.${encodeURIComponent(authUser.id)}&limit=1`});
      return rows?.[0]?.active===true&&rows?.[0]?.role==='admin';
    }catch{return false;}
  })();
  return adminStatusPromise;
};

export const ShareRecordButton:React.FC<Props>=({resourceType,resourceId,ownerId:providedOwnerId,label='Compartir',compact=false,className='',onClick})=>{
  const [isAdmin,setIsAdmin]=useState(false);
  const [open,setOpen]=useState(false);
  const [loading,setLoading]=useState(false);
  const [busyUser,setBusyUser]=useState('');
  const [users,setUsers]=useState<Profile[]>([]);
  const [shares,setShares]=useState<ShareRow[]>([]);
  const [ownerId,setOwnerId]=useState(providedOwnerId||'');
  const [error,setError]=useState('');
  const [userSearch,setUserSearch]=useState('');

  useEffect(()=>{
    let active=true;
    getAdminStatus().then(value=>{if(active)setIsAdmin(value);});
    return()=>{active=false;};
  },[]);
  useEffect(()=>{if(providedOwnerId)setOwnerId(providedOwnerId);},[providedOwnerId]);

  const shareByUser=useMemo(()=>new Map(shares.map(s=>[s.user_id,s])),[shares]);
  const filteredUsers=useMemo(()=>{
    const term=userSearch.trim().toLowerCase();
    if(!term)return users;
    return users.filter(user=>`${user.nombre||''} ${user.apellidos||''} ${user.email||''}`.toLowerCase().includes(term));
  },[users,userSearch]);

  const load=async()=>{
    setLoading(true);setError('');
    try{
      const ownerPromise=providedOwnerId
        ? Promise.resolve([{owner_id:providedOwnerId}])
        : supabase.query(tableForResource(resourceType),{query:`select=owner_id&id=eq.${encodeURIComponent(String(resourceId))}&limit=1`});
      const [profiles,permissionRows,ownerRows]=await Promise.all([
        supabase.query('profiles',{query:'select=id,email,nombre,apellidos,role,active&active=eq.true&role=eq.user&order=nombre.asc,apellidos.asc,email.asc'}),
        getRecordShares(resourceType,resourceId),
        ownerPromise,
      ]);
      setUsers(profiles||[]);
      setShares(permissionRows||[]);
      const owner=ownerRows?.[0]?.owner_id||providedOwnerId||'';
      setOwnerId(owner);
      if(!owner)throw new Error('No se ha podido identificar el propietario de este registro.');
    }catch(e:any){setError(e?.message||'No se pudo cargar la compartición del registro.');}
    finally{setLoading(false);}
  };

  const openModal=async(e:React.MouseEvent<HTMLButtonElement>)=>{
    e.stopPropagation();
    onClick?.(e);
    setUserSearch('');
    setOpen(true);
    await load();
  };

  const setAccess=async(userId:string,access:ShareAccess)=>{
    if(!ownerId)return;
    setBusyUser(userId);setError('');
    try{
      await shareRecordWithUser({resourceType,resourceId,ownerId,userId,access});
      setShares(await getRecordShares(resourceType,resourceId));
    }catch(e:any){setError(e?.message||'No se pudo actualizar la compartición.');}
    finally{setBusyUser('');}
  };

  const removeAccess=async(userId:string)=>{
    setBusyUser(userId);setError('');
    try{
      await unshareRecordWithUser({resourceType,resourceId,userId});
      setShares(await getRecordShares(resourceType,resourceId));
    }catch(e:any){setError(e?.message||'No se pudo dejar de compartir el registro.');}
    finally{setBusyUser('');}
  };

  if(!isAdmin)return null;

  const modal=open&&typeof document!=='undefined'?createPortal(
    <div className="profea-modal-overlay fixed inset-0 flex items-center justify-center bg-slate-900/45 dark:bg-slate-950/65 backdrop-blur-sm" onClick={()=>setOpen(false)}>
      <div className="w-full max-w-2xl max-h-full flex flex-col overflow-hidden rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300"><Users size={19}/></div>
            <div className="min-w-0">
              <h3 className="font-bold text-slate-900 dark:text-slate-100">Compartir {resourceLabel(resourceType)}</h3>
              <p className="text-xs text-slate-500 truncate">Elige lectura o lectura + escritura para cada usuario</p>
            </div>
          </div>
          <button type="button" onClick={()=>setOpen(false)} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"><X size={18}/></button>
        </div>

        <div className="px-4 sm:px-5 pt-4">
          <label className="relative block">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
            <input value={userSearch} onChange={e=>setUserSearch(e.target.value)} placeholder="Buscar usuario por nombre o email…" className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent pl-9 pr-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500/20"/>
          </label>
        </div>

        <div className="overflow-y-auto p-4 sm:p-5 space-y-3">
          {error&&<div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</div>}
          {loading?<div className="py-12 flex items-center justify-center gap-2 text-sm text-slate-500"><Loader2 size={18} className="animate-spin"/>Cargando usuarios…</div>:
          filteredUsers.length===0?<div className="py-10 text-center text-sm text-slate-500">No hay usuarios que coincidan con la búsqueda.</div>:
          filteredUsers.map(user=>{
            const share=shareByUser.get(user.id);
            const current:ShareAccess|null=share?(share.can_update?'read_write':'read'):null;
            const busy=busyUser===user.id;
            const name=[user.nombre,user.apellidos].filter(Boolean).join(' ').trim()||user.email;
            return <div key={user.id} className="rounded-xl border border-slate-200 dark:border-slate-800 px-4 py-3">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate">{name}</div>
                  <div className="text-xs text-slate-500 truncate">{user.email}</div>
                  {current&&<div className="mt-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">Compartido: {current==='read_write'?'lectura + escritura':'solo lectura'}</div>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" disabled={busy} onClick={()=>setAccess(user.id,'read')} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold border transition-colors disabled:opacity-60 ${current==='read'?'bg-blue-600 text-white border-blue-600':'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
                    {busy?<Loader2 size={14} className="animate-spin"/>:<Eye size={14}/>} Lectura
                  </button>
                  <button type="button" disabled={busy} onClick={()=>setAccess(user.id,'read_write')} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold border transition-colors disabled:opacity-60 ${current==='read_write'?'bg-blue-600 text-white border-blue-600':'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
                    {busy?<Loader2 size={14} className="animate-spin"/>:<Pencil size={14}/>} Lectura + escritura
                  </button>
                  {current&&<button type="button" disabled={busy} onClick={()=>removeAccess(user.id)} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-60">
                    {busy?<Loader2 size={14} className="animate-spin"/>:<UserMinus size={14}/>} Dejar de compartir
                  </button>}
                </div>
              </div>
            </div>;
          })}
        </div>

        <div className="border-t border-slate-200 dark:border-slate-800 px-5 py-3 text-xs text-slate-500 flex items-center gap-2"><CheckCircle2 size={14}/>La eliminación no se comparte desde este control.</div>
      </div>
    </div>,document.body):null;

  return <>
    <button
      type="button"
      onClick={openModal}
      title={`Compartir ${resourceLabel(resourceType)}`}
      className={`${compact?'p-2 rounded-lg':'inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold'} border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-blue-50 hover:text-blue-700 dark:hover:bg-blue-950/40 dark:hover:text-blue-300 transition-colors ${className}`}
    >
      <Share2 size={compact?16:15}/>{!compact&&<span>{label}</span>}
    </button>
    {modal}
  </>;
};
