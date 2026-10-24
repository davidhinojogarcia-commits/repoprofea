# Control de contratación SAE por periodo

El resumen se sitúa inmediatamente antes de los trabajadores y permanece visible al desplazarse. Respeta la altura de la cabecera fija de la aplicación. Las filas muestran los previstos, contratados y faltantes de cada quincena de peones y de cada categoría mensual de oficiales. La fila correspondiente al informe seleccionado indica también su aportación.

El objetivo se obtiene de la solicitud y se comparte entre todos los informes de la misma solicitud, categoría y periodo; cambiar de informe no reinicia ni multiplica las necesidades. Una persona cuenta una vez en cada categoría y periodo, usando el nombre normalizado. No se suman los periodos como si fueran personas únicas del mes.

«Contratados*» cuenta el código 2001 («Contratará al candidato») y, para registros antiguos sin código, el estado Contratado. Es una cobertura de contratación prevista, no una certificación de contrato firmado. El detalle separa los contratados con registro y los pendientes de registrar. La mera asignación de quincena no cubre una vacante; códigos como 2500 o 2212 tampoco. Los excesos se muestran como «De más», sin saldos negativos. Las cantidades pendientes, los periodos desconocidos y las categorías ambiguas conservan un objetivo desconocido, con indicación para revisar la solicitud; no se inventan cantidades ni repartos entre quincenas.

El resumen es derivado de los registros existentes. No añade consultas, escrituras, tablas ni migraciones. Los cambios se reflejan mediante el estado existente del módulo; sus guardados y su recuperación de errores siguen siendo los del servicio SAE.

## Validación local

- TypeScript (`npm run lint`) y build de producción (`npm run build`).
- `node --import tsx scripts/testSaeHiringSummary.ts`: quincenas, oficiales mensuales, objetivos compartidos entre informes, deduplicación, exclusión de otras solicitudes, cambio y reversión de códigos, exceso, categoría/periodo desconocidos y ambigüedad de categorías/CN.
- `node scripts/testSaeHiringSummaryBrowser.mjs` y `BROWSER_ENGINE=webkit node scripts/testSaeHiringSummaryBrowser.mjs`: montaje real de SaeSection con servicios sintéticos, tamaños 390/820/1440 px, posición antes de los trabajadores, actualización con 2001, recarga, cambio de informe, fallo de guardado y recuperación, contratación mensual, exceso y reversión, aportación del informe, ausencia de desbordamiento horizontal, modo oscuro y posición sticky con cambio de altura de cabecera. En el entorno local, WebKit se ejecutó con un lanzador temporal para incluir las bibliotecas del sistema disponibles; CI usa la instalación estándar de Playwright.
- `node scripts/testSaeFortnightSql.mjs` y `node scripts/testSaeMonthlySql.mjs`: regresiones existentes PostgreSQL/PGlite correctas.
- `node scripts/testSaeFortnightBrowser.mjs`: regresión existente correcta en Chromium, incluida contratación, reapertura y PDF archivado y coincidencias mensuales.

Los nuevos tests están incorporados al flujo CI existente. Esta validación acredita los datos sintéticos y los navegadores automatizados; no acredita datos privados de producción ni dispositivos físicos. No se ha fusionado ni desplegado esta mejora.
