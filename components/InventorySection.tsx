import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Boxes,
  Building2,
  Camera,
  CircleDot,
  ClipboardList,
  Download,
  Edit3,
  FileCheck2,
  FileDown,
  FolderOpen,
  History,
  Mail,
  MapPinned,
  Navigation,
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
import { exportInventoryStatusPdf } from '../src/lib/inventoryPdf';
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
  deleteInventoryMovement,
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
  updateInventoryMovement,
  updateInventoryPark,
  uploadInventoryDocuments,
  uploadInventoryPhotos,
} from '../src/services/inventoryService';

interface InventorySectionProps { savedObras: string[]; }
type Tab = 'resumen' | 'inventario' | 'movimientos' | 'mantenimiento' | 'documentacion' | 'trazabilidad';

const STATUS_OPTIONS = ['Disponible', 'Asignada a obra', 'En traslado', 'Averiada', 'En reparación', 'Pendiente de revisión', 'Fuera de servicio', 'Baja'];
const MOVEMENT_TYPES = ['Salida a obra', 'Traslado', 'Devolución a nave', 'Avería', 'Envío a reparación', 'Regreso de reparación', 'Cambio de estado'];
const REQUIRED_MACHINE_DOCS = ['Marcado CE / placa identificativa', 'Declaración CE de conformidad', 'Manual de instrucciones', 'Revisión / comprobación periódica'];
const inputClass = 'w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm';

