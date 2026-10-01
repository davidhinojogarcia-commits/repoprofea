import assert from 'node:assert/strict';
import type { Person } from '../types';
import { relationPeriodRank, sortRelationWorkers, splitRelationWorkersByWork } from '../src/lib/relationExportOrdering';

const p = (id:number, obra:string, quincena:string, nombre:string): Person => ({
  id,
  fechaRegistro:'2026-10-01',
  supervisorResponsable:'',
  numOferta:'',
  obra,
  categoria:'',
  quincena,
  apellidosNombre:nombre,
  dni:String(id).padStart(8,'0')+'A',
  fechaNacimiento:'',
  periodoInicio:'2026-10-01',
  periodoFin:'2026-10-15',
  telefono:'',
  calzado:'',
  formacion:'No',
  lugarFormacion:'',
  citaDia:'',
  citaHora:'',
  sitioReconocimiento:'',
  documentacionCompleta:'No',
  observaciones:'',
  sincronizadoEnNube:false,
  necesitaReconocimiento:'No',
} as Person);

assert.equal(relationPeriodRank(p(1,'A','1ª OCTUBRE','A')),0);
assert.equal(relationPeriodRank(p(2,'A','PRIMERA QUINCENA OCTUBRE','B')),0);
assert.equal(relationPeriodRank(p(3,'A','2ª OCTUBRE','C')),1);
assert.equal(relationPeriodRank(p(4,'A','SEGUNDA QUINCENA OCTUBRE','D')),1);
assert.equal(relationPeriodRank(p(5,'A','MES OCTUBRE','E')),2);
assert.equal(relationPeriodRank(p(6,'A','MENSUAL OCTUBRE','F')),2);

const ordered=sortRelationWorkers([
  p(5,'11003 GR','MES OCTUBRE','ZETA'),
  p(3,'11003 GR','2ª OCTUBRE','BETA'),
  p(1,'11003 GR','1ª OCTUBRE','ALFA'),
  p(2,'11003 GR','1ª OCTUBRE','ABAD'),
]);
assert.deepEqual(ordered.map(x=>x.id),[2,1,3,5]);

const groups=splitRelationWorkersByWork([
  p(10,'11096 EE','2ª OCTUBRE','B'),
  p(11,'11003 GR','MES OCTUBRE','C'),
  p(12,'11003 GR','1ª OCTUBRE','A'),
  p(13,'11096 EE','1ª OCTUBRE','A'),
]);
assert.deepEqual(groups.map(g=>g.obra),['11003 GR','11096 EE']);
assert.deepEqual(groups[0].workers.map(x=>x.id),[12,11]);
assert.deepEqual(groups[1].workers.map(x=>x.id),[13,10]);

console.log('Worker relation export ordering regression passed.');
