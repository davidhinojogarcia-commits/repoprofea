import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
const output=new URL('./.mandatory-draft-editor.mjs',import.meta.url);
const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'https://local-validation.invalid/'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
window.HTMLCanvasElement.prototype.getContext=()=>null;
const workers=[1,2].map(i=>({workerId:i,documentWorkerId:'worker-'+i,workerName:'Persona '+i,dni:'',page:1,order:i,nameX:60,nameY:500,nameWidth:100,nameHeight:10,rowHeight:10,signatureX:350,signatureY:500,signatureWidth:90,signatureHeight:32,confidence:1,resolved:true}));
let saved,removed=[],rejectRemoval=false,root;
try{
 await build({stdin:{contents:"export {MandatoryPdfAnchorEditor} from './components/MandatoryPdfAnchorEditor';",resolveDir:new URL('../',import.meta.url).pathname},outfile:output.pathname,bundle:true,platform:'node',format:'esm',packages:'external',plugins:[{name:'editor-boundaries',setup(b){
 b.onResolve({filter:/foremanPortalService$/},()=>({path:'portal',namespace:'mock'}));
 b.onResolve({filter:/\/lib\/supabase$/},()=>({path:'supabase',namespace:'mock'}));
 b.onResolve({filter:/pdfjs-dist/},()=>({path:'pdf',namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},({path})=>({contents:path==='portal'?"export const getSupervisorMandatoryPdf=async()=>({base64:'AAAA'});":path==='supabase'?"export const supabase={query:async()=>[]};":"export default '';export const GlobalWorkerOptions={};export const getDocument=()=>({promise:Promise.resolve({numPages:1,getPage:async()=>({view:[0,0,595,842],getViewport:()=>({width:595,height:842,transform:[1,0,0,-1,0,842]})})})});"}));
 }}]});
 const React=await import('react');const {createRoot}=await import('react-dom/client');const {MandatoryPdfAnchorEditor}=await import(output.href);
 const action=async(fn)=>React.act(async()=>{await fn();await new Promise(r=>setTimeout(r,25));});
 const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
 const mount=async anchors=>{if(root)await action(()=>root.unmount());root=createRoot(document.getElementById('root'));await action(()=>root.render(React.createElement(MandatoryPdfAnchorEditor,{documentId:'doc',title:'Control',obra:'A',documentType:'control_presencia',anchors,onCancel(){},onSave(a){saved=structuredClone(a);},async onRemoveWorker(id){if(rejectRemoval)throw Error('No se pudo eliminar');removed.push(id);}})));};
 await mount(workers);
 assert(document.body.textContent.includes('Avisos de esta firma'));
 assert(!button('Guardar borrador').disabled,'overlap must not disable saving');
 await action(()=>button('Guardar borrador').click());assert.equal(saved.length,2,'conflicting positions remain saved for correction');
 await action(()=>button('Eliminar trabajador del documento').click());assert.deepEqual(removed,[1]);
 const success=[...document.querySelectorAll('[role="status"]')].find(el=>el.textContent.includes('eliminado'));
 assert(success);assert(!success.className.includes('rose'),'success is not shown as red error');
 await mount([{...workers[0],resolved:false,signatureX:null,signatureY:null}]);
 await action(()=>button('Guardar borrador').click());assert.equal(saved[0].resolved,false,'incomplete draft can be saved');
 rejectRemoval=true;await action(()=>button('Eliminar trabajador del documento').click());
 await action(()=>button('Guardar borrador').click());assert.equal(saved.length,1,'failed removal preserves worker');
 rejectRemoval=false;
 await mount([{...workers[0],workerId:-1,documentWorkerId:'new-identity',draftNew:true}]);
 await action(()=>button('Eliminar trabajador del documento').click());assert.deepEqual(removed,[1],'unsaved worker deletion requires no server mutation');
 console.log('PASS: rendered editor saves overlapping/incomplete drafts; verified deletion success is green; failed removal preserves worker; unsaved removal is local.');
}finally{if(root){const React=await import('react');await React.act(()=>root.unmount());}await fs.rm(output,{force:true});dom.window.close();}