const statusClass = (status: string) => {
  const s = (status || '').toLowerCase();
  if (s.includes('aver') || s.includes('fuera') || s.includes('baja')) return 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800';
  if (s.includes('repar') || s.includes('revisión')) return 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800';
  if (s.includes('obra') || s.includes('traslado')) return 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800';
  return 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800';
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => <label className="block min-w-0"><span className="block text-[10px] uppercase tracking-wider font-black text-slate-400 mb-1.5">{label}</span>{children}</label>;
const Modal = ({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) => <div className="fixed inset-0 z-[90] bg-slate-950/60 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4"><div className="w-full sm:max-w-3xl max-h-[94vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl"><div className="sticky top-0 z-10 flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur"><h3 className="font-black pr-3">{title}</h3><button onClick={onClose} className="w-10 h-10 grid place-items-center rounded-xl bg-slate-100 dark:bg-slate-800"><X className="w-5 h-5" /></button></div><div className="p-4 sm:p-5">{children}</div></div></div>;
const Action = ({ title, onClick, icon, danger = false }: { title: string; onClick: () => void; icon: React.ReactNode; danger?: boolean }) => <button type="button" title={title} onClick={onClick} className={`w-10 h-10 sm:w-8 sm:h-8 grid place-items-center rounded-xl sm:rounded-lg border transition-colors [&>svg]:w-4 [&>svg]:h-4 ${danger ? 'border-red-200 text-red-600 bg-red-50/60 dark:border-red-900 dark:bg-red-950/20' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>{icon}</button>;
const Kpi = ({ label, value }: { label: string; value: number }) => <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3"><div className="text-xl font-black">{value}</div><div className="text-[10px] uppercase tracking-wider font-bold text-slate-400">{label}</div></div>;

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
  const [editingMovement, setEditingMovement] = useState<InventoryMovement | null>(null);
  const [maintenanceItem, setMaintenanceItem] = useState<InventoryItem | null>(null);
  const [documentItem, setDocumentItem] = useState<InventoryItem | null>(null);
  const [traceItemId, setTraceItemId] = useState('');
  const [quickItemId, setQuickItemId] = useState('');
  const [shareEmail, setShareEmail] = useState('');
  const [shareBusy, setShareBusy] = useState(false);
  const [qrItem, setQrItem] = useState<InventoryItem | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [parkName, setParkName] = useState('');
  const [parkZone, setParkZone] = useState('Zona 1');
  const [coordinatorEmail, setCoordinatorEmail] = useState('');
  const [parkSaving, setParkSaving] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  const loadParkData = async (selected: InventoryPark) => {
    setPark(selected); setParkName(selected.nombre); setParkZone(selected.zona); setCoordinatorEmail(selected.coordinatorEmail || '');
    const [i, m, mt, docs] = await Promise.all([listInventoryItems(selected.id), listInventoryMovements(selected.id), listInventoryMaintenance(selected.id), listInventoryDocuments(selected.id)]);
    setItems(i); setMovements(m); setMaintenance(mt); setDocuments(docs);
    const active = i.filter(x => x.activo);
    const requestedId = new URLSearchParams(window.location.search).get('inventoryItem');
    const initialId = requestedId && active.some(x => x.id === requestedId) ? requestedId : active[0]?.id || '';
    if (!quickItemId || !active.some(x => x.id === quickItemId)) setQuickItemId(initialId);
    if (!traceItemId || !active.some(x => x.id === traceItemId)) setTraceItemId(initialId);
    if (requestedId && active.some(x => x.id === requestedId)) setTab('trazabilidad');
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
  const quickItem = activeItems.find(i => i.id === quickItemId) || activeItems[0] || null;
  const categories = useMemo<string[]>(() => Array.from(new Set<string>(activeItems.map(i => String(i.categoria || '')).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'es')), [activeItems]);
  const filtered = useMemo(() => activeItems.filter(i => {
    const q = search.trim().toLowerCase();
    const hay = [i.codigo, i.nombre, i.categoria, i.marca, i.modelo, i.numeroSerie, i.matricula, i.ubicacionActual].filter(Boolean).join(' ').toLowerCase();
    return (!q || hay.includes(q)) && (!category || i.categoria === category) && (!status || i.estado === status);
  }), [activeItems, search, category, status]);
  const docsByItem = useMemo(() => documents.reduce((map, doc) => { const list = map.get(doc.itemId) || []; list.push(doc); map.set(doc.itemId, list); return map; }, new Map<string, InventoryDocument[]>()), [documents]);
  const traceMovements = useMemo(() => movements.filter(m => m.itemId === traceItemId).slice().reverse(), [movements, traceItemId]);
  const kpis = useMemo(() => ({ total: activeItems.length, disponibles: activeItems.filter(i => i.estado === 'Disponible').length, curso: activeItems.filter(i => /obra|traslado/i.test(i.estado)).length, incidencias: activeItems.filter(i => /aver|repar|revisión|fuera/i.test(i.estado)).length }), [activeItems]);

  const openQr = async (item: InventoryItem) => {
    const url = new URL(window.location.href); url.search = ''; url.searchParams.set('inventoryItem', item.id);
    setQrItem(item); setQrDataUrl(await QRCode.toDataURL(url.toString(), { width: 320, margin: 2 }));
  };

  const exportPdf = async () => {
    if (!park) return;
    setPdfBusy(true);
    try { await exportInventoryStatusPdf({ park, items: activeItems, movements, maintenance, documents }); }
    catch (e: any) { alert(e?.message || 'No se pudo generar el informe PDF.'); }
    finally { setPdfBusy(false); }
  };

  const saveParkConfig = async () => {
    if (!park) return;
    setParkSaving(true);
    try { const updated = await updateInventoryPark(park.id, { nombre: parkName, zona: parkZone, coordinatorEmail }); await reload(updated.id); }
    catch (e: any) { alert(e?.message || 'No se pudo guardar la configuración del parque.'); }
    finally { setParkSaving(false); }
  };

  const removeMovement = async (movement: InventoryMovement) => {
    if (!park || !confirm('¿Eliminar este movimiento? El cambio quedará registrado internamente en la auditoría.')) return;
    try { await deleteInventoryMovement(movement.id); await reload(park.id); }
    catch (e: any) { alert(e?.message || 'No se pudo eliminar el movimiento.'); }
  };

  if (loading) return <div className="ui-surface p-10 flex items-center justify-center gap-3"><RefreshCw className="w-5 h-5 animate-spin" /> Cargando parque de maquinaria…</div>;

  return <div className="space-y-4 sm:space-y-6 pb-24 md:pb-10">
    <PageHeader eyebrow={`${park?.zona || 'Zona'} · ${park?.isOwned === false ? 'Parque compartido' : 'Parque propio'}`} title="Herramientas y maquinaria" description="Gestión rápida de equipos, documentación, mantenimiento y trazabilidad." icon={<Wrench className="h-5 w-5" />} />
    {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700"><AlertTriangle className="inline w-4 h-4 mr-2" />{error}</div>}

    <div className="md:hidden sticky top-2 z-30 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur p-3 shadow-lg">
      <select className={`${inputClass} font-bold`} value={quickItem?.id || ''} onChange={e => setQuickItemId(e.target.value)}>{activeItems.map(i => <option key={i.id} value={i.id}>{i.codigo} · {i.nombre}</option>)}</select>
      {quickItem && <div className="mt-2 flex items-center justify-between gap-2"><div className="min-w-0"><div className="text-xs truncate text-slate-500">{quickItem.ubicacionActual}</div><span className={`inline-flex mt-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusClass(quickItem.estado)}`}>{quickItem.estado}</span></div><div className="grid grid-cols-4 gap-1.5 shrink-0"><Action title="Mover" onClick={() => setMovementItem(quickItem)} icon={<Truck />} /><Action title="Foto/estado" onClick={() => setMovementItem(quickItem)} icon={<Camera />} /><Action title="Trazabilidad" onClick={() => { setTraceItemId(quickItem.id); setTab('trazabilidad'); }} icon={<MapPinned />} /><Action title="Documentos" onClick={() => { setDocumentItem(quickItem); setTab('documentacion'); }} icon={<FolderOpen />} /></div></div>}
    </div>

    <div className="grid grid-cols-4 gap-2"><Kpi label="Equipos" value={kpis.total} /><Kpi label="Disponibles" value={kpis.disponibles} /><Kpi label="En curso" value={kpis.curso} /><Kpi label="Incidencias" value={kpis.incidencias} /></div>

    <div className="grid grid-cols-2 sm:flex gap-2">
      <button onClick={() => setEditingItem({ codigo: '', categoria: '', nombre: '', cantidad: 1, tipoGestion: 'individual', estado: 'Disponible', ubicacionActual: baseLocation, detalles: {}, observaciones: '', activo: true })} className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-primary text-white px-4 py-3 text-sm font-bold"><Plus className="w-4 h-4" />Nuevo equipo</button>
      <button onClick={() => void exportPdf()} disabled={pdfBusy} className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 dark:bg-blue-600 text-white px-4 py-3 text-sm font-bold disabled:opacity-50"><FileDown className="w-4 h-4" />{pdfBusy ? 'Generando…' : 'Informe PDF'}</button>
    </div>

    <details className="ui-surface p-4 group">
      <summary className="cursor-pointer list-none flex items-center justify-between font-black text-sm"><span>Parque, zona y uso compartido</span><span className="text-xs text-slate-400 group-open:hidden">Configurar</span></summary>
      <div className="pt-4 space-y-4">
        <div className="grid sm:grid-cols-3 gap-3"><Field label="Parque visible"><select className={inputClass} value={park?.id || ''} onChange={async e => { const p = parks.find(x => x.id === e.target.value); if (p) { setLoading(true); try { await loadParkData(p); } finally { setLoading(false); } } }}>{parks.map(p => <option key={p.id} value={p.id}>{p.zona} · {p.nombre}{p.isOwned === false ? ' · Compartido' : ''}</option>)}</select></Field><Field label="Nombre"><input className={inputClass} value={parkName} onChange={e => setParkName(e.target.value)} /></Field><Field label="Zona"><select className={inputClass} value={parkZone} onChange={e => setParkZone(e.target.value)}>{INVENTORY_ZONES.map(z => <option key={z}>{z}</option>)}</select></Field></div>
        <div className="grid lg:grid-cols-2 gap-3"><Field label="Correo coordinador"><input type="email" className={inputClass} value={coordinatorEmail} onChange={e => setCoordinatorEmail(e.target.value)} /></Field><form className="flex gap-2 items-end" onSubmit={async e => { e.preventDefault(); if (!park || !shareEmail.trim()) return; setShareBusy(true); try { await shareInventoryParkByEmail(park.id, shareEmail); setShareEmail(''); await reload(park.id); } catch (err: any) { alert(err?.message || 'No se pudo compartir el parque.'); } finally { setShareBusy(false); } }}><div className="flex-1"><Field label="Compartir con supervisor"><input type="email" className={inputClass} value={shareEmail} onChange={e => setShareEmail(e.target.value)} /></Field></div><button disabled={shareBusy} className="h-[42px] rounded-xl bg-slate-900 dark:bg-blue-600 text-white px-4"><Share2 className="w-4 h-4" /></button></form></div>
        <button onClick={() => void saveParkConfig()} disabled={parkSaving} className="inline-flex items-center gap-2 rounded-xl bg-brand-primary text-white px-4 py-2.5 text-sm font-bold"><Save className="w-4 h-4" />Guardar configuración</button>
      </div>
    </details>

    <div className="sticky top-0 z-20 -mx-1 px-1 py-2 bg-slate-50/95 dark:bg-slate-950/95 backdrop-blur overflow-x-auto"><div className="flex gap-2 min-w-max">{([
      ['resumen', 'Resumen', ClipboardList], ['inventario', 'Inventario', Boxes], ['movimientos', 'Movimientos', History], ['mantenimiento', 'Mantenimiento', Stethoscope], ['documentacion', 'Documentos', FileCheck2], ['trazabilidad', 'Trazabilidad', MapPinned],
    ] as [Tab, string, React.ElementType][]).map(([id, label, Icon]) => <button key={id} onClick={() => setTab(id)} className={`inline-flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs sm:text-sm font-bold border ${tab === id ? 'bg-brand-primary text-white border-brand-primary' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700'}`}><Icon className="w-4 h-4" />{label}</button>)}</div></div>

    {tab === 'resumen' && <SummaryView items={activeItems} movements={movements} documents={documents} onOpenItem={id => { setTraceItemId(id); setTab('trazabilidad'); }} />}
    {tab === 'inventario' && <InventoryView items={filtered} allItems={activeItems} documents={documents} categories={categories} search={search} category={category} status={status} setSearch={setSearch} setCategory={setCategory} setStatus={setStatus} onMove={setMovementItem} onMaintenance={setMaintenanceItem} onDocument={i => { setDocumentItem(i); setTab('documentacion'); }} onEdit={i => setEditingItem({ ...i })} onQr={openQr} onTrace={i => { setTraceItemId(i.id); setTab('trazabilidad'); }} onDelete={async i => { if (!park || !confirm(`¿Dar de baja ${i.nombre}?`)) return; await softDeleteInventoryItem(i.id); await reload(park.id); }} />}
    {tab === 'movimientos' && <MovementsView movements={movements} items={items} onTrace={id => { setTraceItemId(id); setTab('trazabilidad'); }} onEdit={setEditingMovement} onDelete={removeMovement} />}
    {tab === 'mantenimiento' && <MaintenanceView maintenance={maintenance} items={activeItems} onAdd={setMaintenanceItem} />}
    {tab === 'documentacion' && park && <DocumentsView park={park} items={activeItems} documents={documents} selectedItem={documentItem} setSelectedItem={setDocumentItem} onReload={() => reload(park.id)} />}
    {tab === 'trazabilidad' && park && <TraceView park={park} items={activeItems} selectedId={traceItemId} setSelectedId={setTraceItemId} movements={traceMovements} onEdit={setEditingMovement} onDelete={removeMovement} />}

    {editingItem && park && <ItemModal item={editingItem} categories={categories} baseLocation={baseLocation} onClose={() => setEditingItem(null)} onSave={async draft => { await saveInventoryItem(park.id, draft, baseLocation); setEditingItem(null); await reload(park.id); }} />}
    {movementItem && park && <MovementModal item={movementItem} savedObras={savedObras} baseLocation={baseLocation} onClose={() => setMovementItem(null)} onSave={async data => { const paths = data.files.length ? await uploadInventoryPhotos(park.id, movementItem.id, data.files) : []; await registerInventoryMovement({ itemId: movementItem.id, tipo: data.tipo, destino: data.destino, estadoNuevo: data.estadoNuevo, observaciones: data.observaciones, latitud: data.latitud, longitud: data.longitud, fotoPaths: paths }); setMovementItem(null); await reload(park.id); }} />}
    {editingMovement && park && <MovementEditModal movement={editingMovement} item={items.find(i => i.id === editingMovement.itemId) || null} onClose={() => setEditingMovement(null)} onSave={async data => { const newPaths = data.files.length ? await uploadInventoryPhotos(park.id, editingMovement.itemId, data.files) : []; await updateInventoryMovement({ movementId: editingMovement.id, tipo: data.tipo, destino: data.destino, estadoNuevo: data.estadoNuevo, observaciones: data.observaciones, latitud: data.latitud, longitud: data.longitud, fotoPaths: [...data.keptPaths, ...newPaths] }); setEditingMovement(null); await reload(park.id); }} />}
    {maintenanceItem && park && <MaintenanceModal item={maintenanceItem} onClose={() => setMaintenanceItem(null)} onSave={async d => { const paths = d.files.length ? await uploadInventoryDocuments(park.id, maintenanceItem.id, d.files, 'maintenance') : []; await addInventoryMaintenance(park.id, maintenanceItem.id, { tipo: d.tipo, fecha: d.fecha, proximaRevision: d.proximaRevision, proveedor: d.proveedor, mechanicName: d.mechanicName, coste: d.coste, observaciones: d.observaciones, signedDocumentPaths: paths, createdBy: null }); setMaintenanceItem(null); await reload(park.id); }} />}
    {qrItem && <Modal title={`QR · ${qrItem.nombre}`} onClose={() => setQrItem(null)}><div className="text-center"><img src={qrDataUrl} alt="Código QR" className="mx-auto w-64 h-64 rounded-xl bg-white p-3" /><div className="mt-3 font-bold">{qrItem.codigo}</div></div></Modal>}
  </div>;
};

const SummaryView = ({ items, movements, documents, onOpenItem }: { items: InventoryItem[]; movements: InventoryMovement[]; documents: InventoryDocument[]; onOpenItem: (id: string) => void }) => <div className="grid lg:grid-cols-2 gap-4"><div className="ui-surface p-4 sm:p-5"><h3 className="font-black mb-3">Equipos en curso / incidencia</h3><div className="space-y-2">{items.filter(i => i.estado !== 'Disponible').slice(0, 12).map(i => <button key={i.id} onClick={() => onOpenItem(i.id)} className="w-full text-left rounded-xl border border-slate-200 dark:border-slate-800 p-3"><div className="flex justify-between gap-2"><div className="font-bold text-sm">{i.codigo} · {i.nombre}</div><span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusClass(i.estado)}`}>{i.estado}</span></div><div className="text-xs text-slate-500 mt-1 truncate">{i.ubicacionActual}</div></button>)}{!items.some(i => i.estado !== 'Disponible') && <div className="text-sm text-slate-500">No hay equipos actualmente en curso.</div>}</div></div><div className="ui-surface p-4 sm:p-5"><h3 className="font-black mb-3">Actividad reciente</h3><div className="space-y-2">{movements.slice(0, 10).map(m => { const item = items.find(i => i.id === m.itemId); return <button key={m.id} onClick={() => onOpenItem(m.itemId)} className="w-full text-left rounded-xl border border-slate-200 dark:border-slate-800 p-3"><div className="font-bold text-sm">{item?.nombre || 'Equipo'} · {m.tipo}</div><div className="text-xs text-slate-500 mt-1">{m.destino} · {new Date(m.createdAt).toLocaleString('es-ES')}</div>{m.fotoUrls?.[0] && <img src={m.fotoUrls[0]} className="mt-2 w-full h-28 object-cover rounded-xl" alt="Estado del equipo" />}</button>; })}</div><div className="mt-4 text-xs text-slate-500">{documents.length} documentos archivados.</div></div></div>;

const InventoryView = ({ items, documents, categories, search, category, status, setSearch, setCategory, setStatus, onMove, onMaintenance, onDocument, onEdit, onQr, onTrace, onDelete }: { items: InventoryItem[]; allItems: InventoryItem[]; documents: InventoryDocument[]; categories: string[]; search: string; category: string; status: string; setSearch: (v: string) => void; setCategory: (v: string) => void; setStatus: (v: string) => void; onMove: (i: InventoryItem) => void; onMaintenance: (i: InventoryItem) => void; onDocument: (i: InventoryItem) => void; onEdit: (i: InventoryItem) => void; onQr: (i: InventoryItem) => void; onTrace: (i: InventoryItem) => void; onDelete: (i: InventoryItem) => void }) => <div className="space-y-3"><div className="ui-surface p-3 grid sm:grid-cols-3 gap-2"><input className={inputClass} value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar equipo, código, ubicación…" /><select className={inputClass} value={category} onChange={e => setCategory(e.target.value)}><option value="">Todas las categorías</option>{categories.map(c => <option key={c}>{c}</option>)}</select><select className={inputClass} value={status} onChange={e => setStatus(e.target.value)}><option value="">Todos los estados</option>{STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}</select></div><div className="md:hidden space-y-3">{items.map(i => { const docs = documents.filter(d => d.itemId === i.id); return <div key={i.id} className="ui-surface p-4"><div className="flex justify-between gap-3"><div className="min-w-0"><div className="font-black truncate">{i.codigo} · {i.nombre}</div><div className="text-xs text-slate-500 mt-1 truncate">{i.categoria} · {i.ubicacionActual}</div></div><span className={`h-fit shrink-0 rounded-full border px-2 py-1 text-[10px] font-bold ${statusClass(i.estado)}`}>{i.estado}</span></div><div className="grid grid-cols-4 gap-2 mt-4"><QuickAction label="Mover" icon={<Truck />} onClick={() => onMove(i)} /><QuickAction label="Foto" icon={<Camera />} onClick={() => onMove(i)} /><QuickAction label={`Docs ${docs.length}`} icon={<FolderOpen />} onClick={() => onDocument(i)} /><QuickAction label="Trazar" icon={<MapPinned />} onClick={() => onTrace(i)} /></div><div className="flex gap-2 mt-3 pt-3 border-t border-slate-100 dark:border-slate-800"><Action title="Mantenimiento" onClick={() => onMaintenance(i)} icon={<Stethoscope />} /><Action title="Editar" onClick={() => onEdit(i)} icon={<Edit3 />} /><Action title="QR" onClick={() => void onQr(i)} icon={<QrCode />} /><Action title="Dar de baja" danger onClick={() => onDelete(i)} icon={<Trash2 />} /></div></div>; })}</div><div className="hidden md:block ui-surface overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 dark:bg-slate-800/60 text-[11px] uppercase text-slate-500"><tr><th className="p-3 text-left">Equipo</th><th className="p-3 text-left">Estado</th><th className="p-3 text-left">Ubicación</th><th className="p-3 text-left">Docs</th><th className="p-3 text-right">Acciones</th></tr></thead><tbody>{items.map(i => <tr key={i.id} className="border-t border-slate-100 dark:border-slate-800"><td className="p-3"><b>{i.codigo} · {i.nombre}</b><div className="text-xs text-slate-500">{i.categoria}</div></td><td className="p-3"><span className={`rounded-full border px-2 py-1 text-[10px] font-bold ${statusClass(i.estado)}`}>{i.estado}</span></td><td className="p-3 text-xs">{i.ubicacionActual}</td><td className="p-3">{documents.filter(d => d.itemId === i.id).length}</td><td className="p-3"><div className="flex justify-end gap-1"><Action title="Mover" onClick={() => onMove(i)} icon={<Truck />} /><Action title="Mantenimiento" onClick={() => onMaintenance(i)} icon={<Stethoscope />} /><Action title="Documentos" onClick={() => onDocument(i)} icon={<FolderOpen />} /><Action title="Editar" onClick={() => onEdit(i)} icon={<Edit3 />} /><Action title="QR" onClick={() => void onQr(i)} icon={<QrCode />} /><Action title="Trazabilidad" onClick={() => onTrace(i)} icon={<MapPinned />} /><Action title="Baja" danger onClick={() => onDelete(i)} icon={<Trash2 />} /></div></td></tr>)}</tbody></table></div></div>;

const QuickAction = ({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => void }) => <button onClick={onClick} className="min-h-16 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 flex flex-col items-center justify-center gap-1 text-[11px] font-bold [&>svg]:w-5 [&>svg]:h-5">{icon}<span>{label}</span></button>;

const MovementsView = ({ movements, items, onTrace, onEdit, onDelete }: { movements: InventoryMovement[]; items: InventoryItem[]; onTrace: (id: string) => void; onEdit: (m: InventoryMovement) => void; onDelete: (m: InventoryMovement) => void }) => <div className="ui-surface overflow-hidden"><div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800"><h3 className="font-black">Movimientos</h3><p className="text-xs text-slate-500 mt-1">Los errores pueden corregirse o eliminarse. La modificación queda guardada en la auditoría interna.</p></div><div className="divide-y divide-slate-100 dark:divide-slate-800">{movements.map(m => { const item = items.find(i => i.id === m.itemId); return <div key={m.id} className="p-4"><div className="flex gap-3"><button onClick={() => onTrace(m.itemId)} className="flex-1 text-left min-w-0"><div className="font-bold">{item?.nombre || 'Equipo'} · {m.tipo}</div><div className="text-xs text-slate-500 mt-1">{m.origen} → {m.destino}</div><div className="text-[10px] text-slate-400 mt-1">{new Date(m.createdAt).toLocaleString('es-ES')}</div></button>{m.fotoUrls?.[0] && <img src={m.fotoUrls[0]} alt="Estado" className="w-20 h-16 rounded-xl object-cover" />}</div><div className="flex gap-2 mt-3"><Action title="Editar movimiento" onClick={() => onEdit(m)} icon={<Edit3 />} /><Action title="Eliminar movimiento" danger onClick={() => onDelete(m)} icon={<Trash2 />} /><Action title="Ver trazabilidad" onClick={() => onTrace(m.itemId)} icon={<MapPinned />} /></div></div>; })}</div></div>;

const MaintenanceView = ({ maintenance, items, onAdd }: { maintenance: InventoryMaintenance[]; items: InventoryItem[]; onAdd: (i: InventoryItem) => void }) => <div className="grid lg:grid-cols-[1fr_320px] gap-4"><div className="ui-surface overflow-hidden"><div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 font-black">Historial de mantenimiento</div><div className="divide-y divide-slate-100 dark:divide-slate-800">{maintenance.map(m => { const item = items.find(i => i.id === m.itemId); return <div key={m.id} className="p-4"><div className="font-bold">{item?.nombre || 'Equipo'} · {m.tipo}</div><div className="text-xs text-slate-500 mt-1">{m.fecha}{m.proximaRevision ? ` · Próxima: ${m.proximaRevision}` : ''}{m.proveedor ? ` · ${m.proveedor}` : ''}</div>{m.observaciones && <div className="text-xs mt-2">{m.observaciones}</div>}<div className="flex flex-wrap gap-2 mt-3">{m.signedDocumentUrls?.map((d, idx) => <a key={d.path} href={d.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-bold"><Download className="w-3.5 h-3.5" />Parte {idx + 1}</a>)}</div></div>; })}</div></div><div className="ui-surface p-4 sm:p-5"><h3 className="font-black mb-3">Registrar actuación</h3><div className="space-y-2">{items.map(i => <button key={i.id} onClick={() => onAdd(i)} className="w-full text-left p-3 rounded-xl border border-slate-200 dark:border-slate-800"><div className="font-bold text-sm">{i.nombre}</div><div className="text-[10px] text-slate-400">{i.codigo} · {i.estado}</div></button>)}</div></div></div>;

const DocumentsView = ({ park, items, documents, selectedItem, setSelectedItem, onReload }: { park: InventoryPark; items: InventoryItem[]; documents: InventoryDocument[]; selectedItem: InventoryItem | null; setSelectedItem: (i: InventoryItem | null) => void; onReload: () => Promise<void> }) => {
  const [uploadItem, setUploadItem] = useState<InventoryItem | null>(null); const [mailBusy, setMailBusy] = useState(false);
  const current = selectedItem || items[0] || null; const currentDocs = current ? documents.filter(d => d.itemId === current.id) : []; const missing = REQUIRED_MACHINE_DOCS.filter(t => !currentDocs.some(d => d.documentType === t));
  const sendMail = async () => { if (!park.coordinatorEmail) return alert('Guarda primero el correo del coordinador.'); if (!current || !currentDocs.length) return; setMailBusy(true); try { const docs = await createInventoryDocumentMailLinks(currentDocs, 60); const body = ['Documentación de maquinaria', '', `Equipo: ${current.nombre}`, `Código: ${current.codigo}`, '', ...docs.map(d => `- ${d.documentType}: ${d.downloadUrl}`)].join('\n'); window.location.href = `mailto:${encodeURIComponent(park.coordinatorEmail)}?subject=${encodeURIComponent(`Documentación maquinaria · ${current.nombre}`)}&body=${encodeURIComponent(body)}`; } finally { setMailBusy(false); } };
  return <div className="space-y-4"><div className="ui-surface p-4"><Field label="Equipo"><select className={inputClass} value={current?.id || ''} onChange={e => setSelectedItem(items.find(i => i.id === e.target.value) || null)}>{items.map(i => <option key={i.id} value={i.id}>{i.codigo} · {i.nombre}</option>)}</select></Field><div className="grid grid-cols-2 gap-2 mt-3"><button disabled={!current} onClick={() => current && setUploadItem(current)} className="rounded-xl bg-brand-primary text-white px-3 py-3 text-sm font-bold inline-flex items-center justify-center gap-2"><Upload className="w-4 h-4" />Subir</button><button disabled={!current || mailBusy} onClick={() => void sendMail()} className="rounded-xl border px-3 py-3 text-sm font-bold inline-flex items-center justify-center gap-2"><Mail className="w-4 h-4" />Enviar</button></div>{current && <div className={`mt-3 rounded-xl border p-3 text-xs ${missing.length ? 'border-amber-200 bg-amber-50 dark:bg-amber-950/20' : 'border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20'}`}><b>{missing.length ? 'Expediente incompleto' : 'Documentación básica completa'}</b>{missing.length > 0 && <div className="mt-1">Pendiente: {missing.join(' · ')}</div>}</div>}</div><div className="space-y-2">{currentDocs.map(doc => <div key={doc.id} className="ui-surface p-4 flex gap-3 justify-between"><div className="min-w-0"><div className="font-bold">{doc.documentType}</div><div className="text-xs text-slate-500 truncate">{doc.title}</div></div><div className="flex gap-2"><a href={doc.downloadUrl} target="_blank" rel="noreferrer" className="w-10 h-10 grid place-items-center rounded-xl border"><Download className="w-4 h-4" /></a><button onClick={async () => { if (!confirm('¿Eliminar documento?')) return; await deleteInventoryDocument(doc); await onReload(); }} className="w-10 h-10 grid place-items-center rounded-xl border border-red-200 text-red-600"><Trash2 className="w-4 h-4" /></button></div></div>)}</div>{uploadItem && <DocumentUploadModal park={park} item={uploadItem} onClose={() => setUploadItem(null)} onSaved={async () => { setUploadItem(null); await onReload(); }} />}</div>;
};

const TraceView = ({ park, items, selectedId, setSelectedId, movements, onEdit, onDelete }: { park: InventoryPark; items: InventoryItem[]; selectedId: string; setSelectedId: (s: string) => void; movements: InventoryMovement[]; onEdit: (m: InventoryMovement) => void; onDelete: (m: InventoryMovement) => void }) => {
  const movingItems = useMemo(() => items.filter(i => /obra|traslado/i.test(i.estado)), [items]);
  const item = movingItems.find(i => i.id === selectedId) || movingItems[0] || null;

  useEffect(() => {
    if (item && item.id !== selectedId) setSelectedId(item.id);
  }, [item, selectedId, setSelectedId]);

  if (!movingItems.length) {
    return <div className="ui-surface p-5 text-sm text-slate-500">No hay equipos actualmente en movimiento. En Trazabilidad solo se muestran los equipos asignados a obra o en traslado.</div>;
  }

  return <div className="space-y-4"><div className="ui-surface p-4 grid sm:grid-cols-[1fr_auto] gap-3 sm:items-end"><Field label="Equipo"><select value={item?.id || ''} onChange={e => setSelectedId(e.target.value)} className={inputClass}>{movingItems.map(i => <option key={i.id} value={i.id}>{i.codigo} · {i.nombre}</option>)}</select></Field>{item && <div className="text-sm"><span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold ${statusClass(item.estado)}`}>{item.estado}</span><div className="text-xs text-slate-500 mt-1">{item.ubicacionActual}</div></div>}</div><div className="ui-surface p-4 sm:p-5"><h3 className="font-black flex items-center gap-2"><MapPinned className="w-5 h-5 text-brand-primary" />Mapa visual</h3><p className="text-xs text-slate-500 mt-1">Cada punto con fotografía muestra el estado del equipo en ese momento.</p><TraceMap movements={movements} /></div><div className="ui-surface p-4 sm:p-5"><h3 className="font-black mb-4">Trazabilidad completa</h3><div className="relative pl-7 space-y-4 before:absolute before:left-[10px] before:top-2 before:bottom-2 before:w-px before:bg-slate-300 dark:before:bg-slate-700"><div className="relative"><CircleDot className="absolute -left-7 top-0 w-5 h-5 text-brand-primary bg-white dark:bg-slate-900" /><div className="font-bold text-sm">{parkBaseLocation(park)}</div><div className="text-[10px] text-slate-400">Parque base</div></div>{movements.map((m, idx) => <div key={m.id} className="relative"><CircleDot className="absolute -left-7 top-0 w-5 h-5 text-brand-primary bg-white dark:bg-slate-900" /><div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-3"><div className="flex justify-between gap-2"><div><div className="font-bold text-sm">{idx + 1}. {m.tipo} → {m.destino}</div><div className="text-[10px] text-slate-400 mt-1">{new Date(m.createdAt).toLocaleString('es-ES')}</div></div><div className="flex gap-1"><Action title="Editar" onClick={() => onEdit(m)} icon={<Edit3 />} /><Action title="Eliminar" danger onClick={() => onDelete(m)} icon={<Trash2 />} /></div></div>{m.observaciones && <div className="text-xs mt-2">{m.observaciones}</div>}{m.fotoUrls?.length ? <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">{m.fotoUrls.map((url, i) => <a key={url} href={url} target="_blank" rel="noreferrer"><img src={url} alt={`Estado ${i + 1}`} className="w-full h-32 sm:h-36 object-cover rounded-xl border" /></a>)}</div> : <div className="mt-2 text-[10px] text-slate-400">Sin fotografía asociada</div>}</div></div>)}</div></div></div>;
};

