import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { unlink } from 'node:fs/promises';

let user = { id:'owner-A', email:'a@example.test' }, online = true, active = true;
let calls = [], listeners = [], release, started, remoteIdentity = 0, draftsDeleted = 0;
let settingsRelease, settingsStarted;
const emit = (event, next) => { user = next; for (const cb of listeners) cb(event, next ? {user:next} : null); };
globalThis.__authRecovery = { createClient: () => ({
  auth: {
    getSession: async () => ({data:{session:user ? {user,access_token:'synthetic'} : null}}),
    getUser: async () => { remoteIdentity++; return {data:{user}}; },
    onAuthStateChange: cb => { listeners.push(cb); return {data:{subscription:{unsubscribe(){listeners=listeners.filter(x=>x!==cb);}}}}; },
    signOut: async options => { assert.equal(options.scope,'local'); emit('SIGNED_OUT',null); return {}; },
    signInWithPassword: async () => { emit('SIGNED_IN',{id:'owner-A',email:'a@example.test'}); return {data:{user}}; },
  },
  rpc: async () => ({data:null}),
}) };
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{get onLine(){return online;}}});
globalThis.fetch = async (url,options) => {
  calls.push({url,method:options.method});
  if(url.includes('/user_settings')) {
    settingsStarted?.();
    if(settingsRelease) await new Promise(resolve=>{settingsRelease.resolve=resolve;});
    return new Response(JSON.stringify([{settings:{app:{supervisor:{nombreApellidos:'Owner A'},technician:{nombreApellidos:'Technician A'}}}}]));
  }
  if(url.includes('/profiles')) {
    started?.(); if(release) await new Promise(resolve=>{release.resolve=resolve;});
    const id=new URL(url).searchParams.get('id').slice(3);
    return new Response(JSON.stringify([{id,email:'test@example.test',role:'user',active}]));
  }
  return new Response('[]');
};
const output = new URL('./.auth-recovery-test.mjs',import.meta.url);
try {
  await build({stdin:{contents:"export * from './src/lib/authService';export * from './src/services/appSettingsService';export {auth} from './src/lib/supabaseData';export {supabase} from './src/lib/supabase';",resolveDir:process.cwd(),loader:'ts'},bundle:true,format:'esm',platform:'node',outfile:output.pathname,define:{'import.meta.env':'{}'},plugins:[{name:'auth-boundary',setup(b){
    b.onResolve({filter:/^@supabase\/supabase-js$/},()=>({path:'sdk',namespace:'mock'}));
    b.onResolve({filter:/\.\/offlineStore$/},()=>({path:'offline',namespace:'mock'}));
    b.onResolve({filter:/\.\/visitDraftStore$/},()=>({path:'draft',namespace:'mock'}));
    b.onLoad({filter:/.*/,namespace:'mock'},({path})=>({contents:path==='sdk'?'export const {createClient}=globalThis.__authRecovery;':path==='draft'?'export const forgetVisitDraft=()=>globalThis.__deleteDraft();':'export const offlineCacheKey=(...a)=>JSON.stringify(a);export const readOfflineCache=async()=>[{role:"admin",active:true}];export const writeOfflineCache=async()=>{};export const applyRestMutationToCachedReads=async()=>{};export const enqueueOfflineOperation=async()=>{};export const listOfflineOperations=async()=>[];export const removeOfflineOperation=async()=>{};export const setOfflineSyncActivity=async()=>{};export const updateOfflineOperationFailure=async()=>{};'}));
  }}]});
  globalThis.__deleteDraft=()=>draftsDeleted++;
  const {getUserProfile,auth,subscribeToAuth,signInWithEmail,authErrorMessage,loadAppBusinessSettings,resetCachedBusinessSettings,getCachedSupervisorSettings}=await import(output.href);
  const stop=subscribeToAuth(()=>{});
  assert.equal(remoteIdentity,0,'startup relies on SDK INITIAL_SESSION, without a competing remote identity request');
  emit('INITIAL_SESSION',user);
  release={};let signal;const pendingStarted=new Promise(r=>signal=r);started=signal;
  const a=getUserProfile(), b=getUserProfile();await pendingStarted;
  await new Promise(r=>setTimeout(r,0));
  assert.equal(calls.length,1,'two simultaneous profile validations make one server request');
  release.resolve();release=null;started=null;
  assert.equal((await a).uid,'owner-A');await b;
  settingsRelease={};let settingsSignal;const settingBegan=new Promise(r=>settingsSignal=r);settingsStarted=settingsSignal;
  const oldSettings=loadAppBusinessSettings();await settingBegan;
  resetCachedBusinessSettings();settingsRelease.resolve();settingsRelease=null;settingsStarted=null;
  await oldSettings;assert.equal(getCachedSupervisorSettings().nombreApellidos,'','late settings from a previous account cannot repopulate the header cache');
  active=false;assert.equal(await getUserProfile(),null,'a subsequent server revocation is not hidden by cached authorization');
  online=false;await assert.rejects(getUserProfile(),/conexión/,'offline cached active/admin profile must never authorize access');
  online=true;active=true;
  emit('SIGNED_OUT',null);await new Promise(r=>setTimeout(r,0));
  assert.equal(auth.currentUser,null);assert.equal(draftsDeleted,0,'SDK sign-out preserves encrypted pending drafts');
  active=false;await assert.rejects(signInWithEmail('a@example.test','synthetic'),e=>e.code==='auth/missing-role');assert.equal(auth.currentUser,null);
  assert(!authErrorMessage({status:400,code:'unrelated_error'}).includes('contraseña incorrectos'),'unknown HTTP 400 is not treated as a bad password');
  assert.match(authErrorMessage(new TypeError('Failed to fetch')),/conexión/);
  stop();
  console.log('PASS auth: concurrent profile reads 2→1, no completed-profile cache, live revocation, offline denial, INITIAL_SESSION ownership, encrypted draft preservation and safe errors. SDK/HTTP mocked.');
} finally { delete globalThis.__authRecovery;delete globalThis.__deleteDraft; await unlink(output.pathname).catch(()=>{}); }
