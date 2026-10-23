import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import { PGlite } from '@electric-sql/pglite';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const root = new URL('../',import.meta.url).pathname;
const tailwind=process.env.SIGNATURE_TAILWIND_SCRIPT?await fs.readFile(process.env.SIGNATURE_TAILWIND_SCRIPT,'utf8'):await(await fetch('https://cdn.tailwindcss.com',{signal:AbortSignal.timeout(30000)})).text();
const html=await fs.readFile(root+'index.html','utf8');
const tailwindConfig=html.match(/<script>\s*(tailwind.config[\s\S]*?)<\/script>/)[1];
const appCss=await fs.readFile(root+'index.css','utf8');
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const owner=id(1),need=id(10),first=id(20),second=id(21),a=id(30),b=id(31);
const db=new PGlite();
const q=async(sql,args=[]) => (await db.query(sql,args,{parsers:{1184:value=>value}})).rows;
let server,browser,lastPage,failDecision=false,decisionCalls=0,staleFinalization=false,finalizationComplete=false;
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
    create table trabajadores(id bigint primary key,data jsonb);
    create function touch_candidate() returns trigger language plpgsql as $$begin new.updated_at=clock_timestamp();return new;end$$;
    create trigger touch_candidate before update on sae_candidates for each row execute function touch_candidate();`);
  const migration=(await fs.readdir(root+'supabase/migrations')).find(n=>n.endsWith('_sae_fortnight_codes.sql'));
  await db.exec(await fs.readFile(root+'supabase/migrations/'+migration,'utf8'));
  await db.exec(await fs.readFile(root+'supabase/migrations/20261023195934_sae_code_selection_trigger.sql','utf8'));
  await q("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  const reset=async()=>{
    await db.exec('truncate sae_candidates,sae_needs,sae_reports,sae_need_categories,sae_private.code_state,sae_private.code_audit,trabajadores cascade');
    await q("insert into sae_needs(id,owner_id,work_code,work_name,hiring_month,hiring_year) values($1,$2,'11002 GR','Obra A',10,2026)",[need,owner]);
    for(const [r,name] of [[first,'Primera quincena.pdf'],[second,'Segunda quincena.pdf']]) await q("insert into sae_reports(id,need_id,owner_id,file_name,storage_path,detected_legend) values($1,$2,$3,$4,$4,$5)",[r,need,owner,name,{'2001':'Contratará al candidato','2100':'Rechazo voluntario','2212':'Otros motivos','2500':'Ya estaba ocupado el puesto de trabajo','2200':'No cumple los requisitos','2210':'No corresponde al perfil por otros motivos'}]);
    for(const [c,r,f,name] of [[a,first,1,'Juan Hinojo García'],[b,second,2,'JUAN HINOJO GARCIA']]) await q("insert into sae_candidates(id,need_id,source_report_id,owner_id,original_full_name,normalized_full_name,work_code,work_name,hiring_month,fortnight,source_position) values($1,$2,$3,$4,$5,$5,'11002 GR','Obra A',10,$6,'{\"orderNumber\":1}')",[c,need,r,owner,name,f]);
  };
  const originalPdf=await PDFDocument.create();originalPdf.addPage([595,842]);const originalBytes=await originalPdf.save();
  const pdfModule=(await build({stdin:{contents:"export * from 'pdf-lib';",resolveDir:root},bundle:true,platform:'browser',format:'esm',write:false})).outputFiles[0].text;
  const bundle=(await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{SaeSection}from'./components/SaeSection';createRoot(document.getElementById('root')).render(<SaeSection people={[]} onToast={(text,type)=>{document.getElementById('toast').textContent=text;document.getElementById('toast').dataset.type=type;}}/>);`,resolveDir:root,loader:'tsx'},bundle:true,platform:'browser',format:'iife',write:false,define:{'import.meta.env':'{}'},plugins:[{name:'test-boundaries',setup(build){
    build.onResolve({filter:/\/lib\/supabase$|AuthGate$|appSettingsService$|annualHiringPeriodsService$|databaseService$|saeDocumentParser$/},args=>({path:args.path,namespace:'boundary'}));
    build.onLoad({filter:/.*/,namespace:'boundary'},({path})=>({contents:
      path.endsWith('supabase')?`const invoke=async body=>{const r=await fetch('/db',{method:'POST',body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(data.message);return data;};export const getSessionUser=async()=>({id:'${owner}'});export const supabase={url:location.origin,key:'synthetic-public',query:(table,options)=>invoke({table,options}),rpc:(name,body)=>invoke({name,body}),auth:{getSession:async()=>({data:{session:{access_token:'synthetic'}}})}};`:
      path.endsWith('AuthGate')?"export const useAuthShell=()=>({supervisorName:'Supervisor de prueba'});":
      path.endsWith('appSettingsService')?"export const loadAppBusinessSettings=async()=>({savedObras:['11002 GR']});":
      path.endsWith('annualHiringPeriodsService')?"export const listAnnualHiringPeriods=async()=>[{year:2026,months:[{month:10,period1Start:'2026-10-01',period1End:'2026-10-15',period2Start:'2026-10-16',period2End:'2026-10-31'}]}];":
      path.endsWith('databaseService')?"const request=async body=>{const r=await fetch('/worker',{method:'POST',body:JSON.stringify(body)});if(!r.ok)throw Error('Error de trabajador');};export const createDocument=(table,id,data)=>request({id,data});export const deleteDocument=(table,id)=>request({id,remove:true});":
      "export const parseSaeNeedFile=async()=>{throw Error('Parsing is outside this test')};export const parseSaeReportFile=parseSaeNeedFile;export const fileToDataUrl=parseSaeNeedFile;export const titleCaseSpanish=value=>value;"
    }));
  }}]})).outputFiles[0].text;
  server=http.createServer(async(req,res)=>{
    try {
      if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');return res.end(bundle);}
      if(req.url==='/tailwind.js'){res.setHeader('Content-Type','text/javascript');return res.end(tailwind);}
      if(req.url.startsWith('/storage/v1/object/authenticated/sae-documents/')){res.setHeader('Content-Type','application/pdf');return res.end(Buffer.from(originalBytes));}
      if(req.url==='/db'||req.url==='/worker'){
        const chunks=[];for await(const chunk of req)chunks.push(chunk);const data=JSON.parse(Buffer.concat(chunks).toString());res.setHeader('Content-Type','application/json');
        if(req.url==='/worker'){
          if(data.remove)await q('delete from trabajadores where id=$1',[data.id]);else await q('insert into trabajadores values($1,$2)',[data.id,data.data]);
          return res.end('null');
        }
        if(data.name){
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
  browser=await(engine==='webkit'?webkit:chromium).launch({headless:true});
  for(const width of [390,820,1440]) {
    await reset();
    const context=await browser.newContext({viewport:{width,height:900}});
    await context.route('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm',route=>route.fulfill({status:200,contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},body:pdfModule}));
    await context.addInitScript(({need,first})=>{if(!sessionStorage.getItem('profea-sae-selected-need')){sessionStorage.setItem('profea-sae-selected-need',need);sessionStorage.setItem('profea-sae-selected-report',first);}},{need,first});
    const page=await context.newPage();lastPage=page;page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));await page.goto(url);
    const result=()=>page.locator('select').filter({has:page.locator('option[value="2001"]')});
    await result().waitFor();await result().selectOption('2001');
    await page.waitForFunction(()=>!document.querySelector('select:disabled option[value="2001"]'));
    await page.getByRole('button',{name:/Segunda quincena.pdf/}).first().click();
    await page.getByText(/Código 2500 asignado automáticamente/).waitFor();
    assert.equal(await result().inputValue(),'2500','code selection alone updates the second fortnight');
    assert.equal((await q('select count(*)::int n from trabajadores'))[0].n,0,'no worker is created');
    assert.equal((await q('select existing_worker_id from sae_candidates where id=$1',[a]))[0].existing_worker_id,null);
    await page.reload();await page.getByText(/Código 2500 asignado automáticamente/).waitFor();
    await page.getByRole('button',{name:/Primera quincena.pdf/}).first().click();
    await page.getByRole('button',{name:'Registrar trabajador',exact:true}).click();
    await page.getByText('Contratado · 2001',{exact:true}).waitFor();
    assert.equal((await q('select result_code from sae_candidates where id=$1',[b]))[0].result_code,'2500');
    assert.equal((await q('select count(*)::int n from trabajadores'))[0].n,1);
    await page.getByRole('button',{name:/Segunda quincena.pdf/}).first().click();
    await page.getByText(/Código 2500 asignado automáticamente/).waitFor();assert.equal(await result().inputValue(),'2500');
    await page.reload();await page.getByText(/Código 2500 asignado automáticamente/).waitFor();assert.equal(await result().inputValue(),'2500');
    await result().selectOption('2200');await page.getByRole('button',{name:'Mantener código actual',exact:true}).waitFor();
    await page.getByRole('button',{name:'Mantener código actual',exact:true}).click();
    await page.getByRole('button',{name:'Aplicar nuevo código',exact:true}).waitFor({state:'hidden'});
    await page.reload();await result().waitFor();assert.equal(await result().inputValue(),'2200');assert.equal(await page.getByRole('button',{name:'Aplicar nuevo código',exact:true}).count(),0);
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
    await page.getByText(/Código 2212 · Otros motivos asignado automáticamente/).waitFor();assert.equal(await result().inputValue(),'2212');assert.equal(decisionCalls,before+1);
    await page.reload();await page.getByText(/Código 2212 · Otros motivos asignado automáticamente/).waitFor();
    await result().selectOption('2200');await page.getByRole('button',{name:'Mantener código actual',exact:true}).waitFor();
    await page.getByRole('button',{name:'Aplicar nuevo código',exact:true}).focus();await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'Aplicar nuevo código',exact:true}).waitFor({state:'hidden'});
    await page.reload();await result().waitFor();assert.equal(await result().inputValue(),'2200');assert.equal(await apply.count(),0,'Escape conserves the manual code and records the decision');
    let downloads=0;page.on('download',()=>{downloads++;assert(finalizationComplete,'download follows server confirmation');});
    const finalize=()=>page.getByRole('button',{name:'Finalizar y descargar',exact:true}).nth(1);
    staleFinalization=true;finalizationComplete=false;await finalize().click();
    await page.locator('#toast').filter({hasText:/han cambiado/}).waitFor();assert.equal(downloads,0,'stale PDF is not downloaded');
    await page.reload();await page.getByRole('button',{name:'Mantener código actual',exact:true}).waitFor();
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
    await context.close();
  }
  assert.deepEqual(errors,[]);
  console.log(`PASS SAE ${engine} 390/820/1440: real selection + services + PostgreSQL, register, automatic code, reopen, manual keep/apply/Escape/Enter, focus synchronization, retry, duplicate-click protection, stale PDF rejection and real PDF code/finalization.`);
}catch(error){console.error(error.message,errors);if(lastPage)console.error((await lastPage.locator('body').innerText().catch(()=>'' )).slice(-5000));process.exitCode=1;}
finally {if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));await db.close();}
