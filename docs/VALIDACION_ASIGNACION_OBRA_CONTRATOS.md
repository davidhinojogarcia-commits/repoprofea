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
