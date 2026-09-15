import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Boxes,
  Building2,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  ClipboardList,
  Edit3,
  FileText,
  History,
  Image as ImageIcon,
  MapPinned,
  PackageCheck,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  Settings2,
  Share2,
  Stethoscope,
  Trash2,
  Truck,
  Upload,
  Wrench,
  X,
} from 'lucide-react';
import QRCode from 'qrcode';
import { PageHeader } from './ui/PageHeader';
import {
  INVENTORY_BASE_LOCATION,
  InventoryItem,
  InventoryMaintenance,
  InventoryMovement,
  InventoryPark,
  addInventoryMaintenance,
  ensureInventoryReady,
  listInventoryItems,
  listInventoryMaintenance,
  listInventoryMovements,
  registerInventoryMovement,
  saveInventoryItem,
  shareInventoryParkByEmail,
  softDeleteInventoryItem,
  uploadInventoryPhotos,
} from '../src/services/inventoryService';

interface InventorySectionProps {
  savedObras: string[];
}

type Tab = 'resumen' | 'inventario' | 'movimientos' | 'mantenimiento' | 'trazabilidad';

const STATUS_OPTIONS = ['Disponible', 'Asignada a obra', 'En traslado', 'Averiada', 'En reparación', 'Pendiente de revisión', 'Fuera de servicio', 'Baja'];
const MOVEMENT_TYPES = ['Salida a obra', 'Traslado', 'Devolución a nave', 'Avería', 'Envío a reparación', 'Regreso de reparación', 'Cambio de estado'];

const statusClass = (status: string) => {
  const s = (status || '').toLowerCase();
  if (s.includes('aver') || s.includes('fuera') || s.includes('baja')) return 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800';
  if (s.includes('repar') || s.includes('revisión')) return 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800';
  if (s.includes('obra') || s.includes('traslado')) return 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800';
  return 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800';
};

const emptyItem = (): Partial<InventoryItem> & { nombre: string; categoria: string } => ({
  codigo: '', categoria: '', nombre: '', marca: '', modelo: '', numeroSerie: '', matricula: '', cantidad: 1,
  tipoGestion: 'individual', estado: 'Disponible', ubicacionActual: INVENTORY_BASE_LOCATION, detalles: {}, observaciones: '', activo: true,
});

