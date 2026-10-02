import assert from 'node:assert/strict';
import type { MandatoryWorkerAnchor, MandatoryPdfPageMeta } from '../src/lib/mandatoryPdfOverlay';
import {
  computeSignatureBoxFromDetectedName,
  fitSignatureInsideBox,
  scoreMandatoryWorkerNameText,
  validateMandatorySignaturePlacement,
} from '../src/lib/mandatorySignatureGeometry';

const worker=(id:number,name:string,dni='')=>({id,apellidosNombre:name,dni} as any);

const makeAnchor=(input:{
  id:number; name:string; page:number; x:number; y:number; width:number; height:number;
  sigX:number; sigY:number; sigW:number; sigH:number;
}):MandatoryWorkerAnchor=>({
  workerId:input.id,
  workerName:input.name,
  dni:'',
  page:input.page,
  order:input.id,
  nameX:input.x,
  nameY:input.y,
  nameWidth:input.width,
  nameHeight:input.height,
  nameRightX:input.x+input.width,
  nameCenterY:input.y+input.height/2,
  rowHeight:input.height*1.5,
  signatureX:input.sigX,
  signatureY:input.sigY,
  signatureWidth:input.sigW,
  signatureHeight:input.sigH,
  confidence:1,
  resolved:true,
});

const pages:MandatoryPdfPageMeta[]=[
  {page:1,width:595,height:842,rotation:0},
  {page:2,width:595,height:842,rotation:0},
];

// Nombres exactos, compuestos, con coma y variaciones de espacios.
assert(scoreMandatoryWorkerNameText(worker(1,'PÉREZ GARCÍA, JUAN'),'PÉREZ GARCÍA, JUAN')>=0.97);
assert(scoreMandatoryWorkerNameText(worker(2,'DE LA TORRE MARTÍN, ANA MARÍA'),'DE LA TORRE MARTÍN ANA MARÍA')>=0.9);
assert(scoreMandatoryWorkerNameText(worker(3,'SÁNCHEZ-RUIZ, PEDRO'),'SANCHEZ RUIZ PEDRO')>=0.9);

// 1 trabajador: misma línea y justo a la derecha.
{
  const box=computeSignatureBoxFromDetectedName({
    pageWidth:595,pageHeight:842,nameX:70,nameY:700,nameRightX:210,nameHeight:10,
  });
  assert(box);
  assert(box.x>210);
  assert(Math.abs((box.y+box.height/2)-(700+5))<0.001);
}

// Nombre muy largo: reduce anchura y nunca invade el nombre.
{
  const box=computeSignatureBoxFromDetectedName({
    pageWidth:595,pageHeight:842,nameX:70,nameY:650,nameRightX:505,nameHeight:10,
  });
  assert(box);
  assert(box.x>505);
  assert(box.x+box.width<=595);
}

// Sin espacio seguro: no inventa posición.
{
  const box=computeSignatureBoxFromDetectedName({
    pageWidth:595,pageHeight:842,nameX:70,nameY:620,nameRightX:558,nameHeight:10,
  });
  assert.equal(box,null);
}

// 5 trabajadores: ninguna firma invade filas vecinas.
{
  const anchors:MandatoryWorkerAnchor[]=[];
  const centers=[700,675,650,625,600];
  for(let i=0;i<5;i+=1){
    const nameY=centers[i]-5;
    const box=computeSignatureBoxFromDetectedName({
      pageWidth:595,pageHeight:842,nameX:70,nameY,nameRightX:240,nameHeight:10,
      upperWorkerCenterY:i===0?null:centers[i-1],
      lowerWorkerCenterY:i===4?null:centers[i+1],
    });
    assert(box);
    anchors.push(makeAnchor({
      id:i+1,name:`TRABAJADOR ${i+1}`,page:1,x:70,y:nameY,width:170,height:10,
      sigX:box.x,sigY:box.y,sigW:box.width,sigH:box.height,
    }));
  }
  assert.equal(validateMandatorySignaturePlacement(anchors,pages).ok,true);
}

