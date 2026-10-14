import assert from 'node:assert/strict';
import { ForemanDashboardLoader } from '../src/services/foremanDashboardLoader';
import { addSignatureImage } from '../src/lib/signaturePdf';
import { reportOperationalError } from '../src/lib/operationalLog';
async function measure(Loader:any) {
 let calls=0,release!:()=>void;
 const held=new Promise<void>(resolve=>{release=resolve;});
 const loader=new Loader(async()=>{calls++;await held;return [];},'owner-A');
 const initial=loader.load(true);
 const waiting=Array.from({length:10},()=>loader.load(false));
 release();await Promise.all([initial,...waiting]);return calls;
}
const after=await measure(ForemanDashboardLoader);
assert.equal(after,6);
console.log(JSON.stringify({scenario:'initial read plus 10 overlapping refreshes',calls:after}));
let calls=0,release!:()=>void;const held=new Promise<void>(r=>{release=r;});
const loader=new ForemanDashboardLoader(async()=>{calls++;if(calls<=3)await held;return [];},'owner');
const first=loader.load(true),waiting=loader.load(false);release();await first;await waiting;
await loader.load(false);assert.equal(calls,9,'a later mutation gets another fresh read');
const logs:any[]=[];const error=console.error;console.error=(...args)=>{logs.push(args);};
try{reportOperationalError('[test-operation]',Object.assign(new Error('PRIVATE_TOKEN document.pdf'),{status:500,code:'PGRST301',signature:'data:image/png;base64,PRIVATE_SIGNATURE'}));}
finally{console.error=error;}
assert.equal(logs.length,1);assert(!JSON.stringify(logs).includes('PRIVATE'));assert.equal(logs[0][1].status,500);assert.equal(logs[0][1].code,'PGRST301');assert(logs[0][1].correlationId);
console.log('PASS: refresh batching preserves a fresh read after saves; operational logs retain diagnostics without raw payloads.');

let placement: unknown[] = [];
addSignatureImage({getImageProperties:()=>({width:200,height:50}),addImage:(...args:unknown[])=>{placement=args;}} as any,'original-pixels',10,20,100,20);
assert.deepEqual(placement.slice(0,6),['original-pixels','PNG',20,20,80,20],'aspect ratio and centered box are preserved without changing image bytes');
assert.throws(()=>addSignatureImage({getImageProperties:()=>{throw Error('corrupt');}} as any,'corrupt',0,0,20,20),/No se pudo insertar una firma/);
