// Reproducible transport/storage comparison. No production data or network.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {visitTestServer} from './visitMinutesTestServer.mjs';
import {id,content,person} from './visitMinutesFixture.mjs';
const baselinePath=process.env.VISIT_BASELINE_HANDLER;
if(!baselinePath)throw Error('Set VISIT_BASELINE_HANDLER to the inspected main visitMinutesHandler.ts snapshot.');
const baseline=await fs.readFile(baselinePath,'utf8');
function chunk(type,data){const body=Buffer.concat([Buffer.from(type),data]);let crc=0xffffffff;for(const b of body){crc^=b;for(let k=0;k<8;k++)crc=crc&1?0xedb88320^(crc>>>1):crc>>>1;}const h=Buffer.alloc(4),c=Buffer.alloc(4);h.writeUInt32BE(data.length);c.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([h,body,c]);}
const width=500,height=500,raw=Buffer.alloc(height*(width*4+1));let seed=41;
for(let y=0;y<height;y++)for(let x=0;x<width;x++){const p=y*(width*4+1)+x*4+1;for(let k=0;k<3;k++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;raw[p+k]=seed>>>24;}raw[p+3]=255;}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;
const photo=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
const results=[];
for(const before of [true,false]){
 const env=await visitTestServer(before?{handlerSource:baseline}:{});let functions=0,requestBytes=0,logs=0,logBytes=0;const saved={log:console.log,warn:console.warn,error:console.error};
 for(const key of Object.keys(saved))console[key]=(...args)=>{logs++;logBytes+=Buffer.byteLength(args.map(String).join(' ')+'\n');};
 try{
  const call=async body=>{functions++;requestBytes+=Buffer.byteLength(JSON.stringify(body));const r=await env.invoke({clientVersion:'3.1',...body});assert.equal(r.status,200,r.data.message);return r.data;};
  const start=performance.now(),c={...content,agreements:[],attachments:[{id:id(800),name:'Foto.png',mime:'image/png',caption:'Prueba sintética',base64:photo.toString('base64')}]};
  if(!before){const asset=(await call({action:'store-attachment',worksiteId:id(10),mime:'image/png',base64:photo.toString('base64')})).asset;c.workflow='3.1';c.points=[{id:id(801),title:'',description:c.discussion,attachmentIds:[]}];c.attachments[0]={...c.attachments[0],base64:'',fileId:asset.id,bytes:asset.bytes,sha256:asset.sha256};}
  let record=(await call({action:'create',id:id(900),operation:randomUUID(),content:c,participants:[person()]})).record;
  for(let i=0;i<5;i++){const next={...record.state.content,place:'Zona de prueba '+i};record=(await call({action:'command',id:record.id,revision:record.revision,operation:randomUUID(),command:{type:'save',content:next,participants:record.state.participants}})).record;}
  const elapsed=Math.round(performance.now()-start),db=env.calls.filter(c=>c.url.includes('/rest/v1/'));
  await env.db.exec('reset role');const states=await env.db.query('select octet_length(state::text)::integer bytes from visit_minutes');
  results.push({mode:before?'main-49825ad-handler':'3.1',scenario:'One 855 KB PNG, create plus five confirmed edits; includes one asset upload after',functions,requestBytes,restRequests:db.length,stateWrites:db.filter(c=>c.url.includes('/rpc/visit_minutes_commit')).length,logs,logBytes,localDurationMs:elapsed,currentStateBytes:states.rows[0].bytes,storedAssetBytes:[...env.objects.values()].reduce((n,b)=>n+b.length,0),temporaryPdfs:0,gmailMessages:0});
 }finally{Object.assign(console,saved);await env.cleanup();}
}
await fs.mkdir(new URL('../tmp/',import.meta.url),{recursive:true});await fs.writeFile(new URL('../tmp/visit-31-before-after.json',import.meta.url),JSON.stringify({baselineCommit:'49825ad79bea7b4535d57293bb151486f93cb8d5',photoBytes:photo.length,scope:'Real handler and PostgreSQL/PDF code; mocked HTTP services; not production resource billing or mobile memory',results},null,2));console.log(JSON.stringify(results));
