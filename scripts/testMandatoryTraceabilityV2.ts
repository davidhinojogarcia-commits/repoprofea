import assert from 'node:assert/strict';
import {
  assertFrozenMandatoryWorkers,
  assertSignatureBelongsToFrozenWorker,
  canFreezeMandatoryWorker,
  resolveMandatoryLifecycleBeforeAssignment,
  type MandatoryDocumentWorkerV2,
} from '../src/lib/mandatoryTraceabilityV2';

const worker = (overrides: Partial<MandatoryDocumentWorkerV2> = {}): MandatoryDocumentWorkerV2 => ({
  id: '11111111-1111-1111-1111-111111111111',
  documentId: '22222222-2222-2222-2222-222222222222',
  printedName: 'GARCÍA LÓPEZ, JUAN MANUEL',
  detectionStatus: 'CONFIRMED',
  detectionConfidence: 0.98,
  positionStatus: 'RESOLVED',
  nameBox: {x: 0.08, y: 0.61, width: 0.34, height: 0.025},
  signatureBox: {x: 0.76, y: 0.603, width: 0.16, height: 0.04},
  frozenAt: '2026-10-03T08:00:00Z',
  ...overrides,
});

assert.equal(resolveMandatoryLifecycleBeforeAssignment([worker()], true), 'READY');
assert.equal(resolveMandatoryLifecycleBeforeAssignment([worker()], false), 'NEEDS_WORKSITE_REVIEW');
assert.equal(resolveMandatoryLifecycleBeforeAssignment([worker({detectionStatus:'DETECTED'})], true), 'NEEDS_WORKER_REVIEW');
assert.equal(resolveMandatoryLifecycleBeforeAssignment([worker({signatureBox:null, positionStatus:'PENDING'})], true), 'NEEDS_SIGNATURE_POSITION_REVIEW');
assert.equal(resolveMandatoryLifecycleBeforeAssignment([
  worker(),
  worker({id:'33333333-3333-3333-3333-333333333333', printedName:'ENCARGADO DE OBRA', detectionStatus:'REJECTED', positionStatus:'REJECTED', nameBox:null, signatureBox:null}),
], true), 'READY');

assert.equal(canFreezeMandatoryWorker(worker()), true);
assert.equal(canFreezeMandatoryWorker(worker({detectionStatus:'REJECTED',positionStatus:'REJECTED',nameBox:null,signatureBox:null})), false);
assert.equal(canFreezeMandatoryWorker(worker({signatureBox:{x:0.5,y:0.5,width:0,height:0.04}})), false);
assert.doesNotThrow(() => assertFrozenMandatoryWorkers([worker()]));
assert.doesNotThrow(() => assertFrozenMandatoryWorkers([worker(), worker({id:'44444444-4444-4444-4444-444444444444',detectionStatus:'REJECTED',positionStatus:'REJECTED',nameBox:null,signatureBox:null,frozenAt:null})]));
assert.throws(() => assertFrozenMandatoryWorkers([worker({detectionStatus:'DETECTED'})]));
assert.doesNotThrow(() => assertSignatureBelongsToFrozenWorker(worker()));
assert.throws(() => assertSignatureBelongsToFrozenWorker(worker({frozenAt:null})));


const manualWorker = worker({
  id:'55555555-5555-5555-5555-555555555555',
  nameBox:null,
  signatureBox:{x:0.76,y:0.603,width:0.16,height:0.04},
  positionStatus:'RESOLVED',
  positionSource:'MANUAL',
});
assert.equal(canFreezeMandatoryWorker(manualWorker), true);
assert.equal(resolveMandatoryLifecycleBeforeAssignment([manualWorker], true), 'READY');
assert.equal(canFreezeMandatoryWorker({...manualWorker,positionSource:'AUTO'}), false);
assert.equal(resolveMandatoryLifecycleBeforeAssignment([{...manualWorker,positionSource:'AUTO'}], true), 'NEEDS_SIGNATURE_POSITION_REVIEW');

console.log('Mandatory traceability V2 model regression passed.');
