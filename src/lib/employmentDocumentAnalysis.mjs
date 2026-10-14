/** Pure analysis: the imported PDF is never modified. Suggestions require supervisor review. */
export const CONTRACT_DOCUMENT_TYPES = Object.freeze(['contrato','prorroga']);
const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es').replace(/[^a-z0-9]+/g,' ').trim();
export function classifyEmploymentDocument(text, filename='') {
  const content=normalize(text), name=normalize(filename);
  if (/\bprorroga\b/.test(content.slice(0,3000)) || /\bprorroga\b/.test(name)) return 'prorroga';
  if (/contrato\s+de\s+trabajo|contrato\s+laboral/.test(content.slice(0,3000)) || /\bcontrato\b/.test(name)) return 'contrato';
  return null;
}
const workerLabelText = text => normalize(text).replace(/\bdelide\b/g,'del').replace(/\bdel de la\b/g,'del').replace(/\bel la\b/g,'el').replace(/\btrabajador a\b/g,'trabajador');
const workerLabel = text => /^(?:(?:firma(?: del| de la)?|datos(?: del| de la)?) )?(?:el |la |del |de la )?(?:trabajador(?:a)?|persona trabajadora)$/.test(workerLabelText(text));
const sameName = (a,b) => {
  const left=normalize(a).split(' ').sort(),right=normalize(b).split(' ').sort();
  return left.length>=2 && left.join(' ')===right.join(' ');
};
/** Only names explicitly inside the worker's block; never the employer or directory alone. */
export function recognizeEmploymentWorker(text) {
  const lines=String(text||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const names=[];
  for(let i=0;i<lines.length;i++) {
    const label=workerLabelText(lines[i]);
    if(!workerLabel(lines[i]) && !/^(?:datos (?:del|de la) )?(?:trabajador|trabajadora|persona trabajadora)\b/.test(label))continue;
    const inline=lines[i].match(/^(?:(?:DATOS|FIRMA)\s+(?:DEL|DE LA)\s+)?(?:EL\s+|LA\s+)?(?:TRABAJADOR(?:A)?|PERSONA\s+TRABAJADORA)\s*[:\-]\s*(.+)$/i)?.[1];
    for(const raw of inline?[inline]:lines.slice(i+1,i+5)) {
      if(/empresa|representante|empleador|domicilio|clausula|cláusula/i.test(raw))break;
      const candidate=raw.replace(/^(?:D\s*[./](?:D[ÑN]A\.?)?|D[ÑN]A\.?\s|NOMBRE Y APELLIDOS|APELLIDOS Y NOMBRE)\s*[:\-]?\s*/i,'').replace(/\s+[|]?(?:[XYZ]?[0-9]{7,8}[A-Z]|[0-9]{1,2}[/.\-][0-9]{1,2}[/.\-][0-9]{4})\b.*$/i,'').replace(/\s*\|\s*$/,'').trim();
      if(/^[\p{L}][\p{L}\s,.'’-]+$/u.test(candidate) && candidate.split(/\s+/).length>=2 && candidate.split(/\s+/).length<=9 && !/nombre|apellidos|firma|dni|nif|fecha|contrato|trabajador|provincia|municipio|afiliaci[oó]n|nivel|formativo|nacionalidad|domicilio|pa[ií]s|r[eé]gimen/i.test(candidate)) {
        if(!names.some(n=>sameName(n,candidate)))names.push(candidate);
        break;
      }
    }
  }
  return names.length===1?{name:names[0],status:'SUGGESTED'}:{name:null,status:'REVIEW_REQUIRED',reason:names.length?'Se han detectado varias identidades':'Revisa el nombre del trabajador en el original'};
}
/** Coordinates normalized to [0,1], top origin, on unrotated PDF pages. */
export function suggestWorkerSignatureAnchor(pages, workerName, allowLabelOnly=false) {
  if(!normalize(workerName)||!Array.isArray(pages)||!pages.length)return {status:'REVIEW_REQUIRED',reason:'Falta el trabajador o las páginas'};
  const candidates=[];
  pages.forEach((page,index)=>{
    const items=Array.isArray(page?.items)?page.items:[];
    for(const item of items) {
      if(!sameName(item?.text,workerName))continue;
      const x=Number(item.x),y=Number(item.y),nameHeight=Number(item.height||0.015);
      if(![x,y,nameHeight].every(Number.isFinite)||x<0||x>1||y<0||y>1)continue;
      const near=items.some(label=>workerLabel(label?.text) && Math.abs(Number(label?.x)-x)<0.18 && Math.abs(Number(label?.y)-y)<0.16);
      if(!near)continue;
      const width=0.25,height=0.045,below=y+nameHeight+0.008;
      if(below+height>0.99)continue;
      candidates.push({page:index+1,x:Math.min(x,1-width),y:below,width,height,nameX:x,nameY:y,nameWidth:Number(item.width||0.25),nameHeight,source:'WORKER_NAME'});
    }
  });
  // Official forms may print the identity in the data table and only a worker label at the signing field.
  // Label-only suggestions are allowed exclusively after identifying a single worker in that document.
  if(!candidates.length && allowLabelOnly) pages.forEach((page,index)=>{
    for(const item of page?.items||[]) {
      const label=workerLabelText(item?.text);
      if(!workerLabel(item?.text)||/^datos\b/.test(label)||Number(item?.y)<0.5)continue;
      const x=Number(item.x),y=Number(item.y),height=Number(item.height||0.015);
      if(![x,y,height].every(Number.isFinite)||x<0||x>0.9||y<0||y>0.9)continue;
      const below=y+height+0.012;
      if(below+0.045>0.99)continue;
      candidates.push({page:index+1,x:Math.min(x,0.75),y:below,width:0.25,height:0.045,nameX:null,nameY:null,nameWidth:null,nameHeight:null,source:'WORKER_SIGNATURE_LABEL'});
    }
  });
  const unique=candidates.filter((c,i)=>candidates.findIndex(v=>v.page===c.page&&Math.abs(v.x-c.x)<0.01&&Math.abs(v.y-c.y)<0.01)===i);
  if(unique.length!==1)return {status:'REVIEW_REQUIRED',reason:unique.length?'Hay varias posibles zonas de firma':'No se detectó una zona de firma fiable',candidates:unique};
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
