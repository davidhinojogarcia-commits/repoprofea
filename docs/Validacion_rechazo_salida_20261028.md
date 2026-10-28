# Evidencia de validación — Rechazo voluntario y Salida de obra

Fecha: 28/10/2026. Release preparado: 1.21.6.

## Comprobaciones ejecutadas

- `npm run lint`: TypeScript sin errores.
- `npm run build`: bundle Vite y servidor esbuild correctos.
- `npm run test:workforce-documents`: reglas, ambas variantes de rechazo, exclusión de tareas/riesgos sin cese, salidas médicas/otro motivo, regreso conocido/desconocido, duración, cruce de medianoche, fechas inválidas, doble firma obligatoria, conflicto de dos peticiones concurrentes, versión tras corregir, reintento después de commit con respuesta perdida, instantáneas y PDF inmutables, diligencia separada, anulación y acceso de supervisor al mismo registro. PGlite/PostgreSQL embebido, autenticación de prueba.
- Aislamiento por propietario/obra con ID 100 coincidente en dos propietarios, revocación, ACL/RLS, lista sin firmas, borrado del trabajador conservando documentos históricos y rechazo de nuevas firmas si deja de estar autorizado. Revalidación bajo bloqueo de trabajador en el commit.
- Navegador Chromium sobre ambos portales completos, a 390, 820 y 1440 px: botones/iconos y nombres accesibles, ambas firmas trazadas en canvas, finalización, previsualización, recarga, archivo común encargado/supervisor, diligencia, cancelación del compartir nativo simulada con AbortError y recuperación de pérdida real de respuesta HTTP. Handler real, servidor HTTP local y PostgreSQL embebido; autenticación y servicios previos del portal mediante fixtures.
- WebKit ejecutado con sus bibliotecas instaladas en el entorno de prueba. Se repite el mismo circuito; no se equipara con un iPhone/iPad físico. El lanzamiento necesita preservar la ruta de bibliotecas de este entorno, sin cambiar la aplicación.
- `npm run test:parts`, `npm run test:signature-quality`, `npm run test:foreman-publication` y `node scripts/testForemanPublicationUi.mjs`: regresiones superadas. Los avisos de ancho de tablas impresos por los generadores antiguos de prueba no son del PDF nuevo y no produjeron fallos de assertions.
- PDF: generación con datos sintéticos, renderizado Poppler y revisión visual de las páginas completas. Textos multilínea, continuaciones, firmas proporcionales, cabecera/logo, estado de borrador y paginación sin recortes. Se corrigió la restauración de tipografía tras un salto de página.
- PostgreSQL remoto real: `scripts/verifyWorkforceDocumentsPostgres.sql` ejecutado en el proyecto verificado `gestion-profea` (`oanurwzoymkmwmxoyzqi`, PostgreSQL 17.11), con rol service_role y datos sintéticos. Verifica commit, idempotencia, CAS, privilegios mínimos y conservación del PDF al añadir regreso; hace ROLLBACK de todas las escrituras sintéticas.
- Migraciones aplicadas y versionadas con los números efectivos de Supabase: `20261028063849`, `20261028064248`, `20261028064947`. Roles anon/authenticated sin acceso directo a tablas ni ejecución de la RPC. Service_role con SELECT/INSERT/UPDATE en registro y SELECT/INSERT en eventos, sin UPDATE de eventos.
- Asesor de seguridad comparado antes/después: sin nuevos avisos WARN por este módulo. Dos INFO de RLS sin políticas corresponden deliberadamente a las tablas privadas sin concesiones a clientes. Los avisos previos del proyecto quedan fuera de este cambio.

## Límites de la evidencia

No se ha realizado una firma de una persona real, una remisión SAE/SEPE ni una validación profesional del convenio o de las plantillas. No se han probado dispositivos físicos. La prueba PostgreSQL remota no se presenta como una sesión HTTP autenticada en producción; el circuito de navegador anterior usa HTTP local.

CI, fusión y despliegue deben quedar acreditados en el PR y su resultado de publicación; esta nota previa no sustituye su comprobación. La nota jurídica `Documentos_rechazo_salida_20261028.md` identifica las fuentes y las comprobaciones de contrato/régimen/conservación que corresponden a la entidad para cada caso real.
