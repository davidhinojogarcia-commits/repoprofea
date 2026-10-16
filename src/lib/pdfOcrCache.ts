// Per-import, in-memory cache. File identity prevents cross-document reuse; WeakMap
// lets results disappear when the import finishes. No personal data is persisted.
const pages=new WeakMap<File,Map<number,{data:any;scale:number}>>();
export const getPdfPageOcr=(file:File,page:number)=>pages.get(file)?.get(page);
export function rememberPdfPageOcr(file:File,page:number,data:any,scale:number){
  let entries=pages.get(file);
  if(!entries){entries=new Map();pages.set(file,entries);}
  entries.set(page,{data,scale});
}