const TraceMap = ({ movements }: { movements: InventoryMovement[] }) => {
  const geo = movements.filter(m => m.latitud != null && m.longitud != null);
  if (!geo.length) return <div className="mt-4 rounded-2xl border border-dashed p-5 text-sm text-slate-500">Aún no hay movimientos con coordenadas. Al registrar un movimiento desde el móvil pulsa «Ubicación actual».</div>;
  const xs = geo.map(m => Number(m.longitud)); const ys = geo.map(m => Number(m.latitud)); const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const pts = geo.map((m, idx) => ({ m, idx, x: 8 + 84 * ((Number(m.longitud) - minX) / ((maxX - minX) || 1)), y: 86 - 72 * ((Number(m.latitud) - minY) / ((maxY - minY) || 1)) }));
  return <div className="mt-4 relative h-72 rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"><svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full">{pts.slice(1).map((p, i) => <line key={`${p.m.id}-line`} x1={pts[i].x} y1={pts[i].y} x2={p.x} y2={p.y} stroke="currentColor" strokeWidth="0.8" className="text-brand-primary" />)}</svg>{pts.map(p => <div key={p.m.id} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${p.x}%`, top: `${p.y}%` }} title={`${p.idx + 1}. ${p.m.destino}`}>{p.m.fotoUrls?.[0] ? <img src={p.m.fotoUrls[0]} className="w-12 h-12 sm:w-14 sm:h-14 rounded-full object-cover border-4 border-white dark:border-slate-900 shadow-lg ring-2 ring-brand-primary" alt={`Punto ${p.idx + 1}`} /> : <div className="w-9 h-9 rounded-full bg-brand-primary text-white border-4 border-white dark:border-slate-900 shadow-lg grid place-items-center text-xs font-black">{p.idx + 1}</div>}<div className="absolute -bottom-2 -right-2 w-6 h-6 rounded-full bg-slate-900 text-white text-[10px] font-black grid place-items-center">{p.idx + 1}</div></div>)}</div>;
};

