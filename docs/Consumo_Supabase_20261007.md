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
