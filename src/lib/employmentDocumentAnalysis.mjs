/** Pure analysis: the imported PDF is never modified. Suggestions require supervisor review. */
export const CONTRACT_DOCUMENT_TYPES = Object.freeze(['contrato','prorroga']);
const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es').replace(/[^a-z0-9]+/g,' ').trim();
export function classifyEmploymentDocument(text, filename='') {
  const content=normalize(text), name=normalize(filename);
  if (/\bprorroga\b/.test(content.slice(0,3000)) || /\bprorroga\b/.test(name)) return 'prorroga';
  if (/contrato\s+de\s+trabajo|contrato\s+laboral/.test(content.slice(0,3000)) || /\bcontrato\b/.test(name)) return 'contrato';
  return null;
}
const workerLabelText = text => normalize(text).replace(/\bellla\b/g,'el').replace(/\btrabajador(?:ia|la)\b/g,'trabajador').replace(/\bdelide\b/g,'del').replace(/\bdel de la\b/g,'del').replace(/\bel la\b/g,'el').replace(/\btrabajador a\b/g,'trabajador');
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
  const reliable=item=>item.confidence==null||Number(item.confidence)>=0.45;
  const signingLabel=item=>reliable(item)&&workerLabel(item.text)&&!/^datos\b/.test(workerLabelText(item.text));
  const propose=(page,index,item,source)=>{
    const items=page.items||[],x=Number(item.x),y=Number(item.y),h=Number(item.height||0.015);
    if(![x,y,h].every(Number.isFinite)||x<0||x>1||y<0||y>1)return;
    const below=y+h+0.01;
    const nextColumn=items.filter(v=>Number(v.x)>x+0.08&&Math.abs(Number(v.y)-y)<0.035&&/representante|empresa|empleador/.test(normalize(v.text)))
      .sort((a,b)=>a.x-b.x)[0];
    const width=Math.min(0.25,1-x-0.015,nextColumn?Number(nextColumn.x)-x-0.025:1);
    // Reserve only empty space below the identified signing field, never text in a data table.
    const obstacles=items.filter(v=>Number(v.y)>below&&Number(v.x)<x+width&&Number(v.x)+Number(v.width||0.01)>x);
    const bottom=Math.min(0.985,...obstacles.map(v=>Number(v.y)-0.008));
    const height=Math.min(0.045,bottom-below);
    if(width<0.10||height<0.018)return;
    candidates.push({page:index+1,x,y:below,width,height,nameX:source==='WORKER_NAME'?x:null,
      nameY:source==='WORKER_NAME'?y:null,nameWidth:source==='WORKER_NAME'?Number(item.width||0.25):null,
      nameHeight:source==='WORKER_NAME'?h:null,source,labelX:x,labelWidth:Number(item.width||0.08),labelY:y});
  };
  pages.forEach((page,index)=>{
    if(page?.manualOnly)return;
    const items=Array.isArray(page?.items)?page.items:[];
    for(const item of items){
      if(!reliable(item)||!sameName(item.text,workerName))continue;
      const near=items.some(label=>(signingLabel(label)||(reliable(label)&&/^(?:fdo|firmado)(?: por)?$/.test(normalize(label.text))))&&Math.abs(Number(label.x)-Number(item.x))<0.12&&Number(label.y)<=Number(item.y)&&Number(item.y)-Number(label.y)<0.12);
      if(near)propose(page,index,item,'WORKER_NAME');
    }
  });
  if(!candidates.length&&allowLabelOnly)pages.forEach((page,index)=>{
    if(page?.manualOnly)return;
    for(const item of page?.items||[]){
      if(!signingLabel(item))continue;
      const explicit=/^firma\b/.test(workerLabelText(item.text));
      const peer=(page.items||[]).some(v=>Math.abs(Number(v.y)-Number(item.y))<0.035&&Number(v.x)>Number(item.x)+0.08&&/representante|empresa|empleador/.test(normalize(v.text)));
      if(explicit||peer)propose(page,index,item,'WORKER_SIGNATURE_LABEL');
    }
  });
  // OCR/native extraction emits overlapping full lines and word spans for one field.
  // Collapse overlapping labels only; separate signing fields remain ambiguous.
  const unique=[];
  for(const candidate of candidates.sort((a,b)=>b.labelWidth-a.labelWidth)){
    if(!unique.some(v=>v.page===candidate.page&&Math.abs(v.labelY-candidate.labelY)<0.015&&
      candidate.labelX<v.labelX+v.labelWidth&&v.labelX<candidate.labelX+candidate.labelWidth))unique.push(candidate);
  }
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