// 20 trabajadores con separación estrecha: ajuste automático sin colisiones.
{
  const anchors:MandatoryWorkerAnchor[]=[];
  const centers=Array.from({length:20},(_,i)=>760-(i*22));
  for(let i=0;i<20;i+=1){
    const nameY=centers[i]-5;
    const box=computeSignatureBoxFromDetectedName({
      pageWidth:595,pageHeight:842,nameX:55,nameY,nameRightX:225+(i%3)*12,nameHeight:10,
      upperWorkerCenterY:i===0?null:centers[i-1],
      lowerWorkerCenterY:i===19?null:centers[i+1],
    });
    assert(box);
    anchors.push(makeAnchor({
      id:100+i,name:`APELLIDO COMPUESTO ${i} NOMBRE`,page:1,x:55,y:nameY,width:(225+(i%3)*12)-55,height:10,
      sigX:box.x,sigY:box.y,sigW:box.width,sigH:box.height,
    }));
  }
  const result=validateMandatorySignaturePlacement(anchors,pages);
  assert.equal(result.ok,true,JSON.stringify(result.issues));
}

// Varias páginas: las firmas se validan independientemente por página.
{
  const a1=makeAnchor({id:1,name:'UNO',page:1,x:60,y:100,width:120,height:10,sigX:190,sigY:98,sigW:70,sigH:12});
  const a2=makeAnchor({id:2,name:'DOS',page:2,x:60,y:100,width:120,height:10,sigX:190,sigY:98,sigW:70,sigH:12});
  assert.equal(validateMandatorySignaturePlacement([a1,a2],pages).ok,true);
}

// Regresión: una firma desplazada hacia otro trabajador debe fallar.
{
  const own=makeAnchor({id:1,name:'JUAN PEREZ',page:1,x:60,y:500,width:120,height:10,sigX:190,sigY:493,sigW:70,sigH:12});
  const other=makeAnchor({id:2,name:'ANA LOPEZ',page:1,x:60,y:470,width:120,height:10,sigX:190,sigY:463,sigW:70,sigH:12});
  own.signatureY=466;
  const result=validateMandatorySignaturePlacement([own,other],pages);
  assert.equal(result.ok,false);
  assert(result.issues.some(issue=>issue.workerId===1&&(issue.code==='CLOSER_TO_OTHER_WORKER'||issue.code==='OVERLAP_SIGNATURE')));
}

// Regresión: una firma encima del nombre de otra persona debe fallar.
{
  const a=makeAnchor({id:1,name:'JUAN',page:1,x:60,y:400,width:120,height:10,sigX:190,sigY:398,sigW:70,sigH:12});
  const b=makeAnchor({id:2,name:'ANA',page:1,x:200,y:398,width:100,height:10,sigX:310,sigY:398,sigW:70,sigH:12});
  const result=validateMandatorySignaturePlacement([a,b],pages);
  assert.equal(result.ok,false);
  assert(result.issues.some(issue=>issue.workerId===1&&issue.code==='OVERLAP_NAME'));
}

console.log('mandatory signature anchoring regression tests: OK');


// Texto inmediatamente a la derecha: la caja se limita antes de invadirlo.
{
  const box=computeSignatureBoxFromDetectedName({
    pageWidth:595,pageHeight:842,nameX:60,nameY:560,nameRightX:210,nameHeight:10,nextTextX:282,
  });
  assert(box);
  assert(box.x+box.width<=278);
}

// Trabajador cerca del final inferior de página: nunca sale de la página.
{
  const box=computeSignatureBoxFromDetectedName({
    pageWidth:595,pageHeight:842,nameX:60,nameY:5,nameRightX:200,nameHeight:8,
  });
  assert(box);
  assert(box.y>=4);
  assert(box.y+box.height<=838);
}

