import type { Person } from '../../types';

export type SignatureAnchorGeometry = {
  workerId:number;
  workerName:string;
  page:number;
  resolved:boolean;
  nameX:number|null;
  nameY:number|null;
  nameWidth?:number|null;
  nameHeight?:number|null;
  nameRightX?:number|null;
  nameCenterY?:number|null;
  rowHeight:number|null;
  signatureX:number|null;
  signatureY:number|null;
  signatureWidth:number|null;
  signatureHeight:number|null;
};

export type SignaturePageGeometry={
  page:number;
  width:number;
  height:number;
  rotation?:number;
};

export type MandatorySignaturePlacementIssue={
  workerId:number;
  workerName:string;
  code:'UNRESOLVED'|'OUT_OF_PAGE'|'OVERLAP_NAME'|'OVERLAP_SIGNATURE'|'CLOSER_TO_OTHER_WORKER';
  message:string;
};

const normalize = (value: unknown) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9Ñ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const cleanWorkerName = (value: unknown) =>
  normalize(String(value || '').replace(/\[[^\]]*\]\s*$/g, '').replace(/\([^)]*\)\s*$/g, ''));

const workerNameTokens = (worker: Pick<Person,'apellidosNombre'>) =>
  cleanWorkerName(worker.apellidosNombre)
    .split(' ')
    .filter(token => token.length >= 2 && !['DE','DEL','LA','LAS','LOS','Y'].includes(token));

export const mandatoryNameTokenMatch = (token:string,other:string) =>
  token===other ||
  (token.length===1 && other.startsWith(token)) ||
  (other.length===1 && token.startsWith(other)) ||
  (token.length>=4 && other.length>=4 && (
    token.startsWith(other) || other.startsWith(token)
  ));

export const scoreMandatoryWorkerNameText = (worker: Pick<Person,'apellidosNombre'>, text: string) => {
  const textNorm = normalize(text);
  const fullName = cleanWorkerName(worker.apellidosNombre);
  if (!fullName || !textNorm) return 0;
  if (textNorm === fullName) return 1;
  if (textNorm.includes(fullName) || fullName.includes(textNorm)) return 0.975;

  const tokens = workerNameTokens(worker);
  if (tokens.length < 2) return 0;
  const lineTokens = textNorm.split(' ').filter(Boolean);
  const hits=tokens.filter(token=>lineTokens.some(other=>mandatoryNameTokenMatch(token,other))).length;
  const coverage=hits/Math.max(1,tokens.length);
  const precision=hits/Math.max(1,lineTokens.length);
  if(hits>=2 && coverage>=0.78)return 0.91 + Math.min(0.05,precision*0.05);
  if(hits>=2 && coverage>=0.6)return 0.82;
  return 0;
};

const boxesOverlap=(a:{x:number;y:number;width:number;height:number},b:{x:number;y:number;width:number;height:number},padding=0)=>
  a.x < b.x+b.width+padding &&
  a.x+a.width+padding > b.x &&
  a.y < b.y+b.height+padding &&
  a.y+a.height+padding > b.y;

