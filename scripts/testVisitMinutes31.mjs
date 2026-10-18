import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import fs from 'node:fs/promises';
import {PDFDocument} from 'pdf-lib';
import {visitTestServer} from './visitMinutesTestServer.mjs';
import {content,person,png,id} from './visitMinutesFixture.mjs';
const env=await visitTestServer(),metrics={};
const call=async(body,user=1)=>{const r=await env.invoke({clientVersion:'3.1',...body},user);assert.equal(r.status,200,JSON.stringify({action:body.action,message:r.data.message,problems:env.problems.slice(-2)}));return r.data;};
const direct=async(sql,args=[])=>{await env.db.exec('reset role');return(await env.db.query(sql,args)).rows;};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const chunk=(type,data)=>{let crc=0xffffffff;const body=Buffer.concat([Buffer.from(type),data]);for(const byte of body){crc^=byte;for(let bit=0;bit<8;bit++)crc=crc&1?0xedb88320^(crc>>>1):crc>>>1;}const length=Buffer.alloc(4),sum=Buffer.alloc(4);length.writeUInt32BE(data.length);sum.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([length,body,sum]);};
function noisePhoto(seed){const width=500,height=500,raw=Buffer.alloc(height*(width*4+1));let x=seed+1;for(let y=0;y<height;y++)for(let col=0;col<width;col++){const p=y*(width*4+1)+1+col*4;for(let k=0;k<3;k++){x=(Math.imul(x,1664525)+1013904223)>>>0;raw[p+k]=x>>>24;}raw[p+3]=255;}const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);}
try{
 const onsite={...person(),modality:'in-person',reviewEmailSelected:true},remote={...person(21),attended:false,modality:'remote',receiveFinal:true},recipient={...person(22),attended:false,modality:'none',reviewRequired:false,signing:'none',noSignatureReason:'Solo recibe el documento definitivo',receiveFinal:true};
 const c={...content,workflow:'3.1',agreements:[],orders:[],points:[{id:id(801),title:'Ejecución',description:'Se comprueba el avance de las canalizaciones.',attachmentIds:[]},{id:id(802),title:'Seguridad',description:'Se revisa la señalización del acceso.',attachmentIds:[]}],attachments:[]};
 delete c.purpose;delete c.observations;delete c.discussion;delete c.end;
 assert.equal((await env.invoke({action:'store-attachment',worksiteId:id(10),mime:'image/png',base64:png.split(',')[1]},2)).status,403);
 assert.equal((await env.invoke({action:'store-attachment',worksiteId:id(10),mime:'image/png',base64:Buffer.alloc(1500001).toString('base64')})).status,400,'per-file size enforced by backend');
 assert.equal((await env.invoke({action:'store-attachment',worksiteId:id(10),mime:'image/png',base64:Buffer.from('corrupt').toString('base64')})).status,400,'corrupt image rejected');
 assert.equal((await env.invoke({action:'store-attachment',worksiteId:id(10),mime:'application/pdf',base64:Buffer.from('%PDF-1.7 corrupt').toString('base64')})).status,400,'corrupt PDF rejected by server even below limit');
 env.failNextStorageWrite();const upload={action:'store-attachment',worksiteId:id(10),mime:'image/png',base64:png.split(',')[1]};
 assert.notEqual((await env.invoke(upload)).status,200,'upload failure never claims persistence');
 const a=(await call(upload)).asset;await call(upload);assert.equal(env.objects.size,1,'same bytes retained once after retry');
 const beforeUploads=env.calls.length;
 for(let n=0;n<8;n++){
   const photo=noisePhoto(n);assert(photo.length<1500000);const asset=(await call({action:'store-attachment',worksiteId:id(10),mime:'image/png',base64:photo.toString('base64')})).asset;
   c.attachments.push({id:id(820+n),fileId:asset.id,sha256:asset.sha256,bytes:asset.bytes,name:'Foto de prueba '+(n+1)+'.png',mime:'image/png',base64:'',caption:'Imagen sintética para validar tamaño y fidelidad.'});
 }
 metrics.assetRequests=env.calls.slice(beforeUploads).filter(x=>x.url.includes('/rest/v1/')).length;metrics.optimizedAssetBytes=c.attachments.reduce((n,a)=>n+a.bytes,0);
 c.points[0].attachmentIds=[c.attachments[0].id];
 const create={action:'create',id:id(800),operation:randomUUID(),content:c,participants:[onsite,remote,recipient]};
 let r=(await call(create)).record;assert.equal((await call(create)).record.id,r.id);assert(r.state.content.points);assert.equal(r.state.content.purpose,'');assert.equal(r.state.content.observations,'');
 metrics.savedStateBytes=Buffer.byteLength(JSON.stringify(r.state));assert(metrics.savedStateBytes<15000,'autosaves contain metadata, not the 6 MB image payload');
 assert.equal((await env.invoke({action:'get',id:r.id})).status,409,'stale client cannot silently ignore structured content');
 const alien={...c,worksiteId:id(11)};assert.equal((await env.invoke({...create,id:id(899),operation:randomUUID(),content:alien},2)).status,403,'foreign assets are not reusable in another worksite/account');
 const command=async(command,extra={})=>r=(await call({action:'command',id:r.id,revision:r.revision,operation:randomUUID(),command,...extra})).record;
 const preview=await call({action:'preview-mail',id:r.id,kind:'review'});assert.equal(preview.messages.length,2,'final-only recipient excluded');assert(preview.messages.every(m=>!m.body.includes('requiere código')));
 const beforeDraft=env.objects.size,t0=performance.now(),draft=await call({action:'pdf',id:r.id});metrics.draftPdfMs=Math.round(performance.now()-t0);assert(draft.url&&!draft.base64);assert.equal(env.objects.size,beforeDraft+1);
 const again=await call({action:'pdf',id:r.id});assert.equal(env.objects.size,beforeDraft+1,'preview reused without another PDF');
 const draftBytes=new Uint8Array(await (await env.fetchStorage(draft.url)).arrayBuffer());assert.equal(hash(draftBytes),draft.sha256);
 assert(draftBytes.length>4_500_000,'representative PDF exceeds the Vercel JSON payload budget');metrics.draftPdfBytes=draftBytes.length;
 const beforeReview=env.sent.length,operation=randomUUID(),review=await call({action:'send-mail',id:r.id,revision:r.revision,version:1,operation,kind:'review',recipientIds:[onsite.id]});r=review.record;
 assert.equal(review.summary.total,1);assert.equal(env.sent.length,beforeReview+1);assert(env.sent.at(-1).raw.includes('application/pdf'));assert(!env.sent.at(-1).body.includes('#visit='));assert(!env.sent.at(-1).body.includes('código de verificación'));
 assert.equal((await direct('select count(*)::integer n from visit_minutes_access where record_id=$1',[r.id]))[0].n,0,'initial review creates no signature/code access');
 const count=env.sent.length;await call({action:'send-mail',id:r.id,revision:r.revision,version:1,operation,kind:'review',recipientIds:[onsite.id]});assert.equal(env.sent.length,count,'draft review replay is idempotent');
 await command({type:'onsite-sign',personId:onsite.id,decision:'reject',comment:'Se deja constancia de discrepancia en las cotas.',image:png,intent:'knowledge',note:''},{inPersonConfirmed:true});assert.equal(r.state.responses[onsite.id].decision,'reject');assert.equal(r.state.signatures[onsite.id].mode,'in-person');assert.equal(r.state.identityChecks[onsite.id].actor,id(1));
 assert.equal((await env.invoke({clientVersion:'3.1',action:'command',id:r.id,revision:r.revision,operation:randomUUID(),inPersonConfirmed:true,command:{type:'onsite-sign',personId:onsite.id,decision:'agree',comment:'',image:png,intent:'agreement',note:''}})).status,400,'double signature rejected');
 const remoteInvite=await call({action:'remind',kind:'signing',id:r.id,personId:remote.id,operation:randomUUID()});assert.equal(remoteInvite.delivery,'sent');
 const token=env.sent.at(-1).body.match(/#visit=([a-zA-Z0-9_-]{43})/)[1];await call({action:'challenge',token},null);const code=env.sent.at(-1).body.match(/es: (\d{6})/)[1];const session=(await call({action:'verify',token,code},null)).session;
 await call({action:'portal-command',token,session,revision:r.revision,operation:randomUUID(),command:{type:'respond',decision:'agree',comment:''}},null);r=(await call({action:'get',id:r.id})).record;
 await call({action:'portal-command',token,session,revision:r.revision,operation:randomUUID(),command:{type:'sign',image:png,intent:'agreement'}},null);r=(await call({action:'get',id:r.id})).record;
 const finalStart=performance.now();await command({type:'finalize',reviewClosure:'Se conserva expresamente la discrepancia documentada, sin modificar las cotas ni convertir la firma de conocimiento en conformidad.'});metrics.finalPdfMs=Math.round(performance.now()-finalStart);
 assert.equal(r.status,'signed');const file=await call({action:'pdf',id:r.id});assert(file.url&&!file.base64);const finalBytes=new Uint8Array(await (await env.fetchStorage(file.url)).arrayBuffer());assert.equal(hash(finalBytes),r.state.finalSha256);metrics.finalPdfBytes=finalBytes.length;assert((await PDFDocument.load(finalBytes)).getPageCount()>=9);
 const dbFile=(await direct('select base64,storage_path from visit_minutes_files where record_id=$1',[r.id]))[0];assert.equal(dbFile.base64,null,'PDF has one storage copy, not a second database base64 copy');assert(dbFile.storage_path);
 assert.equal((await direct('select count(*)::integer n from visit_signed_publications where record_id=$1',[r.id]))[0].n,1,'portal published independently of Gmail');
 env.setGoogleMode('quota');const failed=await call({action:'send-mail',id:r.id,revision:r.revision,version:1,operation:randomUUID(),kind:'final'});assert(failed.summary.pending>0);assert.equal((await call({action:'get',id:r.id})).record.status,'signed');assert((await call({action:'pdf',id:r.id})).url);
 env.setGoogleMode('ok');let delivery;const finalOperation=randomUUID();do{delivery=await call({action:'send-mail',id:r.id,revision:r.revision,version:1,operation:finalOperation,kind:'final'});}while(delivery.hasMore);assert.equal(delivery.summary.accepted,3);
 const accepted=env.sent.length;await call({action:'send-mail',id:r.id,revision:r.revision,version:1,operation:finalOperation,kind:'final'});assert.equal(env.sent.length,accepted,'final replay never duplicates');
 assert(env.sent.at(-1).raw.includes(Buffer.from(finalBytes).toString('base64').slice(0,60)),'exact final file used in Gmail attachment');
 await command({type:'revise'});assert.equal(r.version,2);assert.equal((await call({action:'pdf',id:r.id,version:1})).sha256,hash(finalBytes));assert.equal((await env.invoke({clientVersion:'3.1',action:'portal',token,session},null)).status,403);
 const grant=env.storageTokens.get(new URL(file.url).searchParams.get('token'));grant.expires=0;assert.equal((await env.fetchStorage(file.url)).status,403,'temporary download expires');
 const events=await direct('select details from visit_minutes_events where record_id=$1',[r.id]);assert(!JSON.stringify(events).includes('#visit='));assert(!JSON.stringify(events).includes(png.slice(0,50)));
 const access=await direct("select c.relrowsecurity,has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') exposed from pg_class c where c.relname in ('visit_minutes_assets','visit_minutes_draft_files')");assert.equal(access.length,2);for(const row of access){assert(row.relrowsecurity);assert(!row.exposed);}
 await fs.mkdir(new URL('../tmp/pdfs/',import.meta.url),{recursive:true});await fs.writeFile(new URL('../tmp/pdfs/visit-31-draft.pdf',import.meta.url),draftBytes);await fs.writeFile(new URL('../tmp/pdfs/visit-31-final.pdf',import.meta.url),finalBytes);await fs.writeFile(new URL('../tmp/visit-31-integration-metrics.json',import.meta.url),JSON.stringify(metrics,null,2));
 console.log('PASS: Actas 3.1 points, absent retired fields, 8 optimized assets with compact saves, upload retry/dedup/isolation, >4.5 MB PDF preview cache, selected draft recipients without codes, atomic witnessed onsite signature/dissent, independent protected remote signature, one immutable final PDF, portal-before-mail, final failure/retry/no duplicates, expiring downloads, history and RLS. Gmail and Storage simulated; PostgreSQL/PDF processing real.');
}finally{await env.cleanup();}
