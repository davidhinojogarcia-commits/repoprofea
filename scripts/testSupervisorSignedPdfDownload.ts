import assert from 'node:assert/strict';

type PdfPayload={base64?:string;variant?:'original'|'signed'|string};

const mayUseStoredAsSigned=(payload:PdfPayload|null|undefined)=>
  Boolean(payload?.base64&&payload?.variant==='signed');

assert.equal(mayUseStoredAsSigned({base64:'abc',variant:'signed'}),true);
assert.equal(mayUseStoredAsSigned({base64:'abc',variant:'original'}),false,'Nunca debe aceptarse el PDF original como firmado.');
assert.equal(mayUseStoredAsSigned({base64:'abc'}),false,'La ausencia de variant no puede considerarse PDF firmado.');
assert.equal(mayUseStoredAsSigned({base64:'',variant:'signed'}),false);

const signatures={
  '1':{signature:'data:image/png;base64,AAAA'},
  '2':{signature:''},
  '3':'data:image/png;base64,BBBB',
};
const valid=Object.values(signatures).filter((raw:any)=>{
  const value=typeof raw==='string'?raw:raw?.signature;
  return typeof value==='string'&&value.startsWith('data:image/');
}).length;
assert.equal(valid,2,'La reconstrucción debe contar solo firmas gráficas reales.');

console.log('Supervisor signed PDF download regression passed.');
