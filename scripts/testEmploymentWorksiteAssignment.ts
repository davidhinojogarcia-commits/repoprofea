import assert from 'node:assert/strict';
import { proposeEmploymentWorksite as propose } from '../src/lib/employmentWorksiteAssignment';
const catalog=[{nombre:'Mejora de acerados',codigo:'11002GR'},{nombre:'Parque municipal',codigo:'11003-EE'}];
for(const text of ['CÓDIGO DE OBRA: 11002-GR','Código obra\n11002 GR','Referencia 11002GR']){
  assert.equal(propose(text,catalog).suggestedObra,catalog[0].nombre);
  assert.equal(propose(text,catalog).status,'pending');
}
assert.equal(propose('CÓDIGO DE OBRA 11003 EE',catalog).suggestedObra,catalog[1].nombre);
assert.equal(propose('CÓDIGO DE OBRA 11002',catalog).suggestedObra,catalog[0].nombre);
assert.equal(propose('OBRA: MEJORA DE ACERADOS',catalog).suggestedObra,catalog[0].nombre);
assert.equal(propose('NIF 11002 y fecha 2026',catalog).suggestedObra,'','unlabelled numbers are not worksite codes');
assert.equal(propose('CÓDIGO DE OBRA 11999GR',catalog).reason,'unknown-code');
assert.equal(propose('CÓDIGO DE OBRA 11002GR',[]).suggestedObra,'','no foreign/unknown worksite invented');
assert.equal(propose('11002GR 11003EE',catalog).reason,'ambiguous');
assert.equal(propose('11002GR 11999GR',catalog).suggestedObra,'','conflicting unknown code needs manual review');
assert.equal(propose('11002GR',[...catalog,{nombre:'Duplicada',codigo:'11002-GR'}]).reason,'ambiguous');
assert.equal(propose('Código obra 11002',[...catalog,{nombre:'Otro programa',codigo:'11002EE'}]).reason,'ambiguous');
assert.equal(propose('Referencia 11002GR',[{nombre:'11002 GR - Acerados'}]).suggestedObra,'11002 GR - Acerados');
assert.equal(propose('Código obra 11OO2GR',catalog).suggestedObra,'','OCR ambiguity is not silently corrected');
console.log('PASS: exact worksite codes, labelled numbers, accents/separators, unique match, conflicts, OCR uncertainty and no guessing.');

for (const invalid of ['11002ER', '11002O', '11002GR7', '11002-GR7', '11002 ER', '11002 ERRORES', '11002GRXYZ', '11002GR 7', '11002GR/7', '11002GR.7']) {
  const proposal = propose('Código de obra: ' + invalid, catalog);
  assert.equal(proposal.suggestedObra, '', invalid + ' must not propose a numeric-prefix match');
  assert.equal(proposal.status, 'pending');
}
for (const text of ['Código de obra: 11002\nDATOS DEL TRABAJADOR', 'Código de obra: 11002', 'Código de obra:\n11002 GR']) {
  assert.equal(propose(text, catalog).suggestedObra, catalog[0].nombre, 'a complete isolated code remains valid');
}
assert.equal(propose('Referencia 11002GR\nCódigo de obra: 11002ER', catalog).suggestedObra, '', 'a valid reference cannot override an unknown labelled code');
assert.equal(propose('OBRA: MEJORA DE ACERADOS\nCódigo de obra: 11002ER', catalog).suggestedObra, '', 'a label cannot override a doubtful code');
console.log('PASS: complete doubtful tokens stay pending, isolated numbers and valid suffixes remain supported.');
