import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Boxes,
  Building2,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  ClipboardList,
  Download,
  Edit3,
  FileCheck2,
  FileText,
  FolderOpen,
  History,
  Image as ImageIcon,
  Mail,
  MapPinned,
  PackageCheck,
  Plus,
  QrCode,
  RefreshCw,
  Save,
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
  INVENTORY_ZONES,
  MACHINE_DOCUMENT_TYPES,
  InventoryDocument,
  InventoryItem,
  InventoryMaintenance,
  InventoryMovement,
  InventoryPark,
  addInventoryDocument,
  addInventoryMaintenance,
  createInventoryDocumentMailLinks,
  deleteInventoryDocument,
  ensureInventoryReady,
  listInventoryDocuments,
  listInventoryItems,
  listInventoryMaintenance,
  listInventoryMovements,
  listInventoryParks,
  parkBaseLocation,
  registerInventoryMovement,
  saveInventoryItem,
  shareInventoryParkByEmail,
  softDeleteInventoryItem,
  updateInventoryPark,
  uploadInventoryDocuments,
  uploadInventoryPhotos,
} from '../src/services/inventoryService';

interface InventorySectionProps { savedObras: string[]; }
type Tab = 'resumen' | 'inventario' | 'movimientos' | 'mantenimiento' | 'documentacion' | 'trazabilidad';

const STATUS_OPTIONS = ['Disponible', 'Asignada a obra', 'En traslado', 'Averiada', 'En reparación', 'Pendiente de revisión', 'Fuera de servicio', 'Baja'];
const MOVEMENT_TYPES = ['Salida a obra', 'Traslado', 'Devolución a nave', 'Avería', 'Envío a reparación', 'Regreso de reparación', 'Cambio de estado'];
const REQUIRED_MACHINE_DOCS = ['Marcado CE / placa identificativa', 'Declaración CE de conformidad', 'Manual de instrucciones', 'Revisión / comprobación periódica'];

const statusClass = (status: string) => {
  const s = (status || '').toLowerCase();
  if (s.includes('aver') || s.includes('fuera') || s.includes('baja')) return 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800';
  if (s.includes('repar') || s.includes('revisión')) return 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800';
  if (s.includes('obra') || s.includes('traslado')) return 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800';
  return 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800';
};

