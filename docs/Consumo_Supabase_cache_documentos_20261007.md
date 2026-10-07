# Optimización adicional de consumo — 7 de octubre de 2026

Implementada en la rama local `feat/consumption-cache-temporary-documents`, sobre la copia disponible del proyecto que incluye las dos fases anteriores y la retención diaria. No está publicada. GitHub devolvió errores internos inicialmente, pero volvió a responder durante la preparación. Se verificó que los archivos base modificados coinciden con main 3b493538ff14624ae0423da5209e45f193600be3 antes de subir la rama. Despliegues automáticos desactivados para esta rama.

## Cambios

- Caché en memoria de 15 segundos para trabajadores, obras, configuración y listados básicos de inventario. Separada por usuario/ruta/cabeceras, copias independientes para que editar una respuesta no contamine otra. Máximo 80 entradas, 4 MiB en conjunto y 2 MiB por respuesta. No se persiste esta caché nueva. Se omiten errores y respuestas demasiado grandes.
- Invalidación antes y después de escrituras REST, RPC y funciones, también en deshacer y sincronización offline. Cambio de sesión borra la caché. BroadcastChannel comunica invalidaciones entre pestañas cuando está disponible. Un resultado que empezó antes de invalidar no se vuelve a almacenar.
- Lecturas de permisos, documentos y firmas permanecen sin esta caché. Las suscripciones del Directorio fuerzan una lectura actual después de cambios remotos, reanudación o reintento. Copias de seguridad piden datos actuales. La opción `fresh: true` permite omitir la caché explícitamente.
- Panel de encargados: mantiene la comprobación ligera de revisiones y descarga solo las filas nuevas/modificadas, en lotes máximos de 100. Conserva orden, elimina de la vista los borrados y mantiene las firmas de las filas no modificadas. La actualización manual completa permanece disponible.
- Historial reversible: agrupa la lectura previa por identificadores en lotes de 100, en lugar de una consulta por registro. Conserva los datos necesarios para deshacer y evita una lectura anterior tomada de caché.
- Configuración del recurso preventivo de las obras: solicita solamente la rama JSON necesaria.
- Compresión sin pérdida en los generadores jsPDF de exportación, presencia, documentos de obra, inventario y documentos generados de encargados. No modifica el motor de superposición de firmas sobre originales importados.
- Descargas Excel y envío manual PDF/Excel liberan sus URL temporales del navegador a los 60 segundos. Esto libera memoria local, no devuelve cuota de Supabase. No borra la descarga del dispositivo ni el adjunto del destinatario.

## Documentos y logs

Las exportaciones habituales revisadas se construyen en el dispositivo y se comparten/descargan sin subir una copia del PDF a Supabase. Se mantienen así. Los documentos importados, firmados, sus versiones y la trazabilidad se conservan porque sustentan las funciones de consulta posterior y revisión. No se ejecutó ningún borrado documental ni se apagó auditoría.

Un PDF y un registro de log son elementos diferentes. Borrar un archivo o caducar auditoría no resta del contador mensual de transferencia ni de la ingestión de logs. Reducir peticiones y tamaño de respuestas previene consumo nuevo.

## Verificación

- TypeScript y compilación de producción: correctos.
- `npm run test:consumption-cache`: transporte simulado de la aplicación real; aislamiento por cuenta, reutilización, invalidez tras escritura/RPC/sesión, actualización remota del Directorio, memoria limitada, errores no almacenados e invalidación durante una lectura.
- El mismo test verifica 205 registros con tres consultas previas del historial, y compresión PDF con tamaño inferior al 70 % del ejemplo sin comprimir, manteniendo texto y coordenadas idénticos. Son ejemplos de prueba, no porcentajes garantizados para los documentos reales.
- `npm run test:low-consumption`: incluye un cambio de firma en una colección de 200 documentos que descarga una sola fila; un borrado no descarga contenido documental. Pasan también las pruebas React de pausa/reanudación, actualización manual, bloqueo por cuota y limpieza de temporizadores.
- `npm run test:consumption-phase2`: correcto; compartición, aislamiento, configuración parcial y guardado médico.
- Retención SQL, recuperación de trabajadores omitidos, trazabilidad V2 y anclaje de firmas: correctos.
- Consulta real en Supabase: tarea `gestionprofea-audit-retention` activa a las 03:20 UTC. PostgreSQL: conexiones/desconexiones desactivadas, registro de sentencias DDL, sin registro por duración de cada consulta. No fue necesario cambiar la base de datos.

## Límites y validación pendiente

Falta subir y revisar la rama, publicar con autorización del usuario y probar en producción cuando Supabase renueve la cuota. La fecha del ciclo facilitada es 8 de octubre de 2026; no se ha comprobado la hora exacta de desbloqueo.

La caché tiene un plazo breve para conservar frescura; respuestas grandes y las lecturas documentales quedan fuera. El ahorro agregado debe medirse en Usage por proyecto y servicio durante 48–72 horas con actividad comparable. Para pasar de 23,68 GB a menos de 5 GB haría falta aproximadamente un 79 % menos de transferencia con el mismo uso. No se garantiza el resultado antes de esa medición. No se han añadido sondeos frecuentes a Supabase para medirlo.

## Originales temporales: decisión aceptada por el usuario

El 7 de octubre el usuario aceptó eliminar originales al cerrar definitivamente, conservando el PDF firmado y reimportando el mismo original si necesita corregir. Se prepara la migración `20261007171146_temporary_imported_originals.sql`, aún sin aplicar en producción porque debe publicarse junto con el botón de reimportación.

La tarea privada diaria de las 03:30 UTC procesa hasta 100 originales por ejecución, solo de Inicio/Control de presencia revisados (`REVIEWED`, estado `reviewed`), sin corrección pendiente, con la última versión completa, todas las firmas requeridas, fidelidad aprobada y bytes/huella del PDF firmado comprobados. Descarta los bytes originales, conservando la huella, nombre y geometría necesarios para recuperar exactamente el mismo archivo. No elimina PDFs firmados, versiones ni firmas; registra un evento breve por descarte y limita su propio historial de Cron a siete días.

Mientras no se haya reimportado el archivo, un trigger rechaza cambios de estado para corregir antes de que las RPC borren el firmado vigente. El botón «Reimportar original» envía el archivo a una función SECURITY INVOKER que exige usuario propietario, bloqueo de fila y coincidencia SHA-256. Mantiene intacto el firmado y marca corrección pendiente para que Cron no vuelva a descartar el archivo recién recuperado. Después puede usarse «Devolver para corregir». Un PDF distinto se rechaza.

`npm run test:temporary-originals` ejecuta la migración en PGlite: descarte elegible, conservación de parciales/pendientes/corruptos/no verificados, idempotencia, conservación del firmado y sus versiones, bloqueo de devolución, reimportación correcta/incorrecta y de otra cuenta, permisos privados y tarea sin duplicados. El digest del test es un sustituto determinista; la producción usa pgcrypto SHA-256.

Una consulta de solo lectura sobre Supabase encontró un documento que cumple los criterios de descarte. No se ha borrado ningún original ni se ha aplicado la migración. La ejecución real y la interacción con usuarios reales quedan pendientes de publicación conjunta. Este descarte reduce almacenamiento y futuras descargas del original; no devuelve Egress ya consumido ni evita por sí solo agotar la cuota.
