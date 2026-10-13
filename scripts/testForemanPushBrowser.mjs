import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import vm from 'node:vm';import {build} from 'esbuild';
const output=new URL('./.push-browser.mjs',import.meta.url);let events=[],failSave=false,unsubscribed=0,permission='granted';
const subscription={endpoint:'https://fcm.googleapis.com/x',options:{},toJSON:()=>({endpoint:'https://fcm.googleapis.com/x',keys:{}}),unsubscribe:async()=>{unsubscribed++;return true;}};
const registration={pushManager:{getSubscription:async()=>null,subscribe:async(options)=>{events.push('subscribe');assert.equal(options.userVisibleOnly,true);return subscription;}}};
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{userAgent:'Android',platform:'Linux',maxTouchPoints:1,serviceWorker:{register:async()=>registration,ready:Promise.resolve(registration),getRegistration:async()=>registration}}});
globalThis.window={isSecureContext:true,Notification:{},PushManager:{},matchMedia:()=>({matches:false})};
globalThis.Notification={permission:'granted',requestPermission:async()=>{events.push('permission');return permission;}};
globalThis.fetch=async()=>{events.push('config');return{ok:true,json:async()=>({configured:true,publicKey:Buffer.alloc(65,4).toString('base64url')})};};
globalThis.__pushApi={rpc:async(name)=>{events.push(name);if(failSave)throw Error('save failure');},auth:{getSession:async()=>{throw Error('expired');}}};
try{
 await build({entryPoints:['src/services/foremanPushService.ts'],outfile:output.pathname,bundle:true,platform:'node',format:'esm',plugins:[{name:'api',setup(b){b.onResolve({filter:/\/lib\/supabase$/},()=>({path:'api',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const supabase=globalThis.__pushApi;'}));}}]});
 const api=await import(output.href);
 await api.activateForemanPush('token');assert.equal(events[0],'permission','Safari gesture happens before fetch');assert.ok(events.includes('register_foreman_push_subscription'));
 permission='denied';events=[];await assert.rejects(api.activateForemanPush('token'));assert.deepEqual(events,['permission']);permission='granted';
 failSave=true;await assert.rejects(api.activateForemanPush('token'));assert.equal(unsubscribed,1,'failed registration rolls back browser subscription');failSave=false;
 navigator.userAgent='iPhone';assert.match(api.foremanPushHelp(),/pantalla de inicio/);navigator.standalone=true;assert.equal(api.foremanPushHelp(),null);
 registration.pushManager.getSubscription=async()=>subscription;assert.equal(await api.restoreForemanPush('token'),true);
 await api.disableForemanPush('token');assert.equal(unsubscribed,2);assert.ok(events.includes('unregister_foreman_push_subscription'));
 assert.equal((await api.dispatchForemanDocumentPush('doc')).status,'unconfirmed','publication preserved when push authentication fails');
 const listeners={};let displayed,opened,posted=[];const context={URL,Promise,console,self:{location:{origin:'https://app.test'},addEventListener:(name,fn)=>listeners[name]=fn,registration:{showNotification:async(title,options)=>{displayed={title,options};}},clients:{matchAll:async()=>[{url:'https://app.test/encargados',postMessage:msg=>posted.push(msg)}]}},clients:{matchAll:async()=>[{url:'https://app.test/',focus:()=>{throw Error('must not replace supervisor tab');}}],openWindow:async(url)=>{opened=url;}}};
 vm.runInNewContext(await fs.readFile(new URL('../public/service-worker.js',import.meta.url),'utf8'),context);
 let pending;listeners.push({data:{json:()=>({title:'Obra A',kind:'FOREMAN_DOCUMENT_AVAILABLE',documentId:'doc',url:'/encargados?document=doc'})},waitUntil:p=>pending=p});await pending;assert.equal(displayed.options.renotify,false);assert.equal(posted[0].documentId,'doc');
 listeners.notificationclick({notification:{data:{url:'/encargados?document=doc'},close(){}},action:'open',waitUntil:p=>pending=p});await pending;assert.equal(opened,'https://app.test/encargados?document=doc');
 context.clients.matchAll=async()=>[];listeners.notificationclick({notification:{data:{url:'https://evil.test/'},close(){}},action:'open',waitUntil:p=>pending=p});await pending;assert.equal(opened,'/');
 assert.ok(!String(opened).includes('evil.test'));
 console.log('PASS push browser/worker: permission gesture, denial, registration rollback, iPhone install help, restore/disable, failed dispatch, foreground refresh and safe document navigation.');
}finally{await fs.rm(output,{force:true});}