export const validateMandatorySignaturePlacement=(anchors:SignatureAnchorGeometry[],pages:SignaturePageGeometry[])=>{
  const issues:MandatorySignaturePlacementIssue[]=[];
  const pageMap=new Map(pages.map(page=>[page.page,page]));
  const resolved=anchors.filter(anchor=>anchor.resolved);

  for(const anchor of anchors){
    const page=pageMap.get(anchor.page);
    if(!anchor.resolved||anchor.signatureX==null||anchor.signatureY==null||anchor.signatureWidth==null||anchor.signatureHeight==null||anchor.nameX==null||anchor.nameY==null){
      issues.push({workerId:anchor.workerId,workerName:anchor.workerName,code:'UNRESOLVED',message:'No se ha localizado con seguridad el nombre del trabajador en el PDF original.'});
      continue;
    }
    if(!page)continue;
    const sig={x:Number(anchor.signatureX),y:Number(anchor.signatureY),width:Number(anchor.signatureWidth),height:Number(anchor.signatureHeight)};
    if(sig.x<0||sig.y<0||sig.x+sig.width>page.width||sig.y+sig.height>page.height){
      issues.push({workerId:anchor.workerId,workerName:anchor.workerName,code:'OUT_OF_PAGE',message:'La firma quedaría fuera de los límites de la página.'});
    }

    const ownName={
      x:Number(anchor.nameX),
      y:Number(anchor.nameY),
      width:Number(anchor.nameWidth||Math.max(1,Number(anchor.nameRightX||anchor.nameX)-Number(anchor.nameX))),
      height:Number(anchor.nameHeight||anchor.rowHeight||10),
    };
    for(const other of resolved){
      if(other.workerId===anchor.workerId||other.page!==anchor.page||other.nameX==null||other.nameY==null)continue;
      const otherName={
        x:Number(other.nameX),
        y:Number(other.nameY),
        width:Number(other.nameWidth||Math.max(1,Number(other.nameRightX||other.nameX)-Number(other.nameX))),
        height:Number(other.nameHeight||other.rowHeight||10),
      };
      if(boxesOverlap(sig,otherName,2)){
        issues.push({workerId:anchor.workerId,workerName:anchor.workerName,code:'OVERLAP_NAME',message:`La firma invadiría el nombre de ${other.workerName}.`});
        break;
      }
    }

    const distanceBetweenBoxes=(a:{x:number;y:number;width:number;height:number},b:{x:number;y:number;width:number;height:number})=>{
      const dx=Math.max(b.x-(a.x+a.width),a.x-(b.x+b.width),0);
      const dy=Math.max(b.y-(a.y+a.height),a.y-(b.y+b.height),0);
      return Math.hypot(dx,dy);
    };
    const ownDistance=distanceBetweenBoxes(sig,ownName);
    for(const other of resolved){
      if(other.workerId===anchor.workerId||other.page!==anchor.page||other.nameX==null||other.nameY==null)continue;
      const otherName={
        x:Number(other.nameX),
        y:Number(other.nameY),
        width:Number(other.nameWidth||Math.max(1,Number(other.nameRightX||other.nameX)-Number(other.nameX))),
        height:Number(other.nameHeight||other.rowHeight||10),
      };
      const otherDistance=distanceBetweenBoxes(sig,otherName);
      if(otherDistance+1<ownDistance){
        issues.push({workerId:anchor.workerId,workerName:anchor.workerName,code:'CLOSER_TO_OTHER_WORKER',message:`La firma quedaría visualmente más cerca de ${other.workerName} que de su propio nombre.`});
        break;
      }
    }
  }

  for(let i=0;i<resolved.length;i+=1){
    const a=resolved[i];
    if(a.signatureX==null||a.signatureY==null||a.signatureWidth==null||a.signatureHeight==null)continue;
    const boxA={x:Number(a.signatureX),y:Number(a.signatureY),width:Number(a.signatureWidth),height:Number(a.signatureHeight)};
    for(let j=i+1;j<resolved.length;j+=1){
      const b=resolved[j];
      if(a.page!==b.page||b.signatureX==null||b.signatureY==null||b.signatureWidth==null||b.signatureHeight==null)continue;
      const boxB={x:Number(b.signatureX),y:Number(b.signatureY),width:Number(b.signatureWidth),height:Number(b.signatureHeight)};
      if(boxesOverlap(boxA,boxB,2)){
        issues.push({workerId:a.workerId,workerName:a.workerName,code:'OVERLAP_SIGNATURE',message:`La firma colisionaría con la de ${b.workerName}.`});
        issues.push({workerId:b.workerId,workerName:b.workerName,code:'OVERLAP_SIGNATURE',message:`La firma colisionaría con la de ${a.workerName}.`});
      }
    }
  }

  const unique=new Map<string,MandatorySignaturePlacementIssue>();
  for(const issue of issues)unique.set(`${issue.workerId}:${issue.code}:${issue.message}`,issue);
  return {ok:unique.size===0,issues:[...unique.values()]};
};

export const computeSignatureBoxFromDetectedName=(input:{
  pageWidth:number;
  pageHeight:number;
  nameX:number;
  nameY:number;
  nameRightX:number;
  nameHeight:number;
  nextTextX?:number|null;
  upperWorkerCenterY?:number|null;
  lowerWorkerCenterY?:number|null;
})=>{
  const rightMargin=Math.max(14,input.pageWidth*0.02);
  const gap=Math.max(6,Math.min(11,input.nameHeight*0.65));
  const maxRight=Math.min(
    input.pageWidth-rightMargin,
    input.nextTextX!=null?Number(input.nextTextX)-4:input.pageWidth-rightMargin,
  );
  const startX=input.nameRightX+gap;
  const available=maxRight-startX;
  const desiredWidth=Math.max(58,Math.min(92,input.pageWidth*0.145));
  const minWidth=28;
  if(available<minWidth)return null;

  const desiredHeight=Math.max(10,Math.min(18,input.nameHeight*1.35));
  const ownCenterY=input.nameY+(input.nameHeight/2);
  const verticalLimits:number[]=[];
  if(input.upperWorkerCenterY!=null)verticalLimits.push(Math.abs(Number(input.upperWorkerCenterY)-ownCenterY)-4);
  if(input.lowerWorkerCenterY!=null)verticalLimits.push(Math.abs(ownCenterY-Number(input.lowerWorkerCenterY))-4);
  const maxHeight=verticalLimits.length?Math.min(...verticalLimits):desiredHeight;
  if(maxHeight<8)return null;

  const height=Math.min(desiredHeight,maxHeight);
  const width=Math.min(desiredWidth,available,Math.max(minWidth,desiredWidth*(height/desiredHeight)));
  if(width<minWidth)return null;
  const y=ownCenterY-(height/2);
  if(y<4||y+height>input.pageHeight-4)return null;
  return {x:startX,y,width,height};
};


export const fitSignatureInsideBox=(input:{
  imageWidth:number;
  imageHeight:number;
  boxWidth:number;
  boxHeight:number;
})=>{
  const safeImageWidth=Math.max(1,Number(input.imageWidth)||1);
  const safeImageHeight=Math.max(1,Number(input.imageHeight)||1);
  const safeBoxWidth=Math.max(1,Number(input.boxWidth)||1);
  const safeBoxHeight=Math.max(1,Number(input.boxHeight)||1);
  const ratio=safeImageWidth/safeImageHeight;
  let width=safeBoxWidth;
  let height=width/ratio;
  if(height>safeBoxHeight){
    height=safeBoxHeight;
    width=height*ratio;
  }
  return {width,height};
};