const inputClass = 'w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm';
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => <label className="block"><span className="block text-[10px] uppercase tracking-wider font-black text-slate-400 mb-1.5">{label}</span>{children}</label>;
const Modal = ({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) => <div className="fixed inset-0 z-[80] bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4"><div className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl"><div className="sticky top-0 z-10 flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur"><h3 className="font-black">{title}</h3><button onClick={onClose} className="w-9 h-9 grid place-items-center rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"><X className="w-5 h-5" /></button></div><div className="p-5">{children}</div></div></div>;
const Kpi = ({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) => <div className="ui-surface p-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-xl bg-brand-primary/10 text-brand-primary grid place-items-center [&>svg]:w-5 [&>svg]:h-5">{icon}</div><div><div className="text-2xl font-black text-slate-800 dark:text-white">{value}</div><div className="text-[11px] uppercase tracking-wider font-bold text-slate-400">{label}</div></div></div></div>;
const Action = ({ title, onClick, icon, danger = false }: { title: string; onClick: () => void; icon: React.ReactNode; danger?: boolean }) => <button type="button" title={title} onClick={onClick} className={`w-8 h-8 grid place-items-center rounded-lg border transition-colors [&>svg]:w-4 [&>svg]:h-4 ${danger ? 'border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>{icon}</button>;

export const InventorySection: React.FC<InventorySectionProps> = ({ savedObras }) => {
  const [tab, setTab] = useState<Tab>('resumen');
  const [parks, setParks] = useState<InventoryPark[]>([]);
  const [park, setPark] = useState<InventoryPark | null>(null);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [maintenance, setMaintenance] = useState<InventoryMaintenance[]>([]);
  const [documents, setDocuments] = useState<InventoryDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [editingItem, setEditingItem] = useState<(Partial<InventoryItem> & { nombre: string; categoria: string }) | null>(null);
  const [movementItem, setMovementItem] = useState<InventoryItem | null>(null);
  const [maintenanceItem, setMaintenanceItem] = useState<InventoryItem | null>(null);
  const [documentItem, setDocumentItem] = useState<InventoryItem | null>(null);
  const [traceItemId, setTraceItemId] = useState('');
  const [shareEmail, setShareEmail] = useState('');
  const [shareBusy, setShareBusy] = useState(false);
  const [qrItem, setQrItem] = useState<InventoryItem | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [parkName, setParkName] = useState('');
  const [parkZone, setParkZone] = useState('Zona 1');
  const [coordinatorEmail, setCoordinatorEmail] = useState('');
  const [parkSaving, setParkSaving] = useState(false);

  const loadParkData = async (selected: InventoryPark) => {
    setPark(selected);
    setParkName(selected.nombre);
    setParkZone(selected.zona);
    setCoordinatorEmail(selected.coordinatorEmail || '');
    const [i, m, mt, docs] = await Promise.all([
      listInventoryItems(selected.id),
      listInventoryMovements(selected.id),
      listInventoryMaintenance(selected.id),
      listInventoryDocuments(selected.id),
    ]);
    setItems(i); setMovements(m); setMaintenance(mt); setDocuments(docs);
    const requestedId = new URLSearchParams(window.location.search).get('inventoryItem');
    if (requestedId && i.some(x => x.id === requestedId)) { setTraceItemId(requestedId); setTab('trazabilidad'); }
    else if (!traceItemId && i.length) setTraceItemId(i[0].id);
  };

  const reload = async (preferredParkId?: string) => {
    setLoading(true); setError('');
    try {
      const ensured = await ensureInventoryReady();
      const all = await listInventoryParks();
      setParks(all);
      const selected = all.find(p => p.id === preferredParkId) || all.find(p => p.id === park?.id) || all.find(p => p.id === ensured.id) || all[0];
      if (selected) await loadParkData(selected);
    } catch (e: any) { setError(e?.message || 'No se pudo cargar el inventario.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { void reload(); }, []);

  const baseLocation = park ? parkBaseLocation(park) : '';
  const activeItems = useMemo(() => items.filter(i => i.activo), [items]);
  const categories = useMemo<string[]>(() => Array.from(
    new Set<string>(activeItems.map(item => String(item.categoria || '')).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, 'es')), [activeItems]);
  const filtered = useMemo(() => activeItems.filter(i => {
    const q = search.trim().toLowerCase();
    const hay = [i.codigo, i.nombre, i.categoria, i.marca, i.modelo, i.numeroSerie, i.matricula, i.ubicacionActual].filter(Boolean).join(' ').toLowerCase();
    return (!q || hay.includes(q)) && (!category || i.categoria === category) && (!status || i.estado === status);
  }), [activeItems, search, category, status]);
  const kpis = useMemo(() => ({
    total: activeItems.reduce((a, i) => a + (i.cantidad || 1), 0),
    disponibles: activeItems.filter(i => i.estado === 'Disponible').length,
    obra: activeItems.filter(i => i.estado === 'Asignada a obra').length,
    incidencias: activeItems.filter(i => /aver|repar|revisión|fuera/i.test(i.estado)).length,
  }), [activeItems]);
  const docsByItem = useMemo(() => documents.reduce((map, doc) => { const list = map.get(doc.itemId) || []; list.push(doc); map.set(doc.itemId, list); return map; }, new Map<string, InventoryDocument[]>()), [documents]);
  const traceMovements = useMemo(() => movements.filter(m => m.itemId === traceItemId).slice().reverse(), [movements, traceItemId]);

  const openQr = async (item: InventoryItem) => {
    const url = new URL(window.location.href); url.search = ''; url.searchParams.set('inventoryItem', item.id);
    setQrItem(item); setQrDataUrl(await QRCode.toDataURL(url.toString(), { width: 320, margin: 2 }));
  };

  const saveParkConfig = async () => {
    if (!park) return;
    setParkSaving(true);
    try {
      const updated = await updateInventoryPark(park.id, { nombre: parkName, zona: parkZone, coordinatorEmail });
      setPark(updated);
      await reload(updated.id);
    } catch (e: any) { alert(e?.message || 'No se pudo guardar la configuración del parque.'); }
    finally { setParkSaving(false); }
  };

  if (loading) return <div className="ui-surface p-10 flex items-center justify-center gap-3"><RefreshCw className="w-5 h-5 animate-spin" /> Cargando parque de maquinaria…</div>;

  return <div className="space-y-6 pb-10">
    <PageHeader
      eyebrow={`${park?.zona || 'Zona'} · ${park?.isOwned === false ? 'Parque compartido' : 'Parque propio'}`}
      title="Herramientas y maquinaria"
      description={`Inventario, mantenimiento, documentación y trazabilidad de ${park?.nombre || 'tu parque o nave logística'}.`}
      icon={<Wrench className="h-5 w-5" />}
    />

    {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"><AlertTriangle className="inline w-4 h-4 mr-2" />{error}</div>}

    <div className="ui-surface p-4 sm:p-5 space-y-4">
      <div className="grid lg:grid-cols-[1fr_auto] gap-4 lg:items-end">
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Parque / nave visible"><select className={inputClass} value={park?.id || ''} onChange={async e => { const p = parks.find(x => x.id === e.target.value); if (p) { setLoading(true); try { await loadParkData(p); } finally { setLoading(false); } } }}>{parks.map(p => <option key={p.id} value={p.id}>{p.zona} · {p.nombre}{p.isOwned === false ? ' · Compartido' : ''}</option>)}</select></Field>
          <Field label="Nombre del parque / nave"><input className={inputClass} value={parkName} onChange={e => setParkName(e.target.value)} placeholder="Ej. Parque de maquinaria San Fernando" /></Field>
          <Field label="Zona"><select className={inputClass} value={parkZone} onChange={e => setParkZone(e.target.value)}>{INVENTORY_ZONES.map(z => <option key={z}>{z}</option>)}</select></Field>
        </div>
        <button onClick={() => void saveParkConfig()} disabled={parkSaving} className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-primary text-white px-4 py-2.5 text-sm font-bold disabled:opacity-50"><Save className="w-4 h-4" />{parkSaving ? 'Guardando…' : 'Guardar parque'}</button>
      </div>
      <div className="grid lg:grid-cols-2 gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
        <Field label="Correo del coordinador de seguridad"><input type="email" className={inputClass} value={coordinatorEmail} onChange={e => setCoordinatorEmail(e.target.value)} placeholder="coordinador@empresa.es" /></Field>
        <form className="flex gap-2 items-end" onSubmit={async e => { e.preventDefault(); if (!park || !shareEmail.trim()) return; setShareBusy(true); try { await shareInventoryParkByEmail(park.id, shareEmail); alert(`Zona compartida con ${shareEmail}.`); setShareEmail(''); await reload(park.id); } catch (err: any) { alert(err?.message || 'No se pudo compartir el parque.'); } finally { setShareBusy(false); } }}>
          <Field label="Compartir zona con otro supervisor"><input type="email" className={inputClass} value={shareEmail} onChange={e => setShareEmail(e.target.value)} placeholder="correo del supervisor" /></Field>
          <button disabled={shareBusy} className="h-[42px] inline-flex items-center gap-2 rounded-xl bg-slate-900 dark:bg-blue-600 text-white px-4 text-sm font-bold disabled:opacity-50"><Share2 className="w-4 h-4" />Compartir</button>
        </form>
      </div>
      <div className="text-xs text-slate-500">Las zonas compartidas se identifican solo por <b>zona y nombre del parque</b>; la interfaz no muestra nombres ni apellidos de otros supervisores. La autoría técnica queda registrada internamente para auditoría.</div>
    </div>

    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Kpi icon={<Boxes />} label="Unidades" value={kpis.total} /><Kpi icon={<PackageCheck />} label="Disponibles" value={kpis.disponibles} /><Kpi icon={<Building2 />} label="En obra" value={kpis.obra} /><Kpi icon={<AlertTriangle />} label="Incidencias" value={kpis.incidencias} />
    </div>

    <div className="flex flex-wrap gap-2">{([
      ['resumen', 'Resumen', ClipboardList], ['inventario', 'Inventario', Boxes], ['movimientos', 'Movimientos', History],
      ['mantenimiento', 'Mantenimiento', Stethoscope], ['documentacion', 'Documentación', FileCheck2], ['trazabilidad', 'Mapa y trazabilidad', MapPinned],
    ] as [Tab, string, React.ElementType][]).map(([id, label, Icon]) => <button key={id} onClick={() => setTab(id)} className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold border transition-all ${tab === id ? 'bg-brand-primary text-white border-brand-primary shadow-md' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-brand-primary/50'}`}><Icon className="w-4 h-4" />{label}</button>)}</div>

    {tab === 'resumen' && <SummaryView items={activeItems} movements={movements} documents={documents} onOpenItem={id => { setTraceItemId(id); setTab('trazabilidad'); }} />}
    {tab === 'inventario' && <div className="ui-surface overflow-hidden">
      <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 flex flex-col xl:flex-row gap-3 xl:items-center xl:justify-between"><div className="flex flex-col sm:flex-row gap-2 flex-1"><div className="relative flex-1"><SearchIcon value={search} onChange={setSearch} /></div><select value={category} onChange={e => setCategory(e.target.value)} className={inputClass}><option value="">Todas las categorías</option>{categories.map(c => <option key={c}>{c}</option>)}</select><select value={status} onChange={e => setStatus(e.target.value)} className={inputClass}><option value="">Todos los estados</option>{STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}</select></div><button onClick={() => setEditingItem({ codigo: '', categoria: '', nombre: '', cantidad: 1, tipoGestion: 'individual', estado: 'Disponible', ubicacionActual: baseLocation, detalles: {}, observaciones: '', activo: true })} className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-primary text-white px-4 py-2 text-sm font-bold"><Plus className="w-4 h-4" />Añadir equipo</button></div>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 dark:bg-slate-800/60 text-[11px] uppercase tracking-wider text-slate-500"><tr><th className="p-3 text-left">Código</th><th className="p-3 text-left">Equipo</th><th className="p-3 text-left">Estado</th><th className="p-3 text-left">Ubicación</th><th className="p-3 text-left">Documentos</th><th className="p-3 text-right">Acciones</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{filtered.map(item => { const docs = docsByItem.get(item.id) || []; return <tr key={item.id}><td className="p-3 font-mono text-xs font-bold">{item.codigo}</td><td className="p-3"><div className="font-bold">{item.nombre}</div><div className="text-xs text-slate-500">{item.categoria} · {[item.marca, item.modelo, item.numeroSerie].filter(Boolean).join(' · ') || 'Sin identificación adicional'}</div></td><td className="p-3"><span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold ${statusClass(item.estado)}`}>{item.estado}</span></td><td className="p-3 text-xs">{item.ubicacionActual}</td><td className="p-3 text-xs"><button onClick={() => { setDocumentItem(item); setTab('documentacion'); }} className="font-bold text-brand-primary">{docs.length} archivo(s)</button></td><td className="p-3"><div className="flex justify-end gap-1.5"><Action title="Movimiento" onClick={() => setMovementItem(item)} icon={<Truck />} /><Action title="Mantenimiento" onClick={() => setMaintenanceItem(item)} icon={<Stethoscope />} /><Action title="Documentación" onClick={() => { setDocumentItem(item); setTab('documentacion'); }} icon={<FolderOpen />} /><Action title="Editar" onClick={() => setEditingItem({ ...item })} icon={<Edit3 />} /><Action title="QR" onClick={() => void openQr(item)} icon={<QrCode />} /><Action title="Trazabilidad" onClick={() => { setTraceItemId(item.id); setTab('trazabilidad'); }} icon={<MapPinned />} /><Action title="Dar de baja" danger onClick={async () => { if (!confirm(`¿Dar de baja ${item.nombre}?`)) return; await softDeleteInventoryItem(item.id); await reload(park?.id); }} icon={<Trash2 />} /></div></td></tr>; })}</tbody></table></div>
    </div>}

    {tab === 'movimientos' && <MovementsView movements={movements} items={items} onTrace={id => { setTraceItemId(id); setTab('trazabilidad'); }} />}
    {tab === 'mantenimiento' && <MaintenanceView maintenance={maintenance} items={items} onAdd={setMaintenanceItem} />}
    {tab === 'documentacion' && park && <DocumentsView park={park} items={activeItems} documents={documents} selectedItem={documentItem} setSelectedItem={setDocumentItem} onReload={() => reload(park.id)} />}
    {tab === 'trazabilidad' && park && <TraceView park={park} items={activeItems} selectedId={traceItemId} setSelectedId={setTraceItemId} movements={traceMovements} />}

    {editingItem && park && <ItemModal item={editingItem} categories={categories} baseLocation={baseLocation} onClose={() => setEditingItem(null)} onSave={async draft => { await saveInventoryItem(park.id, draft, baseLocation); setEditingItem(null); await reload(park.id); }} />}
    {movementItem && park && <MovementModal item={movementItem} savedObras={savedObras} baseLocation={baseLocation} onClose={() => setMovementItem(null)} onSave={async data => { let paths: string[] = []; if (data.files.length) paths = await uploadInventoryPhotos(park.id, movementItem.id, data.files); await registerInventoryMovement({ ...data, fotoPaths: paths, itemId: movementItem.id }); setMovementItem(null); await reload(park.id); }} />}
    {maintenanceItem && park && <MaintenanceModal item={maintenanceItem} onClose={() => setMaintenanceItem(null)} onSave={async d => { const paths = d.files.length ? await uploadInventoryDocuments(park.id, maintenanceItem.id, d.files, 'maintenance') : []; await addInventoryMaintenance(park.id, maintenanceItem.id, { tipo: d.tipo, fecha: d.fecha, proximaRevision: d.proximaRevision, proveedor: d.proveedor, mechanicName: d.mechanicName, coste: d.coste, observaciones: d.observaciones, signedDocumentPaths: paths, createdBy: null }); setMaintenanceItem(null); await reload(park.id); }} />}
    {qrItem && <Modal title={`QR · ${qrItem.nombre}`} onClose={() => setQrItem(null)}><div className="text-center"><img src={qrDataUrl} alt="Código QR del equipo" className="mx-auto w-64 h-64 rounded-xl bg-white p-3" /><div className="mt-3 font-bold">{qrItem.codigo}</div><div className="text-xs text-slate-500">Abre la trazabilidad y documentación del equipo.</div></div></Modal>}
  </div>;
};