const ItemModal = ({ item, categories, baseLocation, onClose, onSave }: { item: Partial<InventoryItem> & { nombre: string; categoria: string }; categories: string[]; baseLocation: string; onClose: () => void; onSave: (i: any) => Promise<void> }) => { const [d, setD] = useState({ ...item, ubicacionActual: item.ubicacionActual || baseLocation }); const [saving, setSaving] = useState(false); return <Modal title={item.id ? 'Editar equipo' : 'Nuevo equipo'} onClose={onClose}><form onSubmit={async e => { e.preventDefault(); setSaving(true); try { await onSave(d); } finally { setSaving(false); } }} className="grid sm:grid-cols-2 gap-4"><Field label="Código"><input className={inputClass} value={d.codigo || ''} onChange={e => setD({ ...d, codigo: e.target.value })} /></Field><Field label="Categoría"><input list="inventory-categories" required className={inputClass} value={d.categoria || ''} onChange={e => setD({ ...d, categoria: e.target.value })} /><datalist id="inventory-categories">{categories.map(c => <option key={c} value={c} />)}</datalist></Field><div className="sm:col-span-2"><Field label="Equipo"><input required className={inputClass} value={d.nombre || ''} onChange={e => setD({ ...d, nombre: e.target.value })} /></Field></div><Field label="Marca"><input className={inputClass} value={d.marca || ''} onChange={e => setD({ ...d, marca: e.target.value })} /></Field><Field label="Modelo"><input className={inputClass} value={d.modelo || ''} onChange={e => setD({ ...d, modelo: e.target.value })} /></Field><Field label="Nº serie"><input className={inputClass} value={d.numeroSerie || ''} onChange={e => setD({ ...d, numeroSerie: e.target.value })} /></Field><Field label="Matrícula"><input className={inputClass} value={d.matricula || ''} onChange={e => setD({ ...d, matricula: e.target.value })} /></Field><Field label="Estado"><select className={inputClass} value={d.estado || 'Disponible'} onChange={e => setD({ ...d, estado: e.target.value })}>{STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}</select></Field><Field label="Ubicación"><input className={inputClass} value={d.ubicacionActual || ''} onChange={e => setD({ ...d, ubicacionActual: e.target.value })} /></Field><div className="sm:col-span-2"><Field label="Observaciones"><textarea rows={3} className={inputClass} value={d.observaciones || ''} onChange={e => setD({ ...d, observaciones: e.target.value })} /></Field></div><div className="sm:col-span-2 flex justify-end gap-2"><button type="button" onClick={onClose} className="px-4 py-3 rounded-xl border font-bold text-sm">Cancelar</button><button disabled={saving} className="px-5 py-3 rounded-xl bg-brand-primary text-white font-bold text-sm">Guardar</button></div></form></Modal>; };

