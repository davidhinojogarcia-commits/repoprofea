import React,{useState,useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {PreventionSection} from '../../components/PreventionSection';
import {selectScenario,calls} from './fake-db';
window.addEventListener('profea:dialog',(e:any)=>e.detail.resolve(false));
function App(){
 const [scenario,setScenario]=useState('vertical');const [count,setCount]=useState('Sin lecturas');
 useEffect(()=>{const update=()=>setCount(calls.join(' → '));window.addEventListener('qa-calls',update);return()=>window.removeEventListener('qa-calls',update);},[]);
 return <><header className="qa-header"><h1>Pruebas de informes PDF</h1><p>GestionProfea · PR #291 · componente original de main <code>97af602</code></p><p><strong>Datos e imágenes sintéticos. Acceso directo. Sin conexión a producción.</strong></p><p>Selecciona un caso y pulsa «Compartir PDF». Abre también «Ver historial y fotografía» para comparar la imagen.</p><label htmlFor="scenario">Caso de prueba</label><select id="scenario" value={scenario} onChange={e=>{selectScenario(e.target.value);setScenario(e.target.value);}}><option value="vertical">Imagen vertical</option><option value="horizontal">Imagen horizontal</option><option value="mixed">Dos imágenes y texto largo</option><option value="missing">Error: fotografía ausente</option><option value="corrupt">Error: fotografía corrupta</option><option value="inaccessible">Error: acceso denegado</option></select><p>Solo lectura: los botones de crear, editar y eliminar no guardan datos.</p><details><summary>Lecturas de prueba</summary><p className="break-words" data-testid="calls">{count}</p></details></header><PreventionSection key={scenario} savedObras={['Obra de pruebas A']} token="qa-only-no-real-token" supervisorName="Supervisor de pruebas"/></>;
}
createRoot(document.getElementById('root')!).render(<App/>);