export const InventorySection: React.FC<InventorySectionProps> = ({ savedObras }) => {
  const [tab, setTab] = useState<Tab>('resumen');
  const [park, setPark] = useState<InventoryPark | null>(null);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [maintenance, setMaintenance] = useState<InventoryMaintenance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [editingItem, setEditingItem] = useState<(Partial<InventoryItem> & { nombre: string; categoria: string }) | null>(null);
  const [movementItem, setMovementItem] = useState<InventoryItem | null>(null);
  const [maintenanceItem, setMaintenanceItem] = useState<InventoryItem | null>(null);
  const [traceItemId, setTraceItemId] = useState<string>('');
  const [shareEmail, setShareEmail] = useState('');
  const [shareBusy, setShareBusy] = useState(false);
  const [qrItem, setQrItem] = useState<InventoryItem | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');

  const reload = async () => {
    setLoading(true); setError('');
    try {
      const p = await ensureInventoryReady();
      setPark(p);
      const [i, m, mt] = await Promise.all([listInventoryItems(p.id), listInventoryMovements(p.id), listInventoryMaintenance(p.id)]);
      setItems(i); setMovements(m); setMaintenance(mt);
      const requestedId = new URLSearchParams(window.location.search).get('inventoryItem');
      if (requestedId && i.some(x => x.id === requestedId)) {
        setTraceItemId(requestedId); setTab('trazabilidad');
      } else if (!traceItemId && i.length) setTraceItemId(i[0].id);
    } catch (e: any) {
      setError(e?.message || 'No se pudo cargar el inventario.');
    } finally { setLoading(false); }
  };

  useEffect(() => { void reload(); }, []);

  const activeItems = useMemo(() => items.filter(i => i.activo), [items]);
  const categories = useMemo<string[]>(() => Array.from(new Set<string>(activeItems.map(i => String(i.categoria || '')))).filter(Boolean).sort((a,b) => a.localeCompare(b, 'es')), [activeItems]);
  const filtered = useMemo(() => activeItems.filter(i => {
    const q = search.trim().toLowerCase();
    const hay = [i.codigo, i.nombre, i.categoria, i.marca, i.modelo, i.numeroSerie, i.matricula, i.ubicacionActual].filter(Boolean).join(' ').toLowerCase();
    return (!q || hay.includes(q)) && (!category || i.categoria === category) && (!status || i.estado === status);
  }), [activeItems, search, category, status]);

  const kpis = useMemo(() => ({
    total: activeItems.reduce((a,i) => a + (i.cantidad || 1), 0),
    disponibles: activeItems.filter(i => i.estado === 'Disponible').length,
    obra: activeItems.filter(i => i.estado === 'Asignada a obra').length,
    incidencias: activeItems.filter(i => /aver|repar|revisión|fuera/i.test(i.estado)).length,
  }), [activeItems]);

  const selectedTraceItem = activeItems.find(i => i.id === traceItemId) || null;
  const traceMovements = useMemo(() => movements.filter(m => m.itemId === traceItemId).slice().reverse(), [movements, traceItemId]);

  const openQr = async (item: InventoryItem) => {
    const url = new URL(window.location.href);
    url.search = '';
    url.searchParams.set('inventoryItem', item.id);
    setQrItem(item);
    setQrDataUrl(await QRCode.toDataURL(url.toString(), { width: 320, margin: 2 }));
  };

  if (loading) return <div className="ui-surface p-10 flex items-center justify-center gap-3"><RefreshCw className="w-5 h-5 animate-spin" /> Cargando parque de maquinaria…</div>;

  return (
    <div className="space-y-6 pb-10">
      <PageHeader eyebrow="Zona 6 · Parque compartido" title="Herramientas y maquinaria" description="Inventario, custodia, movimientos, estado técnico y trazabilidad del parque Nave logística Antonio Ramos." icon={<Wrench className="h-5 w-5" />} />

      {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"><AlertTriangle className="inline w-4 h-4 mr-2" />{error}</div>}

      {park && <div className="ui-surface p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Parque activo</div>
          <div className="text-lg font-black text-slate-800 dark:text-slate-100">{park.nombre} <span className="text-brand-primary">({park.zona})</span></div>
          <div className="text-xs text-slate-500 mt-1">Inventario común. Cada movimiento queda atribuido al usuario que lo registra.</div>
        </div>
        <form className="flex gap-2 w-full lg:w-auto" onSubmit={async e => {
          e.preventDefault(); if (!park || !shareEmail.trim()) return; setShareBusy(true);
          try { const name = await shareInventoryParkByEmail(park.id, shareEmail); alert(`Parque compartido con ${name || shareEmail}.`); setShareEmail(''); }
          catch (e:any) { alert(e?.message || 'No se pudo compartir el parque.'); }
          finally { setShareBusy(false); }
        }}>
          <input value={shareEmail} onChange={e => setShareEmail(e.target.value)} type="email" placeholder="Correo del otro supervisor" className="min-w-0 flex-1 lg:w-64 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
          <button disabled={shareBusy} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 dark:bg-blue-600 text-white px-4 py-2 text-sm font-bold disabled:opacity-50"><Share2 className="w-4 h-4" /> Compartir</button>
        </form>
      </div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={<Boxes />} label="Unidades" value={kpis.total} />
        <Kpi icon={<PackageCheck />} label="Disponibles" value={kpis.disponibles} />
        <Kpi icon={<Building2 />} label="En obra" value={kpis.obra} />
        <Kpi icon={<AlertTriangle />} label="Incidencias" value={kpis.incidencias} />
      </div>

      <div className="flex flex-wrap gap-2">
        {([
          ['resumen','Resumen',ClipboardList], ['inventario','Inventario',Boxes], ['movimientos','Movimientos',History],
          ['mantenimiento','Mantenimiento',Stethoscope], ['trazabilidad','Mapa y trazabilidad',MapPinned],
        ] as [Tab,string,React.ElementType][]).map(([id,label,Icon]) => <button key={id} onClick={() => setTab(id)} className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold border transition-all ${tab===id ? 'bg-brand-primary text-white border-brand-primary shadow-md' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-brand-primary/50'}`}><Icon className="w-4 h-4" />{label}</button>)}
      </div>

      {tab === 'resumen' && <SummaryView items={activeItems} movements={movements} onOpenItem={id => { setTraceItemId(id); setTab('trazabilidad'); }} />}
      {tab === 'inventario' && <div className="ui-surface overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 flex flex-col xl:flex-row gap-3 xl:items-center xl:justify-between">
          <div className="flex flex-col sm:flex-row gap-2 flex-1">
            <div className="relative flex-1"><Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" /><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar código, equipo, serie, ubicación…" className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-9 pr-3 py-2 text-sm" /></div>
            <select value={category} onChange={e=>setCategory(e.target.value)} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"><option value="">Todas las categorías</option>{categories.map(c=><option key={c}>{c}</option>)}</select>
            <select value={status} onChange={e=>setStatus(e.target.value)} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"><option value="">Todos los estados</option>{STATUS_OPTIONS.map(s=><option key={s}>{s}</option>)}</select>
          </div>
          <button onClick={()=>setEditingItem(emptyItem())} className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-primary hover:bg-brand-secondary text-white px-4 py-2 text-sm font-bold"><Plus className="w-4 h-4" />Añadir equipo</button>
        </div>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 dark:bg-slate-800/60 text-[11px] uppercase tracking-wider text-slate-500"><tr><th className="p-3 text-left">Código</th><th className="p-3 text-left">Equipo</th><th className="p-3 text-left">Estado</th><th className="p-3 text-left">Ubicación</th><th className="p-3 text-center">Uds.</th><th className="p-3 text-right">Acciones</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{filtered.map(item => <tr key={item.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30"><td className="p-3 font-mono text-xs font-bold">{item.codigo}</td><td className="p-3"><div className="font-bold text-slate-800 dark:text-slate-100">{item.nombre}</div><div className="text-xs text-slate-500">{item.categoria} · {[item.marca,item.modelo,item.numeroSerie].filter(Boolean).join(' · ') || 'Sin identificación adicional'}</div></td><td className="p-3"><span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold ${statusClass(item.estado)}`}>{item.estado}</span></td><td className="p-3 text-xs max-w-[260px]">{item.ubicacionActual}</td><td className="p-3 text-center font-bold">{item.cantidad}</td><td className="p-3"><div className="flex justify-end gap-1.5"><Action title="Movimiento" onClick={()=>setMovementItem(item)} icon={<Truck/>}/><Action title="Editar" onClick={()=>setEditingItem({...item})} icon={<Edit3/>}/><Action title="QR" onClick={()=>void openQr(item)} icon={<QrCode/>}/><Action title="Trazabilidad" onClick={()=>{setTraceItemId(item.id);setTab('trazabilidad')}} icon={<MapPinned/>}/><Action title="Dar de baja" danger onClick={async()=>{if(!confirm(`¿Dar de baja ${item.nombre}? Se conservará toda su trazabilidad.`))return; await softDeleteInventoryItem(item.id); await reload();}} icon={<Trash2/>}/></div></td></tr>)}</tbody></table></div>
      </div>}

      {tab === 'movimientos' && <MovementsView movements={movements} items={items} onTrace={id=>{setTraceItemId(id);setTab('trazabilidad')}} />}
      {tab === 'mantenimiento' && <MaintenanceView maintenance={maintenance} items={items} onAdd={setMaintenanceItem} />}
      {tab === 'trazabilidad' && <TraceView items={activeItems} selectedId={traceItemId} setSelectedId={setTraceItemId} movements={traceMovements} />}

      {editingItem && park && <ItemModal item={editingItem} categories={categories} onClose={()=>setEditingItem(null)} onSave={async draft=>{await saveInventoryItem(park.id,draft);setEditingItem(null);await reload();}} />}
      {movementItem && <MovementModal item={movementItem} savedObras={savedObras} onClose={()=>setMovementItem(null)} onSave={async data=>{let paths:string[]=[]; if(data.files.length && park) paths=await uploadInventoryPhotos(park.id,movementItem.id,data.files); await registerInventoryMovement({...data,fotoPaths:paths,itemId:movementItem.id}); setMovementItem(null); await reload();}} />}
      {maintenanceItem && park && <MaintenanceModal item={maintenanceItem} onClose={()=>setMaintenanceItem(null)} onSave={async d=>{await addInventoryMaintenance(park.id,maintenanceItem.id,d);setMaintenanceItem(null);await reload();}} />}
      {qrItem && <Modal title={`QR · ${qrItem.nombre}`} onClose={()=>setQrItem(null)}><div className="text-center"><img src={qrDataUrl} alt="Código QR del equipo" className="mx-auto w-64 h-64 rounded-xl bg-white p-3"/><div className="mt-3 font-bold">{qrItem.codigo}</div><div className="text-xs text-slate-500">Al escanearlo se abre directamente la trazabilidad del equipo.</div></div></Modal>}
    </div>
  );
};

const Kpi = ({icon,label,value}:{icon:React.ReactNode;label:string;value:number}) => <div className="ui-surface p-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-xl bg-brand-primary/10 text-brand-primary grid place-items-center [&>svg]:w-5 [&>svg]:h-5">{icon}</div><div><div className="text-2xl font-black text-slate-800 dark:text-white">{value}</div><div className="text-[11px] uppercase tracking-wider font-bold text-slate-400">{label}</div></div></div></div>;
const Action = ({title,onClick,icon,danger=false}:{title:string;onClick:()=>void;icon:React.ReactNode;danger?:boolean}) => <button type="button" title={title} onClick={onClick} className={`w-8 h-8 grid place-items-center rounded-lg border transition-colors [&>svg]:w-4 [&>svg]:h-4 ${danger?'border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900':'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>{icon}</button>;

const SummaryView = ({items,movements,onOpenItem}:{items:InventoryItem[];movements:InventoryMovement[];onOpenItem:(id:string)=>void}) => {
  const grouped = useMemo(()=>Array.from(items.reduce((m,i)=>m.set(i.categoria,(m.get(i.categoria)||0)+(i.cantidad||1)),new Map<string,number>()).entries()).sort((a,b)=>b[1]-a[1]).slice(0,12),[items]);
  return <div className="grid lg:grid-cols-2 gap-4"><div className="ui-surface p-5"><h3 className="font-black mb-4 flex items-center gap-2"><Boxes className="w-5 h-5 text-brand-primary"/>Inventario por familia</h3><div className="space-y-2">{grouped.map(([name,count])=><div key={name} className="flex items-center justify-between rounded-xl bg-slate-50 dark:bg-slate-800/50 px-3 py-2"><span className="text-sm font-semibold">{name}</span><span className="text-xs font-black rounded-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-2.5 py-1">{count}</span></div>)}</div></div><div className="ui-surface p-5"><h3 className="font-black mb-4 flex items-center gap-2"><History className="w-5 h-5 text-brand-primary"/>Últimos movimientos</h3><div className="space-y-3">{movements.slice(0,10).map(m=>{const item=items.find(i=>i.id===m.itemId);return <button key={m.id} onClick={()=>onOpenItem(m.itemId)} className="w-full text-left rounded-xl border border-slate-200 dark:border-slate-800 p-3 hover:border-brand-primary/50"><div className="flex items-center justify-between gap-3"><div className="font-bold text-sm">{item?.nombre||'Equipo'} <span className="font-mono text-[10px] text-slate-400">{item?.codigo}</span></div><ChevronRight className="w-4 h-4 text-slate-400"/></div><div className="text-xs text-slate-500 mt-1">{m.tipo}: {m.origen} → {m.destino}</div><div className="text-[10px] text-slate-400 mt-1">{new Date(m.createdAt).toLocaleString('es-ES')} · {m.createdByName||'Usuario'}</div></button>})}{!movements.length&&<div className="text-sm text-slate-500">Todavía no hay movimientos registrados.</div>}</div></div></div>;
};

const MovementsView = ({movements,items,onTrace}:{movements:InventoryMovement[];items:InventoryItem[];onTrace:(id:string)=>void}) => <div className="ui-surface overflow-hidden"><div className="p-5 border-b border-slate-200 dark:border-slate-800"><h3 className="font-black">Registro completo de movimientos</h3><p className="text-xs text-slate-500 mt-1">Trazabilidad cronológica y responsable de cada salida, traslado, devolución o incidencia.</p></div><div className="divide-y divide-slate-100 dark:divide-slate-800">{movements.map(m=>{const item=items.find(i=>i.id===m.itemId);return <button key={m.id} onClick={()=>onTrace(m.itemId)} className="w-full p-4 text-left hover:bg-slate-50 dark:hover:bg-slate-800/30"><div className="flex flex-col md:flex-row md:items-center gap-2 md:justify-between"><div><div className="font-bold">{item?.nombre||'Equipo'} <span className="text-xs font-mono text-slate-400">{item?.codigo}</span></div><div className="text-xs text-slate-500">{m.origen} → <span className="font-semibold text-slate-700 dark:text-slate-200">{m.destino}</span></div></div><div className="text-right"><div className="text-xs font-bold">{m.tipo}</div><div className="text-[10px] text-slate-400">{new Date(m.createdAt).toLocaleString('es-ES')} · {m.createdByName||'Usuario'}</div></div></div></button>})}</div></div>;

const MaintenanceView = ({maintenance,items,onAdd}:{maintenance:InventoryMaintenance[];items:InventoryItem[];onAdd:(i:InventoryItem)=>void}) => <div className="grid lg:grid-cols-[1fr_320px] gap-4"><div className="ui-surface overflow-hidden"><div className="p-5 border-b border-slate-200 dark:border-slate-800 font-black">Historial de mantenimiento y averías</div><div className="divide-y divide-slate-100 dark:divide-slate-800">{maintenance.map(m=>{const item=items.find(i=>i.id===m.itemId);return <div key={m.id} className="p-4"><div className="flex justify-between gap-3"><div><div className="font-bold">{item?.nombre||'Equipo'} · {m.tipo}</div><div className="text-xs text-slate-500 mt-1">{m.fecha}{m.proximaRevision?` · Próxima revisión: ${m.proximaRevision}`:''}{m.proveedor?` · ${m.proveedor}`:''}</div><div className="text-xs mt-2">{m.observaciones}</div></div>{m.coste!=null&&<div className="font-black">{m.coste.toLocaleString('es-ES',{style:'currency',currency:'EUR'})}</div>}</div></div>})}{!maintenance.length&&<div className="p-6 text-sm text-slate-500">No hay mantenimientos registrados.</div>}</div></div><div className="ui-surface p-5"><h3 className="font-black mb-3">Registrar actuación</h3><p className="text-xs text-slate-500 mb-4">Selecciona una máquina para registrar revisión, reparación, mantenimiento preventivo o incidencia.</p><div className="max-h-[520px] overflow-y-auto space-y-2">{items.filter(i=>i.activo).map(i=><button key={i.id} onClick={()=>onAdd(i)} className="w-full text-left p-3 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-brand-primary/50"><div className="font-bold text-sm">{i.nombre}</div><div className="text-[10px] text-slate-400">{i.codigo} · {i.estado}</div></button>)}</div></div></div>;

const TraceView = ({items,selectedId,setSelectedId,movements}:{items:InventoryItem[];selectedId:string;setSelectedId:(s:string)=>void;movements:InventoryMovement[]}) => {
  const item=items.find(i=>i.id===selectedId);
  const geo=movements.filter(m=>m.latitud!=null&&m.longitud!=null) as (InventoryMovement & {latitud:number;longitud:number})[];
  let points:{x:number;y:number;m:InventoryMovement}[]=[];
  if(geo.length){const xs=geo.map(m=>m.longitud), ys=geo.map(m=>m.latitud); const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);points=geo.map(m=>({x:8+84*((m.longitud-minX)/((maxX-minX)||1)),y:92-84*((m.latitud-minY)/((maxY-minY)||1)),m}));}
  return <div className="grid xl:grid-cols-[320px_1fr] gap-4"><div className="ui-surface p-4"><label className="text-[10px] uppercase tracking-wider font-black text-slate-400">Equipo</label><select value={selectedId} onChange={e=>setSelectedId(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm">{items.map(i=><option key={i.id} value={i.id}>{i.codigo} · {i.nombre}</option>)}</select>{item&&<div className="mt-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 p-4"><div className="text-xs text-slate-400 uppercase font-bold">Actualmente en</div><div className="font-black mt-1">{item.ubicacionActual}</div><span className={`inline-flex mt-3 rounded-full border px-2.5 py-1 text-[11px] font-bold ${statusClass(item.estado)}`}>{item.estado}</span></div>}</div><div className="space-y-4"><div className="ui-surface p-5"><h3 className="font-black flex items-center gap-2"><MapPinned className="w-5 h-5 text-brand-primary"/>Mapa de trayectoria</h3><p className="text-xs text-slate-500 mt-1">El recorrido se construye con cada movimiento. Si se registra geolocalización desde el móvil, se representa también espacialmente.</p>{geo.length>=2?<div className="mt-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3"><svg viewBox="0 0 100 100" className="w-full h-72">{points.slice(1).map((p,i)=><line key={i} x1={points[i].x} y1={points[i].y} x2={p.x} y2={p.y} stroke="currentColor" strokeWidth="1" className="text-brand-primary"/>)}{points.map((p,i)=><g key={i}><circle cx={p.x} cy={p.y} r="2.8" className="fill-brand-primary"/><text x={p.x+3} y={p.y-2} fontSize="3" className="fill-slate-600 dark:fill-slate-300">{i+1}</text></g>)}</svg></div>:<div className="mt-4 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 p-5 text-sm text-slate-500">Aún no hay suficientes movimientos con coordenadas para dibujar el recorrido geográfico. La línea temporal inferior mantiene toda la trazabilidad.</div>}</div><div className="ui-surface p-5"><h3 className="font-black mb-4">Línea completa de trazabilidad</h3><div className="relative pl-7 space-y-5 before:absolute before:left-[10px] before:top-2 before:bottom-2 before:w-px before:bg-slate-300 dark:before:bg-slate-700"><div className="relative"><CircleDot className="absolute -left-7 top-0 w-5 h-5 text-brand-primary bg-white dark:bg-slate-900"/><div className="font-bold text-sm">{INVENTORY_BASE_LOCATION}</div><div className="text-[10px] text-slate-400">Parque base</div></div>{movements.map((m,idx)=><div key={m.id} className="relative"><CircleDot className="absolute -left-7 top-0 w-5 h-5 text-brand-primary bg-white dark:bg-slate-900"/><div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3"><div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1"><div className="font-bold text-sm">{idx+1}. {m.tipo} → {m.destino}</div><div className="text-[10px] text-slate-400">{new Date(m.createdAt).toLocaleString('es-ES')}</div></div><div className="text-xs text-slate-500 mt-1">Estado: {m.estadoAnterior||'-'} → {m.estadoNuevo||'-'} · Responsable: {m.createdByName||'Usuario'}</div>{m.observaciones&&<div className="text-xs mt-2">{m.observaciones}</div>}{m.fotoUrls?.length?<div className="flex gap-2 mt-3 flex-wrap">{m.fotoUrls.map((u,i)=><a key={i} href={u} target="_blank" rel="noreferrer"><img src={u} className="w-20 h-16 object-cover rounded-lg border border-slate-200 dark:border-slate-700"/></a>)}</div>:null}</div></div>)}</div></div></div></div>;
};

const Modal = ({title,onClose,children}:{title:string;onClose:()=>void;children:React.ReactNode}) => <div className="fixed inset-0 z-[80] bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4"><div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl"><div className="sticky top-0 z-10 flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur"><h3 className="font-black">{title}</h3><button onClick={onClose} className="w-9 h-9 grid place-items-center rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"><X className="w-5 h-5"/></button></div><div className="p-5">{children}</div></div></div>;
const Field = ({label,children}:{label:string;children:React.ReactNode}) => <label className="block"><span className="block text-[10px] uppercase tracking-wider font-black text-slate-400 mb-1.5">{label}</span>{children}</label>;
const inputClass='w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm';

const ItemModal = ({item,categories,onClose,onSave}:{item:Partial<InventoryItem>&{nombre:string;categoria:string};categories:string[];onClose:()=>void;onSave:(i:any)=>Promise<void>}) => {const [d,setD]=useState(item);const [saving,setSaving]=useState(false);return <Modal title={item.id?'Editar equipo':'Añadir herramienta o maquinaria'} onClose={onClose}><form onSubmit={async e=>{e.preventDefault();setSaving(true);try{await onSave(d)}finally{setSaving(false)}}} className="grid sm:grid-cols-2 gap-4"><Field label="Código interno"><input className={inputClass} value={d.codigo||''} onChange={e=>setD({...d,codigo:e.target.value})}/></Field><Field label="Categoría"><input list="inventory-categories" required className={inputClass} value={d.categoria||''} onChange={e=>setD({...d,categoria:e.target.value})}/><datalist id="inventory-categories">{categories.map(c=><option key={c} value={c}/>)}</datalist></Field><div className="sm:col-span-2"><Field label="Equipo / descripción"><input required className={inputClass} value={d.nombre||''} onChange={e=>setD({...d,nombre:e.target.value})}/></Field></div><Field label="Marca"><input className={inputClass} value={d.marca||''} onChange={e=>setD({...d,marca:e.target.value})}/></Field><Field label="Modelo"><input className={inputClass} value={d.modelo||''} onChange={e=>setD({...d,modelo:e.target.value})}/></Field><Field label="Nº serie"><input className={inputClass} value={d.numeroSerie||''} onChange={e=>setD({...d,numeroSerie:e.target.value})}/></Field><Field label="Matrícula"><input className={inputClass} value={d.matricula||''} onChange={e=>setD({...d,matricula:e.target.value})}/></Field><Field label="Cantidad"><input type="number" min="1" className={inputClass} value={d.cantidad||1} onChange={e=>setD({...d,cantidad:Number(e.target.value)||1})}/></Field><Field label="Gestión"><select className={inputClass} value={d.tipoGestion||'individual'} onChange={e=>setD({...d,tipoGestion:e.target.value as any})}><option value="individual">Individual</option><option value="lote">Por lote/unidades</option></select></Field><Field label="Estado"><select className={inputClass} value={d.estado||'Disponible'} onChange={e=>setD({...d,estado:e.target.value})}>{STATUS_OPTIONS.map(s=><option key={s}>{s}</option>)}</select></Field><Field label="Ubicación actual"><input className={inputClass} value={d.ubicacionActual||''} onChange={e=>setD({...d,ubicacionActual:e.target.value})}/></Field><div className="sm:col-span-2"><Field label="Observaciones"><textarea rows={3} className={inputClass} value={d.observaciones||''} onChange={e=>setD({...d,observaciones:e.target.value})}/></Field></div><div className="sm:col-span-2 flex justify-end gap-2 pt-2"><button type="button" onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 font-bold text-sm">Cancelar</button><button disabled={saving} className="px-5 py-2 rounded-xl bg-brand-primary text-white font-bold text-sm disabled:opacity-50">{saving?'Guardando…':'Guardar'}</button></div></form></Modal>};

const MovementModal = ({item,savedObras,onClose,onSave}:{item:InventoryItem;savedObras:string[];onClose:()=>void;onSave:(d:any)=>Promise<void>}) => {const [tipo,setTipo]=useState('Salida a obra');const [destino,setDestino]=useState('');const [estadoNuevo,setEstadoNuevo]=useState('Asignada a obra');const [observaciones,setObservaciones]=useState('');const [files,setFiles]=useState<File[]>([]);const [coords,setCoords]=useState<{latitud:number|null;longitud:number|null}>({latitud:null,longitud:null});const [saving,setSaving]=useState(false);useEffect(()=>{if(tipo==='Devolución a nave'){setDestino(INVENTORY_BASE_LOCATION);setEstadoNuevo('Disponible')}else if(tipo==='Avería'){setDestino(item.ubicacionActual);setEstadoNuevo('Averiada')}else if(tipo==='Envío a reparación'){setEstadoNuevo('En reparación')}else if(tipo==='Regreso de reparación'){setEstadoNuevo('Disponible')}},[tipo]);return <Modal title={`Registrar movimiento · ${item.codigo}`} onClose={onClose}><form className="space-y-4" onSubmit={async e=>{e.preventDefault();if(!destino.trim())return;setSaving(true);try{await onSave({tipo,destino,estadoNuevo,observaciones,latitud:coords.latitud,longitud:coords.longitud,files})}finally{setSaving(false)}}}><div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3 text-sm"><b>{item.nombre}</b><div className="text-xs text-slate-500 mt-1">Origen: {item.ubicacionActual} · Estado: {item.estado}</div></div><Field label="Tipo de movimiento"><select className={inputClass} value={tipo} onChange={e=>setTipo(e.target.value)}>{MOVEMENT_TYPES.map(x=><option key={x}>{x}</option>)}</select></Field><Field label="Destino / obra"><input list="inventory-works" required className={inputClass} value={destino} onChange={e=>setDestino(e.target.value)} placeholder="Obra, taller, almacén…"/><datalist id="inventory-works">{savedObras.map(o=><option key={o} value={o}/>) }<option value={INVENTORY_BASE_LOCATION}/></datalist></Field><Field label="Estado al finalizar"><select className={inputClass} value={estadoNuevo} onChange={e=>setEstadoNuevo(e.target.value)}>{STATUS_OPTIONS.map(s=><option key={s}>{s}</option>)}</select></Field><Field label="Observaciones"><textarea rows={3} className={inputClass} value={observaciones} onChange={e=>setObservaciones(e.target.value)} placeholder="Daños, accesorios, incidencias, condiciones de entrega…"/></Field><div className="grid sm:grid-cols-2 gap-3"><div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3"><div className="text-xs font-bold flex items-center gap-2"><ImageIcon className="w-4 h-4"/>Fotos de evidencia (opcional)</div><input type="file" accept="image/*" multiple capture="environment" onChange={e=>setFiles(Array.from(e.target.files||[]).slice(0,4))} className="mt-2 block w-full text-xs"/><div className="text-[10px] text-slate-400 mt-1">Máximo 4 fotos de salida, entrada, daño o accesorios.</div></div><div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3"><div className="text-xs font-bold flex items-center gap-2"><MapPinned className="w-4 h-4"/>Geolocalización (opcional)</div><button type="button" onClick={()=>navigator.geolocation?.getCurrentPosition(p=>setCoords({latitud:p.coords.latitude,longitud:p.coords.longitude}),()=>alert('No se pudo obtener la ubicación.'))} className="mt-2 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-bold">Usar ubicación actual</button>{coords.latitud!=null&&<div className="text-[10px] text-emerald-600 mt-2">Ubicación registrada ✓</div>}</div></div><div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 font-bold text-sm">Cancelar</button><button disabled={saving} className="px-5 py-2 rounded-xl bg-brand-primary text-white font-bold text-sm disabled:opacity-50">{saving?'Registrando…':'Registrar movimiento'}</button></div></form></Modal>};

const MaintenanceModal = ({item,onClose,onSave}:{item:InventoryItem;onClose:()=>void;onSave:(d:any)=>Promise<void>}) => {const [tipo,setTipo]=useState('Mantenimiento preventivo');const [fecha,setFecha]=useState(new Date().toISOString().slice(0,10));const [next,setNext]=useState('');const [provider,setProvider]=useState('');const [cost,setCost]=useState('');const [obs,setObs]=useState('');const [busy,setBusy]=useState(false);return <Modal title={`Mantenimiento · ${item.codigo}`} onClose={onClose}><form className="grid sm:grid-cols-2 gap-4" onSubmit={async e=>{e.preventDefault();setBusy(true);try{await onSave({tipo,fecha,proximaRevision:next||null,proveedor:provider||null,coste:cost?Number(cost):null,observaciones:obs,createdBy:null})}finally{setBusy(false)}}}><Field label="Tipo"><select className={inputClass} value={tipo} onChange={e=>setTipo(e.target.value)}><option>Mantenimiento preventivo</option><option>Revisión</option><option>Reparación</option><option>Avería</option><option>ITV / inspección</option><option>Otro</option></select></Field><Field label="Fecha"><input required type="date" className={inputClass} value={fecha} onChange={e=>setFecha(e.target.value)}/></Field><Field label="Próxima revisión"><input type="date" className={inputClass} value={next} onChange={e=>setNext(e.target.value)}/></Field><Field label="Proveedor / taller"><input className={inputClass} value={provider} onChange={e=>setProvider(e.target.value)}/></Field><Field label="Coste"><input type="number" step="0.01" className={inputClass} value={cost} onChange={e=>setCost(e.target.value)}/></Field><div className="sm:col-span-2"><Field label="Observaciones"><textarea rows={3} className={inputClass} value={obs} onChange={e=>setObs(e.target.value)}/></Field></div><div className="sm:col-span-2 flex justify-end gap-2"><button type="button" onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 font-bold text-sm">Cancelar</button><button disabled={busy} className="px-5 py-2 rounded-xl bg-brand-primary text-white font-bold text-sm disabled:opacity-50">Guardar actuación</button></div></form></Modal>};
