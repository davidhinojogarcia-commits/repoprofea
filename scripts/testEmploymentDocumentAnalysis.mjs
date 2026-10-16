import assert from 'node:assert/strict';
import {classifyEmploymentDocument,suggestWorkerSignatureAnchor,validateContractImport,recognizeEmploymentWorker} from '../src/lib/employmentDocumentAnalysis.mjs';
assert.equal(classifyEmploymentDocument('CONTRATO DE TRABAJO'),'contrato');
assert.equal(classifyEmploymentDocument('PRÓRROGA DEL CONTRATO'),'prorroga');
assert.equal(classifyEmploymentDocument('documentación general'),null);
assert.equal(classifyEmploymentDocument('','prorroga.pdf'),'prorroga');
const sample=[{items:[{text:'El trabajador',x:0.60,y:0.78},{text:'María López Ruiz',x:0.60,y:0.82}]}];
const suggestion=suggestWorkerSignatureAnchor(sample,'María López Ruiz');
assert.equal(suggestion.status,'SUGGESTED');
assert.equal(suggestion.requiresSupervisorConfirmation,true);
assert.equal(suggestWorkerSignatureAnchor(sample,'Persona desconocida').status,'REVIEW_REQUIRED');
assert.equal(suggestWorkerSignatureAnchor([], 'María López').status,'REVIEW_REQUIRED');
assert.equal(validateContractImport({documentType:'contrato',pages:3,workers:[{name:'María'}],anchorConfirmed:true}).valid,true);
assert.equal(validateContractImport({documentType:'prorroga',pages:1,workers:[],anchorConfirmed:false}).valid,false);
assert.equal(validateContractImport({documentType:'inicio',pages:3,workers:[{name:'María'}],anchorConfirmed:true}).valid,false);
console.log('Employment document analysis: 9 assertions passed');


assert.equal(recognizeEmploymentWorker('EMPRESA\nJuan Empresa García\nEL TRABAJADOR\nLópez Ruiz, María').name,'López Ruiz, María');
assert.equal(recognizeEmploymentWorker('EL TRABAJADOR\nLópez Ruiz, María\nEL TRABAJADOR\nLópez Ruiz, María').name,'López Ruiz, María');
assert.equal(recognizeEmploymentWorker('EL TRABAJADOR\nMaría López Ruiz\nLA TRABAJADORA\nAna Pérez Díaz').name,null);
assert.equal(recognizeEmploymentWorker('REPRESENTANTE DE LA EMPRESA\nDavid Hinojo García').name,null);
assert.equal(recognizeEmploymentWorker('TRABAJADOR: María López Ruiz').name,'María López Ruiz');
assert.equal(suggestWorkerSignatureAnchor([{items:[{text:'El trabajador',x:0.1,y:0.8},{text:'María López Ruiz',x:0.6,y:0.82}]}],'María López Ruiz').status,'REVIEW_REQUIRED','employer column not associated with worker label');
assert.equal(suggestWorkerSignatureAnchor([sample[0],sample[0]],'María López Ruiz').status,'REVIEW_REQUIRED','multiple pages require review');
const below=suggestWorkerSignatureAnchor(sample,'María López Ruiz').anchor;
assert(below.y>0.82,'signature below name, never label');
assert.equal(validateContractImport({documentType:'contrato',pages:4,workers:[{name:'María'}],anchorConfirmed:true}).valid,true);
console.log('PASS: employer exclusion, comma names, conflicting identities, column isolation, multiple-page ambiguity and page variations.');

assert.equal(recognizeEmploymentWorker('DATOS DEL/DE LA TRABAJADOR/A\nMaría López Ruiz').name,'María López Ruiz');

const official='DATOS DE LA EMPRESA\nD./DÑA. NIF/NIE\nREPRESENTANTE EMPRESA 12345678Z\nDATOS DELIDE LA TRABAJADOR/A\nD.IDÑA. NIF/NIE FECHA NACIMIENTO\nPÉREZ GÓMEZ, JUAN CARLOS 87654321X 06/08/1966\nNº AFILIACIÓN S.S. NIVEL FORMATIVO';
assert.equal(recognizeEmploymentWorker(official).name,'PÉREZ GÓMEZ, JUAN CARLOS');
assert.equal(recognizeEmploymentWorker('DATOS DEL/DE LA TRABAJADOR/A\nDÍAZ RUIZ, DAVID 87654321X 01/01/1980').name,'DÍAZ RUIZ, DAVID');
const fields=[{items:[{text:'El/la trabajador/a',x:0.15,y:0.76,height:0.015},{text:'El/la representante de la Empresa',x:0.45,y:0.76,height:0.015}]}];
assert.equal(suggestWorkerSignatureAnchor(fields,'PÉREZ GÓMEZ, JUAN CARLOS',true).status,'SUGGESTED');
assert.equal(suggestWorkerSignatureAnchor(fields,'PÉREZ GÓMEZ, JUAN CARLOS').status,'REVIEW_REQUIRED');
assert.equal(suggestWorkerSignatureAnchor([{items:[{text:'Datos del trabajador',x:0.15,y:0.6}]}],'PÉREZ GÓMEZ, JUAN CARLOS',true).status,'REVIEW_REQUIRED');
console.log('PASS: official SAE field/table layout, OCR header, DNI/date separation and worker-only signing field.');


const scanned=[{items:[{text:'Datos delide la trabajadoría',x:.1,y:.3},{text:'María López Ruiz',x:.1,y:.34}]}];
assert.equal(recognizeEmploymentWorker('DATOS DELIDE LA TRABAJADORÍA\nMaría López Ruiz').name,'María López Ruiz');
assert.equal(suggestWorkerSignatureAnchor(scanned,'María López Ruiz',true).status,'REVIEW_REQUIRED','a worker data row is not a signing field');
const officialScan={items:[{text:'Ellla trabajador/a',x:.15,y:.78,width:.15,height:.015,confidence:.9},{text:'trabajador/a',x:.18,y:.78,width:.12,height:.015,confidence:.95},{text:'Ellla representante de la Empresa',x:.4,y:.78,width:.3,height:.015}]};
const identified=suggestWorkerSignatureAnchor([...scanned,officialScan,{items:[]}],'María López Ruiz',true);
assert.equal(identified.status,'SUGGESTED');assert.equal(identified.anchor.page,2,'interior-page form label');assert.equal(identified.anchor.x,.15,'overlapping OCR spans are one signing field');
assert.equal(suggestWorkerSignatureAnchor([officialScan,officialScan],'María López Ruiz',true).status,'REVIEW_REQUIRED','two different signing pages stay ambiguous');
assert.equal(suggestWorkerSignatureAnchor([{items:[{text:'Firma del trabajador',x:.15,y:.2,width:.2,height:.015}]}],'María López Ruiz',true).status,'SUGGESTED','explicit signing field need not be in the lower half');
assert.equal(suggestWorkerSignatureAnchor([{items:officialScan.items.map(v=>({...v,confidence:.1}))}],'María López Ruiz',true).status,'REVIEW_REQUIRED','low-confidence OCR never invents a position');
console.log('PASS: observed Spanish OCR variants, data-table exclusion, duplicate span grouping, interior-page labels, ambiguity and confidence checks.');

assert.equal(suggestWorkerSignatureAnchor([{items:[{text:'Fdo.',x:.6,y:.76},{text:'María López Ruiz',x:.6,y:.8}]}],'María López Ruiz').status,'SUGGESTED','Fdo linked to the exact worker name');
