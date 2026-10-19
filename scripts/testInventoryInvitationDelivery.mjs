import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {build} from 'esbuild';
const output=new URL('./.inventory-invitation-delivery.mjs',import.meta.url);
let result, error, calls=[];
globalThis.__inventoryEdge=async(name,body)=>{calls.push({name,body});if(error)throw error;return result;};
try {
 await build({entryPoints:[new URL('../src/services/inventoryService.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'esm',packages:'external',outfile:output.pathname,plugins:[{name:'transport',setup(b){
  b.onResolve({filter:/\/lib\/supabase$/},()=>({path:'transport',namespace:'mock'}));
  b.onResolve({filter:/offlineStore$/},()=>({path:'offline',namespace:'mock'}));
  b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:args.path==='transport'?"export const supabase={edgeFunction:(...args)=>globalThis.__inventoryEdge(...args)};export const getSessionUser=async()=>null;export const queueOfflineRpc=async()=>{};export const queueOfflineStorageRemove=async()=>{};export const queueOfflineStorageUpload=async()=>{};":"export const listOfflineOperations=async()=>[];export const offlineCacheKey=(...args)=>args.join(':');export const readOfflineCache=async()=>[];export const writeOfflineCache=async()=>{};"}));
 }}]});
 const {sendInventoryParkInvitationEmail}=await import(output.href);
 for(result of [null,{}, {ok:false,delivery:'not_configured'}, {ok:true,delivery:'not_configured'}])await assert.rejects(()=>sendInventoryParkInvitationEmail('invitation-test'),/No se pudo enviar/);
 error=new Error('HTTP 503: mail unavailable');await assert.rejects(()=>sendInventoryParkInvitationEmail('invitation-test'),/503/);
 error=null;result={ok:true,delivery:'sent'};assert.equal((await sendInventoryParkInvitationEmail('invitation-test')).delivery,'sent');
 assert.equal(calls.length,6);assert(calls.every(call=>call.name==='inventory-share-invite'&&call.body.invitationId==='invitation-test'));
 console.log('PASS real inventory delivery service: exact invitation ID, sent confirmation, rejected/unconfigured/invalid responses and transport errors. No real emails sent.');
} finally {await fs.unlink(output).catch(()=>{});delete globalThis.__inventoryEdge;}
