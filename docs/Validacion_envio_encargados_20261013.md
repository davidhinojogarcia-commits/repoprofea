# Envío al portal de encargados — validación 13/10/2026

## Causa comprobada

La consulta de producción confirmó un documento de Inicio/Control de presencia en estado `ASSIGNED`, con acceso activo de su obra, cuya fecha superaba los 62 días. La función `resolve_foreman_portal` lo excluía por `work_date >= current_date - 62`. El envío estaba guardado, pero el encargado no podía verlo.

## Corrección

- Ventana de confirmación con documento, obra, periodo y fecha de envío obtenida del servidor.
- Comprobación de persistencia sin aceptar caché ni respaldo sin conexión como prueba.
- Aviso específico si la obra carece de acceso activo o no puede comprobarse ese acceso.
- Fecha de envío visible en la ficha del supervisor después de recargar.
- Los documentos publicados pendientes de firma no caducan por la fecha del documento. Los cerrados mantienen un historial limitado y los recién finalizados siguen visibles aunque la fecha de obra sea antigua.
- El portal usa el estado principal del servidor por delante del estado secundario del documento.
- Botón Actualizar documentos, indicador de última consulta y explicación de los filtros que oculten documentos.
- Consulta nueva al recuperar visibilidad o conexión, limitada a una cada 30 segundos; sin sondeos periódicos nuevos.
- Protección frente a un doble toque en Enviar.

## Pruebas ejecutadas

| Prueba | Resultado |
| --- | --- |
| PostgreSQL/PGlite: reproducción del documento antiguo oculto y visibilidad tras la migración | Correcto |
| Migración repetida, token inválido, aislamiento por obra y supervisor | Correcto |
| Publicación explícita, retirada, reenvío, revocación selectiva, bloqueo si faltan firmas | Correcto |
| Interfaz React: confirmación, destino, fecha, doble toque, actualización y filtros | Correcto |
| Respuesta ambigua, fallo de envío, documento sin cambio, acceso ausente/inaccesible | Correcto |
| Caché: consulta RPC nueva y conservación de la caché habitual | Correcto |
| Guardado de trabajadores, coordenadas, trabajadores añadidos y verificación de red | Correcto |
| Detección de trabajadores y recuperación de trabajadores ausentes | Correcto |
| PDF original con ambas firmas solapadas; límites de página | Correcto |
| Capas de ventanas y contraste diurno/nocturno | Correcto |
| Consumo: consultas limitadas, aislamiento, cuota, horarios de mañana | Correcto |
| TypeScript y compilación de cliente/servidor | Correcto |

Comandos: `npm run test:foreman-publication`, `npm run test:consumption-cache`, `npm run test:mandatory-persistence`, `node --import tsx scripts/testMandatoryWorkerDetection.ts`, `node scripts/testMandatoryMissingWorkerRecovery.mjs`, `node --import tsx scripts/testGlobalModalStack.ts`, `node --import tsx scripts/testGlobalModalAudit.ts`, `node --import tsx scripts/testThemeContrast.ts`, `npm run test:low-consumption`, `npm run lint`, `npm run build`.

El lanzador CLI de tsx no pudo crear su canal IPC en este entorno. Las mismas pruebas se ejecutaron satisfactoriamente mediante `node --import tsx`.

## Alcance y publicación

La consulta de producción fue de diagnóstico. No se enviaron documentos ni se modificaron firmas o datos reales para probar. La regresión SQL se ejecutó en una base local aislada y la interfaz React con servicios simulados.

Falta aplicar `20261013071157_foreman_publication_receipt_visibility.sql` y publicar la versión revisada para que la corrección esté disponible en producción. Falta la comprobación final en iPhone/Safari real después de publicar; las pruebas automatizadas no sustituyen esa comprobación.

La rama `local/foreman-publication-receipt-20261013` tiene desactivados los despliegues automáticos en `vercel.json`.

La revisión de Supabase conserva los controles de token, propietario y obra del resolver existente. Sus avisos sobre funciones SECURITY DEFINER son anteriores a este cambio; este endpoint necesita acceso por token y conserva la validación antes de consultar datos. Referencia del aviso: https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable

## Organización por quincenas

Documentos de encargados se organiza por obra, mes y quincena. El periodo explícito importado tiene prioridad sobre la fecha del documento; si no hay quincena explícita se utiliza el día de una fecha válida del mismo mes. Si no se puede determinar, se conserva visible en Sin quincena. Todas las quincenas permite consultar ambas y cambiar de obra o mes restablece el filtro y la selección de borrado.

Regresión adicional: días 1/15/16/31, fecha inválida, año bisiesto, periodo explícito diferente de la fecha, ausencia de fecha, agrupación visual, aislamiento por obra y mes, filtro de quincena y recuperación de todos los documentos sin duplicados.
