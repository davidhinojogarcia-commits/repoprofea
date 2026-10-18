import assert from 'node:assert/strict';
import {visitForemanProfile} from '../src/lib/visitForeman';
const resources = {
  'Obra A': {recursoPreventivoNombre:' Encargado Apellido Uno ',recursoPreventivoCategoria:' Encargado de obra ',recursoPreventivoTelefono:' 600000001 '},
  'Obra B': {recursoPreventivoNombre:'Persona de otra obra',recursoPreventivoTelefono:'600000002'},
};
assert.deepEqual(visitForemanProfile({nombre:'Obra A'}, resources), {nombreApellidos:'Encargado Apellido Uno',cargo:'Encargado de obra',telefono:'600000001',email:''});
assert.equal(visitForemanProfile({nombre:'Obra'}, resources),null,'never associate by partial work name/code');
assert.equal(visitForemanProfile({nombre:'Obra desconocida'}, resources),null);
assert.equal(visitForemanProfile({nombre:''}, resources),null);
assert.equal(visitForemanProfile({nombre:'Obra A'}, {...resources,' obra a ':{recursoPreventivoNombre:'Otro'}}),null,'ambiguous configuration is not guessed');
assert.equal(visitForemanProfile({nombre:'Obra A'}, {'Obra A':{recursoPreventivoNombre:' '}}),null);
assert.equal(visitForemanProfile({nombre:'OBRA A'}, resources)?.telefono,'600000001');
console.log('PASS: exact configured work resource, name/category/phone, no email, missing and ambiguous work isolation.');
