# Consumo y recuperación — 25/10/2026

## Incidente demostrado

Main de partida: `25345d818502d65f32d7d9e0152ec91fc0dd52c9`.
Proyecto Supabase: `oanurwzoymkmwmxoyzqi` (ACTIVE_HEALTHY, PostgreSQL 17).
Los logs consultados el 25/10 a las 07:24 UTC contienen más de 6,1 millones
de errores 40001 en las últimas 24 h. La agrupación por contexto identifica
`public.sae_finalize_report_version(uuid,jsonb)` en todos ellos; PostgREST
reporta versión 14.18. No equivalen a 6,1 millones de peticiones del navegador.

La función lanza 40001 cuando la instantánea enviada no coincide con los
candidatos actuales. PostgREST 14 reintenta indefinidamente ese SQLSTATE:
https://supabase.com/kb/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions

La migración `20261025072447_sae_business_conflict_http409.sql` sustituye solo
los SQLSTATE de conflictos funcionales por PT409 en cinco funciones SAE
existentes. Se conservan mensajes, locks, comprobaciones, transacciones,
ACLs, propietarios, RLS y versiones archivadas. No cambia filas ni índices.
No se desactiva el registro de errores. Los errores de serialización reales
de PostgreSQL mantienen su comportamiento.

## Validación y recuperación

Las regresiones PostgreSQL/PGlite de quincenas, coincidencias mensuales y
periodos manuales aplican la migración a las funciones reales y comprueban
que sus definiciones solo cambian en el código de error, que ACL/propietario/
SECURITY DEFINER/search_path son idénticos y que reaplicarla es inocuo.
El rechazo de una finalización obsoleta exige ahora `PT409`; siguen pasando
RLS, rollback, idempotencia, códigos, versiones y aislamiento.

Es compatible con el frontend actual: se conserva el mensaje de conflicto.
Aplicar tras CI y antes de integrar/publicar. Si falla, la transacción de
migración revierte por completo. Ante una regresión, restaurar la definición
anterior cambiando únicamente PT409 por P0001 (respuesta 400), nunca restaurar
40001, que reintroduciría el bucle. No es necesario tocar datos de negocio.
Verificar después definiciones y logs en ventanas UTC explícitas. Una petición
antigua ya ejecutándose podría necesitar intervención específica si no cesa;
no reiniciar ni terminar sesiones indiscriminadamente.

## Medidas de partida y límites

TypeScript y `test:low-consumption`, `test:consumption-cache`,
`test:consumption-phase2` pasan antes de cambios. Ya existen caché por usuario,
coalescencia de lecturas, invalidación entre pestañas, revisiones ligeras de
documentos y franjas de refresco. No se reemplazan.

Los logs de PostgreSQL tienen log_min_messages=warning, log_duration=off y
log_min_duration_statement=-1: el volumen dominante es un fallo repetido,
no trazas de consultas activadas por la aplicación. Los avisos del asesor
incluyen claves foráneas sin índice y tablas internas sin políticas; esto no
justifica añadir índices indiscriminados ni abrir políticas de tablas que
se usan mediante RPC. Requieren estudiar los patrones concretos.

Vercel Hobby no permitió consultar la ventana de 1 h; la de 30 min devolvió
cero grupos de logs. Esto no acredita ausencia histórica de errores.
No hay aún comparación de tiempos de pantallas con datos reales, transferencia
global ni validación física iPad. La saturación puede contribuir al acceso
lento, pero no demuestra por sí sola la causa del aviso concreto del iPad.

PR #300 (Groq) y #298 (offline portal) permanecen excluidos por sus bloqueos.
La CI de Groq usa respuestas simuladas; falta credencial utilizable, comprobar
cuenta Free/controles de datos y generación escrita/dictada real con revisión,
aplicación, guardado y reapertura. No se afirma que la IA esté terminada.