const LocationButton = ({ onLocation }: { onLocation: (lat: number, lng: number) => void }) => <button type="button" onClick={() => navigator.geolocation?.getCurrentPosition(p => onLocation(p.coords.latitude, p.coords.longitude), () => alert('No se pudo obtener la ubicación. Revisa el permiso de localización.'))} className="w-full rounded-xl border border-brand-primary/30 bg-brand-primary/5 text-brand-primary py-3 text-sm font-bold inline-flex items-center justify-center gap-2"><Navigation className="w-4 h-4" />Ubicación actual</button>;

const MovementModal = ({ item, savedObras, baseLocation, onClose, onSave }: { item: InventoryItem; savedObras: string[]; baseLocation: string; onClose: () => void; onSave: (d: any) => Promise<void> }) => { const [tipo, setTipo] = useState('Salida a obra'); const [destino, setDestino] = useState(''); const [estadoNuevo, setEstadoNuevo] = useState('Asignada a obra'); const [observaciones, setObservaciones] = useState(''); const [files, setFiles] = useState<File[]>([]); const [coords, setCoords] = useState<{ latitud: number | null; longitud: number | null }>({ latitud: null, longitud: null }); const [saving, setSaving] = useState(false); useEffect(() => { if (tipo === 'Devolución a nave') { setDestino(baseLocation); setEstadoNuevo('Disponible'); } else if (tipo === 'Avería') { setDestino(item.ubicacionActual); setEstadoNuevo('Averiada'); } else if (tipo === 'Envío a reparación') setEstadoNuevo('En reparación'); else if (tipo === 'Regreso de reparación') setEstadoNuevo('Disponible'); }, [tipo, baseLocation, item.ubicacionActual]); return <Modal title={`Movimiento · ${item.nombre}`} onClose={onClose}><form className="space-y-4" onSubmit={async e => { e.preventDefault(); if (!destino.trim()) return; setSaving(true); try { await onSave({ tipo, destino, estadoNuevo, observaciones, files, ...coords }); } finally { setSaving(false); } }}><div className="rounded-xl bg-slate-50 dark:bg-slate-800 p-3 text-xs"><b>Origen:</b> {item.ubicacionActual}</div><Field label="Tipo"><select className={inputClass} value={tipo} onChange={e => setTipo(e.target.value)}>{MOVEMENT_TYPES.map(x => <option key={x}>{x}</option>)}</select></Field><Field label="Destino / obra"><input list="inventory-works" required className={inputClass} value={destino} onChange={e => setDestino(e.target.value)} /><datalist id="inventory-works">{savedObras.map(o => <option key={o} value={o} />)}<option value={baseLocation} /></datalist></Field><Field label="Estado"><select className={inputClass} value={estadoNuevo} onChange={e => setEstadoNuevo(e.target.value)}>{STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}</select></Field><Field label="Observaciones"><textarea rows={2} className={inputClass} value={observaciones} onChange={e => setObservaciones(e.target.value)} /></Field><div className="grid sm:grid-cols-2 gap-3"><label className="rounded-xl border p-3"><span className="text-xs font-bold flex items-center gap-2"><Camera className="w-4 h-4" />Foto del estado</span><input type="file" accept="image/*" multiple capture="environment" onChange={e => setFiles(Array.from(e.target.files || []).slice(0, 4))} className="mt-3 block w-full text-xs" /></label><div><LocationButton onLocation={(lat, lng) => setCoords({ latitud: lat, longitud: lng })} />{coords.latitud != null && <div className="text-[10px] text-emerald-600 mt-2 text-center">Ubicación registrada ✓</div>}</div></div><button disabled={saving} className="w-full rounded-xl bg-brand-primary text-white py-3.5 font-black">{saving ? 'Registrando…' : 'Registrar movimiento'}</button></form></Modal>; };

