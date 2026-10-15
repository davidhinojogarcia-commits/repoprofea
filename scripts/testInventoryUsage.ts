import assert from 'node:assert/strict';
import {inventoryIsInUse, inventorySupervisorColor, inventorySupervisors, inventoryUsage, filterInventoryItems} from '../src/lib/inventoryUsage';
import type {InventoryItem, InventoryParkShare} from '../src/services/inventoryService';
const shares = [
 {userId:'user-2',displayName:'Lucía Núñez',status:'accepted',isOwner:false},
 {userId:'user-1',displayName:'Álvaro Prueba',status:'accepted',isOwner:true},
 {userId:'user-3',displayName:'Pendiente',status:'pending',isOwner:false},
] as InventoryParkShare[];
const items = [
 {id:'1',nombre:'Martillo eléctrico',codigo:'M1',estado:'Asignada a obra',responsableActual:'user-1',ubicacionActual:'Obra A'},
 {id:'2',nombre:'Hormigonera',codigo:'H1',estado:'En traslado',responsableActual:'user-2',ubicacionActual:'Obra B'},
 {id:'3',nombre:'Taladro',codigo:'T1',estado:'Disponible',responsableActual:'user-1'},
 {id:'4',nombre:'Radial',codigo:'R1',estado:'Asignada a obra',responsableActual:null},
 {id:'5',nombre:'Compresor',codigo:'C1',estado:'Averiada',responsableActual:'user-2'},
] as InventoryItem[];
const filter=(overrides={})=>filterInventoryItems(items,shares,{search:'',category:'',status:'',supervisorId:'',...overrides});
assert(inventoryIsInUse('Asignada a obra'));assert(inventoryIsInUse(' en USO '));assert(!inventoryIsInUse('Averiada'));
assert.notEqual(inventorySupervisorColor('user-1',shares),inventorySupervisorColor('user-2',shares));
assert.equal(inventorySupervisorColor('user-1',shares),inventorySupervisorColor('user-1',shares.slice().reverse()));
assert.equal(inventorySupervisors(shares)[0].userId,'user-1');assert.equal(inventorySupervisors(shares).length,2);
assert.equal(inventoryUsage(items[2],shares).responsible,null,'available equipment never marked as used');
assert.equal(inventoryUsage(items[3],shares).responsibleName,'Responsable pendiente de confirmar');
assert.equal(inventoryUsage({...items[0],responsableActual:'foreign-user'},shares).responsible,null);
assert.deepEqual(filter({search:'nunez'}).map(i=>i.id),['2'],'accent-insensitive responsible search');
assert.deepEqual(filter({search:'en uso'}).map(i=>i.id),['1','2','4']);
assert.deepEqual(filter({supervisorId:'user-1'}).map(i=>i.id),['1']);
assert.deepEqual(filter({supervisorId:'user-2'}).map(i=>i.id),['2']);
assert.deepEqual(filter({supervisorId:'__UNASSIGNED__'}).map(i=>i.id),['4']);
assert.equal(filter({supervisorId:'user-2',search:'Obra A'}).length,0);
assert.equal(filter({status:'__IN_USE__'}).length,3);assert.equal(filter({status:'Disponible'}).length,1);
console.log('PASS usage semantics, separate stable colors, no guessed responsibility, accent-insensitive search, user/status/location filters.');
