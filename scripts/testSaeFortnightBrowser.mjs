import assert from 'node:assert/strict';
import { applyBusinessConflictFix } from './saeBusinessConflictFixture.mjs';
import fs from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import { PGlite } from '@electric-sql/pglite';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const root = new URL('../',import.meta.url).pathname;
const tailwind=process.env.SIGNATURE_TAILWIND_SCRIPT?await fs.readFile(process.env.SIGNATURE_TAILWIND_SCRIPT,'utf8'):await(await fetch('https://cdn.tailwindcss.com',{signal:AbortSignal.timeout(30000)})).text();
const workerBytes=await fs.readFile(require.resolve('pdfjs-dist/build/pdf.worker.min.mjs'));
const html=await fs.readFile(root+'index.html','utf8');
const tailwindConfig=html.match(/<script>\s*(tailwind.config[\s\S]*?)<\/script>/)[1];
const appCss=await fs.readFile(root+'index.css','utf8');
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const owner=id(1),need=id(10),first=id(20),second=id(21),a=id(30),b=id(31);
const db=new PGlite();
const q=async(sql,args=[]) => (await db.query(sql,args,{parsers:{1184:value=>value}})).rows;
let server,browser,lastPage,failDecision=false,decisionCalls=0,staleFinalization=false,finalizationComplete=false;
let failMonthly=false,monthlyCalls=0;
const errors=[];
const engine=process.env.BROWSER_ENGINE==='webkit'?'webkit':'chromium';
try {
  await db.exec(`create role anon;create role authenticated;create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function sae_has_permission(action text) returns boolean language sql stable as $$select true$$;
    create table sae_needs(id uuid primary key,owner_id uuid,work_code text,work_name text,hiring_month smallint,hiring_year smallint,status text default 'en_contratacion',notes text,created_at timestamptz default now());
    create table sae_need_categories(id uuid,need_id uuid,category text,requested_count int,created_at timestamptz default now());
    create table sae_reports(id uuid primary key,need_id uuid,owner_id uuid,updated_by uuid,file_name text,storage_path text,raw_text text,extraction_method text,processing_status text default 'review',detected_legend jsonb default '{}',created_at timestamptz default now());
    create table sae_candidates(id uuid primary key,need_id uuid,source_report_id uuid,owner_id uuid,
      original_full_name text,normalized_full_name text,first_name text,surnames text,dni_nie text,category text,offer_number text,work_code text,work_name text,
      hiring_month smallint,fortnight smallint,status text default 'sin_asignar',result_code text,result_label text,selected_for_hire boolean default false,
      existing_worker_id bigint,existing_worker_owner_id uuid,source_page int default 1,source_row_text text,source_position jsonb default '{}',alignment_offset_x numeric default 0,alignment_offset_y numeric default 0,confidence text default 'alta',
      created_by uuid,updated_by uuid,created_at timestamptz default clock_timestamp(),updated_at timestamptz default clock_timestamp());
    create table sae_generated_documents(id uuid,source_report_id uuid);
    create table trabajadores(id bigint primary key,owner_id uuid,periodo_inicio text,periodo_fin text,data jsonb,apellidos_nombre text,obra text,categoria text);
    create table user_settings(user_id uuid primary key,settings jsonb);
    create function touch_candidate() returns trigger language plpgsql as $$begin new.updated_at=clock_timestamp();return new;end$$;
    create trigger touch_candidate before update on sae_candidates for each row execute function touch_candidate();`);
  const migration=(await fs.readdir(root+'supabase/migrations')).find(n=>n.endsWith('_sae_fortnight_codes.sql'));
  await db.exec(await fs.readFile(root+'supabase/migrations/'+migration,'utf8'));
  await db.exec(await fs.readFile(root+'supabase/migrations/20261023195934_sae_code_selection_trigger.sql','utf8'));
  await db.exec(await fs.readFile(root+'supabase/migrations/20261023210429_sae_reopened_draft_codes.sql','utf8'));
  await db.exec(await fs.readFile(root+'supabase/migrations/20261023214422_sae_monthly_work_matches.sql','utf8'));
  await db.exec(await fs.readFile(root+'supabase/migrations/20261024201410_sae_report_manual_period.sql','utf8'));
  await applyBusinessConflictFix(db);
  await q("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  await db.exec(await fs.readFile(root+'supabase/migrations/20261024201222_sae_reverse_fortnight_suggestions.sql','utf8'));
  const reset=async()=>{
    await db.exec('truncate sae_candidates,sae_needs,sae_reports,sae_need_categories,sae_private.code_state,sae_private.code_audit,trabajadores,user_settings cascade');
    await q("insert into sae_needs(id,owner_id,work_code,work_name,hiring_month,hiring_year) values($1,$2,'11002 GR','Obra A',10,2026)",[need,owner]);
    for(const [r,name] of [[first,'Primera quincena.pdf'],[second,'Segunda quincena.pdf']]) await q("insert into sae_reports(id,need_id,owner_id,file_name,storage_path,detected_legend) values($1,$2,$3,$4,$4,$5)",[r,need,owner,name,{'2001':'Contratará al candidato','2100':'Rechazo voluntario','2212':'Otros motivos','2500':'Ya estaba ocupado el puesto de trabajo','2200':'No cumple los requisitos','2210':'No corresponde al perfil por otros motivos'}]);
    for(const [c,r,f,name] of [[a,first,1,'Juan Hinojo García'],[b,second,2,'JUAN HINOJO GARCIA']]) await q("insert into sae_candidates(id,need_id,source_report_id,owner_id,original_full_name,normalized_full_name,work_code,work_name,hiring_month,fortnight,source_position) values($1,$2,$3,$4,$5,$5,'11002 GR','Obra A',10,$6,'{\"orderNumber\":1}')",[c,need,r,owner,name,f]);
  };
  const originalPdf=await PDFDocument.create();originalPdf.addPage([595,842]);const originalBytes=await originalPdf.save();
  const pdfModule=(await build({stdin:{contents:"export * from 'pdf-lib';",resolveDir:root},bundle:true,platform:'browser',format:'esm',write:false})).outputFiles[0].text;
  const bundle=(await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{SaeSection}from'./components/SaeSection';createRoot(document.getElementById('root')).render(<SaeSection people={[]} onToast={(text,type)=>{document.getElementById('toast').textContent=text;document.getElementById('toast').dataset.type=type;}}/>);`,resolveDir:root,loader:'tsx'},bundle:true,platform:'browser',format:'iife',write:false,define:{'import.meta.env':'{}'},plugins:[{name:'test-boundaries',setup(build){
    build.onResolve({filter:/pdf\.worker.*\?url$/},()=>({path:'worker',namespace:'worker-url'}));
    build.onLoad({filter:/.*/,namespace:'worker-url'},()=>({contents:"export default '/pdf.worker.mjs'"}));
    build.onResolve({filter:/\/lib\/supabase$|AuthGate$|appSettingsService$|annualHiringPeriodsService$|databaseService$|saeDocumentParser$/},args=>({path:args.path,namespace:'boundary'}));
    build.onLoad({filter:/.*/,namespace:'boundary'},({path})=>({contents:
      path.endsWith('supabase')?`window.__saePending=0;const invoke=async body=>{window.__saePending++;try{const r=await fetch('/db',{method:'POST',body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(data.message);return data;}finally{window.__saePending--;}};export const getSessionUser=async()=>({id:'${owner}'});export const supabase={url:location.origin,key:'synthetic-public',query:(table,options)=>invoke({table,options}),rpc:(name,body)=>invoke({name,body}),auth:{getSession:async()=>({data:{session:{access_token:'synthetic'}}})}};`:
      path.endsWith('AuthGate')?"export const useAuthShell=()=>({supervisorName:'Supervisor de prueba'});":
      path.endsWith('appSettingsService')?"export const loadAppBusinessSettings=async()=>({savedObras:['11002 GR']});":
      path.endsWith('annualHiringPeriodsService')?"export const listAnnualHiringPeriods=async()=>[{year:2026,months:[{month:10,period1Start:'2026-10-01',period1End:'2026-10-15',period2Start:'2026-10-16',period2End:'2026-10-31'}]}];":
      path.endsWith('databaseService')?"const request=async body=>{const r=await fetch('/worker',{method:'POST',body:JSON.stringify(body)});if(!r.ok)throw Error('Error de trabajador');};export const createDocument=(table,id,data)=>request({id,data});export const deleteDocument=(table,id)=>request({id,remove:true});":
      "export const parseSaeNeedFile=async()=>{throw Error('Parsing is outside this test')};export const parseSaeReportFile=parseSaeNeedFile;export const fileToDataUrl=parseSaeNeedFile;export const titleCaseSpanish=value=>value;"
    }));
  }}]})).outputFiles[0].text;
  server=http.createServer(async(req,res)=>{
    try {
      if(req.url==='/pdf.worker.mjs'){res.setHeader('Content-Type','text/javascript');return res.end(workerBytes);}
      if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');return res.end(bundle);}
      if(req.url==='/tailwind.js'){res.setHeader('Content-Type','text/javascript');return res.end(tailwind);}
      if(req.url.startsWith('/storage/v1/object/authenticated/sae-documents/')){res.setHeader('Content-Type','application/pdf');return res.end(Buffer.from(originalBytes));}
      if(req.url==='/db'||req.url==='/worker'){
        const chunks=[];for await(const chunk of req)chunks.push(chunk);const data=JSON.parse(Buffer.concat(chunks).toString());res.setHeader('Content-Type','application/json');
        if(req.url==='/worker'){
          if(data.remove)await q('delete from trabajadores where id=$1',[data.id]);else await q('insert into trabajadores(id,owner_id,periodo_inicio,periodo_fin,data) values($1,$2,$3,$4,$5)',[data.id,owner,data.data.periodoInicio,data.data.periodoFin,data.data]);
          return res.end('null');
        }
        if(data.name){
          if(data.name==='sae_set_report_period') {
            const p=data.body;
            await q('select sae_set_report_period($1,$2,$3)',[p.p_report_id,p.p_period,p.p_expected_revision]);
            return res.end('null');
          }

          if(data.name==='list_sae_monthly_matches'){return res.end(JSON.stringify((await q('select list_sae_monthly_matches($1) result',[data.body.p_need_id]))[0].result));}
          if(data.name==='sae_apply_monthly_2500'){
            monthlyCalls++;if(failMonthly){res.statusCode=503;return res.end(JSON.stringify({message:'Sin conexión mensual de prueba. Se conserva el código.'}));}
            try{await q('select sae_apply_monthly_2500($1,$2)',[data.body.p_candidate_id,data.body.p_signature]);return res.end('null');}
            catch(error){res.statusCode=409;return res.end(JSON.stringify({message:error.message}));}
          }
          if(data.name==='sae_reopen_report'){await q('select sae_reopen_report($1)',[data.body.p_report_id]);return res.end('null');}
          if(data.name==='sae_finalize_report_version'){
            if(staleFinalization){staleFinalization=false;await q("update sae_candidates set result_code='2210' where id=$1",[b]);}
            try {
              const version=(await q('select sae_finalize_report_version($1,$2) version',[data.body.p_report_id,data.body.p_snapshot]))[0].version;
              finalizationComplete=true;return res.end(JSON.stringify(version));
            } catch(error) {res.statusCode=409;return res.end(JSON.stringify({message:error.message}));}
          }
          assert.equal(data.name,'sae_sync_fortnight_codes');
          if(data.body.p_candidate_id){decisionCalls++;if(failDecision){res.statusCode=503;return res.end(JSON.stringify({message:'Sin conexión de prueba. El código actual se conserva.'}));}}
          const p=data.body;const rows=await q('select sae_sync_fortnight_codes($1,$2,$3,$4) result',[p.p_need_id,p.p_candidate_id||null,p.p_signature||null,p.p_apply??null]);
          return res.end(JSON.stringify(rows[0].result));
        }
        assert(['sae_needs','sae_reports','sae_candidates','sae_need_categories'].includes(data.table));
        const options=data.options||{},params=new URLSearchParams(options.query),args=[];
        const where=[...params].filter(([k,v])=>v.startsWith('eq.')).map(([k,v])=>{assert.match(k,/^[a-z_]+$/);args.push(v.slice(3));return `${k}=$${args.length}`;}).join(' and ')||'true';
        let rows;
        if(options.method==='PATCH'){
          const assignments=Object.entries(options.body).map(([key,value])=>{assert.match(key,/^[a-z_]+$/);args.push(value);return `${key}=$${args.length}`;});
          rows=await q(`update ${data.table} set ${assignments.join(',')} where ${where} returning *`,args);
        }else{
          const select=params.get('select')||'*';assert.match(select,/^(\*|[a-z_,]+)$/);
          const order=params.get('order')?.split('.');
          rows=await q(`select ${select} from ${data.table} where ${where}${order?` order by ${order[0]} ${order[1]==='desc'?'desc':'asc'}`:''}`,args);
        }
        return res.end(JSON.stringify(rows));
      }
      res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><script>${tailwindConfig}</script><style>${appCss}body{margin:0;font:16px Arial}#root{max-width:1300px;margin:auto;padding:12px}</style><body><div id="toast" role="status"></div><div id="root"></div><script src="/app.js"></script></body></html>`);
    }catch(error){errors.push(error.message);res.statusCode=500;res.end(JSON.stringify({message:error.message}));}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
  browser=await(engine==='webkit'?webkit:chromium).launch({headless:true,...(process.env.SAE_BROWSER_EXECUTABLE ? {executablePath:process.env.SAE_BROWSER_EXECUTABLE} : {})});
  for(const width of [390,820,1440]) {
    await reset();
    const context=await browser.newContext({viewport:{width,height:900}});
    await context.route('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm',route=>route.fulfill({status:200,contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},body:pdfModule}));
    await context.addInitScript(({need,first})=>{if(!sessionStorage.getItem('profea-sae-selected-need')){sessionStorage.setItem('profea-sae-selected-need',need);sessionStorage.setItem('profea-sae-selected-report',first);}},{need,first});
    const page=await context.newPage();lastPage=page;page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));await page.goto(url);
    const result=()=>page.locator('select').filter({has:page.locator('option[value="2001"]')});
    // Correct an unrecognized report, then check real SQL persistence after reload.
    await result().waitFor();
    await q('update sae_candidates set fortnight=null where id=$1',[a]);
    await page.waitForFunction(()=>window.__saePending===0);await page.reload();await page.waitForFunction(()=>window.__saePending===0);
    const firstCard=()=>page.getByRole('button',{name:/Primera quincena.pdf/}).first().locator('..');
    await firstCard().getByRole('button',{name:'Añadir periodo',exact:true}).click();
    let dialog=page.getByRole('dialog',{name:'Periodo del informe'});
    await dialog.getByLabel('Periodo',{exact:true}).selectOption('1ª Quincena');
    await dialog.getByRole('button',{name:'Guardar periodo',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
    assert.equal((await q('select fortnight from sae_candidates where id=$1',[a]))[0].fortnight,1);
    await page.waitForFunction(()=>window.__saePending===0);await page.reload();await page.waitForFunction(()=>window.__saePending===0);await firstCard().getByRole('button',{name:'Editar periodo',exact:true}).click();
    dialog=page.getByRole('dialog',{name:'Periodo del informe'});
    assert.equal(await dialog.getByLabel('Periodo',{exact:true}).inputValue(),'1ª Quincena');
    await dialog.getByLabel('Periodo',{exact:true}).selectOption('2ª Quincena');
    await dialog.getByRole('button',{name:'Guardar periodo',exact:true}).click();await dialog.waitFor({state:'hidden'});
    assert.equal((await q('select fortnight from sae_candidates where id=$1',[a]))[0].fortnight,2);
    await firstCard().getByRole('button',{name:'Editar periodo',exact:true}).click();
    dialog=page.getByRole('dialog',{name:'Periodo del informe'});
    await dialog.getByLabel('Periodo',{exact:true}).selectOption('Mensual');
    await dialog.getByRole('button',{name:'Guardar periodo',exact:true}).click();await dialog.waitFor({state:'hidden'});
    await page.waitForFunction(()=>window.__saePending===0);await page.reload();await page.waitForFunction(()=>window.__saePending===0);await firstCard().getByRole('button',{name:'Editar periodo',exact:true}).click();
    dialog=page.getByRole('dialog',{name:'Periodo del informe'});
    assert.equal(await dialog.getByLabel('Periodo',{exact:true}).inputValue(),'Mensual');
    const periodBounds=await dialog.boundingBox();assert.ok(periodBounds.x>=0&&periodBounds.x+periodBounds.width<=width+1,'period editor fits mobile/tablet');
    await dialog.getByLabel('Periodo',{exact:true}).selectOption('1ª Quincena');
    await dialog.getByRole('button',{name:'Cancelar',exact:true}).click();
    assert.equal((await q("select detected_legend->'__manual_period'->>'label' label from sae_reports where id=$1",[first]))[0].label,'Mensual');
    await reset();await page.waitForFunction(()=>window.__saePending===0);await page.reload();await page.waitForFunction(()=>window.__saePending===0);await result().waitFor();await result().selectOption('2001');
    await page.waitForFunction(()=>!document.querySelector('select:disabled option[value="2001"]'));
    await page.getByRole('button',{name:/Segunda quincena.pdf/}).first().click();
    await page.getByText(/Código 2500 asignado a partir/).waitFor();
    assert.equal(await result().inputValue(),'2500','code selection alone updates the second fortnight');
    assert.equal((await q('select count(*)::int n from trabajadores'))[0].n,0,'no worker is created');
    assert.equal((await q('select existing_worker_id from sae_candidates where id=$1',[a]))[0].existing_worker_id,null);
    await page.waitForFunction(()=>window.__saePending===0);await page.reload();await page.waitForFunction(()=>window.__saePending===0);await page.getByText(/Código 2500 asignado a partir/).waitFor();
    await page.getByRole('button',{name:/Primera quincena.pdf/}).first().click();
    await page.getByRole('button',{name:'Registrar trabajador',exact:true}).click();
    await page.getByText('Contratado · 2001',{exact:true}).waitFor();
    assert.equal((await q('select result_code from sae_candidates where id=$1',[b]))[0].result_code,'2500');
    assert.equal((await q('select count(*)::int n from trabajadores'))[0].n,1);
    await page.getByRole('button',{name:/Segunda quincena.pdf/}).first().click();
    await page.getByText(/Código 2500 asignado a partir/).waitFor();assert.equal(await result().inputValue(),'2500');
    await page.waitForFunction(()=>window.__saePending===0);await page.reload();await page.waitForFunction(()=>window.__saePending===0);await page.getByText(/Código 2500 asignado a partir/).waitFor();assert.equal(await result().inputValue(),'2500');
    await result().selectOption('2200');await page.getByRole('button',{name:'Mantener código actual',exact:true}).waitFor();
    await page.getByRole('button',{name:'Mantener código actual',exact:true}).click();
    await page.getByRole('button',{name:'Aplicar nuevo código',exact:true}).waitFor({state:'hidden'});
    await page.waitForFunction(()=>window.__saePending===0);await page.reload();await page.waitForFunction(()=>window.__saePending===0);await result().waitFor();assert.equal(await result().inputValue(),'2200');assert.equal(await page.getByRole('button',{name:'Aplicar nuevo código',exact:true}).count(),0);
    // A source correction arrives while this view is open; focus refreshes it.
    await q("update sae_candidates set result_code='2100' where id=$1",[a]);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    const apply=page.getByRole('button',{name:'Aplicar nuevo código',exact:true});await apply.waitFor();
    await apply.scrollIntoViewIfNeeded();
    assert(await apply.isVisible());
    const bounds=await apply.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=width+1,'replacement button fits the viewport');
    if(process.env.SAE_SCREENSHOT_DIR)await page.screenshot({path:`${process.env.SAE_SCREENSHOT_DIR}/sae-${engine}-${width}.png`,fullPage:true});
    await apply.focus();await page.keyboard.press('Enter');assert.equal(await result().inputValue(),'2200','Enter does not confirm replacement');
    failDecision=true;await apply.click();await page.getByText(/Sin conexión de prueba/).waitFor();assert.equal(await result().inputValue(),'2200');failDecision=false;
    const before=decisionCalls;await apply.evaluate(el=>{el.click();el.click();});
    await page.getByText(/Código 2212 · Otros motivos asignado a partir/).waitFor();assert.equal(await result().inputValue(),'2212');assert.equal(decisionCalls,before+1);
    await page.waitForFunction(()=>window.__saePending===0);await page.reload();await page.waitForFunction(()=>window.__saePending===0);await page.getByText(/Código 2212 · Otros motivos asignado a partir/).waitFor();
    await result().selectOption('2200');await page.getByRole('button',{name:'Mantener código actual',exact:true}).waitFor();
    await page.getByRole('button',{name:'Aplicar nuevo código',exact:true}).focus();await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'Aplicar nuevo código',exact:true}).waitFor({state:'hidden'});
    await page.waitForFunction(()=>window.__saePending===0);await page.reload();await page.waitForFunction(()=>window.__saePending===0);await result().waitFor();assert.equal(await result().inputValue(),'2200');assert.equal(await apply.count(),0,'Escape conserves the manual code and records the decision');
    let downloads=0;page.on('download',()=>{downloads++;assert(finalizationComplete,'download follows server confirmation');});
    const finalize=()=>page.getByRole('button',{name:'Finalizar y descargar',exact:true}).nth(1);
    staleFinalization=true;finalizationComplete=false;await finalize().click();
    await page.locator('#toast').filter({hasText:/han cambiado/}).waitFor();assert.equal(downloads,0,'stale PDF is not downloaded');
    await page.waitForFunction(()=>window.__saePending===0);await page.reload();await page.waitForFunction(()=>window.__saePending===0);await page.getByRole('button',{name:'Mantener código actual',exact:true}).waitFor();
    await page.getByRole('button',{name:'Mantener código actual',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('[role="alert"]'));
    const downloadPromise=page.waitForEvent('download');await finalize().click();const download=await downloadPromise;
    const stream=await download.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);
    const savedBytes=new Uint8Array(Buffer.concat(chunks));assert(savedBytes.length>originalBytes.length);
    const pdfTask=getDocument({data:savedBytes,useSystemFonts:true});const savedPdf=await pdfTask.promise;
    const text=(await (await savedPdf.getPage(1)).getTextContent()).items.map(item=>item.str).join(' ');await pdfTask.destroy();
    assert(text.includes('2210'),'downloaded PDF contains the confirmed code');
    await q("update sae_candidates set result_code='2001' where id=$1",[a]);
    assert.equal((await q('select result_code from sae_candidates where id=$1',[b]))[0].result_code,'2210','official result is immutable under automation');
    await page.waitForFunction(()=>window.__saePending===0);await page.reload();await page.waitForFunction(()=>window.__saePending===0);await page.getByRole('button',{name:'Reabrir para modificar',exact:true}).click();
    await page.getByRole('button',{name:'Aplicar nuevo código',exact:true}).waitFor();
    assert.equal(await result().inputValue(),'2210','reopening preserves a manual result until accepted');
    await page.getByRole('button',{name:'Aplicar nuevo código',exact:true}).click();
    await page.getByText(/Código 2500 asignado a partir/).waitFor();
    assert.equal(await result().inputValue(),'2500','reopened draft accepts the new automatic result');
    await page.waitForFunction(()=>window.__saePending===0);await page.reload();await page.waitForFunction(()=>window.__saePending===0);await page.getByText(/Código 2500 asignado a partir/).waitFor();
    const archivedDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Versión 1',exact:true}).click();
    const archivedFile=await archivedDownload,archivedStream=await archivedFile.createReadStream(),archivedChunks=[];
    for await(const chunk of archivedStream)archivedChunks.push(chunk);
    const archivedTask=getDocument({data:new Uint8Array(Buffer.concat(archivedChunks)),useSystemFonts:true});
    const archivedPdf=await archivedTask.promise;
    const archivedText=(await(await archivedPdf.getPage(1)).getTextContent()).items.map(item=>item.str).join(' ');await archivedTask.destroy();
    assert(archivedText.includes('2210'),'archived PDF retains its original code after the draft changes to 2500');
    await page.getByRole('button',{name:'Consultar / ajustar',exact:true}).last().click();
    const dx=page.getByLabel('Desplazamiento X'),dy=page.getByLabel('Desplazamiento Y');
    await dx.fill('-6.5');await dy.fill('-2');
    await page.getByText('Posición guardada y verificada',{exact:true}).waitFor();
    assert.equal(Number((await q('select alignment_offset_x from sae_candidates where id=$1',[b]))[0].alignment_offset_x),-6.5);
    await page.waitForFunction(()=>document.querySelector('canvas[aria-label="Vista previa documento SAE"]')?.width>300);
    const closePreview=page.getByRole('button',{name:'Cerrar',exact:true});
    const box=await closePreview.boundingBox();assert(box.x>=0 && box.x+box.width<=width+1,'preview controls fit screen');
    await closePreview.click();await page.waitForFunction(()=>window.__saePending===0);await page.reload();await page.waitForFunction(()=>window.__saePending===0);
    await page.getByRole('button',{name:'Consultar / ajustar',exact:true}).last().click();
    await dx.waitFor();assert.equal(await dx.inputValue(),'-6.5');assert.equal(await dy.inputValue(),'-2');
    await closePreview.click();
    await reset();await q("update sae_candidates set category='Peón',result_code=null where id=$1",[a]);
    await q("update sae_candidates set category='Peón',result_code='2001' where id=$1",[b]);
    await page.waitForFunction(()=>window.__saePending===0);await page.reload();await page.waitForFunction(()=>window.__saePending===0);await page.getByRole('button',{name:/Primera quincena.pdf/}).first().click();
    await page.getByText(/resultado SAE de la segunda quincena/).waitFor();
    const reverseApply=page.getByRole('button',{name:'Aplicar nuevo código',exact:true});
    await reverseApply.focus();await page.keyboard.press('Enter');assert.equal(await result().inputValue(),'');
    await reverseApply.click();await reverseApply.waitFor({state:'hidden'});assert.equal(await result().inputValue(),'2500');
    assert.equal((await q('select result_code from sae_candidates where id=$1',[b]))[0].result_code,'2001');
    await page.waitForFunction(()=>window.__saePending===0);await page.reload();await page.waitForFunction(()=>window.__saePending===0);await result().waitFor();assert.equal(await result().inputValue(),'2500');
    // Monthly qualified workforce: another work/category, using names only.
    await reset();const monthlyNeed=id(11),monthlyReport=id(22);
    await q("insert into sae_needs(id,owner_id,work_code,work_name,hiring_month,hiring_year) values($1,$2,'11003 GR','Obra de destino',10,2026)",[monthlyNeed,owner]);
    await q("insert into sae_reports(id,need_id,owner_id,file_name,storage_path,detected_legend) values($1,$2,$3,'Mensual destino.pdf','mensual-destino.pdf',$4)",[monthlyReport,monthlyNeed,owner,{'2001':'Contratará al candidato','2500':'Ya estaba ocupado el puesto de trabajo','2200':'No cumple los requisitos','2212':'Otros motivos'}]);
    await q("update sae_candidates set category='Oficial de albañilería',fortnight=null,result_code='2001',dni_nie='11111111A' where id=$1",[a]);
    await q("update sae_candidates set need_id=$2,source_report_id=$3,work_code='11003 GR',work_name='Obra de destino',category='Encofrador',source_position='{\"orderNumber\":2}',fortnight=null,result_code='2200',dni_nie='22222222B' where id=$1",[b,monthlyNeed,monthlyReport]);
    await q("update sae_private.code_state set issue='Incidencia antigua de quincena' where candidate_id=$1",[b]);
    await q('insert into user_settings values($1,$2)',[owner,{annualHiringPeriods:[{year:2026,months:[{month:10,period1Start:'2026-10-01',period1End:'2026-10-15',period2Start:'2026-10-16',period2End:'2026-10-31'}]}]}]);
    const openMonthly=async()=>{await page.evaluate(({need,report})=>{sessionStorage.setItem('profea-sae-selected-need',need);sessionStorage.setItem('profea-sae-selected-report',report);},{need:monthlyNeed,report:monthlyReport});await page.waitForFunction(()=>window.__saePending===0);await page.reload();await page.waitForFunction(()=>window.__saePending===0);await page.getByText(/Coincidencia por apellidos y nombre/).waitFor();};
    await openMonthly();await page.getByText('Previsto para contratar · 2001',{exact:true}).waitFor();
    assert.equal(await page.getByText('Incidencia antigua de quincena',{exact:true}).count(),0,'a monthly row does not show stale fortnight notices');
    assert.equal(await result().inputValue(),'2200','monthly warning preserves a manual result');
    await page.getByRole('button',{name:'Consultar contratación de origen',exact:true}).click();
    await page.getByRole('heading',{name:/Trabajadores del informe · Primera quincena.pdf/}).waitFor();
    assert.equal(await result().inputValue(),'2001','consult opens the source report');await openMonthly();
    const monthlyApply=()=>page.getByRole('button',{name:'Aplicar 2500 por coincidencia mensual',exact:true});
    await monthlyApply().scrollIntoViewIfNeeded();const monthlyBounds=await monthlyApply().boundingBox();
    assert(monthlyBounds.x>=0&&monthlyBounds.x+monthlyBounds.width<=width+1,'monthly action fits the viewport');
    await monthlyApply().focus();await page.keyboard.press('Enter');assert.equal(await result().inputValue(),'2200','Enter cannot apply the monthly code');
    await q("update sae_candidates set result_code=null where id=$1",[a]);await monthlyApply().click();
    await page.getByText(/coincidencia mensual ha cambiado/).waitFor();assert.equal(await result().inputValue(),'2200');
    await q("update sae_candidates set result_code='2001' where id=$1",[a]);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await page.getByText(/coincidencia mensual ha cambiado/).waitFor({state:'hidden'});
    failMonthly=true;await monthlyApply().click();await page.getByText(/Sin conexión mensual de prueba/).waitFor();assert.equal(await result().inputValue(),'2200');failMonthly=false;
    const monthlyBefore=monthlyCalls;await monthlyApply().evaluate(el=>{el.click();el.click();});
    await page.getByText('Resultado 2500 guardado.',{exact:true}).waitFor();assert.equal(monthlyCalls,monthlyBefore+1);
    await page.waitForFunction(()=>window.__saePending===0);await page.reload();await page.waitForFunction(()=>window.__saePending===0);await page.getByText('Resultado 2500 guardado.',{exact:true}).waitFor();assert.equal(await result().inputValue(),'2500');
    await q("insert into trabajadores(id,owner_id,periodo_inicio,periodo_fin,data) values(55501,$1,'2026-10-01','2026-10-31','{}')",[owner]);
    await q("update sae_candidates set status='contratado',existing_worker_id=55501,existing_worker_owner_id=$2 where id=$1",[a,owner]);
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.getByText('Contratación registrada',{exact:true}).waitFor();
    await q("update trabajadores set periodo_inicio='2026-11-01',periodo_fin='2026-11-30' where id=55501");
    await q("update sae_candidates set result_code='2200' where id=$1",[b]);
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.getByText(/las fechas no se solapan/).waitFor();assert.equal(await monthlyApply().count(),0);
    await q(`insert into sae_candidates(id,need_id,source_report_id,owner_id,original_full_name,normalized_full_name,work_code,work_name,hiring_month,category,result_code)
      values($1,$2,$3,$4,'Juan Hinojo Garcia','JUAN HINOJO GARCIA','11002 GR','Obra A',10,'Carpintero','2001')`,[id(32),need,first,owner]);
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.getByText(/varias entradas con el mismo nombre/).waitFor();assert.equal(await monthlyApply().count(),0);
    await q('delete from sae_candidates where id in($1,$2)',[a,id(32)]);
    await q("update trabajadores set apellidos_nombre='JUAN HINOJO GARCÍA',obra='11002 GR',categoria='Carpintero',periodo_inicio='2026-10-01',periodo_fin='2026-10-31' where id=55501");
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await monthlyApply().waitFor();
    await page.getByText('Consultar ficha de origen',{exact:true}).click();await page.getByText(/Directorio de trabajadores · JUAN HINOJO/).waitFor();
    await monthlyApply().click();await page.getByText('Resultado 2500 guardado.',{exact:true}).waitFor();
    await q("update sae_candidates set source_position='{\"orderNumber\":1}',result_code='2200' where id=$1",[b]);
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    const firstPosition=page.getByRole('button',{name:'Aplicar 2212 · Otros motivos por coincidencia mensual',exact:true});
    await firstPosition.waitFor();await firstPosition.focus();await page.keyboard.press('Enter');assert.equal(await result().inputValue(),'2200');
    await firstPosition.click();await page.getByText('Resultado 2212 guardado.',{exact:true}).waitFor();
    await page.waitForFunction(()=>window.__saePending===0);await page.reload();await page.waitForFunction(()=>window.__saePending===0);await page.getByText('Resultado 2212 guardado.',{exact:true}).waitFor();assert.equal(await result().inputValue(),'2212');
    await page.waitForFunction(()=>window.__saePending===0);await context.close();
  }
  assert.deepEqual(errors,[]);
  console.log(`PASS SAE ${engine} 390/820/1440: fortnight rules, register, reopen/archive PDF, manual decisions and monthly name-only matching across works/categories, source consultation, planned/registered/Directory origins, stale/retry/double-click/Enter guards, non-overlap, ambiguity and persistence.`);
}catch(error){console.error(error.message,errors);if(lastPage)console.error((await lastPage.locator('body').innerText().catch(()=>'' )).slice(-5000));process.exitCode=1;}
finally {if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));await db.close();}