const MovementEditModal = ({ movement, item, onClose, onSave }: { movement: InventoryMovement; item: InventoryItem | null; onClose: () => void; onSave: (d: any) => Promise<void> }) => { const [tipo, setTipo] = useState(movement.tipo); const [destino, setDestino] = useState(movement.destino); const [estadoNuevo, setEstadoNuevo] = useState(movement.estadoNuevo || item?.estado || 'Disponible'); const [observaciones, setObservaciones] = useState(movement.observaciones || ''); const [latitud, setLatitud] = useState<number | null>(movement.latitud ?? null); const [longitud, setLongitud] = useState<number | null>(movement.longitud ?? null); const [files, setFiles] = useState<File[]>([]); const [keptPaths, setKeptPaths] = useState<string[]>(movement.fotoPaths); const [busy, setBusy] = useState(false); return <Modal title="Corregir movimiento" onClose={onClose}><form className="space-y-4" onSubmit={async e => { e.preventDefault(); setBusy(true); try { await onSave({ tipo, destino, estadoNuevo, observaciones, latitud, longitud, files, keptPaths }); } finally { setBusy(false); } }}><div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs">Esta corrección actualiza la trazabilidad visible, pero el valor anterior permanece registrado en la auditoría interna.</div><Field label="Tipo"><select className={inputClass} value={tipo} onChange={e => setTipo(e.target.value)}>{MOVEMENT_TYPES.map(x => <option key={x}>{x}</option>)}</select></Field><Field label="Destino"><input required className={inputClass} value={destino} onChange={e => setDestino(e.target.value)} /></Field><Field label="Estado"><select className={inputClass} value={estadoNuevo} onChange={e => setEstadoNuevo(e.target.value)}>{STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}</select></Field><Field label="Observaciones"><textarea rows={2} className={inputClass} value={observaciones} onChange={e => setObservaciones(e.target.value)} /></Field>{movement.fotoUrls?.length ? <div><div className="text-[10px] uppercase font-black text-slate-400 mb-2">Fotos actuales · toca para quitar</div><div className="grid grid-cols-3 gap-2">{movement.fotoUrls.map((url, idx) => { const path = movement.fotoPaths[idx]; const kept = keptPaths.includes(path); return <button key={path} type="button" onClick={() => setKeptPaths(current => kept ? current.filter(p => p !== path) : [...current, path])} className={`relative rounded-xl overflow-hidden border-2 ${kept ? 'border-brand-primary' : 'border-red-400 opacity-40'}`}><img src={url} className="w-full h-24 object-cover" alt="Evidencia" />{!kept && <span className="absolute inset-0 grid place-items-center text-white bg-red-600/40 font-black text-xs">QUITAR</span>}</button>; })}</div></div> : null}<Field label="Añadir fotos"><input type="file" accept="image/*" multiple capture="environment" onChange={e => setFiles(Array.from(e.target.files || []).slice(0, 4))} className="block w-full text-xs" /></Field><LocationButton onLocation={(lat, lng) => { setLatitud(lat); setLongitud(lng); }} />{latitud != null && <div className="text-[10px] text-emerald-600 text-center">Coordenadas guardadas ✓</div>}<button disabled={busy} className="w-full rounded-xl bg-brand-primary text-white py-3.5 font-black">Guardar corrección</button></form></Modal>; };

const MaintenanceModal = ({ item, onClose, onSave }: { item: InventoryItem; onClose: () => void; onSave: (d: any) => Promise<void> }) => { const [tipo, setTipo] = useState('Revisión / comprobación periódica'); const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10)); const [next, setNext] = useState(''); const [provider, setProvider] = useState(''); const [mechanicName, setMechanicName] = useState(''); const [cost, setCost] = useState(''); const [obs, setObs] = useState(''); const [files, setFiles] = useState<File[]>([]); const [busy, setBusy] = useState(false); return <Modal title={`Mantenimiento · ${item.nombre}`} onClose={onClose}><form className="grid sm:grid-cols-2 gap-4" onSubmit={async e => { e.preventDefault(); setBusy(true); try { await onSave({ tipo, fecha, proximaRevision: next || null, proveedor: provider || null, mechanicName: mechanicName || null, coste: cost ? Number(cost) : null, observaciones: obs, files }); } finally { setBusy(false); } }}><Field label="Tipo"><select className={inputClass} value={tipo} onChange={e => setTipo(e.target.value)}><option>Revisión / comprobación periódica</option><option>Mantenimiento preventivo</option><option>Reparación</option><option>Avería</option><option>ITV / inspección</option><option>Otro</option></select></Field><Field label="Fecha"><input required type="date" className={inputClass} value={fecha} onChange={e => setFecha(e.target.value)} /></Field><Field label="Próxima revisión"><input type="date" className={inputClass} value={next} onChange={e => setNext(e.target.value)} /></Field><Field label="Taller"><input className={inputClass} value={provider} onChange={e => setProvider(e.target.value)} /></Field><Field label="Mecánico / técnico"><input className={inputClass} value={mechanicName} onChange={e => setMechanicName(e.target.value)} /></Field><Field label="Coste"><input type="number" step="0.01" className={inputClass} value={cost} onChange={e => setCost(e.target.value)} /></Field><div className="sm:col-span-2"><Field label="Parte firmado"><input type="file" accept="application/pdf,image/*" multiple onChange={e => setFiles(Array.from(e.target.files || []).slice(0, 4))} className="block w-full text-sm" /></Field></div><div className="sm:col-span-2"><Field label="Observaciones"><textarea rows={3} className={inputClass} value={obs} onChange={e => setObs(e.target.value)} /></Field></div><div className="sm:col-span-2"><button disabled={busy} className="w-full rounded-xl bg-brand-primary text-white py-3.5 font-black">Guardar actuación</button></div></form></Modal>; };

const DocumentUploadModal = ({ park, item, onClose, onSaved }: { park: InventoryPark; item: InventoryItem; onClose: () => void; onSaved: () => Promise<void> }) => { const [type, setType] = useState<string>(MACHINE_DOCUMENT_TYPES[0]); const [title, setTitle] = useState(''); const [issueDate, setIssueDate] = useState(''); const [expiryDate, setExpiryDate] = useState(''); const [notes, setNotes] = useState(''); const [file, setFile] = useState<File | null>(null); const [busy, setBusy] = useState(false); return <Modal title={`Documento · ${item.nombre}`} onClose={onClose}><form className="space-y-4" onSubmit={async e => { e.preventDefault(); if (!file) return; setBusy(true); try { await addInventoryDocument({ parkId: park.id, itemId: item.id, documentType: type, title: title || file.name, file, issueDate: issueDate || null, expiryDate: expiryDate || null, notes: notes || null }); await onSaved(); } finally { setBusy(false); } }}><Field label="Tipo"><select className={inputClass} value={type} onChange={e => setType(e.target.value)}>{MACHINE_DOCUMENT_TYPES.map(t => <option key={t}>{t}</option>)}</select></Field><Field label="Título"><input className={inputClass} value={title} onChange={e => setTitle(e.target.value)} /></Field><div className="grid grid-cols-2 gap-3"><Field label="Emisión"><input type="date" className={inputClass} value={issueDate} onChange={e => setIssueDate(e.target.value)} /></Field><Field label="Caducidad"><input type="date" className={inputClass} value={expiryDate} onChange={e => setExpiryDate(e.target.value)} /></Field></div><Field label="Archivo"><input required type="file" accept="application/pdf,image/*" onChange={e => setFile(e.target.files?.[0] || null)} className="block w-full text-sm" /></Field><Field label="Notas"><textarea rows={2} className={inputClass} value={notes} onChange={e => setNotes(e.target.value)} /></Field><button disabled={busy} className="w-full rounded-xl bg-brand-primary text-white py-3.5 font-black">{busy ? 'Subiendo…' : 'Guardar documento'}</button></form></Modal>; };