// Firmas grandes y pequeñas conservan proporción; nunca se deforman.
{
  const large=fitSignatureInsideBox({imageWidth:1200,imageHeight:400,boxWidth:80,boxHeight:16});
  assert(Math.abs((large.width/large.height)-3)<0.0001);
  assert(large.width<=80&&large.height<=16);

  const tall=fitSignatureInsideBox({imageWidth:240,imageHeight:480,boxWidth:80,boxHeight:16});
  assert(Math.abs((tall.width/tall.height)-0.5)<0.0001);
  assert(tall.width<=80&&tall.height<=16);
}

// Variación ligera de formato: al moverse el nombre, la firma se mueve con él.
{
  const first=computeSignatureBoxFromDetectedName({
    pageWidth:595,pageHeight:842,nameX:60,nameY:520,nameRightX:210,nameHeight:10,
  });
  const shifted=computeSignatureBoxFromDetectedName({
    pageWidth:595,pageHeight:842,nameX:67,nameY:514,nameRightX:217,nameHeight:10,
  });
  assert(first&&shifted);
  assert.equal(Math.round(shifted.x-first.x),7);
  assert.equal(Math.round((shifted.y+shifted.height/2)-(first.y+first.height/2)),-6);
}

console.log('mandatory signature anchoring extended tests: OK');


// Posición manual confirmada por el supervisor: es válida aunque el PDF escaneado
// no permita recuperar las coordenadas del nombre. Se siguen validando límites y colisiones.
{
  const manual:MandatoryWorkerAnchor={
    workerId:501,
    workerName:'NOMBRE AJUSTADO MANUALMENTE',
    dni:'',
    page:1,
    order:0,
    nameX:null,
    nameY:null,
    rowHeight:null,
    signatureX:320,
    signatureY:410,
    signatureWidth:90,
    signatureHeight:20,
    confidence:1,
    resolved:true,
    reason:'Posición confirmada manualmente por el supervisor.',
  };
  const result=validateMandatorySignaturePlacement([manual],pages);
  assert.equal(result.ok,true,JSON.stringify(result.issues));
}

// Sin localización automática ni confirmación manual debe seguir bloqueándose.
{
  const unresolved:MandatoryWorkerAnchor={
    workerId:502,
    workerName:'NOMBRE SIN LOCALIZAR',
    dni:'',
    page:1,
    order:0,
    nameX:null,
    nameY:null,
    rowHeight:null,
    signatureX:null,
    signatureY:null,
    signatureWidth:90,
    signatureHeight:20,
    confidence:0,
    resolved:false,
    reason:'Pendiente de localizar.',
  };
  const result=validateMandatorySignaturePlacement([unresolved],pages);
  assert.equal(result.ok,false);
  assert(result.issues.some(issue=>issue.workerId===502&&issue.code==='UNRESOLVED'));
}

console.log('mandatory manual supervisor anchor regression tests: OK');


// Control de presencia con columna FIRMA: el nombre puede estar muy a la izquierda,
// pero la firma se coloca en la columna fija del documento conservando exactamente su fila.
{
  const signatureColumnX=455;
  const centers=[700,675,650];
  const boxes=centers.map((center,i)=>computeSignatureBoxFromDetectedName({
    pageWidth:595,
    pageHeight:842,
    nameX:55,
    nameY:center-5,
    nameRightX:210+(i*8),
    nameHeight:10,
    signatureColumnX,
    upperWorkerCenterY:i===0?null:centers[i-1],
    lowerWorkerCenterY:i===centers.length-1?null:centers[i+1],
  }));
  boxes.forEach((box,i)=>{
    assert(box);
    assert(box.x>=signatureColumnX,'La firma debe comenzar dentro de la columna FIRMA.');
    assert(Math.abs((box.y+box.height/2)-centers[i])<0.001,'La firma debe conservar el centro vertical de su propia fila.');
  });
  assert(boxes[0].y>boxes[1].y&&boxes[1].y>boxes[2].y,'Cada firma debe mantener el orden vertical de los trabajadores.');
}

console.log('mandatory signature column-row anchoring regression tests: OK');
