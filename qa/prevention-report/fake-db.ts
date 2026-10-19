export let scenario='vertical';
export const calls:string[]=[];
export function selectScenario(value:string){scenario=value;calls.length=0;}
function image(vertical:boolean){
 const c=document.createElement('canvas');c.width=vertical?600:1000;c.height=vertical?1000:600;
 const ctx=c.getContext('2d')!;ctx.fillStyle='#d6ebf5';ctx.fillRect(0,0,c.width,c.height);
 ctx.fillStyle='#c49a6c';ctx.fillRect(0,c.height*.48,c.width,c.height*.52);
 ctx.fillStyle='#434850';ctx.fillRect(c.width*.27,c.height*.56,c.width*.46,c.height*.36);
 for(let n=0;n<3;n++){const x=c.width*(.12+n*.32);ctx.fillStyle='#e77326';ctx.fillRect(x,c.height*.42,20,c.height*.24);ctx.fillStyle='#f9d33e';ctx.fillRect(x-5,c.height*.44,30,45);}
 ctx.fillStyle='#164B9B';ctx.fillRect(0,0,c.width,105);ctx.fillStyle='white';ctx.font='bold 27px sans-serif';ctx.fillText('IMAGEN SINTÉTICA DE PRUEBAS',20,42);ctx.font='24px sans-serif';ctx.fillText(vertical?'VERTICAL · 600 × 1000':'HORIZONTAL · 1000 × 600',20,79);
 return c.toDataURL('image/jpeg',.85);
}
const base={obra:'Obra de pruebas A',kind:'incident',work_date:'2026-10-18',category:'Accesos y señalización',severity:'high',task:'Inspección del acceso',description:'Comprobar la señalización y las protecciones de la excavación.',measures:'Revisar las barreras antes del inicio.',responsible:'Responsable de pruebas',deadline:null,status:'pending',actor:'Supervisor de pruebas',checks:{},created_at:'2026-10-18T09:00:00Z',updated_at:'2026-10-18T09:00:00Z',resolved_at:null,has_photo:true};
export const supabase={async rpc(name:string,args:any={}){
 calls.push(name+(args.p_id?':'+args.p_id:''));window.dispatchEvent(new Event('qa-calls'));
 if(name==='list_prevention_records'){
  const row={...base,id:scenario==='horizontal'?'h':'v',title:scenario==='horizontal'?'Fotografía horizontal':'Fotografía vertical'};
  return {records:[row,...(scenario==='mixed'?[{...base,id:'h',title:'Fotografía horizontal',description:'Seguimiento extenso de las medidas preventivas. '.repeat(300)}]:[]),{...base,id:'other',obra:'Obra de pruebas B',title:'Otra obra: no debe exportarse',has_photo:true}],truncated:false};
 }
 if(name==='get_prevention_acta_history') return [];
 if(name==='get_prevention_record_details'){
  if(args.p_id==='other')throw new Error('La fotografía de otra obra no debe consultarse.');
  if(scenario==='inaccessible')throw new Error('Prueba: fotografía inaccesible (acceso denegado).');
  return {photo:scenario==='missing'?null:scenario==='corrupt'?'data:image/png;base64,YWJj':image(args.p_id==='v'),events:[]};
 }
 throw new Error('Entorno de consulta: no se permiten guardados ni eliminaciones.');
}};
