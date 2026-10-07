# Reducción de consumo de GestiónProfea

Problema: el panel de documentación de encargados descargaba cinco colecciones completas cada cinco segundos, incluyendo snapshots históricos y firmas, y validaba remotamente el usuario en cada refresco.

Cambios:
- Comprobaciones de revisiones cada 60 segundos, únicamente con pantalla visible y conexión disponible. Solo se recarga la colección que cambió; se detectan también borrados.
- Historial con proyección de los campos mostrados, sin descargar snapshots completos ni imágenes de firmas. No se alteran las copias almacenadas.
- Usuario recuperado de la sesión del SDK para estas lecturas; autorización y RLS siguen en el servidor.
- Comprobación de correo cada cinco minutos, sin solapamientos y con el estado actual de documentos. Importación manual y actualización posterior a guardar siguen disponibles.
- Coalescencia de GET simultáneos, separada por usuario, ruta y cabeceras, sin caché de respuestas antiguas y sin agrupar escrituras.
- HTTP 402 detiene nuevas peticiones REST/RPC de la sesión hasta recargar la aplicación; HTTP 429 aplica una pausa de un minuto. El SDK de autenticación y Storage siguen sus propios mecanismos.
- Suscripciones al Directorio y Papelera evitan lecturas simultáneas, suspenden recargas ocultas y no reintentan inmediatamente errores de autorización/cuota.

Validación reproducible:
```
npm run test:low-consumption
npm run lint
npm run build
node scripts/testMandatoryMissingWorkerRecovery.mjs
node --import tsx scripts/testMandatoryTraceabilityV2.ts
node --import tsx scripts/testMandatorySignatureAnchoring.ts
node --import tsx scripts/testGlobalModalStack.ts
```

Las pruebas de datos verifican revisiones sin cambios, recarga selectiva, borrados externos, conservación de firmas, aislamiento por usuario, deduplicación y parada por cuota. Las pruebas de React montan el panel con dependencias simuladas y verifican pausa de pestaña oculta, reanudación, botón Actualizar, restricción y limpieza de temporizadores. No equivalen a una prueba de firma completa con usuarios de producción.

Límites: la primera carga y los datos modificados todavía incluyen el contenido necesario para las operaciones actuales del panel, dentro de sus límites de consulta existentes. No hay paginación nueva ni migración de firmas a Storage. La reducción diaria real debe medirse tras desplegar; estos cambios no restituyen la cuota ya consumida. Se preservan los registros de auditoría y la trazabilidad.

La rama local/reduce-supabase-consumption-20261007 tiene desactivados los despliegues automáticos de Vercel. Fusión y publicación pendientes de validación del usuario.

## Segunda revisión: peticiones por trabajador y configuración

La primera fase se fusionó en PR #222 y está publicada en producción (commit `10ba2f47e94359f1fad2a2a34ebaa4a35630ef0e`). Esta segunda fase se prepara por separado para validación del usuario antes de fusionar y publicar.

Los tres renderizadores del Directorio ya reciben `Person.ownerId`, hidratado desde `trabajadores.owner_id`, pero no lo pasaban al botón Compartir. Cada botón ejecutaba una comprobación remota de usuario y una consulta de propietario al montarse. El propietario conocido ahora se reutiliza; si falta, permanece la consulta de respaldo. El modal conserva las RPC de consultar, conceder y retirar permisos. Los datos locales deciden la visibilidad del botón, y Supabase continúa autorizando las operaciones mediante sus reglas y RPC.

Los servicios de SAE, escáner, reconocimiento médico, preferencias, auditoría y los controles de compartición usan la sesión del SDK para obtener la identidad. La renovación automática del token sigue habilitada. No se modifica la autenticación de las funciones de servidor ni se redefine `auth.getUser` globalmente. Se preservan los registros de auditoría de las operaciones.

Las cuatro lecturas de configuración solicitan solamente su rama JSON (`pdfPreferences`, `subcontratasPreferences`, `subcontratas` o `annualHiringPeriods`), conservando el filtro por usuario y las escrituras mediante `patch_user_settings`. El tamaño total de configuración observado en seis usuarios era 33.377 bytes: esta medida reduce transferencia, pero por sí sola no explica consumos de varios GB.

Validación adicional: `npm run test:consumption-phase2`. Monta el botón real y comprueba que 100 trabajadores con propietario conocido no necesitan consultas de propietario ni peticiones remotas de identidad. Comprueba también el respaldo cuando falta el propietario, ocultación para otros propietarios, RPC de compartir/retirar, lectura y guardado parcial de preferencias, aislamiento por usuario, ausencia de sesión, conservación de auditoría y guardado médico. Las pruebas usan transporte simulado: no acreditan ahorro diario ni sustituyen la validación funcional del usuario en Supabase.

También pasan TypeScript, compilación, las pruebas de bajo consumo de la fase 1, recuperación de trabajador ausente y anclaje de firmas. La rama de segunda fase tiene desactivados los despliegues automáticos de Vercel.

El consumo de `Logs Ingest` incluye los registros automáticos de API, Auth, Postgres, Realtime y otros servicios; no equivale al tamaño de `audit_logs` ni al volumen de fichas almacenadas. Reducir peticiones evita actividad que genera esos registros. PostgreSQL ya tenía una configuración poco verbosa: declaraciones DDL, sin registro de cada consulta ni de conexiones, mensajes desde warning. No se apaga la auditoría ni se borran registros para intentar reducir el contador de ingestión.

Para confirmar el ahorro real después de publicar, comparar al menos 48–72 horas de incrementos diarios, con actividad y usuarios similares, tanto en Logs Ingest como en Egress y número de peticiones. El acumulado mensual no desciende al aplicar una corrección, y no puede garantizarse un consumo mínimo fijo independiente del uso.

Referencia: https://supabase.com/docs/guides/platform/manage-your-usage/logs-ingest
