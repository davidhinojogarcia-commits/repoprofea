# Periodo manual del informe SAE

Cada tarjeta de informe permite añadir o editar su periodo: primera quincena, segunda quincena o mensual. El mes y el año siguen siendo los de su solicitud de mano de obra. La selección manual prevalece sobre la detección, queda en el servidor incluso sin candidatos y se aplica a todos los candidatos del informe.

La RPC `sae_set_report_period` guarda metadatos y candidatos en una transacción, usa el bloqueo de propietario existente y comprueba una revisión para rechazar escrituras de sesiones obsoletas. Un trigger impide que un cliente anterior deshaga el periodo mediante una edición individual del candidato. Se conservan la leyenda, las versiones archivadas, los resultados y las posiciones de códigos; la reconciliación existente sigue gestionando propuestas y códigos automáticos.

Los informes finalizados deben reabrirse. Un cambio que afectaría a un trabajador registrado exige revertir previamente su contratación; no se modifican silenciosamente registros del directorio.

Validación reproducible:

- `npm run lint` y `npm run build`.
- `node scripts/testSaeReportPeriodSql.mjs`: periodo ausente y detectado, cambios repetidos, mensual, informe vacío, persistencia, revisión obsoleta, cliente anterior, contratación protegida, reapertura, archivo, RLS/ACL y rollback completo ante error.
- `node scripts/testSaeFortnightSql.mjs` y `node scripts/testSaeMonthlySql.mjs`: regresiones de códigos y coincidencias.
- `node scripts/testSaeFortnightBrowser.mjs` y `BROWSER_ENGINE=webkit node scripts/testSaeFortnightBrowser.mjs`: formulario con la aplicación y SQL reales en 390/820/1440 px, edición, guardado, recarga, cancelación y regresiones existentes. Autenticación y servicios externos simulados en el entorno de pruebas.

La CI incorpora el nuevo test SQL a `test:sae-fortnights`. Antes de publicar, aplicar `20261024201410_sae_report_manual_period.sql` y comprobar la versión desplegada. Los navegadores automatizados no acreditan dispositivos físicos ni acceso privado a producción.

Resultado local: TypeScript, build, los tres scripts SQL y Chromium correctos. WebKit no pudo arrancar por bibliotecas del sistema ausentes; la instalación de dependencias del entorno falló. Su ejecución queda pendiente en CI. No se ha aplicado la migración ni publicado en producción.
