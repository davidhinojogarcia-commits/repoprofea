import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {build} from 'esbuild';
const output=new URL('./.inventory-usage-service.mjs',import.meta.url);
const park='park-1',item='item-1',owner='recorder',guest='actual-user';
let online=true,ops=[],calls=[],queue=[],rows=[{id:item,park_id:park,nombre:'Taladro',estado:'Asignada a obra',responsable_actual:guest}];
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{get onLine(){return online;}}});
globalThis.__usageTransport={
 supabase:{query:async(table)=>{calls.push({table});return rows;},rpc:async(name,body)=>{calls.push({name,body});return name==='get_inventory_supervisors'?[{item_id:item,supervisor_id:owner,supervisor_name:'Supervisor'}]:body.p_movement_id;}},
 offlineCacheKey:(user,scope,key)=>`${user}:${scope}:${key}`,readOfflineCache:async()=>[{item_id:item,supervisor_id:owner,supervisor_name:'Supervisor'}],writeOfflineCache:async()=>{},
 getSessionUser:async()=>({id:owner}),queueOfflineRpc:async(name,body,label,meta)=>{queue.push({name,body,meta});},
 queueOfflineStorageRemove:async()=>{},queueOfflineStorageUpload:async()=>{},
 listOfflineOperations:async(userId)=>{assert.equal(userId,owner);return ops.filter(op=>op.userId===userId);},
};
try {
 await build({entryPoints:[new URL('../src/services/inventoryService.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'esm',packages:'external',outfile:output.pathname,plugins:[{name:'transport',setup(b){
 b.onResolve({filter:/\/lib\/supabase$|offlineStore$/},()=>({path:'transport',namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:['supabase','getSessionUser','queueOfflineRpc','queueOfflineStorageRemove','queueOfflineStorageUpload','listOfflineOperations','offlineCacheKey','readOfflineCache','writeOfflineCache'].map(name=>`export const ${name}=globalThis.__usageTransport.${name};`).join('\n')}));
 }}]});
 const service=await import(output.href);
 const input={itemId:item,parkId:park,tipo:'Salida a obra',destino:'Obra A',estadoNuevo:'Asignada a obra',responsableId:guest,movementId:'stable-id'};
 await service.registerInventoryMovement(input);const call=calls.at(-1);assert.equal(call.name,'inventory_register_usage_movement');assert.equal(call.body.p_responsable_id,guest);assert.equal(call.body.p_movement_id,'stable-id');
 await service.registerInventoryMovement({...input,estadoNuevo:'Disponible'});assert.equal(calls.at(-1).body.p_responsable_id,null);
 online=false;await assert.rejects(()=>service.registerInventoryMovement({...input,responsableId:null}),/Selecciona/);assert.equal(queue.length,0);
 await service.registerInventoryMovement(input);assert.equal(queue[0].meta.responsableId,guest);assert.equal(queue[0].meta.movementId,'stable-id');
 const pending=(name,meta,userId=owner)=>({kind:'rpc',userId,createdAt:Date.now(),payload:{name,meta:{parkId:park,itemId:item,...meta}}});
 ops=[pending('inventory_register_usage_movement',{responsableId:guest,estadoNuevo:'En traslado',destino:'Obra B'})];
 let result=await service.listInventoryItems(park);assert.equal(result[0].responsableActual,guest);assert.equal(result[0].estado,'En traslado');assert.equal(result[0].supervisorResponsableId,owner);
 ops=[pending('inventory_update_movement',{estadoNuevo:'Disponible',destino:'Obra antigua',affectsCurrentState:false})];
 result=await service.listInventoryItems(park);assert.equal(result[0].estado,'Asignada a obra','old movement correction does not replace current state');assert.equal(result[0].responsableActual,guest,'editor is never made user');
 ops=[pending('inventory_update_movement',{estadoNuevo:'Asignada a obra',responsableId:guest,affectsCurrentState:true})];
 result=await service.listInventoryItems(park);assert.equal(result[0].responsableActual,guest);
 ops=[pending('inventory_register_usage_movement',{estadoNuevo:'Disponible',responsableId:guest})];result=await service.listInventoryItems(park);assert.equal(result[0].responsableActual,null);
 ops=[pending('inventory_register_usage_movement',{estadoNuevo:'En traslado',responsableId:'other-session'},'other-session')];result=await service.listInventoryItems(park);assert.equal(result[0].responsableActual,guest);
 await service.updateInventoryMovement({movementId:'old',itemId:item,parkId:park,tipo:'Corrección',destino:'Obra A',estadoNuevo:'Asignada a obra',affectsCurrentState:true,responsableId:guest});assert.equal(queue.at(-1).meta.responsableId,guest);
 console.log('PASS real inventory service: explicit user, stable request ID, clear on return, offline queue/projection, old-history correction, recorder separation and session isolation.');
} finally {await fs.unlink(output).catch(()=>{});delete globalThis.__usageTransport;}
