# Asignación revisada a obra de contratos y prórrogas

Rama independiente `feat/employment-worksite-assignment`, basada en main `fc638f58a0dff674bad074201e2da6a44c210c21`. No depende del PR 260 ni modifica sus cambios de tinta. Sin publicación, migraciones, dependencias nuevas ni cambios de documentos históricos.

## Comportamiento

- La importación manual y Gmail consultan el catálogo de obras una vez por lote, conservando nombre y código. No se limitan a las obras que ya tengan documentos en pantalla.
- Reconocen códigos de 4-6 dígitos con GR/EE, admitiendo espacios y separadores. Un número sin sufijo sólo se considera código si figura bajo «Código [de] obra». También se permite la coincidencia exacta de un nombre etiquetado como obra.
- Se propone sólo una coincidencia única. Códigos desconocidos, múltiples, repetidos entre obras o dudosos quedan sin propuesta; no se corrigen caracteres OCR a ciegas ni se reconstruye el código a partir de campos de expediente/municipio.
- Cada contrato/prórroga nuevo queda en `__PENDING_WORKSITE__`, aunque haya una propuesta. La obra seleccionada en pantalla nunca sirve como asignación implícita. La propuesta se guarda en `details.worksiteAssignment` y el backend mantiene `NEEDS_WORKSITE_REVIEW`.
- La interfaz abre el grupo «Pendientes de asignación». En «Asignar obra» muestra código y propuesta; el supervisor puede elegir otra obra. Sin propuesta no se preselecciona la primera obra del catálogo.
- El selector carga obras propias con filtro por propietario, y la RPC existente valida otra vez propietario, pertenencia de la obra y estado pendiente. Confirmar clasifica el documento, pero no lo publica. Se conserva el envío manual posterior al portal y la revisión de identidad/firma.
- No hay operaciones sobre los bytes del PDF ni coordenadas de firma. La propuesta es sólo metadato. La corrección de la propuesta se hace antes de confirmar; no se habilita mover históricos ni documentos ya enviados entre obras.
- El guardado del selector bloquea doble pulsación y conserva la elección con mensaje de error si falla. El usuario puede reintentar. Una vez confirmada la obra, se selecciona su grupo en el panel.

## Pruebas locales

`npm run test:employment-worksites`: códigos y formatos, coincidencias únicas/ambiguas, números ajenos, OCR dudoso; importación por lote manual/Gmail en obras diferentes; ausencia de fuga desde la obra seleccionada; original conservado y una consulta de catálogo por lote; persistencia de propuesta en el servicio real con transporte simulado; componente React real con corrección manual, catálogo vacío/ajeno, doble pulsación y reintento.

`npm run test:employment-documents`: incluye nuevas comprobaciones PostgreSQL/PGlite del estado pendiente, bloqueo de envío antes de asignar, rechazo de otro propietario y obra ajena, confirmación persistida, bytes y geometría inalterados y ausencia de publicación automática. Mantiene las regresiones de contrato/prórroga, importación y firma.

También se ejecutan publicación, persistencia, clasificación anterior de Inicio/Control, bajo consumo, lint/TypeScript, compilación y diff-check. CI incorpora la nueva batería.

## Límites

No se ha probado este cambio con una cuenta real de producción ni en dispositivos físicos. Las pruebas UI usan DOM simulado y los RPC PostgreSQL local; no equivalen a un recorrido real desplegado. Un escaneado necesita que el OCR existente lea el código: si no lo consigue, queda para asignación manual. No se han aplicado migraciones ni hecho escrituras en Supabase de producción.

El catálogo se limita actualmente a 1000 obras por importación/selector. Los contratos existentes no se reclasifican automáticamente. La publicación requiere autorización expresa del usuario.

## Corrección posterior a la revisión del 15/10/2026

Se elimina el reconocimiento parcial de códigos etiquetados: `11002ER`, `11002O`, `11002GR7` y variantes con separadores dejan de convertirse en `11002`. Se conserva el token completo, incluidos sufijos desconocidos, y los saltos de línea; un número realmente aislado y un sufijo válido siguen admitidos. Ante contenido adicional dudoso se prefiere revisión manual. Un código dudoso no se oculta por una referencia válida o por el nombre de la obra.

Nuevas regresiones: sufijos desconocidos/ilegibles, restos alfanuméricos y numéricos, código aislado con el siguiente campo en otra línea, y dos lotes consecutivos con obra seleccionada diferente y un contrato dudoso. Todos continúan pendientes de confirmación; no hay publicación implícita. Las fronteras de Gmail, persistencia y OCR simuladas en estas pruebas no acreditan servicios reales.

Se incorpora main `70d8f640af64525fba2ad99c6eb2ee28e5c3e0ec`, conservando las pruebas de inventario y las exclusiones de despliegue de ambas ramas. Sin cambios de esquema ni dependencias.

Validación local de la copia combinada: asignación por obra, contratos/prórrogas y SQL/PGlite, persistencia obligatoria, bajo consumo, publicación manual, clasificación previa, TypeScript y build correctos. El build mantiene el aviso de paquetes grandes. La batería Chromium con PDF generados pasa extracción, identidad, confirmación manual, fidelidad de firma y tamaños PC/tablet/móvil en claro/oscuro; no equivale a dispositivos físicos.

Los dos PDF privados aportados son escaneados: contrato de 3 páginas y prórroga de 1, sin texto nativo. Se han calculado hashes y tamaños sin modificar los originales. Un OCR externo de diagnóstico (inglés, distinto del OCR español de la app) no recuperó códigos fiables: no demuestra ni descarta el reconocimiento automático del producto. No se incorporan documentos privados, nombres ni contenido OCR al repositorio.

### Criterio de aceptación pendiente

- CI correcta sobre el nuevo commit y rama fusionable con main.
- Importación autenticada de contratos y prórrogas de al menos dos obras, en un mismo lote y en lotes consecutivos; ningún documento hereda la obra seleccionada ni la de un lote anterior.
- Código desconocido, múltiple o ilegible sin propuesta; confirmación manual obligatoria y bloqueo del envío antes de confirmar.
- Tras confirmar y recargar: obra correcta, bytes/hash del original, páginas, rotaciones y todas las coordenadas existentes idénticos. Los documentos anteriores no cambian y confirmar no publica.
- Verificar en cuenta real el recorrido importar → revisar obra → confirmar → revisar posición → envío explícito, y la experiencia en Android/iPhone/iPad.
- Autorización expresa antes de fusionar o publicar. Esta corrección no autoriza ninguna de esas acciones.

### Fallo de OCR inicial y PDF privados reales

La prueba adicional encontró que un fallo de OCR en la primera lectura descartaba el contrato antes de crear el pendiente. Se corrige en importación manual y Gmail: si el nombre identifica contrato/prórroga, se continúa con texto vacío y aviso de revisión; el analizador PDF sigue comprobando el archivo y sus páginas. Para otros tipos el error se conserva. No se deduce obra, identidad ni posición a partir del nombre del archivo.

La prueba Chromium adicional con los dos escaneados privados, forzando el OCR a fallar y simulando catálogo/persistencia, acredita importación pendiente, propuesta vacía, base64 y SHA-256 idénticos a los originales, 3/1 páginas y ausencia de trabajadores o posiciones inventadas. Se comprueba también que el original se puede visualizar sin personas reconocidas. Esto verifica el fallback del cliente con archivos reales, no el OCR español automático ni la persistencia de una cuenta real. La fidelidad de posiciones previamente guardadas sigue acreditada por SQL/PGlite y las regresiones, no por esos dos PDF sin posiciones asociadas.
