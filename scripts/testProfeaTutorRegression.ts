import assert from 'node:assert/strict';
import { authenticateTutorRequest, executeTutorTools, executeTutorConfirmation, planTutorRequestLocal } from '../src/server/profeaTutorAgent';
import { profeaTutorHandler } from '../src/server/profeaTutorHandler';
process.env.VITE_SUPABASE_URL='https://example.supabase.test';
process.env.VITE_SUPABASE_PUBLISHABLE_KEY='test';
process.env.TUTOR_CONFIRMATION_SECRET='test-only-secret';
const ctx={currentView:'prevencion',obra:'A',periodo:'P1'};
const d1='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',d2='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let calls:any[]=[],workers:any[]=[],docs:any[]=[{id:d1,obra:'A'}],auth:any={id:'u'},profile:any={id:'u',active:true,role:'supervisor'},status=200,deleteCount=1,saved:any,invalidSave=false,missingPersisted=false;
const original=globalThis.fetch;
globalThis.fetch=async(input,init:any={})=>{
 const url=new URL(String(input));const body=init.body?JSON.parse(init.body):null;calls.push({url:url.href,init,body});
 let data:any=[];
 if(url.pathname==='/auth/v1/user')data=auth;
 if(url.pathname==='/rest/v1/profiles')data=profile?[profile]:[];
 if(url.pathname==='/rest/v1/trabajadores')data=workers.slice(Number(url.searchParams.get('offset')||0),Number(url.searchParams.get('offset')||0)+Number(url.searchParams.get('limit')||200));
 if(url.pathname==='/rest/v1/foreman_mandatory_documents')data=docs.slice(Number(url.searchParams.get('offset')||0),Number(url.searchParams.get('offset')||0)+Number(url.searchParams.get('limit')||200));
 if(url.pathname.endsWith('/save_prevention_record')){saved={...body.p_data,id:body.p_id,status:'pending',updated_at:'2026-10-10T08:00:00Z'};data=invalidSave?null:saved;}
 if(url.pathname==='/rest/v1/prevention_records')data=missingPersisted?[]:[saved];
 if(url.pathname.endsWith('/delete_foreman_mandatory_documents'))data=deleteCount;
 return new Response(JSON.stringify(data),{status});
};
let passed=0;
async function test(name:string,fn:()=>any){calls=[];await fn();passed++;console.log('PASS '+name);}
const run=(name:string,args:any={},question='consulta',requestId='r')=>executeTutorTools([{name,arguments:args}],ctx,'tok',requestId,question,'u');
async function endpoint(body:any,authorization='Bearer tok',method='POST'){
 let result:any;const res={setHeader(){},status(code:number){result={status:code};return this},json(data:any){result={status:200,...result,data};return result}};
 await profeaTutorHandler({method,body,headers:{authorization}},res);return result;
}
const fullCommand='Registra una incidencia; obra: A; fecha: 2026-10-10; categoría: Otros; prioridad: Media; título: Protección; tarea: Trabajo; descripción: Falta protección';
try{
 await test('sesión ausente y esquema Bearer obligatorio',async()=>{await assert.rejects(authenticateTutorRequest(''),(e:any)=>e.status===401);await assert.rejects(authenticateTutorRequest('tok'),(e:any)=>e.status===401);assert.equal(calls.length,0)});
 await test('sesión válida y perfil activo',async()=>{assert.equal((await authenticateTutorRequest('Bearer tok')).userId,'u');assert.equal(new Headers(calls[0].init.headers).get('Authorization'),'Bearer tok')});
 await test('usuario inválido, 401 y perfil desactivado',async()=>{auth={};await assert.rejects(authenticateTutorRequest('Bearer tok'),(e:any)=>e.status===401);auth={id:'u'};status=401;await assert.rejects(authenticateTutorRequest('Bearer tok'));status=400;await assert.rejects(authenticateTutorRequest('Bearer tok'),(e:any)=>e.status===401);status=200;profile.active=false;await assert.rejects(authenticateTutorRequest('Bearer tok'),(e:any)=>e.status===403);profile.active=true});
 await test('navegación válida e inválida',async()=>{assert.equal((await run('navigate',{view:'sae'}))[0].clientAction?.view,'sae');assert.equal((await run('navigate',{view:'javascript:1'}))[0].error,'VIEW_NOT_ALLOWED')});
 await test('administración requiere rol administrador',async()=>{assert.equal((await run('navigate',{view:'administracion'}))[0].error,'VIEW_NOT_AUTHORIZED');profile.role='admin';assert.equal((await run('navigate',{view:'administracion'}))[0].ok,true);profile.role='supervisor'});
 await test('filtros: planificador y endpoint conectados',async()=>{const r=await endpoint({question:'Aplica filtros; obra: A; periodo: P1',context:ctx});assert.deepEqual(r.data.clientActions,[{type:'apply_filters',obra:'A',periodo:'P1'}]);assert.equal(r.data.verified,false)});
 await test('filtros incompletos no inventados',async()=>{assert.equal(planTutorRequestLocal('Aplica filtros',ctx).toolCalls.length,0);assert.equal(planTutorRequestLocal('Aplica filtros; obra: A; obra: B',ctx).taskStatus,'diagnostic')});
 workers=Array.from({length:351},(_,i)=>({id:i+1,owner_id:'u',obra:'A',quincena:'P1',apellidos_nombre:i===350?'Pérez, Ana':'Luis',reconocimiento_estado:'Apto'}));
 await test('trabajador más allá de 250: paginación y consulta mínima',async()=>{const r=(await run('search_workers',{name:'Ana'}))[0];assert.equal((r.data as any[]).length,1);assert.equal(calls.length,2);const url=new URL(calls[0].url);assert.ok(!url.searchParams.get('select')!.split(',').includes('data'));assert.match(url.searchParams.get('and')!,/or\(obra.eq."A"/);assert.equal(url.searchParams.get('order'),'owner_id.asc,id.asc')});
 await test('legacy JSON proyectado sin campos privados',async()=>{workers=[{id:1,owner_id:'u',nombre_legacy:'Ana',obra_legacy:'A',periodo_legacy:'P1',estado_legacy:'Pendiente'}];const r=(await run('search_workers',{name:'Ana'}))[0];assert.equal((r.data as any[])[0].nombre,'Ana');assert.ok(!JSON.stringify(r.data).includes('owner_id'))});
 await test('resultados completos sin recorte a 80',async()=>{workers=Array.from({length:101},(_,i)=>({id:i+1,obra:'A',quincena:'P1',apellidos_nombre:'Ana'}));assert.equal(((await run('search_workers'))[0].data as any[]).length,101)});
 await test('lectura detecta paginación inconsistente',async()=>{workers=Array.from({length:200},()=>({id:1,obra:'A',quincena:'P1'}));assert.equal((await run('search_workers'))[0].ok,false)});
 await test('pendientes: apto vigente excluido, caducado incluido',async()=>{workers=[{id:1,obra:'A',quincena:'P1',reconocimiento_estado:'Apto',necesita_reconocimiento:'Sí',reconocimiento_validez:'2027-01-01'},{id:2,obra:'A',quincena:'P1',reconocimiento_estado:'Apto',reconocimiento_validez:'2025-01-01'},{id:3,obra:'A',quincena:'P1',reconocimiento_estado:'Pendiente'},{id:4,obra:'B',quincena:'P1',reconocimiento_estado:'Pendiente'}];assert.deepEqual(((await run('list_pending_medical'))[0].data as any[]).map(x=>x.id),[2,3]);calls=[];assert.equal((await executeTutorTools([{name:'list_pending_medical'}],{obra:'A'},'tok','r'))[0].error,'PERIODO_REQUIRED');assert.equal(calls.length,0)});
 await test('catálogo cerrado y errores no verificados',async()=>{assert.equal((await run('sql'))[0].error,'TOOL_NOT_ALLOWED');status=403;const r=(await run('search_workers'))[0];assert.equal(r.ok,false);assert.equal(r.verified,false);status=200});
 await test('incidencia incompleta ofrece formulario',async()=>{const r=await endpoint({question:'Registra una incidencia',context:ctx});assert.equal(r.data.incidentForm,true);assert.ok(!calls.some(x=>x.url.includes('save_prevention')))});
 await test('orden completa guarda y recupera por mismo ID',async()=>{const r=await endpoint({question:fullCommand,context:ctx,requestId:'incident-1'});assert.equal(r.data.toolResults[0].ok,true);assert.equal(r.data.verified,true);assert.match(r.data.answer,/recuperada/);assert.ok(calls.some(x=>x.url.includes('prevention_records?')))});
 const args=planTutorRequestLocal(fullCommand,ctx).toolCalls[0].arguments!;
 await test('incidencia: hipotéticos y negaciones no escriben',async()=>{for(const q of ['¿Cómo registra una incidencia?','No registra una incidencia','Nunca crea una incidencia']){assert.equal((await run('create_prevention_incident',args,q))[0].error,'EXPLICIT_MUTATION_REQUIRED');assert.ok(!planTutorRequestLocal(q,ctx).toolCalls.some(x=>x.name==='create_prevention_incident'))}assert.equal(calls.length,0)});
 await test('incidencia: fecha inexistente, categoría y obra inválidas',async()=>{for(const patch of [{workDate:'2026-02-30'},{category:'inventada'},{title:''}])assert.equal((await run('create_prevention_incident',{...args,...patch},'Registra una incidencia'))[0].error,'VALIDATION_ERROR');assert.equal((await run('create_prevention_incident',{...args,obra:'B'},'Registra una incidencia'))[0].error,'STALE_CONTEXT');assert.equal(calls.length,0)});
 await test('reintentos conservan ID, usuarios no comparten ID',async()=>{await run('create_prevention_incident',args,'Registra una incidencia','retry');const first=saved.id;await run('create_prevention_incident',args,'Registra una incidencia','retry');assert.equal(saved.id,first);await executeTutorTools([{name:'create_prevention_incident',arguments:args}],ctx,'tok','retry','Registra una incidencia','other');assert.notEqual(saved.id,first)});
 await test('respuesta RPC vacía y lectura ausente no completan',async()=>{invalidSave=true;assert.equal((await run('create_prevention_incident',args,'Registra una incidencia'))[0].ok,false);invalidSave=false;missingPersisted=true;assert.equal((await run('create_prevention_incident',args,'Registra una incidencia'))[0].verified,false);missingPersisted=false});
 let confirmation:any;
 await test('preparación de borrado solo lee',async()=>{confirmation=(await run('prepare_delete_mandatory_documents'))[0].confirmation;assert.equal(confirmation.recordsAffected,1);assert.ok(calls.every(x=>!x.init.method||x.init.method==='GET'))});
 const confirm=(userId='u',context=ctx,token=confirmation.token)=>executeTutorConfirmation({confirmationToken:token,context,token:'tok',userId});
 await test('borrado: usuario, obra, firma y caducidad',async()=>{assert.equal((await confirm('other')).error,'CONFIRMATION_USER_MISMATCH');assert.equal((await confirm('u',{...ctx,obra:'B'})).error,'STALE_CONTEXT');await assert.rejects(confirm('u',ctx,confirmation.token+'x'));await assert.rejects(confirm('u',ctx,confirmation.token+'.extra')); const now=Date.now;Date.now=()=>now()+700000;try{await assert.rejects(confirm())}finally{Date.now=now}assert.equal(calls.length,0)});
 await test('nuevo documento invalida el alcance completo',async()=>{docs.push({id:d2,obra:'A'});assert.equal((await confirm()).error,'CONFIRMATION_SCOPE_CHANGED');assert.ok(!calls.some(x=>x.url.includes('/rpc/')));docs=[{id:d1,obra:'A'}]});
 await test('documento perdido invalida alcance',async()=>{docs=[];assert.equal((await confirm()).error,'CONFIRMATION_SCOPE_CHANGED');docs=[{id:d1,obra:'A'}]});
 await test('borrado parcial no se certifica',async()=>{deleteCount=0;const r=await confirm();assert.equal(r.error,'PARTIAL_DELETE');assert.equal(r.verified,false);deleteCount=1});
 await test('borrado exacto confirmado',async()=>{assert.equal((await confirm()).ok,true);assert.deepEqual(calls.at(-1).body,{p_ids:[d1],p_obra:null})});
 await test('más de 500 documentos: alcance completo',async()=>{docs=Array.from({length:501},(_,i)=>({id:`${String(i).padStart(8,'0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,obra:'A'}));const r=(await run('prepare_delete_mandatory_documents'))[0];assert.equal(r.confirmation!.recordsAffected,501);assert.equal(calls.length,3)});
 await test('endpoint rechaza método, JSON, sesión y pregunta vacía',async()=>{assert.equal((await endpoint({},'', 'GET')).status,405);assert.equal((await endpoint('{')).status,400);assert.equal((await endpoint({question:'Abre SAE'},'')).status,401);assert.equal((await endpoint({question:''})).status,400);status=400;assert.equal((await endpoint({question:'Abre prevención'})).status,401);status=200});
 console.log(`${passed} regresiones del Tutor correctas. HTTP/DB simulados; handler real compartido local/Vercel.`);
}finally{globalThis.fetch=original}