const SearchIcon = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => <div className="relative"><svg className="absolute left-3 top-3 w-4 h-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg><input value={value} onChange={e => onChange(e.target.value)} placeholder="Buscar código, equipo, serie, ubicación…" className={`${inputClass} pl-9`} /></div>;

const SummaryView = ({ items, movements, documents, onOpenItem }: { items: InventoryItem[]; movements: InventoryMovement[]; documents: InventoryDocument[]; onOpenItem: (id: string) => void }) => {
  const grouped = useMemo(() => Array.from(items.reduce((m, i) => m.set(i.categoria, (m.get(i.categoria) || 0) + (i.cantidad || 1)), new Map<string, number>()).entries()).sort((a, b) => b[1] - a[1]).slice(0, 12), [items]);
  return <div className="grid lg:grid-cols-2 gap-4"><div className="ui-surface p-5"><h3 className="font-black mb-4 flex items-center gap-2"><Boxes className="w-5 h-5 text-brand-primary" />Inventario por familia</h3><div className="space-y-2">{grouped.map(([name, count]) => <div key={name} className="flex items-center justify-between rounded-xl bg-slate-50 dark:bg-slate-800/50 px-3 py-2"><span className="text-sm font-semibold">{name}</span><span className="text-xs font-black">{count}</span></div>)}</div><div className="mt-5 rounded-xl border border-slate-200 dark:border-slate-800 p-4"><div className="text-xs font-black uppercase text-slate-400">Expediente documental</div><div className="text-2xl font-black mt-1">{documents.length}</div><div className="text-xs text-slate-500">documentos de maquinaria archivados y descargables</div></div></div><div className="ui-surface p-5"><h3 className="font-black mb-4 flex items-center gap-2"><History className="w-5 h-5 text-brand-primary" />Últimos movimientos</h3><div className="space-y-3">{movements.slice(0, 10).map(m => { const item = items.find(i => i.id === m.itemId); return <button key={m.id} onClick={() => onOpenItem(m.itemId)} className="w-full text-left rounded-xl border border-slate-200 dark:border-slate-800 p-3"><div className="font-bold text-sm">{item?.nombre || 'Equipo'}</div><div className="text-xs text-slate-500 mt-1">{m.tipo}: {m.origen} → {m.destino}</div><div className="text-[10px] text-slate-400 mt-1">{new Date(m.createdAt).toLocaleString('es-ES')} · Supervisor autorizado</div></button>; })}</div></div></div>;
};

