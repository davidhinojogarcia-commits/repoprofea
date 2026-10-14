/** Contract/prórroga analysis, pure and conservative: never modifies imported PDFs. */
export const CONTRACT_DOCUMENT_TYPES = Object.freeze(['contrato','prorroga']);
const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es').replace(/\s+/g,' ').trim();
export function classifyEmploymentDocument(text, filename='') {
  const content=normalize(text), name=normalize(filename);
  if (/\bprorroga\b/.test(content.slice(0,3000)) || /\bprorroga\b/.test(name)) return 'prorroga';
  if (/contrato\s+de\s+trabajo|contrato\s+laboral/.test(content.slice(0,3000)) || /contrato/.test(name)) return 'contrato';
  return null;
}
/** Text boxes are extracted from pdf.js, with dimensions normalized to [0,1] and top-origin. */
export function suggestWorkerSignatureAnchor(pages, workerName) {
  const name=normalize(workerName);
  if (!name || !Array.isArray(pages) || !pages.length) return {status:'REVIEW_REQUIRED', reason:'Falta el trabajador o las páginas'};
  const candidates=[];
  pages.forEach((page,index)=>{
    const items=Array.isArray(page?.items)?page.items:[];
    for (let i=0;i<items.length;i++) {
      const label=normalize(items[i]?.text);
      const explicit=/^(firma\s+(del?\s+)?trabajador|el\s+trabajador|la\s+persona\s+trabajadora)$/.test(label);
      const named=label===name || (name.length>=8 && label.includes(name));
      if (!explicit && !named) continue;
      const x=Number(items[i].x), y=Number(items[i].y);
      if (!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>1||y<0||y>1) continue;
      // Suggest only if both the worker's identity and the signature field appear nearby.
      const near=items.some(t=>t!==items[i] && Math.abs(Number(t?.y)-y)<0.20 && (
        explicit ? normalize(t?.text).includes(name) :
        /firma\s+(del?\s+)?trabajador|el\s+trabajador/.test(normalize(t?.text))
      ));
      if (!near) continue;
      const width=0.30,height=0.085;
      const below=y+0.018;
      if (below+height>0.99) continue;
      candidates.push({page:index+1,x:Math.min(x,1-width),y:below,width,height,source:explicit?'WORKER_SIGNATURE_LABEL':'WORKER_NAME'});
    }
  });
  // Ambiguous/multiple zones are always reviewed manually: never invent a position.
  const unique=candidates.filter((c,i)=>candidates.findIndex(v=>v.page===c.page && Math.abs(v.x-c.x)<0.05 && Math.abs(v.y-c.y)<0.05)===i);
  if (unique.length!==1) return {status:'REVIEW_REQUIRED',reason:unique.length?'Hay varias posibles zonas de firma':'No se detectó una zona de firma fiable',candidates:unique};
  return {status:'SUGGESTED',anchor:unique[0],requiresSupervisorConfirmation:true};
}
export function validateContractImport({documentType,pages,workers,anchorConfirmed}) {
  const errors=[];
  if(!CONTRACT_DOCUMENT_TYPES.includes(documentType))errors.push('Tipo documental no admitido');
  if(!Number.isInteger(pages)||pages<1)errors.push('PDF sin páginas válidas');
  if(!Array.isArray(workers)||workers.length!==1||!workers[0]?.name)errors.push('El contrato o prórroga debe corresponder a un único trabajador identificado');
  if(anchorConfirmed!==true)errors.push('El supervisor debe confirmar la ubicación de firma');
  return {valid:errors.length===0,errors};
}
