import { jsPDF } from 'jspdf';
import { OFFICIAL_LOGO_BASE64 } from '../assets/logoData';

/** ISO/IEC 7810 ID-1 physical dimensions, in millimetres. */
export const CARD_W = 85.6;
export const CARD_H = 53.98;
export const DUPLEX_CAPACITY = 8;
export const A4_W = 210;
export const A4_H = 297;
export type PrintableWorkerCard = { id: string | number; frontPng: string };

/**
 * A4 portrait 2 × 4 grid, with >= 12 mm print-safe margins and separation.
 * The back page exchanges the two column positions for long-edge duplex:
 * text on the back stays upright, artwork is NEVER mirrored.
 */
export function cardSlot(index: number, reverse = false) {
  if (!Number.isInteger(index) || index < 0 || index >= DUPLEX_CAPACITY) throw new Error('Posición del carnet fuera de la hoja.');
  const row = Math.floor(index / 2);
  const col = index % 2;
  const mirrored = reverse ? 1 - col : col;
  const xMargin = (A4_W - (CARD_W * 2 + 12.8)) / 2;
  return { x: xMargin + mirrored * (CARD_W + 12.8), y: 17.5 + row * (CARD_H + 13) };
}

function marks(pdf: jsPDF, x: number, y: number) {
  pdf.setDrawColor(95, 108, 122);
  pdf.setLineWidth(0.16);
  const length = 3;
  const gap = 0.7;
  for (const [px, dir] of [[x, -1], [x + CARD_W, 1]] as const) {
    for (const py of [y, y + CARD_H]) {
      pdf.line(px + dir * gap, py, px + dir * (gap + length), py);
    }
  }
  for (const [py, dir] of [[y, -1], [y + CARD_H, 1]] as const) {
    for (const px of [x, x + CARD_W]) {
      pdf.line(px, py + dir * gap, px, py + dir * (gap + length));
    }
  }
}

export function drawWorkerCardBack(pdf: jsPDF, x: number, y: number) {
  pdf.setFillColor(255,255,255);
  pdf.rect(x,y,CARD_W,CARD_H,'F');
  pdf.setFillColor(0,84,142);
  pdf.rect(x,y,CARD_W,11,'F');
  pdf.setFont('helvetica','bold');
  pdf.setTextColor(255,255,255);
  pdf.setFontSize(8);
  pdf.text('DIPUTACIÓN DE CÁDIZ · PROFEA',x+4,y+4.8);
  pdf.setFontSize(6.7);
  pdf.text('CARNET IDENTIFICATIVO DE TRABAJADOR/A',x+4,y+8.4);
  pdf.setTextColor(15,23,42);
  pdf.setFont('helvetica','bold');
  pdf.setFontSize(7.5);
  pdf.text('Personal e intransferible',x+4,y+16);
  pdf.setFont('helvetica','normal');
  pdf.setFontSize(7);
  const text = [
    'La información autorizada y su vigencia pueden',
    'consultarse mediante el QR del anverso.',
    '',
    'Este carnet no acredita por sí solo contratación',
    'vigente, autorización de maquinaria ni aptitud',
    'para tareas concretas.',
    '',
    'En caso de extravío, comuníquelo al servicio.'
  ];
  pdf.text(text,x+4,y+21,{lineHeightFactor:1.17});
  pdf.setDrawColor(219,229,239);
  pdf.line(x+4,y+45,x+CARD_W-4,y+45);
  const logo=pdf.getImageProperties(OFFICIAL_LOGO_BASE64);
  const h=4.7;
  pdf.addImage(OFFICIAL_LOGO_BASE64,'PNG',x+4,y+47,Math.min(27,h*logo.width/logo.height),h);
  pdf.setFontSize(5.5);
  pdf.setTextColor(80,99,119);
  pdf.text('VERIFICACIÓN MEDIANTE QR',x+CARD_W-4,y+50.5,{align:'right'});
}

/** Creates a separate 1-card PDF for the reverse preview, not for sheet printing. */
export function generateWorkerCardBack() {
  const doc=new jsPDF({orientation:'landscape',unit:'mm',format:[CARD_H,CARD_W],compress:true});
  drawWorkerCardBack(doc,0,0);
  return doc;
}

export function generateWorkerCardDuplexSheet(cards: PrintableWorkerCard[]) {
  if (!cards.length) throw new Error('Selecciona al menos un carnet para imprimir.');
  if (cards.length > 320) throw new Error('Selecciona un máximo de 320 carnets por impresión.');
  const ids=new Set<string>();
  for (const c of cards) {
    const id=String(c.id);
    if (ids.has(id)) throw new Error('No se pueden imprimir carnets duplicados.');
    ids.add(id);
    if (!/^data:image\/png;base64,/.test(c.frontPng)) throw new Error('El anverso debe ser una imagen PNG generada del carnet.');
  }
  const doc=new jsPDF({orientation:'portrait',unit:'mm',format:'a4',compress:true});
  for (let page=0;page<Math.ceil(cards.length/DUPLEX_CAPACITY);page++) {
    if (page) doc.addPage('a4','portrait');
    const batch=cards.slice(page*DUPLEX_CAPACITY,(page+1)*DUPLEX_CAPACITY);
    batch.forEach((card,index)=>{
      const {x,y}=cardSlot(index);
      // Preserve existing landscape front artwork and its QR without stretching.
      const ratio=95/62;
      const w=Math.min(CARD_W,CARD_H*ratio),h=w/ratio;
      doc.addImage(card.frontPng,'PNG',x+(CARD_W-w)/2,y+(CARD_H-h)/2,w,h);
      marks(doc,x,y);
    });
    doc.addPage('a4','portrait');
    batch.forEach((_,index)=>{
      const {x,y}=cardSlot(index,true);
      drawWorkerCardBack(doc,x,y);
      marks(doc,x,y);
    });
  }
  return {doc,filename:'CARNETS_PROFEA_A4_DOBLE_CARA.pdf'};
}

/** Optional two-page print calibration, separate from definitive cards. */
export function generateWorkerCardCalibration() {
  const doc=new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
  for (let page=0;page<2;page++) {
    if(page)doc.addPage('a4','portrait');
    for(let i=0;i<DUPLEX_CAPACITY;i++){
      const {x,y}=cardSlot(i,page===1);
      doc.setDrawColor(0,84,142);
      doc.setLineWidth(0.25);
      doc.rect(x,y,CARD_W,CARD_H);
      marks(doc,x,y);
      doc.setFontSize(9);
      doc.setTextColor(0,84,142);
      doc.text((page?'REVERSO':'ANVERSO')+' · '+(i+1),x+4,y+10);
      doc.text('85,60 × 53,98 mm',x+4,y+15);
      doc.line(x+5,y+22,x+25,y+22);
      doc.text('20 mm',x+5,y+26);
    }
  }
  return {doc,filename:'CARNET_PROFEA_PRUEBA_CALIBRACION_A4.pdf'};
}
