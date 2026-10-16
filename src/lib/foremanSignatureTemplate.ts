/** Position of a foreman signature in normalized PDF page coordinates.
 * Never key a reusable layout by document title alone: templateKey must identify
 * a verified model, and page aspect ratios must be compatible before reuse.
 */
export type ForemanSignatureTemplate = {
  templateKey: string;
  enabled: boolean;
  required: boolean;
  allPages: true;
  x: number;
  y: number;
  width: number;
  height: number;
  pageRatio: number;
  revision: number;
};
export type PdfPageSize = { width: number; height: number };
export type SignatureRectangle = { page: number; x: number; y: number; width: number; height: number };
/** Default boxes match the signature cells of the existing institutional models. */
export function defaultGeneratedForemanTemplate(templateKey:string):ForemanSignatureTemplate {
  const attendance=templateKey.startsWith('control_horario:');
  return {templateKey,enabled:false,required:false,allPages:true,
    x:(attendance?214:14)/297,y:(attendance?86:18)/210,
    width:(attendance?68:82)/297,height:(attendance?10:14)/210,
    pageRatio:297/210,revision:1};
}
const finite = (n: number) => Number.isFinite(n);
export function validateForemanTemplate(template: ForemanSignatureTemplate): void {
  if (!template.templateKey?.trim()) throw new Error('Modelo documental sin identificar.');
  if (![template.x,template.y,template.width,template.height,template.pageRatio].every(finite) ||
    template.x<0||template.y<0||template.width<=0||template.height<=0||
    template.x+template.width>1||template.y+template.height>1||template.pageRatio<=0)
    throw new Error('El recuadro de firma del encargado no es válido.');
}
export function repeatForemanSignature(template: ForemanSignatureTemplate,pages:PdfPageSize[]):SignatureRectangle[] {
  if(!template.enabled)return [];
  validateForemanTemplate(template);
  if(!pages.length)throw new Error('El PDF no contiene páginas.');
  return pages.map((page,i)=>{
    if(!finite(page.width)||!finite(page.height)||page.width<=0||page.height<=0)
      throw new Error('Página PDF sin dimensiones válidas.');
    const ratio=page.width/page.height;
    if(Math.abs(ratio-template.pageRatio)>0.012)
      throw new Error('El formato de una página no coincide con el de la plantilla. Requiere revisión del supervisor.');
    return {
      page:i+1,
      x:template.x*page.width,
      y:template.y*page.height,
      width:template.width*page.width,
      height:template.height*page.height,
    };
  });
}
export function createForemanTemplate(
  templateKey:string, box:{x:number;y:number;width:number;height:number}, page:PdfPageSize,
  existing?:ForemanSignatureTemplate,
):ForemanSignatureTemplate {
  if(!finite(page.width)||!finite(page.height)||page.width<=0||page.height<=0)throw new Error('Dimensiones PDF inválidas.');
  const candidate:ForemanSignatureTemplate={
    templateKey,enabled:true,required:existing?.required??false,allPages:true,
    x:box.x/page.width,y:box.y/page.height,
    width:box.width/page.width,height:box.height/page.height,
    pageRatio:page.width/page.height,revision:(existing?.revision??0)+1,
  };
  validateForemanTemplate(candidate);
  return candidate;
}
