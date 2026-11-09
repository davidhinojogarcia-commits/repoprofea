import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type {
  InventoryPark, InventoryParkShare, InventoryItem, InventoryMovement,
  InventoryMaintenance, InventoryDocument,
} from '../services/inventoryService';
import { applyInstitutionalPdfStandard, applyPdfCopyrightStamp, renderInstitutionalReportHeader, renderInstitutionalSectionTitle } from './exportUtils';

type Snapshot = {
  exportedAt: string;
  items: InventoryItem[];
  movements: InventoryMovement[];
  maintenance: InventoryMaintenance[];
  documents: InventoryDocument[];
  shares: InventoryParkShare[];
};
const blue: [number,number,number] = [0,84,142];
const fmt = (value?: string | null) => value ? new Date(value).toLocaleString('es-ES') : '-';
const str = (value: unknown) => value == null || value === '' ? '-' : String(value);
const safe = (s: string) => s.replace(/[^a-z0-9_-]+/gi, '_').slice(0,60);

export async function exportInventoryParkFullPdf(park: InventoryPark, snapshot: Snapshot) {
  const pdf = new jsPDF({ compress: true, unit: 'mm', format: 'a4' });
  const title = 'Informe general del parque de herramientas y maquinaria';
  const subtitle = `${park.zona} · ${park.nombre}`;
  const pageHeader = () => renderInstitutionalReportHeader(pdf,title,subtitle,{subtitle:'DESARROLLO LOCAL · GESTIÓN DE FONDOS PROFEA'});
  pageHeader();
  let y = 39;
  const section = (name: string) => {
    if(y>250){pdf.addPage();pageHeader();y=39;}
    y=renderInstitutionalSectionTitle(pdf,name,y,{x:14,width:182});
  };
  const table = (head: string[], body: (string|number)[][], sizes?: Record<number,{cellWidth:number}>) => {
    autoTable(pdf,{
      startY:y,
      head:[head],
      body:body.length?body:[['Sin registros',...head.slice(1).map(()=>'-')]],
      theme:'grid',
      styles:{fontSize:7.1,cellPadding:2,overflow:'linebreak',valign:'top'},
      headStyles:{fillColor:blue,textColor:255,fontStyle:'bold'},
      alternateRowStyles:{fillColor:[241,247,252]},
      columnStyles:sizes,
      margin:{top:39,left:14,right:14,bottom:18},
      didDrawPage:(data)=>{if(data.pageNumber>1)pageHeader();},
    });
    y=((pdf as any).lastAutoTable?.finalY||y+15)+7;
  };

  pdf.setFontSize(9);
  pdf.setTextColor(50,65,82);
  pdf.text(`Exportado: ${fmt(snapshot.exportedAt)} · Informe elaborado con datos del parque autorizados para el usuario`,14,y);
  y+=7;
  section('1. Identificación y responsables del parque');
  table(['Dato','Información'],[
    ['Zona',park.zona],['Parque',park.nombre],['Descripción',str(park.descripcion)],
    ['Coordinación del parque',str(park.coordinatorEmail)],
    ['Titularidad del acceso',park.isOwned===false?'Parque compartido':'Parque propio'],
  ],{0:{cellWidth:55}});
  section('2. Supervisores y personas con acceso');
  table(['Nombre','Rol','Acceso','Titular'],snapshot.shares.map(s=>[
    s.displayName,s.role,s.status==='accepted'?'Aceptado':'Pendiente',s.isOwner?'Sí':'No',
  ]));
  section('3. Resumen cuantitativo');
  const active=snapshot.items.filter(i=>i.activo);
  const units=(list:InventoryItem[])=>list.reduce((sum,i)=>sum+Math.max(1,Number(i.cantidad||1)),0);
  table(['Indicador','Registros / unidades'],[
    ['Equipos en inventario',`${snapshot.items.length} registros · ${units(snapshot.items)} unidades`],
    ['Equipos activos',`${active.length} registros · ${units(active)} unidades`],
    ['Equipos dados de baja',String(snapshot.items.filter(i=>!i.activo).length)],
    ['Movimientos registrados',String(snapshot.movements.length)],
    ['Mantenimientos registrados',String(snapshot.maintenance.length)],
    ['Documentos registrados',String(snapshot.documents.length)],
  ]);
  section('4. Inventario completo · activos y bajas');
  const sortedItems=snapshot.items.slice().sort((a,b)=>a.codigo.localeCompare(b.codigo,'es'));
  const names=new Map(snapshot.items.map(i=>[i.id,`${i.codigo} · ${i.nombre}`]));
  table(['Código y equipo','Categoría','Estado','Cantidad','Ubicación','Supervisor'],sortedItems.map(i=>[
    `${i.codigo} · ${i.nombre}${i.activo?'':' (BAJA)'}`,i.categoria,i.estado,str(i.cantidad),i.ubicacionActual,str(i.supervisorResponsableNombre),
  ]),{0:{cellWidth:43},1:{cellWidth:25},2:{cellWidth:25},3:{cellWidth:15},4:{cellWidth:44},5:{cellWidth:30}});

  section('5. Histórico de movimientos y cambios de estado registrados');
  table(['Fecha','Equipo','Movimiento','Origen / destino','Responsable'],snapshot.movements.slice().sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).map(m=>[
    fmt(m.createdAt),names.get(m.itemId)||m.itemId,m.tipo,
    `${m.origen||'-'} → ${m.destino||'-'}${m.estadoAnterior||m.estadoNuevo?` · ${m.estadoAnterior||'-'} / ${m.estadoNuevo||'-'}`:''}`,
    str(m.createdByName||m.createdBy||m.responsableId),
  ]),{0:{cellWidth:30},1:{cellWidth:41},2:{cellWidth:28},3:{cellWidth:62},4:{cellWidth:21}});
  section('6. Mantenimientos y revisiones');
  table(['Equipo','Tipo','Fecha','Próxima revisión','Proveedor / técnico','Observaciones'],snapshot.maintenance.map(m=>[
    names.get(m.itemId)||m.itemId,m.tipo,m.fecha,str(m.proximaRevision),
    [m.proveedor,m.mechanicName].filter(Boolean).join(' · ')||'-',str(m.observaciones),
  ]));
  section('7. Documentación registrada');
  table(['Equipo','Documento','Archivo','Emisión','Caducidad'],snapshot.documents.map(d=>[
    names.get(d.itemId)||d.itemId,d.documentType,d.fileName,str(d.issueDate),str(d.expiryDate),
  ]));

  if(y>248){pdf.addPage();pageHeader();y=39;}
  section('8. Alcance y advertencias de trazabilidad');
  pdf.setFontSize(8);
  pdf.setTextColor(60,72,88);
  const note='El documento refleja los datos y acontecimientos conservados por GestionProfea hasta el momento de exportación. No acredita acontecimientos previos al alta del sistema ni modificaciones que no se hayan registrado en el historial. Los documentos adjuntos se inventarían por referencia, sin incorporar automáticamente su contenido íntegro.';
  const lines=pdf.splitTextToSize(note,182);
  pdf.text(lines,14,y);
  applyInstitutionalPdfStandard(pdf);
  applyPdfCopyrightStamp(pdf);
  const filename=`PARQUE_COMPLETO_${safe(park.zona)}_${snapshot.exportedAt.slice(0,10)}.pdf`;
  pdf.save(filename);
  return filename;
}
