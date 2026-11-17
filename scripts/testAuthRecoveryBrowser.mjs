import assert from 'node:assert/strict';
import http from 'node:http';
import {build} from 'esbuild';
import {chromium,webkit} from 'playwright';

const root=new URL('../',import.meta.url).pathname;
const mockAuth=`let callback;const reads=[];window.authTest={reads,signouts:0,signins:0,emit(id,event='SIGNED_IN'){callback(id?{id,uid:id,email:id+'@example.test'}:null,event);},resolve(i,active=true){const r=reads[i];r.resolve(active?{uid:r.user.id,role:'user',active:true,email:r.user.email}:null);},reject(i){reads[i].reject(new TypeError('synthetic network failure'));}};
export const subscribeToAuth=cb=>{callback=cb;return()=>{callback=()=>{};};};
export const getUserProfile=user=>new Promise((resolve,reject)=>reads.push({user,resolve,reject}));
export const signOutUser=async()=>{window.authTest.signouts++;callback(null,'SIGNED_OUT');};
export const signInWithEmail=async()=>{window.authTest.signins++;const user={id:'A',uid:'A',email:'a@example.test'};callback(user,'SIGNED_IN');return user;};
export const authErrorMessage=()=> 'No se ha podido conectar.';`;
const mockSettings=`export const DEFAULT_SUPERVISOR_SETTINGS={},DEFAULT_TECHNICIAN_SETTINGS={};export const resetCachedBusinessSettings=()=>{};export const loadAppBusinessSettings=async()=>({supervisor:{},technician:{}});`;
const bundle=(await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{AuthGate,useAuthShell}from'./components/AuthGate';function Protected(){const{user,profile}=useAuthShell();return <div data-testid="protected">{user.id}:{profile.uid}</div>}createRoot(document.getElementById('root')).render(<AuthGate><Protected/></AuthGate>);`,loader:'tsx',resolveDir:root},bundle:true,write:false,format:'iife',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'auth-transport',setup(b){
 b.onResolve({filter:/lib\/authService$/},()=>({path:'auth',namespace:'mock'}));
 b.onResolve({filter:/lib\/supabase$/},()=>({path:'sdk',namespace:'mock'}));
 b.onResolve({filter:/services\/appSettingsService$/},()=>({path:'settings',namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},({path})=>({contents:path==='auth'?mockAuth:path==='settings'?mockSettings:'export const supabase={auth:{}};'}));
}}]})).outputFiles[0].text;
const server=http.createServer((req,res)=>{if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle);}else{res.setHeader('Content-Type','text/html');res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}button,input{min-height:44px;max-width:100%;box-sizing:border-box}form>div,input,button{display:block}#root{max-width:450px;padding:12px;margin:auto}</style><div id="root"></div><script src="/app.js"></script>');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const engine=process.env.BROWSER_ENGINE==='webkit'?'webkit':'chromium';
const browser=await(engine==='webkit'?webkit:chromium).launch();
try{
 for(const width of [390,820,1440]){
  const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>!!window.authTest);
  await page.evaluate(()=>authTest.emit('A','INITIAL_SESSION'));await page.waitForFunction(()=>authTest.reads.length===1);
  await page.evaluate(()=>{authTest.emit(null,'SIGNED_OUT');authTest.resolve(0);});
  await page.getByLabel('Correo electrónico',{exact:true}).waitFor();assert.equal(await page.getByTestId('protected').count(),0,'late profile response cannot reopen a signed-out account');
  await page.getByLabel('Correo electrónico',{exact:true}).fill('a@example.test');await page.getByLabel('Contraseña',{exact:true}).fill('synthetic');
  await page.locator('form').evaluate(form=>{form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
  await page.waitForFunction(()=>authTest.reads.length===2);assert.equal(await page.evaluate(()=>authTest.signins),1,'double submit causes one SDK sign-in');
  await page.evaluate(()=>authTest.emit('B'));await page.waitForFunction(()=>authTest.reads.length===3);
  await page.evaluate(()=>authTest.resolve(1));assert.equal(await page.getByTestId('protected').count(),0,'account A cannot authorize account B');
  await page.evaluate(()=>authTest.resolve(2));await page.getByTestId('protected').filter({hasText:'B:B'}).waitFor();
  await page.evaluate(()=>authTest.emit(null,'SIGNED_OUT'));await page.getByLabel('Correo electrónico',{exact:true}).waitFor();
  await page.evaluate(()=>authTest.emit('C'));await page.waitForFunction(()=>authTest.reads.length===4);
  for(let i=3;i<6;i++){
    await page.waitForFunction(n=>authTest.reads.length===n,i+1);await page.evaluate(n=>authTest.reject(n),i);
  }
  await page.getByRole('alert').filter({hasText:'No se ha podido validar'}).waitFor();
  assert.equal(await page.evaluate(()=>authTest.signouts),0,'network failure must not revoke session');
  const retry=page.getByRole('button',{name:'Volver a comprobar sesión',exact:true});await retry.click();
  await page.waitForFunction(()=>authTest.reads.length===7);await page.evaluate(()=>authTest.resolve(6));await page.getByTestId('protected').filter({hasText:'C:C'}).waitFor();
  await page.setViewportSize({width:width===390?844:1180,height:390});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal layout fits');
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS '+engine+' AuthGate 390/820/1440 + landscape: stale signout/account-switch responses rejected, network failure preserves session, explicit retry restores access. Real React; auth/HTTP mocked; no physical iPad.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