const MovementsView = ({ movements, items, onTrace }: { movements: InventoryMovement[]; items: InventoryItem[]; onTrace: (id: string) => void }) => <div className="ui-surface overflow-hidden"><div className="p-5 border-b border-slate-200 dark:border-slate-800"><h3 className="font-black">Registro completo de movimientos</h3><p className="text-xs text-slate-500 mt-1">La auditoría conserva internamente el usuario, pero las zonas compartidas no muestran nombres ni apellidos.</p></div><div className="divide-y divide-slate-100 dark:divide-slate-800">{movements.map(m => { const item = items.find(i => i.id === m.itemId); return <button key={m.id} onClick={() => onTrace(m.itemId)} className="w-full p-4 text-left"><div className="flex justify-between gap-3"><div><div className="font-bold">{item?.nombre || 'Equipo'}</div><div className="text-xs text-slate-500">{m.origen} → {m.destino}</div></div><div className="text-right"><div className="text-xs font-bold">{m.tipo}</div><div className="text-[10px] text-slate-400">{new Date(m.createdAt).toLocaleString('es-ES')} · Supervisor autorizado</div></div></div></button>; })}</div></div>;

const MaintenanceView = ({ maintenance, items, onAdd }: { maintenance: InventoryMaintenance[]; items: InventoryItem[]; onAdd: (i: InventoryItem) => void }) => <div className="grid lg:grid-cols-[1fr_320px] gap-4"><div className="ui-surface overflow-hidden"><div className="p-5 border-b border-slate-200 dark:border-slate-800"><h3 className="font-black">Historial de mantenimiento y revisiones</h3><p className="text-xs text-slate-500 mt-1">Los partes firmados del mecánico permanecen archivados y descargables durante la vida útil del equipo.</p></div><div className="divide-y divide-slate-100 dark:divide-slate-800">{maintenance.map(m => { const item = items.find(i => i.id === m.itemId); return <div key={m.id} className="p-4"><div className="flex flex-col sm:flex-row justify-between gap-3"><div><div className="font-bold">{item?.nombre || 'Equipo'} · {m.tipo}</div><div className="text-xs text-slate-500 mt-1">{m.fecha}{m.proximaRevision ? ` · Próxima revisión: ${m.proximaRevision}` : ''}{m.proveedor ? ` · ${m.proveedor}` : ''}{m.mechanicName ? ` · Mecánico: ${m.mechanicName}` : ''}</div>{m.observaciones && <div className="text-xs mt-2">{m.observaciones}</div>}<div className="flex flex-wrap gap-2 mt-3">{m.signedDocumentUrls?.map((d, idx) => <a key={d.path} href={d.url} target="_blank" rel="noreferrer" download className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-bold"><Download className="w-3.5 h-3.5" />Parte firmado {idx + 1}</a>)}</div></div>{m.coste != null && <div className="font-black">{m.coste.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })}</div>}</div></div>; })}{!maintenance.length && <div className="p-6 text-sm text-slate-500">No hay mantenimientos registrados.</div>}</div></div><div className="ui-surface p-5"><h3 className="font-black mb-3">Registrar actuación</h3><p className="text-xs text-slate-500 mb-4">Selecciona una máquina y adjunta el parte firmado del mecánico cuando corresponda.</p><div className="max-h-[520px] overflow-y-auto space-y-2">{items.filter(i => i.activo).map(i => <button key={i.id} onClick={() => onAdd(i)} className="w-full text-left p-3 rounded-xl border border-slate-200 dark:border-slate-800"><div className="font-bold text-sm">{i.nombre}</div><div className="text-[10px] text-slate-400">{i.codigo} · {i.estado}</div></button>)}</div></div></div>;

const DocumentsView = ({ park, items, documents, selectedItem, setSelectedItem, onReload }: { park: InventoryPark; items: InventoryItem[]; documents: InventoryDocument[]; selectedItem: InventoryItem | null; setSelectedItem: (i: InventoryItem | null) => void; onReload: () => Promise<void> }) => {
  const [uploadItem, setUploadItem] = useState<InventoryItem | null>(null);
  const [mailBusy, setMailBusy] = useState(false);
  const current = selectedItem || items[0] || null;
  const currentDocs = current ? documents.filter(d => d.itemId === current.id) : [];
  const missingRequired = REQUIRED_MACHINE_DOCS.filter(type => !currentDocs.some(d => d.documentType === type));
  const sendMail = async () => {
    if (!park.coordinatorEmail) return alert('Guarda primero el correo del coordinador de seguridad en la cabecera del parque.');
    if (!current || !currentDocs.length) return alert('No hay documentos de esta máquina para enviar.');
    setMailBusy(true);
    try {
      const docs = await createInventoryDocumentMailLinks(currentDocs, 60);
      const body = [`Documentación de seguridad de maquinaria`, '', `Equipo: ${current.nombre}`, `Código: ${current.codigo || '-'}`, `Parque: ${park.nombre} (${park.zona})`, '', 'Enlaces seguros de descarga (válidos temporalmente):', ...docs.map(d => `- ${d.documentType}: ${d.downloadUrl}`), '', 'Documentación remitida desde GestionProfea.'].join('\n');
      window.location.href = `mailto:${encodeURIComponent(park.coordinatorEmail)}?subject=${encodeURIComponent(`Documentación maquinaria · ${current.nombre}`)}&body=${encodeURIComponent(body)}`;
    } finally { setMailBusy(false); }
  };
  return <div className="space-y-4"><div className="ui-surface p-5"><div className="flex flex-col lg:flex-row gap-3 lg:items-end lg:justify-between"><Field label="Máquina / equipo"><select className={inputClass} value={current?.id || ''} onChange={e => setSelectedItem(items.find(i => i.id === e.target.value) || null)}>{items.map(i => <option key={i.id} value={i.id}>{i.codigo} · {i.nombre}</option>)}</select></Field><div className="flex gap-2"><button disabled={!current} onClick={() => current && setUploadItem(current)} className="inline-flex items-center gap-2 rounded-xl bg-brand-primary text-white px-4 py-2.5 text-sm font-bold"><Upload className="w-4 h-4" />Subir documento</button><button disabled={!current || mailBusy} onClick={() => void sendMail()} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2.5 text-sm font-bold"><Mail className="w-4 h-4" />Enviar al coordinador</button></div></div>{current && <div className={`mt-4 rounded-xl p-3 border ${missingRequired.length ? 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20' : 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/20'}`}><div className="font-bold text-sm">{missingRequired.length ? 'Expediente documental incompleto' : 'Documentación básica registrada'}</div><div className="text-xs mt-1 text-slate-600 dark:text-slate-300">{missingRequired.length ? `Pendiente: ${missingRequired.join(' · ')}` : 'Se han registrado las evidencias básicas de identificación, conformidad, instrucciones y comprobaciones.'}</div></div>}</div><div className="ui-surface overflow-hidden"><div className="p-5 border-b border-slate-200 dark:border-slate-800 font-black">Expediente documental del equipo</div><div className="divide-y divide-slate-100 dark:divide-slate-800">{currentDocs.map(doc => <div key={doc.id} className="p-4 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between"><div><div className="font-bold">{doc.documentType}</div><div className="text-xs text-slate-500">{doc.title}{doc.issueDate ? ` · Fecha: ${doc.issueDate}` : ''}{doc.expiryDate ? ` · Vence: ${doc.expiryDate}` : ''}</div>{doc.notes && <div className="text-xs mt-1">{doc.notes}</div>}</div><div className="flex gap-2"><a href={doc.downloadUrl} target="_blank" rel="noreferrer" download className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-bold"><Download className="w-4 h-4" />Descargar</a><button onClick={async () => { if (!confirm('¿Eliminar este documento del expediente?')) return; await deleteInventoryDocument(doc); await onReload(); }} className="w-9 h-9 grid place-items-center rounded-lg border border-red-200 text-red-600"><Trash2 className="w-4 h-4" /></button></div></div>)}{!currentDocs.length && <div className="p-6 text-sm text-slate-500">Todavía no hay documentos archivados para este equipo.</div>}</div></div>{uploadItem && <DocumentUploadModal park={park} item={uploadItem} onClose={() => setUploadItem(null)} onSaved={async () => { setUploadItem(null); await onReload(); }} />}</div>;
};

const TraceView = ({ park, items, selectedId, setSelectedId, movements }: { park: InventoryPark; items: InventoryItem[]; selectedId: string; setSelectedId: (s: string) => void; movements: InventoryMovement[] }) => {
  const item = items.find(i => i.id === selectedId);
  return <div className="grid xl:grid-cols-[320px_1fr] gap-4"><div className="ui-surface p-4"><Field label="Equipo"><select value={selectedId} onChange={e => setSelectedId(e.target.value)} className={inputClass}>{items.map(i => <option key={i.id} value={i.id}>{i.codigo} · {i.nombre}</option>)}</select></Field>{item && <div className="mt-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 p-4"><div className="text-xs text-slate-400 uppercase font-bold">Actualmente en</div><div className="font-black mt-1">{item.ubicacionActual}</div></div>}</div><div className="ui-surface p-5"><h3 className="font-black mb-4 flex items-center gap-2"><MapPinned className="w-5 h-5 text-brand-primary" />Línea completa de trazabilidad</h3><div className="relative pl-7 space-y-5 before:absolute before:left-[10px] before:top-2 before:bottom-2 before:w-px before:bg-slate-300 dark:before:bg-slate-700"><div className="relative"><CircleDot className="absolute -left-7 top-0 w-5 h-5 text-brand-primary bg-white dark:bg-slate-900" /><div className="font-bold text-sm">{parkBaseLocation(park)}</div><div className="text-[10px] text-slate-400">Parque base</div></div>{movements.map((m, idx) => <div key={m.id} className="relative"><CircleDot className="absolute -left-7 top-0 w-5 h-5 text-brand-primary bg-white dark:bg-slate-900" /><div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3"><div className="font-bold text-sm">{idx + 1}. {m.tipo} → {m.destino}</div><div className="text-[10px] text-slate-400">{new Date(m.createdAt).toLocaleString('es-ES')} · Supervisor autorizado</div>{m.observaciones && <div className="text-xs mt-2">{m.observaciones}</div>}</div></div>)}</div></div></div>;
};

const ItemModal = ({ item, categories, baseLocation, onClose, onSave }: { item: Partial<InventoryItem> & { nombre: string; categoria: string }; categories: string[]; baseLocation: string; onClose: () => void; onSave: (i: any) => Promise<void> }) => { const [d, setD] = useState({ ...item, ubicacionActual: item.ubicacionActual || baseLocation }); const [saving, setSaving] = useState(false); return <Modal title={item.id ? 'Editar equipo' : 'Añadir herramienta o maquinaria'} onClose={onClose}><form onSubmit={async e => { e.preventDefault(); setSaving(true); try { await onSave(d); } finally { setSaving(false); } }} className="grid sm:grid-cols-2 gap-4"><Field label="Código interno"><input className={inputClass} value={d.codigo || ''} onChange={e => setD({ ...d, codigo: e.target.value })} /></Field><Field label="Categoría"><input list="inventory-categories" required className={inputClass} value={d.categoria || ''} onChange={e => setD({ ...d, categoria: e.target.value })} /><datalist id="inventory-categories">{categories.map(c => <option key={c} value={c} />)}</datalist></Field><div className="sm:col-span-2"><Field label="Equipo / descripción"><input required className={inputClass} value={d.nombre || ''} onChange={e => setD({ ...d, nombre: e.target.value })} /></Field></div><Field label="Marca"><input className={inputClass} value={d.marca || ''} onChange={e => setD({ ...d, marca: e.target.value })} /></Field><Field label="Modelo"><input className={inputClass} value={d.modelo || ''} onChange={e => setD({ ...d, modelo: e.target.value })} /></Field><Field label="Nº serie"><input className={inputClass} value={d.numeroSerie || ''} onChange={e => setD({ ...d, numeroSerie: e.target.value })} /></Field><Field label="Matrícula"><input className={inputClass} value={d.matricula || ''} onChange={e => setD({ ...d, matricula: e.target.value })} /></Field><Field label="Cantidad"><input type="number" min="1" className={inputClass} value={d.cantidad || 1} onChange={e => setD({ ...d, cantidad: Number(e.target.value) || 1 })} /></Field><Field label="Estado"><select className={inputClass} value={d.estado || 'Disponible'} onChange={e => setD({ ...d, estado: e.target.value })}>{STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}</select></Field><div className="sm:col-span-2"><Field label="Ubicación actual"><input className={inputClass} value={d.ubicacionActual || ''} onChange={e => setD({ ...d, ubicacionActual: e.target.value })} /></Field></div><div className="sm:col-span-2"><Field label="Observaciones"><textarea rows={3} className={inputClass} value={d.observaciones || ''} onChange={e => setD({ ...d, observaciones: e.target.value })} /></Field></div><div className="sm:col-span-2 flex justify-end gap-2"><button type="button" onClick={onClose} className="px-4 py-2 rounded-xl border font-bold text-sm">Cancelar</button><button disabled={saving} className="px-5 py-2 rounded-xl bg-brand-primary text-white font-bold text-sm">Guardar</button></div></form></Modal>; };

const MovementModal = ({ item, savedObras, baseLocation, onClose, onSave }: { item: InventoryItem; savedObras: string[]; baseLocation: string; onClose: () => void; onSave: (d: any) => Promise<void> }) => { const [tipo, setTipo] = useState('Salida a obra'); const [destino, setDestino] = useState(''); const [estadoNuevo, setEstadoNuevo] = useState('Asignada a obra'); const [observaciones, setObservaciones] = useState(''); const [files, setFiles] = useState<File[]>([]); const [saving, setSaving] = useState(false); useEffect(() => { if (tipo === 'Devolución a nave') { setDestino(baseLocation); setEstadoNuevo('Disponible'); } else if (tipo === 'Avería') { setDestino(item.ubicacionActual); setEstadoNuevo('Averiada'); } else if (tipo === 'Envío a reparación') setEstadoNuevo('En reparación'); else if (tipo === 'Regreso de reparación') setEstadoNuevo('Disponible'); }, [tipo, baseLocation]); return <Modal title={`Registrar movimiento · ${item.codigo}`} onClose={onClose}><form className="space-y-4" onSubmit={async e => { e.preventDefault(); if (!destino.trim()) return; setSaving(true); try { await onSave({ tipo, destino, estadoNuevo, observaciones, files }); } finally { setSaving(false); } }}><Field label="Tipo de movimiento"><select className={inputClass} value={tipo} onChange={e => setTipo(e.target.value)}>{MOVEMENT_TYPES.map(x => <option key={x}>{x}</option>)}</select></Field><Field label="Destino / obra"><input list="inventory-works" required className={inputClass} value={destino} onChange={e => setDestino(e.target.value)} /><datalist id="inventory-works">{savedObras.map(o => <option key={o} value={o} />)}<option value={baseLocation} /></datalist></Field><Field label="Estado al finalizar"><select className={inputClass} value={estadoNuevo} onChange={e => setEstadoNuevo(e.target.value)}>{STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}</select></Field><Field label="Observaciones"><textarea rows={3} className={inputClass} value={observaciones} onChange={e => setObservaciones(e.target.value)} /></Field><Field label="Fotos de evidencia"><input type="file" accept="image/*" multiple capture="environment" onChange={e => setFiles(Array.from(e.target.files || []).slice(0, 4))} className="block w-full text-xs" /></Field><div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="px-4 py-2 rounded-xl border font-bold text-sm">Cancelar</button><button disabled={saving} className="px-5 py-2 rounded-xl bg-brand-primary text-white font-bold text-sm">Registrar movimiento</button></div></form></Modal>; };

const MaintenanceModal = ({ item, onClose, onSave }: { item: InventoryItem; onClose: () => void; onSave: (d: any) => Promise<void> }) => { const [tipo, setTipo] = useState('Revisión / comprobación periódica'); const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10)); const [next, setNext] = useState(''); const [provider, setProvider] = useState(''); const [mechanicName, setMechanicName] = useState(''); const [cost, setCost] = useState(''); const [obs, setObs] = useState(''); const [files, setFiles] = useState<File[]>([]); const [busy, setBusy] = useState(false); return <Modal title={`Mantenimiento · ${item.codigo}`} onClose={onClose}><form className="grid sm:grid-cols-2 gap-4" onSubmit={async e => { e.preventDefault(); setBusy(true); try { await onSave({ tipo, fecha, proximaRevision: next || null, proveedor: provider || null, mechanicName: mechanicName || null, coste: cost ? Number(cost) : null, observaciones: obs, files }); } finally { setBusy(false); } }}><Field label="Tipo"><select className={inputClass} value={tipo} onChange={e => setTipo(e.target.value)}><option>Revisión / comprobación periódica</option><option>Mantenimiento preventivo</option><option>Reparación</option><option>Avería</option><option>ITV / inspección</option><option>Otro</option></select></Field><Field label="Fecha"><input required type="date" className={inputClass} value={fecha} onChange={e => setFecha(e.target.value)} /></Field><Field label="Próxima revisión"><input type="date" className={inputClass} value={next} onChange={e => setNext(e.target.value)} /></Field><Field label="Proveedor / taller"><input className={inputClass} value={provider} onChange={e => setProvider(e.target.value)} /></Field><Field label="Mecánico / técnico competente"><input className={inputClass} value={mechanicName} onChange={e => setMechanicName(e.target.value)} /></Field><Field label="Coste"><input type="number" step="0.01" className={inputClass} value={cost} onChange={e => setCost(e.target.value)} /></Field><div className="sm:col-span-2"><Field label="Parte firmado del mecánico / revisión"><input type="file" accept="application/pdf,image/*" multiple onChange={e => setFiles(Array.from(e.target.files || []).slice(0, 4))} className="block w-full text-sm" /><div className="text-[10px] text-slate-400 mt-1">PDF o imagen del documento firmado. Quedará archivado y disponible para descarga.</div></Field></div><div className="sm:col-span-2"><Field label="Observaciones"><textarea rows={3} className={inputClass} value={obs} onChange={e => setObs(e.target.value)} /></Field></div><div className="sm:col-span-2 flex justify-end gap-2"><button type="button" onClick={onClose} className="px-4 py-2 rounded-xl border font-bold text-sm">Cancelar</button><button disabled={busy} className="px-5 py-2 rounded-xl bg-brand-primary text-white font-bold text-sm">Guardar actuación</button></div></form></Modal>; };

const DocumentUploadModal = ({ park, item, onClose, onSaved }: { park: InventoryPark; item: InventoryItem; onClose: () => void; onSaved: () => Promise<void> }) => { const [type, setType] = useState<string>(MACHINE_DOCUMENT_TYPES[0]); const [title, setTitle] = useState(''); const [issueDate, setIssueDate] = useState(''); const [expiryDate, setExpiryDate] = useState(''); const [notes, setNotes] = useState(''); const [file, setFile] = useState<File | null>(null); const [busy, setBusy] = useState(false); return <Modal title={`Subir documentación · ${item.nombre}`} onClose={onClose}><form className="grid sm:grid-cols-2 gap-4" onSubmit={async e => { e.preventDefault(); if (!file) return alert('Selecciona el documento que deseas archivar.'); setBusy(true); try { await addInventoryDocument({ parkId: park.id, itemId: item.id, documentType: type, title: title || file.name, file, issueDate: issueDate || null, expiryDate: expiryDate || null, notes: notes || null }); await onSaved(); } finally { setBusy(false); } }}><div className="sm:col-span-2"><Field label="Tipo de documento"><select className={inputClass} value={type} onChange={e => setType(e.target.value)}>{MACHINE_DOCUMENT_TYPES.map(t => <option key={t}>{t}</option>)}</select></Field></div><div className="sm:col-span-2"><Field label="Título"><input className={inputClass} value={title} onChange={e => setTitle(e.target.value)} placeholder="Ej. Declaración CE de conformidad" /></Field></div><Field label="Fecha de emisión"><input type="date" className={inputClass} value={issueDate} onChange={e => setIssueDate(e.target.value)} /></Field><Field label="Fecha de caducidad / próxima revisión"><input type="date" className={inputClass} value={expiryDate} onChange={e => setExpiryDate(e.target.value)} /></Field><div className="sm:col-span-2"><Field label="Archivo"><input required type="file" accept="application/pdf,image/*" onChange={e => setFile(e.target.files?.[0] || null)} className="block w-full text-sm" /></Field></div><div className="sm:col-span-2"><Field label="Notas"><textarea rows={3} className={inputClass} value={notes} onChange={e => setNotes(e.target.value)} /></Field></div><div className="sm:col-span-2 flex justify-end gap-2"><button type="button" onClick={onClose} className="px-4 py-2 rounded-xl border font-bold text-sm">Cancelar</button><button disabled={busy} className="px-5 py-2 rounded-xl bg-brand-primary text-white font-bold text-sm">{busy ? 'Subiendo…' : 'Guardar documento'}</button></div></form></Modal>; };
