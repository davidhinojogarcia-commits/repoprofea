import React,{useEffect,useMemo,useState} from 'react';
import {Share2,Users,X,Loader2,UserPlus,UserMinus,CheckCircle2} from 'lucide-react';
import {supabase} from '../src/lib/supabase';
import {getRecordShares,shareRecordWithUser,unshareRecordWithUser} from '../src/lib/functions';

type Props={
  resourceType:'trabajadores'|'contrataciones'|'reconocimientos'|'citas'|'subcontratas'|'obra'|string;
  resourceId:string|number;
  label?:string;
  compact?:boolean;
  className?:string;
  onClick?:React.MouseEventHandler<HTMLButtonElement>;
};

type Profile={id:string;email:string;nombre?:string;apellidos?:string;role?:string;active?:boolean};
type ShareRow={id:string;user_id:string;can_read:boolean;can_update:boolean;can_delete:boolean};

const tableForResource=(resourceType:string)=>resourceType==='obra'?'obras':resourceType;
const resourceLabel=(resourceType:string)=>({
  trabajadores:'trabajador',
  contrataciones:'contratación',
  reconocimientos:'reconocimiento médico',
  citas:'cita',
  subcontratas:'subcontrata',
  obra:'obra',
}[resourceType]||'registro');

export const ShareRecordButton:React.FC<Props>=({resourceType,resourceId,label='Compartir',compact=false,className='',onClick})=>{
  const [isAdmin,setIsAdmin]=useState(false);
  const [open,setOpen]=useState(false);
  const [loading,setLoading]=useState(false);
  const [busyUser,setBusyUser]=useState('');
  const [users,setUsers]=useState<Profile[]>([]);
  const [shares,setShares]=useState<ShareRow[]>([]);
  const [ownerId,setOwnerId]=useState('');
  const [error,setError]=useState('');

  useEffect(()=>{
    let active=true;
    (async()=>{
      try{
        const authUser=(await supabase.auth.getUser()).data.user;
        if(!authUser)return;
        const rows=await supabase.query('profiles',{query:`select=role,active&id=eq.${encodeURIComponent(authUser.id)}&limit=1`});
        if(active)setIsAdmin(rows?.[0]?.active===true&&rows?.[0]?.role==='admin');
      }catch{/* El botón simplemente permanece oculto si no se puede verificar el rol. */}
    })();
    return()=>{active=false;};
  },[]);

  const sharedIds=useMemo(()=>new Set(shares.map(s=>s.user_id)),[shares]);

  const load=async()=>{
    setLoading(true);setError('');
    try{
      const table=tableForResource(resourceType);
      const [profiles,permissionRows,ownerRows]=await Promise.all([
        supabase.query('profiles',{query:'select=id,email,nombre,apellidos,role,active&active=eq.true&role=eq.user&order=nombre.asc,apellidos.asc,email.asc'}),
        getRecordShares(resourceType,resourceId),
        supabase.query(table,{query:`select=owner_id&id=eq.${encodeURIComponent(String(resourceId))}&limit=1`}),
      ]);
      setUsers(profiles||[]);
      setShares(permissionRows||[]);
      const owner=ownerRows?.[0]?.owner_id||'';
      setOwnerId(owner);
      if(!owner)throw new Error('No se ha podido identificar el propietario de este registro.');
    }catch(e:any){setError(e?.message||'No se pudo cargar la compartición del registro.');}
    finally{setLoading(false);}
  };

  const openModal=async(e:React.MouseEvent<HTMLButtonElement>)=>{
    e.stopPropagation();
    onClick?.(e);
    setOpen(true);
    await load();
  };

  const toggle=async(userId:string,currentlyShared:boolean)=>{
    if(!ownerId)return;
    setBusyUser(userId);setError('');
    try{
      if(currentlyShared){
        await unshareRecordWithUser({resourceType,resourceId,userId});
      }else{
        await shareRecordWithUser({resourceType,resourceId,ownerId,userId});
      }
      setShares(await getRecordShares(resourceType,resourceId));
    }catch(e:any){setError(e?.message||'No se pudo actualizar la compartición.');}
    finally{setBusyUser('');}
  };

  if(!isAdmin)return null;

  return <>
    <button
      type="button"
      onClick={openModal}
      title={`Compartir ${resourceLabel(resourceType)}`}
      className={`${compact?'p-2 rounded-lg':'inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold'} border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-blue-50 hover:text-blue-700 dark:hover:bg-blue-950/40 dark:hover:text-blue-300 transition-colors ${className}`}
    >
      <Share2 size={compact?16:15}/>{!compact&&<span>{label}</span>}
    </button>

    {open&&<div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/45 dark:bg-slate-950/65 backdrop-blur-sm p-4" onClick={()=>setOpen(false)}>
      <div className="w-full max-w-xl max-h-[82dvh] flex flex-col overflow-hidden rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300"><Users size={19}/></div>
            <div className="min-w-0"><h3 className="font-bold text-slate-900 dark:text-slate-100">Compartir {resourceLabel(resourceType)}</h3><p className="text-xs text-slate-500 truncate">ID {String(resourceId)} · acceso de lectura y edición</p></div>
          </div>
          <button type="button" onClick={()=>setOpen(false)} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"><X size={18}/></button>
        </div>

        <div className="overflow-y-auto p-4 sm:p-5 space-y-3">
          {error&&<div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</div>}
          {loading?<div className="py-12 flex items-center justify-center gap-2 text-sm text-slate-500"><Loader2 size={18} className="animate-spin"/>Cargando usuarios…</div>:
          users.length===0?<div className="py-10 text-center text-sm text-slate-500">No hay usuarios normales activos con los que compartir.</div>:
          users.map(user=>{
            const shared=sharedIds.has(user.id);
            const busy=busyUser===user.id;
            const name=[user.nombre,user.apellidos].filter(Boolean).join(' ').trim()||user.email;
            return <div key={user.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 px-4 py-3">
              <div className="min-w-0"><div className="font-semibold text-sm truncate">{name}</div><div className="text-xs text-slate-500 truncate">{user.email}</div></div>
              <button type="button" disabled={busy} onClick={()=>toggle(user.id,shared)} className={`shrink-0 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold border transition-colors disabled:opacity-60 ${shared?'border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/30':'border-blue-200 dark:border-blue-900 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/30'}`}>
                {busy?<Loader2 size={15} className="animate-spin"/>:shared?<UserMinus size={15}/>:<UserPlus size={15}/>} {shared?'Dejar de compartir':'Compartir'}
              </button>
            </div>;
          })}
        </div>

        <div className="border-t border-slate-200 dark:border-slate-800 px-5 py-3 text-xs text-slate-500 flex items-center gap-2"><CheckCircle2 size={14}/>Al compartir se concede lectura y edición del registro. Eliminar sigue reservado salvo permiso específico.</div>
      </div>
    </div>}
  </>;
};
