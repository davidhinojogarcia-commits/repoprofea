const norm = (value: unknown) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9Ñ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const STOP = new Set([
  'OBRA','DE','DEL','LA','LAS','LOS','Y','EN','EL','AL','PARA','POR','CON','PROFEA','PFEA',
  'CONTROL','PRESENCIA','INICIO','INCORPORACION','TRABAJADORES','RELACION','DOCUMENTO',
]);

const significantTokens=(value:string)=>
  norm(value).split(' ').filter(token=>token.length>=3&&!STOP.has(token));

export const extractMandatoryWorksiteLabel=(text:string)=>{
  const lines=String(text||'').split(/\r?\n/).map(line=>line.replace(/\s+/g,' ').trim()).filter(Boolean);

  for(let i=0;i<lines.length;i+=1){
    const line=lines[i];
    const direct=line.match(/^\s*OBRA\s*[:\-–]?\s*(.+)$/i);
    if(direct?.[1]){
      const value=direct[1]
        .replace(/\s+(?:CATEGORIA|N[.º°]?I[.º°]?F[.º°]?|NIF|FIRMA)\b.*$/i,'')
        .trim();
      if(value.length>=4)return value;
    }
    if(/^\s*OBRA\s*[:\-–]?\s*$/i.test(line)&&lines[i+1]){
      const value=lines[i+1]
        .replace(/\s+(?:CATEGORIA|N[.º°]?I[.º°]?F[.º°]?|NIF|FIRMA)\b.*$/i,'')
        .trim();
      if(value.length>=4)return value;
    }
  }
  return '';
};

export const extractMandatoryWorksiteCode=(text:string)=>{
  const n=norm(text);
  const match=n.match(/\b(\d{4,6})\s*[-/]?\s*(EE|GR)\b/);
  return match ? match[1] + ' ' + match[2] : '';
};

const scoreCandidate=(candidate:string,probe:string)=>{
  const c=norm(candidate);
  const p=norm(probe);
  if(!c||!p)return 0;
  if(c===p)return 1;
  if(p.includes(c))return 0.98;
  if(c.includes(p)&&p.length>=12)return 0.94;

  const ct=significantTokens(candidate);
  const pt=new Set(significantTokens(probe));
  if(ct.length<2)return 0;
  const hits=ct.filter(token=>pt.has(token)).length;
  const coverage=hits/ct.length;
  if(hits>=4&&coverage>=0.75)return 0.9;
  if(hits>=3&&coverage>=0.7)return 0.84;
  return 0;
};

export const resolveMandatoryWorksite=(input:{
  text:string;
  candidates?:string[];
  fallback?:string;
})=>{
  const candidates=(input.candidates||[]).map(value=>String(value||'').trim()).filter(Boolean);
  const label=extractMandatoryWorksiteLabel(input.text);
  const code=extractMandatoryWorksiteCode(input.text);

  const probes=[label,code].filter(Boolean);
  let best:{value:string;score:number}|null=null;
  for(const candidate of candidates){
    for(const probe of probes){
      const score=scoreCandidate(candidate,probe);
      if(!best||score>best.score)best={value:candidate,score};
    }
    if(!probes.length){
      const score=scoreCandidate(candidate,input.text);
      if(!best||score>best.score)best={value:candidate,score};
    }
  }

  if(best&&best.score>=0.84)return {obra:best.value,source:'candidate' as const,confidence:best.score,label,code};
  if(label)return {obra:label,source:'document-label' as const,confidence:0.8,label,code};
  if(code)return {obra:code,source:'document-code' as const,confidence:0.8,label,code};

  const fallback=String(input.fallback||'').trim();
  return fallback
    ? {obra:fallback,source:'fallback' as const,confidence:0.4,label,code}
    : {obra:'',source:'unresolved' as const,confidence:0,label,code};
};
