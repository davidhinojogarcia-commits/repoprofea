import fs from 'node:fs/promises';
import {build} from 'esbuild';
export const fixtureSource = `
const park={id:'park-a',nombre:'Parque A',zona:'Zona 6',isOwned:true};
const otherPark={...park,id:'park-b',nombre:'Parque B'};
const base={parkId:park.id,cantidad:1,tipoGestion:'individual',activo:true,categoria:'MAQUINARIA',ubicacionActual:'Obra A',detalles:{}};
globalThis.__usage={
 park,parks:[park,otherPark],
 items:[{...base,id:'item-a',codigo:'M1',nombre:'Martillo eléctrico',estado:'Asignada a obra',responsableActual:'user-a'},
 {...base,id:'item-b',codigo:'H1',nombre:'Hormigonera',estado:'En traslado',responsableActual:'user-i'},
 {...base,id:'item-c',codigo:'T1',nombre:'Taladro',estado:'Disponible',responsableActual:null},
 {...base,id:'item-d',codigo:'R1',nombre:'Radial',estado:'Asignada a obra',responsableActual:null},
 {...base,id:'other',parkId:'park-b',codigo:'P2',nombre:'Equipo parque B',estado:'Disponible'}],
 shares:[{participantKey:'user:user-i',userId:'user-i',email:'guest@example.com',displayName:'Lucía Núñez',status:'accepted',isOwner:false},
 {participantKey:'user:user-a',userId:'user-a',email:'owner@example.com',displayName:'Álvaro Prueba',status:'accepted',isOwner:true},
 {participantKey:'invite:pending',userId:'pending',email:'pending@example.com',displayName:'Pendiente',status:'pending',isOwner:false}],
 calls:[],saves:[],uploads:0,hold:false,fail:false,
};
const state=globalThis.__usage;
globalThis.__inventory={
 ensureInventoryReady:async()=>park,
 listInventoryParks:async()=>state.parks,
 listInventoryParkInvitations:async()=>[],
 listInventoryParkShares:async(id)=>id===park.id?state.shares:[state.shares[1]],
 listInventoryItems:async(id)=>{state.calls.push('items');return state.items.filter(item=>item.parkId===id).map(item=>({...item}));},
 uploadInventoryPhotos:async()=>{state.uploads++;return ['park-a/item-a/photo.jpg'];},
 registerInventoryMovement:async(input)=>{state.saves.push({...input});if(state.hold)await new Promise(resolve=>state.release=resolve);if(state.fail)throw Error('Error de guardado simulado');const item=state.items.find(item=>item.id===input.itemId);Object.assign(item,{estado:input.estadoNuevo,ubicacionActual:input.destino,responsableActual:['Asignada a obra','En traslado','En uso'].includes(input.estadoNuevo)?input.responsableId:null});},
};`;

export async function buildUsageFixture(browser=false) {
 const source=await fs.readFile(new URL('../src/services/inventoryService.ts',import.meta.url),'utf8');
 const names=[...source.matchAll(/export async function (\w+)/g)].map(match=>match[1]);
 return build({stdin:{contents:(browser?fixtureSource+"\nimport React from 'react';import {createRoot} from 'react-dom/client';":"")+"\nimport {InventorySection} from './components/InventorySection';"+(browser?"createRoot(document.getElementById('root')).render(React.createElement(InventorySection,{savedObras:['Obra A','Obra B']}));":"export {InventorySection};"),resolveDir:new URL('../',import.meta.url).pathname,loader:'tsx'},bundle:true,platform:browser?'browser':'node',format:browser?'iife':'esm',...(browser?{}:{packages:'external'}),write:false,define:{'import.meta.env':'{}'},plugins:[{name:'boundaries',setup(b){
 b.onResolve({filter:/(?:\/lib\/|\.\/)supabase$/},()=>({path:'auth',namespace:'test-auth'}));
 b.onLoad({filter:/.*/,namespace:'test-auth'},()=>({contents:"export const supabase={auth:{getSession:async()=>({data:{session:{access_token:'fixture-session'}}})}};"}));
 b.onResolve({filter:/inventoryService$/},()=>({path:'service',namespace:'mock'}));
 b.onResolve({filter:/inventoryPdf$|inventoryExcelImport$/},()=>({path:'optional',namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:args.path==='service'?names.map(name=>`export const ${name}=(...args)=>globalThis.__inventory.${name}?.(...args)??Promise.resolve([]);`).join('\n')+"\nexport const INVENTORY_ZONES=['Zona 6'];export const MACHINE_DOCUMENT_TYPES=[];export const parkBaseLocation=p=>p.nombre;":"export const exportInventoryStatusPdf=async()=>{};export const analyzeInventoryExcel=async()=>[];export const applyInventoryImportPlan=async()=>({});export const buildInventoryImportPlan=()=>({});"}));
 }}]});
}
