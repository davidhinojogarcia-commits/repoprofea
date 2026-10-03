import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

const doc = {
  status: 'NEEDS_WORKSITE_REVIEW',
  worksite: null,
  workers: [
    {id:'w1',status:'CONFIRMED',frozen:false,signed:false},
    {id:'w2',status:'CONFIRMED',frozen:false,signed:false},
    {id:'w3',status:'REJECTED',frozen:false,signed:false},
  ],
  versions: [],
  currentPdf: null,
};

const confirmWorksite = obra => {
  assert.equal(doc.status,'NEEDS_WORKSITE_REVIEW');
  doc.worksite=obra;
  doc.status='READY';
};
const assign = () => {
  assert.equal(doc.status,'READY');
  for (const w of doc.workers) w.frozen=true;
  doc.status='ASSIGNED';
};
const sign = id => {
  assert.ok(['ASSIGNED','IN_SIGNATURE','RETURNED_FOR_CORRECTION'].includes(doc.status));
  const w=doc.workers.find(x=>x.id===id);
  assert.ok(w && w.status==='CONFIRMED' && w.frozen);
  w.signed=true;
  doc.status='IN_SIGNATURE';
};
const submit = bytes => {
  const incomingSha=sha(bytes);
  if(['SUBMITTED','RECEIVED','REVIEWED'].includes(doc.status)){
    if(doc.currentPdf?.sha===incomingSha)return {...doc.currentPdf,idempotent:true};
    throw new Error('El documento ya fue enviado con un PDF diferente');
  }
  assert.ok(['ASSIGNED','IN_SIGNATURE','RETURNED_FOR_CORRECTION'].includes(doc.status));
  const required=doc.workers.filter(w=>w.status==='CONFIRMED').length;
  const signed=doc.workers.filter(w=>w.status==='CONFIRMED'&&w.signed).length;
  assert.ok(signed>0);
  const version={versionNo:doc.versions.length+1,bytes:Buffer.from(bytes),sha:incomingSha,mode:signed<required?'partial':'complete',signed,required};
  doc.versions.push(version);
  doc.currentPdf=version;
  doc.status='SUBMITTED';
  return version;
};
const receive = () => {
  assert.equal(doc.status,'SUBMITTED');
  assert.ok(doc.currentPdf);
  doc.status='RECEIVED';
  return Buffer.from(doc.currentPdf.bytes);
};
const returned = () => {
  assert.ok(['SUBMITTED','RECEIVED','REVIEWED'].includes(doc.status));
  doc.status='RETURNED_FOR_CORRECTION';
  doc.currentPdf=null;
};

confirmWorksite('OBRA 12345-EE');
assign();
sign('w1');
const v1Bytes=Buffer.from('ORIGINAL-PDF+SIGNATURE-W1');
const v1=submit(v1Bytes);
assert.equal(v1.mode,'partial');
const retryV1=submit(v1Bytes);
assert.equal(retryV1.idempotent,true);
assert.equal(doc.versions.length,1);
assert.throws(()=>submit(Buffer.from('DIFFERENT-PDF-SAME-STATE')));
const supervisorV1=receive();
assert.equal(sha(supervisorV1),v1.sha);
assert.deepEqual(supervisorV1,v1.bytes);
returned();
assert.throws(()=>receive());
sign('w2');
const v2=submit(Buffer.from('ORIGINAL-PDF+SIGNATURE-W1+SIGNATURE-W2'));
assert.equal(v2.mode,'complete');
const supervisorV2=receive();
assert.equal(sha(supervisorV2),v2.sha);
assert.deepEqual(supervisorV2,v2.bytes);
assert.equal(doc.versions.length,2);
assert.notEqual(doc.versions[0].sha,doc.versions[1].sha);
assert.equal(doc.versions[0].sha,v1.sha);
assert.equal(doc.versions[1].sha,v2.sha);
console.log('Mandatory traceability V2 E2E correction/versioning regression passed.');
