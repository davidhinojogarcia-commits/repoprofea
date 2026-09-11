import React,{useEffect,useMemo,useState} from 'react';
import {Loader2,ShieldCheck,Users,X,RefreshCw,Trash2,UserX,UserCheck,KeyRound,Pencil,Share2,Filter,Search,Eye,Unlink} from 'lucide-react';
import {supabase} from '../src/lib/supabase';
import {createManagedUser,deleteManagedUser,sendManagedPasswordReset,setDataPermission,deleteDataPermission,setManagedUserActive,setManagedUserRole,updateManagedPermissions,updateManagedUserProfile} from '../src/lib/functions';

type Role='admin'|'user';
type ModuleName='contratacion'|'trabajadores'|'obras'|'reconocimientos'|'subcontratas'|'citas';
type PermissionSet=Record<'read'|'create'|'update'|'delete',boolean>;
type Modules=Record<ModuleName,PermissionSet>;
type ShareAccess='read'|'read_write';
type ResourceType='trabajadores'|'obra'|'citas'|'reconocimientos'|'subcontratas'|'contrataciones';

type ResourceConfig={table:string;label:string;select:string};
const resourceConfigs:Record<ResourceType,ResourceConfig>={
 trabajadores:{table:'trabajadores',label:'Trabajador',select:'id,owner_id,apellidos_nombre,dni,obra,num_oferta'},
 obra:{table:'obras',label:'Obra',select:'id,owner_id,codigo,nombre,municipio'},
 citas:{table:'citas',label:'Cita',select:'id,owner_id,trabajador_id,cita_dia,cita_hora,sitio_reconocimiento,num_oferta'},
 reconocimientos:{table:'reconocimientos',label:'Reconocimiento médico',select:'id,owner_id,trabajador_id,dni,apellidos_nombre,resultado,fecha_reconocimiento,centro_medico'},
 subcontratas:{table:'subcontratas',label:'Subcontrata',select:'id,owner_id,nombre_empresa,cif,municipio,persona_contacto'},
 contrataciones:{table:'contrataciones',label:'Contratación',select:'id,owner_id,trabajador_id,num_oferta,categoria,periodo_inicio,periodo_fin,quincena'},
};

const moduleLabels:Record<ModuleName,string>={contratacion:'Contratación',trabajadores:'Trabajadores',obras:'Obras',reconocimientos:'Reconocimientos',subcontratas:'Subcontratas',citas:'Citas'};
const defaultPermissions=():Modules=>Object.fromEntries(Object.keys(moduleLabels).map(k=>[k,{read:true,create:true,update:true,delete:true}])) as Modules;
const dateValue=(v:any)=>v?new Date(v).toLocaleString('es-ES'):'—';
const auditActionOptions=[['CREATE','Crear'],['INSERT','Insertar'],['UPDATE','Actualizar'],['DELETE','Eliminar'],['LOGIN','Inicio de sesión'],['CREATE_USER','Crear usuario'],['UPDATE_USER','Actualizar usuario'],['RESET_PASSWORD','Restablecer contraseña']] as const;
const auditResourceOptions=[['trabajadores','Trabajadores'],['trash','Papelera'],['subcontratas','Subcontratas'],['contrataciones','Contrataciones'],['reconocimientos','Reconocimientos médicos'],['citas','Citas'],['obras','Obras'],['profiles','Administración / Usuarios'],['auth','Autenticación'],['workers','Trabajadores (legado)']] as const;

interface AdminPanelProps{onClose:()=>void;}
interface UserForm{nombre:string;apellidos:string;email:string;telefono:string;password:string;role:Role;}
const emptyForm=():UserForm=>({nombre:'',apellidos:'',email:'',telefono:'',password:'',role:'user'});

