import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { build } from 'esbuild';
import { PGlite } from '@electric-sql/pglite';
const output = new URL('./.worker-annual-lookup.mjs', import.meta.url);
const db = new PGlite();
let calls = [], writes = [], bytes = 0, repeatPage = false;
await db.exec(`CREATE TABLE trabajadores(id integer PRIMARY KEY, owner_id text, dni text, periodo_inicio text, quincena text, fecha_registro text, data jsonb)`);
async function insert(id, owner, dni, start, fortnight, registered, data) {
  await db.query('INSERT INTO trabajadores VALUES ($1,$2,$3,$4,$5,$6,$7)', [id,owner,dni,start,fortnight,registered,JSON.stringify(data)]);
}
const normalize = value => String(value || '').replace(/[\s-]/g,'').trim().toUpperCase();
const year = row => Number(String(row.periodo_inicio || row.data?.periodoInicio || '').match(/^(\d{4})-/)?.[1] || String(row.quincena || row.data?.quincena || '').match(/(?:^|\s)(20\d{2})(?:$|\s)/)?.[1] || String(row.fecha_registro || row.data?.fechaRegistro || '').match(/^(\d{4})-/)?.[1] || new Date().getFullYear());
globalThis.__annualTransport = {
 getSessionUser: async () => ({id:'owner-a'}),
 supabase: { query: async (table, options) => {
  assert.equal(table,'trabajadores');
  if(options.method === 'POST') { writes.push(options.body); return []; }
  const q = new URLSearchParams(options.query); calls.push(q);
  assert.equal(q.get('owner_id'),'eq.owner-a'); assert.equal(q.get('order'),'id.asc');
  assert.equal(q.get('limit'),'500'); assert.equal(options.fresh,true);
  assert.equal(q.get('select'),'id,dni,periodo_inicio,quincena,fecha_registro,legacyDni:data->>dni,legacyStart:data->>periodoInicio,legacyFortnight:data->>quincena,legacyRegistered:data->>fechaRegistro');
  const params = ['owner-a']; let where = 'owner_id=$1';
  if(q.has('or')) {
   const match = q.get('or').match(/^\(dni\.ilike\.(\*[A-Z0-9*]+\*),data->>dni\.ilike\.\1\)$/);
   assert(match,'PostgREST OR contains only a safe broad DNI pattern');
   params.push(match[1].replaceAll('*','%')); where += " AND (dni ILIKE $2 OR data->>'dni' ILIKE $2)";
  }
  params.push(500, repeatPage ? 0 : Number(q.get('offset')));
  const rows = (await db.query(`SELECT id,dni,periodo_inicio,quincena,fecha_registro,data->>'dni' AS "legacyDni",data->>'periodoInicio' AS "legacyStart",data->>'quincena' AS "legacyFortnight",data->>'fechaRegistro' AS "legacyRegistered" FROM trabajadores WHERE ${where} ORDER BY id LIMIT $${params.length-1} OFFSET $${params.length}`,params)).rows;
  bytes += Buffer.byteLength(JSON.stringify(rows)); return rows;
 } },
};
try {
 await build({entryPoints:[new URL('../src/services/databaseService.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'esm',packages:'external',outfile:output.pathname,plugins:[{name:'transport',setup(b){
  b.onResolve({filter:/\/lib\/supabase$/},()=>({path:'transport',namespace:'mock'}));
  b.onResolve({filter:/medicalAppointmentAutoSync$/},()=>({path:'medical',namespace:'mock'}));
  b.onLoad({filter:/.*/,namespace:'mock'},({path})=>({contents:path==='medical'?'export const syncMedicalAppointmentFromWorker=async()=>{};':'export const {supabase,getSessionUser}=globalThis.__annualTransport;'}));
 }}]});
 const {createDocument} = await import(output.href);
 for(let i=1;i<=1201;i++) await insert(i,'owner-a',`OTHER${i}`,'2026-01-01','','',{document:'private fixture '.repeat(100)});
 await insert(2001,'owner-a','X1234567L','2026-01-01','','',{});
 await insert(2002,'owner-a',' x-123 4567-l ','','1ª quincena 2026','',{});
 await insert(2003,'owner-a','','','','',{dni:'X1234567L',fechaRegistro:'2026-03-01'});
 await insert(2004,'owner-a','X1234567L','2025-01-01','','',{});
 await insert(2005,'owner-b','X1234567L','2026-01-01','','',{});
 await insert(2006,'owner-a','X1234567LZZ','2026-01-01','','',{});
 const original = (await db.query("SELECT id,dni,periodo_inicio,quincena,fecha_registro,data FROM trabajadores WHERE owner_id='owner-a'")).rows;
 const expected = original.filter(r=>normalize(r.dni || r.data?.dni)==='X1234567L' && year(r)===2026).length+1;
 const oldBytes = Buffer.byteLength(JSON.stringify(original));
 await createDocument('trabajadores',3000,{dni:'X1234567L',periodoInicio:'2026-05-01'});
 assert.equal(writes.at(-1).data.numeroContratacionAnual,expected); assert.equal(expected,4);
 assert.equal(calls.length,1); assert(bytes < oldBytes/10); const filteredBytes = bytes;
 // Legacy punctuation cannot enter PostgREST syntax; count beyond the old 1000-row cap.
 await insert(2100,'owner-a','A.B(1)','2026-01-01','','',{});
 calls=[]; bytes=0;
 await createDocument('trabajadores',3001,{dni:'A.B(1)',periodoInicio:'2026-05-01'});
 assert.equal(writes.at(-1).data.numeroContratacionAnual,2);
 assert.equal(calls.length,3); assert(calls.every(q=>!q.has('or')));
 assert.deepEqual(calls.map(q=>q.get('offset')),['0','500','1000']);
 calls=[]; await createDocument('trabajadores',3002,{dni:'',periodoInicio:'2026-05-01'});
 assert.equal(calls.length,0); assert.equal(writes.at(-1).data.numeroContratacionAnual,1);
 repeatPage=true; const written=writes.length;
 await assert.rejects(()=>createDocument('trabajadores',3003,{dni:'A.B(1)',periodoInicio:'2026-05-01'}),/historial cambió/);
 assert.equal(writes.length,written,'unstable pagination must not write an incomplete count');
 console.log(`PASS real createDocument + PostgreSQL fixture: exact count, legacy DNI/year, owner isolation, >1000 rows, injection-safe fallback, repeated pages fail before write; same synthetic lookup ${original.length} full rows/${oldBytes} bytes -> 5 projected candidates/${filteredBytes} bytes, one GET.`);
} finally {
 await db.close(); await fs.unlink(output).catch(()=>{}); delete globalThis.__annualTransport;
}
