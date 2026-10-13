import assert from 'node:assert/strict';
import {suggestSafeMandatorySignaturePositions,validateMandatorySignaturePlacement,fitSignatureInsideBox,blockingMandatorySignatureIssues} from '../src/lib/mandatorySignatureGeometry';
const pages=[{page:1,width:595,height:842}];
const anchor=(id:number,y:number,nameWidth:number)=>({workerId:id,workerName:'Persona '+id,page:1,resolved:true,nameX:60,nameY:y,nameWidth,nameHeight:10,rowHeight:20,signatureX:350,signatureY:y-2,signatureWidth:70,signatureHeight:14});
const correct=[anchor(1,500,100),anchor(2,470,270)];
assert.equal(validateMandatorySignaturePlacement(correct,pages).ok,true,'longer surname on another row must not produce a false nearest-name warning');
const bad=correct.map(a=>({...a}));bad[0].signatureY=469;
assert.equal(validateMandatorySignaturePlacement(bad,pages).ok,false);
const fixed=suggestSafeMandatorySignaturePositions(bad,pages);
assert.equal(validateMandatorySignaturePlacement(fixed,pages).ok,true);
assert.equal(fixed[0].signatureY!+fixed[0].signatureHeight!/2,505,'correction stays in the original name row');
assert.deepEqual(correct,[anchor(1,500,100),anchor(2,470,270)],'input is immutable');
assert.equal(bad[0].signatureY,469,'draft input is immutable');
const uncertain={...bad[0],nameY:null};assert.deepEqual(suggestSafeMandatorySignaturePositions([uncertain],pages),[uncertain],'never guess a missing name');
assert.equal(validateMandatorySignaturePlacement([{...correct[0],page:2}],pages).ok,false,'missing page must fail');
assert.equal(validateMandatorySignaturePlacement([{...correct[0],signatureWidth:NaN}],pages).ok,false,'nonfinite coordinates must fail');
const dimensions=fitSignatureInsideBox({imageWidth:300,imageHeight:100,boxWidth:70,boxHeight:14});assert.equal(dimensions.width/dimensions.height,3);assert(dimensions.height<=14&&dimensions.width<=70);
console.log('PASS: false nearest-name regression, safe same-row corrections, uncertainty, bounds, invalid numbers and aspect ratio.');

const overlapping=[anchor(1,500,100),anchor(2,500,100)];
const overlapIssues=validateMandatorySignaturePlacement(overlapping,pages).issues;
assert(overlapIssues.some(issue=>issue.code==='OVERLAP_SIGNATURE'));
assert.equal(blockingMandatorySignatureIssues(overlapIssues).length,0,'signature overlap is advisory');
assert(blockingMandatorySignatureIssues(validateMandatorySignaturePlacement([{...overlapping[0],signatureX:580}],pages).issues).length,'bounds still block');
console.log('PASS: signature-to-signature overlap is advisory; out-of-page positions still block.');


const nearRows=[{...anchor(1,500,100),signatureY:470},anchor(2,470,270)];
const nearIssues=validateMandatorySignaturePlacement(nearRows,pages).issues;
assert(nearIssues.some(issue=>issue.code==='CLOSER_TO_OTHER_WORKER'),'row proximity remains detectable');
assert.equal(blockingMandatorySignatureIssues(nearIssues).length,0,'supervisor row proximity validation permits publication');
console.log('PASS: row proximity remains informative without blocking supervisor validation.');