export function AdminPanel({onClose}:AdminPanelProps){
 const [tab,setTab]=useState<'users'|'permissions'|'audit'>('users');
 const [users,setUsers]=useState<any[]>([]);
 const [auditLogs,setAuditLogs]=useState<any[]>([]);
 const [permissions,setPermissions]=useState<Record<string,Modules>>({});
 const [selectedUid,setSelectedUid]=useState('');
 const [auditUserFilter,setAuditUserFilter]=useState('');
 const [auditActionFilter,setAuditActionFilter]=useState('');
 const [auditResourceFilter,setAuditResourceFilter]=useState('');
 const [auditDateFrom,setAuditDateFrom]=useState('');
 const [auditDateTo,setAuditDateTo]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [createOpen,setCreateOpen]=useState(false);
 const [editUid,setEditUid]=useState('');
 const [form,setForm]=useState<UserForm>(emptyForm());
 const [catalogs,setCatalogs]=useState<Record<string,any[]>>({});
 const [userShares,setUserShares]=useState<any[]>([]);
 const [sharesLoading,setSharesLoading]=useState(false);
 const [shareType,setShareType]=useState<ResourceType>('trabajadores');
 const [shareRecordId,setShareRecordId]=useState('');
 const [shareAccess,setShareAccess]=useState<ShareAccess>('read');
 const [shareSearch,setShareSearch]=useState('');

 const load=async()=>{
  setError('');
  const us=await supabase.query('profiles',{query:'select=id,email,nombre,apellidos,telefono,role,active,created_at,last_access_at&order=created_at.asc'});
  setUsers(us||[]);
  const ps=await supabase.query('user_permissions',{query:'select=user_id,modules'});
  setPermissions(Object.fromEntries((ps||[]).map((p:any)=>[p.user_id,p.modules||defaultPermissions()])));
 };

 const loadCatalogs=async()=>{
  const entries=await Promise.all((Object.entries(resourceConfigs) as [ResourceType,ResourceConfig][]).map(async([type,cfg])=>{
   const rows=await supabase.query(cfg.table,{query:`select=${cfg.select}&order=created_at.desc&limit=2000`});
   return [type,rows||[]] as const;
  }));
  setCatalogs(Object.fromEntries(entries));
 };

 const loadUserShares=async(uid:string)=>{
  if(!uid){setUserShares([]);return;}
  setSharesLoading(true);
  try{
   const rows=await supabase.query('data_permissions',{query:`select=id,resource_type,resource_id,owner_id,user_id,can_read,can_update,can_delete,created_at&user_id=eq.${encodeURIComponent(uid)}&order=created_at.desc`});
   setUserShares(rows||[]);
  }finally{setSharesLoading(false);}
 };

 const loadAudit=async()=>{
  setError('');
  const filters:string[]=[];
  if(auditUserFilter)filters.push(`user_id=eq.${encodeURIComponent(auditUserFilter)}`);
  if(auditActionFilter)filters.push(`action=eq.${encodeURIComponent(auditActionFilter)}`);
  if(auditResourceFilter)filters.push(`resource_type=eq.${encodeURIComponent(auditResourceFilter)}`);
  if(auditDateFrom){const from=new Date(`${auditDateFrom}T00:00:00`);if(!Number.isNaN(from.getTime()))filters.push(`timestamp=gte.${encodeURIComponent(from.toISOString())}`);}
  if(auditDateTo){const to=new Date(`${auditDateTo}T23:59:59.999`);if(!Number.isNaN(to.getTime()))filters.push(`timestamp=lte.${encodeURIComponent(to.toISOString())}`);}
  const suffix=filters.length?`&${filters.join('&')}`:'';
  const rows=await supabase.query('audit_logs',{query:`select=id,user_id,user_email,action,resource_type,resource_id,timestamp,details${suffix}&order=timestamp.desc&limit=300`});
  setAuditLogs(rows||[]);
 };

 const clearAuditFilters=()=>{setAuditUserFilter('');setAuditActionFilter('');setAuditResourceFilter('');setAuditDateFrom('');setAuditDateTo('');};
 useEffect(()=>{load().catch(e=>setError(e?.message||'No se pudieron cargar los usuarios.'));},[]);
 useEffect(()=>{if(tab==='audit')loadAudit().catch(e=>setError(e?.message||'No se pudo cargar la auditoría.'));},[tab,auditUserFilter,auditActionFilter,auditResourceFilter,auditDateFrom,auditDateTo]);
 useEffect(()=>{if(tab==='permissions')loadCatalogs().catch(e=>setError(e?.message||'No se pudieron cargar los registros disponibles.'));},[tab]);
 useEffect(()=>{if(tab==='permissions')loadUserShares(selectedUid).catch(e=>setError(e?.message||'No se pudieron cargar los registros compartidos.'));},[tab,selectedUid]);
 useEffect(()=>{setShareRecordId('');setShareSearch('');},[shareType]);

 const run=async(op:()=>Promise<any>,reload=true)=>{setBusy(true);setError('');try{await op();if(reload)await load();}catch(e:any){setError(e?.message||'La operación no se pudo completar.');}finally{setBusy(false);}};
 const createUser=async(e:React.FormEvent)=>{e.preventDefault();if(form.password.length<8){setError('La contraseña debe tener al menos 8 caracteres.');return;}await run(async()=>{await createManagedUser(form);setCreateOpen(false);setForm(emptyForm());});};
 const saveEdit=async(e:React.FormEvent)=>{e.preventDefault();if(!editUid)return;const current=users.find(u=>u.id===editUid);await run(async()=>{await updateManagedUserProfile({uid:editUid,email:form.email,nombre:form.nombre,apellidos:form.apellidos,telefono:form.telefono});if(current&&(current.role||'user')!==form.role)await setManagedUserRole({uid:editUid,role:form.role});setEditUid('');});};
 const resetPassword=async(uid:string)=>run(async()=>{await sendManagedPasswordReset({uid});},false);
 const savePermissions=async()=>{if(!selectedUid)return;await run(()=>updateManagedPermissions({uid:selectedUid,modules:permissions[selectedUid]||defaultPermissions()}));};

 const workersById=useMemo(()=>new Map((catalogs.trabajadores||[]).map((r:any)=>[String(r.id),r])),[catalogs]);
 const recordLabel=(type:string,row:any)=>{
  if(!row)return 'Registro no disponible';
  if(type==='trabajadores')return `${row.apellidos_nombre||'Trabajador'}${row.dni?` · ${row.dni}`:''}${row.obra?` · ${row.obra}`:''}`;
  if(type==='obra')return `${row.codigo?`${row.codigo} · `:''}${row.nombre||'Obra'}${row.municipio?` · ${row.municipio}`:''}`;
  if(type==='reconocimientos')return `${row.apellidos_nombre||'Reconocimiento'}${row.dni?` · ${row.dni}`:''}${row.fecha_reconocimiento?` · ${row.fecha_reconocimiento}`:''}`;
  if(type==='subcontratas')return `${row.nombre_empresa||'Subcontrata'}${row.cif?` · ${row.cif}`:''}${row.municipio?` · ${row.municipio}`:''}`;
  if(type==='citas'){
   const worker=workersById.get(String(row.trabajador_id));
   return `${worker?.apellidos_nombre||'Cita médica'}${row.cita_dia?` · ${row.cita_dia}`:''}${row.cita_hora?` ${String(row.cita_hora).slice(0,5)}`:''}${row.sitio_reconocimiento?` · ${row.sitio_reconocimiento}`:''}`;
  }
  if(type==='contrataciones'){
   const worker=workersById.get(String(row.trabajador_id));
   return `${worker?.apellidos_nombre||'Contratación'}${row.num_oferta?` · Oferta ${row.num_oferta}`:''}${row.periodo_inicio?` · ${row.periodo_inicio}`:''}`;
  }
  return 'Registro';
 };
 const findRecord=(type:string,id:string)=>((catalogs[type]||[]).find((r:any)=>String(r.id)===String(id)));
 const currentRecords=useMemo(()=>catalogs[shareType]||[],[catalogs,shareType]);
 const filteredRecords=useMemo(()=>{const term=shareSearch.trim().toLowerCase();return currentRecords.filter((row:any)=>!term||recordLabel(shareType,row).toLowerCase().includes(term));},[currentRecords,shareSearch,shareType,workersById]);

 const saveShare=async()=>{
  if(!selectedUid){setError('Selecciona primero un usuario.');return;}
  const row=findRecord(shareType,shareRecordId);
  if(!row){setError('Selecciona un registro disponible.');return;}
  if(!row.owner_id){setError('Este registro no tiene propietario asignado y no se puede compartir.');return;}
  await run(async()=>{
   await setDataPermission({resourceType:shareType,resourceId:row.id,ownerId:row.owner_id,userId:selectedUid,canRead:true,canUpdate:shareAccess==='read_write',canDelete:false});
   await loadUserShares(selectedUid);
   setShareRecordId('');
   setShareSearch('');
  },false);
 };
 const changeShareAccess=async(share:any,access:ShareAccess)=>run(async()=>{
  await setDataPermission({resourceType:share.resource_type,resourceId:share.resource_id,ownerId:share.owner_id,userId:share.user_id,canRead:true,canUpdate:access==='read_write',canDelete:false});
  await loadUserShares(selectedUid);
 },false);
 const removeShare=async(share:any)=>run(async()=>{await deleteDataPermission({resourceType:share.resource_type,resourceId:share.resource_id,userId:share.user_id});await loadUserShares(selectedUid);},false);

 const filteredUserLabel=useMemo(()=>users.find(u=>u.id===auditUserFilter),[users,auditUserFilter]);
 const hasAuditFilters=Boolean(auditUserFilter||auditActionFilter||auditResourceFilter||auditDateFrom||auditDateTo);
 const selectedUser=users.find(u=>u.id===selectedUid);

 return <section className="w-full bg-transparent">
  <div className="w-full max-w-none mx-auto p-3 sm:p-4 lg:p-6 space-y-5">
   <header className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"><div className="flex items-center gap-3"><div className="rounded-xl bg-brand-primary text-white p-2.5"><ShieldCheck size={22}/></div><div><h1 className="text-2xl font-bold">Administración</h1><p className="text-sm text-slate-500">Usuarios, permisos, compartición y auditoría</p></div></div></header>
   <nav className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2 flex flex-wrap gap-2">{([['users','Usuarios'],['permissions','Permisos'],['audit','Auditoría']] as const).map(([k,l])=><button key={k} onClick={()=>setTab(k)} className={`px-4 py-2.5 rounded-xl text-sm font-semibold ${tab===k?'bg-brand-primary text-white':'hover:bg-slate-100 dark:hover:bg-slate-800'}`}>{l}</button>)}</nav>
   <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm p-4 sm:p-5 lg:p-6 relative min-h-[420px]">
    {error&&<div role="alert" className="mb-4 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</div>}

    {tab==='users'&&<><div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4"><h2 className="font-semibold flex items-center gap-2"><Users size={18}/>Usuarios</h2><div className="flex gap-2"><button onClick={()=>load()} className="p-2.5 rounded-lg border"><RefreshCw size={17}/></button><button onClick={()=>setCreateOpen(true)} className="rounded-lg bg-brand-primary text-white px-4 py-2.5 text-sm font-semibold">Crear usuario</button></div></div><div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[1040px] text-sm"><thead className="bg-slate-50 dark:bg-slate-800/60"><tr>{['Nombre','Email','Teléfono','Rol','Estado','Creación','Último acceso','Acciones'].map(x=><th key={x} className="text-left px-4 py-3 font-semibold whitespace-nowrap">{x}</th>)}</tr></thead><tbody>{users.map(u=><tr key={u.id} className="border-t"><td className="px-4 py-3">{u.nombre} {u.apellidos}</td><td className="px-4 py-3">{u.email}</td><td className="px-4 py-3 whitespace-nowrap">{u.telefono||'—'}</td><td className="px-4 py-3"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${u.role==='admin'?'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300':'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}>{u.role==='admin'?'Administrador':'Usuario'}</span></td><td className="px-4 py-3">{u.active===false?'Inactivo':'Activo'}</td><td className="px-4 py-3 whitespace-nowrap">{dateValue(u.created_at)}</td><td className="px-4 py-3 whitespace-nowrap">{dateValue(u.last_access_at)}</td><td className="px-4 py-3"><div className="flex gap-1"><button title="Editar usuario" onClick={()=>{setEditUid(u.id);setForm({nombre:u.nombre||'',apellidos:u.apellidos||'',email:u.email||'',telefono:u.telefono||'',password:'',role:u.role||'user'});}} className="p-2 rounded hover:bg-slate-100 dark:hover:bg-slate-800"><Pencil size={16}/></button><button title="Activar/desactivar" onClick={()=>run(()=>setManagedUserActive({uid:u.id,active:u.active===false}))} disabled={busy} className="p-2 rounded">{u.active===false?<UserCheck size={16}/>:<UserX size={16}/>}</button><button title="Enviar correo de restablecimiento de contraseña" onClick={()=>resetPassword(u.id)} disabled={busy} className="p-2 rounded"><KeyRound size={16}/></button><button title="Permisos" onClick={()=>{setSelectedUid(u.id);setTab('permissions')}} className="p-2 rounded"><ShieldCheck size={16}/></button><button title="Eliminar" onClick={()=>{if(confirm(`¿Eliminar ${u.email}?`))run(()=>deleteManagedUser({uid:u.id}))}} disabled={busy} className="p-2 rounded text-red-600"><Trash2 size={16}/></button></div></td></tr>)}</tbody></table></div></>}

    {tab==='permissions'&&<div className="space-y-8">
     <section className="space-y-4"><div><label className="text-sm font-medium">Usuario</label><select value={selectedUid} onChange={e=>setSelectedUid(e.target.value)} className="mt-2 w-full rounded-lg border px-3 py-2 bg-transparent"><option value="">Selecciona un usuario</option>{users.map(u=><option key={u.id} value={u.id}>{u.nombre} {u.apellidos} — {u.email}</option>)}</select></div>{selectedUid&&<div className="rounded-xl border overflow-x-auto"><table className="w-full min-w-[620px] text-sm"><thead className="bg-slate-50 dark:bg-slate-800/60"><tr><th className="text-left p-3">Módulo</th><th>Ver</th><th>Crear</th><th>Editar</th><th>Eliminar</th></tr></thead><tbody>{Object.entries(moduleLabels).map(([key,label])=>{const m=key as ModuleName;const v=permissions[selectedUid]?.[m]||{read:false,create:false,update:false,delete:false};return <tr key={key} className="border-t"><td className="p-3 font-medium">{label}</td>{(['read','create','update','delete'] as const).map(a=><td key={a} className="text-center"><input type="checkbox" checked={v[a]} disabled={busy} onChange={e=>setPermissions(prev=>({...prev,[selectedUid]:{...(prev[selectedUid]||defaultPermissions()),[m]:{...v,[a]:e.target.checked}}}))}/></td>)}</tr>})}</tbody></table></div>}<button disabled={!selectedUid||busy} onClick={savePermissions} className="rounded-lg bg-brand-primary text-white px-5 py-2.5 font-semibold disabled:opacity-50">Guardar permisos de módulo</button></section>

     {selectedUid&&<section className="rounded-xl border p-5 space-y-4"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><Share2 size={18}/><div><h3 className="font-semibold">Registros compartidos con {selectedUser?.nombre||selectedUser?.email}</h3><p className="text-xs text-slate-500">Estos son los accesos granulares que tiene actualmente este usuario.</p></div></div><button type="button" onClick={()=>loadUserShares(selectedUid)} className="p-2 rounded-lg border"><RefreshCw size={16}/></button></div>
      {sharesLoading?<div className="py-8 flex justify-center gap-2 text-sm text-slate-500"><Loader2 size={18} className="animate-spin"/>Cargando comparticiones…</div>:userShares.length===0?<div className="rounded-xl border border-dashed p-7 text-center text-sm text-slate-500">Este usuario no tiene ningún registro compartido actualmente.</div>:<div className="space-y-2">{userShares.map(s=>{const row=findRecord(s.resource_type,s.resource_id);const access:ShareAccess=s.can_update?'read_write':'read';const cfg=resourceConfigs[s.resource_type as ResourceType];return <div key={s.id} className="rounded-xl border p-3 flex flex-col xl:flex-row xl:items-center justify-between gap-3"><div className="min-w-0"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{cfg?.label||s.resource_type}</div><div className="font-semibold text-sm truncate">{recordLabel(s.resource_type,row)}</div></div><div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={()=>changeShareAccess(s,'read')} className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold ${access==='read'?'bg-blue-600 text-white border-blue-600':'border-slate-200 dark:border-slate-700'}`}><Eye size={14}/>Lectura</button><button type="button" disabled={busy} onClick={()=>changeShareAccess(s,'read_write')} className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold ${access==='read_write'?'bg-blue-600 text-white border-blue-600':'border-slate-200 dark:border-slate-700'}`}><Pencil size={14}/>Lectura + escritura</button><button type="button" disabled={busy} onClick={()=>removeShare(s)} className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 px-3 py-2 text-xs font-semibold hover:bg-red-50 dark:hover:bg-red-950/30"><Unlink size={14}/>Dejar de compartir</button></div></div>})}</div>}
     </section>}

     {selectedUid&&<section className="rounded-xl border p-5 space-y-4"><div className="flex items-center gap-2"><Share2 size={18}/><div><h3 className="font-semibold">Compartir otro registro</h3><p className="text-xs text-slate-500">Selecciona el dato real; los identificadores internos se resuelven automáticamente.</p></div></div>
      <div className="grid md:grid-cols-2 gap-3"><label className="text-xs font-medium"><span className="block mb-1">Tipo de dato</span><select value={shareType} onChange={e=>setShareType(e.target.value as ResourceType)} className="w-full rounded-lg border px-3 py-2.5 bg-transparent">{(Object.entries(resourceConfigs) as [ResourceType,ResourceConfig][]).map(([type,cfg])=><option key={type} value={type}>{cfg.label}</option>)}</select></label><label className="text-xs font-medium"><span className="block mb-1">Buscar registro</span><span className="relative block"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input value={shareSearch} onChange={e=>setShareSearch(e.target.value)} placeholder="Nombre, DNI, oferta, obra…" className="w-full rounded-lg border pl-9 pr-3 py-2.5 bg-transparent"/></span></label></div>
      <div className="max-h-64 overflow-y-auto rounded-xl border divide-y divide-slate-100 dark:divide-slate-800">{filteredRecords.map((row:any)=><label key={String(row.id)} className="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50"><input type="radio" name="admin-share-record" checked={String(shareRecordId)===String(row.id)} onChange={()=>setShareRecordId(String(row.id))} className="mt-1"/><span className="text-sm font-medium">{recordLabel(shareType,row)}</span></label>)}{filteredRecords.length===0&&<div className="p-6 text-center text-sm text-slate-500">No hay registros que coincidan con la búsqueda.</div>}</div>
      <div className="grid sm:grid-cols-2 gap-2"><button type="button" onClick={()=>setShareAccess('read')} className={`rounded-xl border px-3 py-3 text-sm font-semibold flex items-center justify-center gap-2 ${shareAccess==='read'?'bg-blue-600 text-white border-blue-600':'border-slate-200 dark:border-slate-700'}`}><Eye size={16}/>Lectura</button><button type="button" onClick={()=>setShareAccess('read_write')} className={`rounded-xl border px-3 py-3 text-sm font-semibold flex items-center justify-center gap-2 ${shareAccess==='read_write'?'bg-blue-600 text-white border-blue-600':'border-slate-200 dark:border-slate-700'}`}><Pencil size={16}/>Lectura + escritura</button></div>
      <button disabled={busy||!shareRecordId} onClick={saveShare} className="rounded-lg bg-brand-primary text-white px-5 py-2.5 font-semibold disabled:opacity-50">Compartir registro seleccionado</button>
     </section>}
    </div>}

    {tab==='audit'&&<div><div className="mb-5"><div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"><div><h2 className="font-semibold">Registro de auditoría</h2><p className="text-xs text-slate-500 mt-1">Filtra la actividad por usuario, acción, sección y rango de fechas.</p></div><button onClick={loadAudit} className="self-start sm:self-auto p-2.5 rounded-lg border" title="Actualizar auditoría"><RefreshCw size={17}/></button></div><div className="mt-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3"><label className="text-xs font-medium"><span className="flex items-center gap-1 mb-1"><Filter size={13}/> Usuario</span><select value={auditUserFilter} onChange={e=>setAuditUserFilter(e.target.value)} className="w-full rounded-lg border px-3 py-2 bg-transparent"><option value="">Todos los usuarios</option>{users.map(u=><option key={u.id} value={u.id}>{u.nombre} {u.apellidos} — {u.email}</option>)}</select></label><label className="text-xs font-medium"><span className="mb-1 block">Acción</span><select value={auditActionFilter} onChange={e=>setAuditActionFilter(e.target.value)} className="w-full rounded-lg border px-3 py-2 bg-transparent"><option value="">Todas las acciones</option>{auditActionOptions.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label className="text-xs font-medium"><span className="mb-1 block">Módulo / sección</span><select value={auditResourceFilter} onChange={e=>setAuditResourceFilter(e.target.value)} className="w-full rounded-lg border px-3 py-2 bg-transparent"><option value="">Todas las secciones</option>{auditResourceOptions.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label className="text-xs font-medium"><span className="mb-1 block">Desde</span><input type="date" value={auditDateFrom} max={auditDateTo||undefined} onChange={e=>setAuditDateFrom(e.target.value)} className="w-full rounded-lg border px-3 py-2 bg-transparent"/></label><label className="text-xs font-medium"><span className="mb-1 block">Hasta</span><input type="date" value={auditDateTo} min={auditDateFrom||undefined} onChange={e=>setAuditDateTo(e.target.value)} className="w-full rounded-lg border px-3 py-2 bg-transparent"/></label></div>{hasAuditFilters&&<div className="mt-3 flex flex-wrap items-center gap-2 text-xs"><span className="rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2">Filtros activos{filteredUserLabel?<> · <strong>{filteredUserLabel.nombre} {filteredUserLabel.apellidos}</strong></>:null}</span><button type="button" onClick={clearAuditFilters} className="rounded-lg border px-3 py-2 font-medium hover:bg-slate-50 dark:hover:bg-slate-800">Limpiar filtros</button></div>}</div><div className="space-y-2">{auditLogs.length===0?<div className="py-12 text-center text-sm text-slate-500">No hay eventos para estos filtros.</div>:auditLogs.map(log=><div key={log.id} className="rounded-lg border p-3 text-sm"><div className="flex justify-between gap-4"><strong>{log.action}</strong><span className="text-slate-500">{dateValue(log.timestamp)}</span></div><div className="text-slate-600 dark:text-slate-300">{log.resource_type} / {log.resource_id} · {log.user_email}</div>{log.details&&<pre className="mt-2 whitespace-pre-wrap break-words text-xs text-slate-500">{JSON.stringify(log.details)}</pre>}</div>)}</div></div>}

    {busy&&<div className="fixed bottom-6 right-6 rounded-full bg-slate-900 text-white px-4 py-2 flex items-center gap-2 text-sm shadow-xl"><Loader2 size={16} className="animate-spin"/>Procesando…</div>}
   </div>
  </div>

  {(createOpen||editUid)&&<div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4"><form onSubmit={editUid?saveEdit:createUser} className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-4"><div className="flex justify-between"><h3 className="text-lg font-bold">{editUid?'Editar usuario':'Crear usuario'}</h3><button type="button" onClick={()=>{setCreateOpen(false);setEditUid('');setForm(emptyForm())}}><X/></button></div><input required value={form.nombre} onChange={e=>setForm(f=>({...f,nombre:e.target.value}))} placeholder="Nombre" className="w-full rounded-lg border px-3 py-2 bg-transparent"/><input required value={form.apellidos} onChange={e=>setForm(f=>({...f,apellidos:e.target.value}))} placeholder="Apellidos" className="w-full rounded-lg border px-3 py-2 bg-transparent"/><input required type="email" value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))} placeholder="Email" className="w-full rounded-lg border px-3 py-2 bg-transparent"/><input type="tel" value={form.telefono} onChange={e=>setForm(f=>({...f,telefono:e.target.value}))} placeholder="Teléfono (opcional)" className="w-full rounded-lg border px-3 py-2 bg-transparent"/>{!editUid&&<input required type="password" minLength={8} value={form.password} onChange={e=>setForm(f=>({...f,password:e.target.value}))} placeholder="Contraseña inicial" className="w-full rounded-lg border px-3 py-2 bg-transparent"/>}<label className="block"><span className="mb-1.5 block text-sm font-medium">Rol</span><select value={form.role} onChange={e=>setForm(f=>({...f,role:e.target.value as Role}))} className="w-full rounded-lg border px-3 py-2 bg-transparent"><option value="user">Usuario</option><option value="admin">Administrador</option></select></label><button disabled={busy} className="w-full rounded-lg bg-brand-primary text-white px-4 py-2.5 font-semibold">{editUid?'Guardar cambios':'Crear usuario'}</button></form></div>}
 </section>;
}
