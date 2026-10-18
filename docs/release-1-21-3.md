# GestionProfea 1.21.3 — publicación conjunta

Autorización del supervisor: 18/10/2026, «Fusiona y publica todo lo pendiente».

Se integran los PR abiertos #260, #266, #267, #270, #288 y #289 sobre main `49825ad79bea7b4535d57293bb151486f93cb8d5`. Los antiguos tenían conflictos con cambios posteriores. La rama de publicación conserva sus commits como padres y reúne el resultado resuelto en una única CI y una única publicación de producción.

## Resultado integrado

- Actas 3.1: puntos, anexos compactos privados, guardado automático, primer borrador sin códigos, firmas presenciales individuales y alternativa remota protegida, PDF definitivo/publicación en portal y distribución Gmail idempotente.
- Incidencias: reducción adaptativa local de fotos antes de adjuntarlas. Medición Chromium con imagen sintética: 13.625.221 bytes de entrada → 300.771 caracteres de data URL, inferior al límite persistido de 400.000 caracteres.
- Firmas: azul centralizado `#164B9B`, lienzo adaptable, proporciones en PDF, firma conservada tras fallo, bloqueo del doble guardado y comprobación posterior. Firmas del encargado permanecen separadas; exclusiones de contratos/prórrogas/presencia/inicios conservadas.
- Registro diario: solo se exportan fichas con entrada y salida firmadas. Los pendientes continúan guardados y accesibles desde Control horario; una firma ilegible produce error y detiene el PDF. Se conserva el ajuste proporcional de la imagen.
- Portal: «Control, inicios y contratos» en dos líneas, nombre accesible completo. Modales/confirmaciones por delante, scroll y Cancelar/Enter correctos; se mantienen las pruebas WebKit posteriores a los PR originales.
- Consumo: refrescos concurrentes agrupados; recursos PDF cerrados; logs saneados. Se mantiene el tratamiento posterior de errores Gmail con un registro mínimo de fallos inesperados, sin duplicar el log ni imprimir datos del proveedor.

## Resolución de conflictos

Se preservan competencias, firmas independientes, visor continuo/zoom, publicaciones, OAuth y pruebas de Actas posteriores a las ramas antiguas. `SIGNATURE_INK` y `SIGNATURE_INK_COLOR` apuntan al mismo valor para mantener compatibilidad. Las pruebas de jornada incluyen ambas mejoras de filtrado y proporción. Los stubs UI conservan las comprobaciones de firma/reintento e incorporan los nuevos casos de fichas incompletas; las pruebas usan el nuevo nombre del portal.

Las pruebas locales ejecutadas pasan en dominio, SQL PGlite, PDF, Gmail simulado, firmas, publicación de encargados, consumo y prevención. Chromium comprueba captura con ratón/touch/pen simulado, proporción, transparencia, guardado doble/fallo/reintento, documentos de varias páginas/rotaciones, PDF original y un recorrido completo de Actas 3.1. TypeScript/build pasan; la CI conjunta debe terminar antes de fusionar.

## Datos y migraciones

Se requieren `20261017160440_visit_minutes_mixed_signatures.sql` y `20261018085541_visit_minutes_points_assets.sql`, ya incluidas en #289. Aplicar transaccionalmente antes del código nuevo y comprobar tablas, funciones, permisos y bucket privado. No se borran actas, firmas, versiones ni originales. La reversión posterior a crear datos 3.1 debe conservar el esquema y los documentos; no reinstalar un backend que ignore puntos/referencias privadas.

## Límites de la validación

La CI incluye Chromium y WebKit. Los proveedores Gmail/Storage de los E2E son simulados: siguen pendientes el envío real desde el OAuth de la app y la recepción física. Las pruebas de dispositivos físicos iPhone/Android/iPad, HEIC auténtico, teclado y suspensión del SO siguen pendientes. El recolector automático seguro de temporales de Actas no forma parte de estos PR y permanece pendiente; las versiones definitivas no se eliminarán para simular ahorro. Ver `visit-minutes-3-1-validation.md` para el alcance y las métricas detalladas. Esta publicación autorizada no convierte esos pendientes en pruebas superadas.
