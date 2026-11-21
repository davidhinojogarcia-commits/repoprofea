# Portal de encargados: persistencia, modo offline y gestión de cambios

Base revisada: `main` en `cfa9ec9770159006503f6c4e76d2cd87d8c7a717`.

## Cambios

- Borrador de trabajo en IndexedDB: pestaña, fecha, formularios, selecciones, documentos expandidos, filas editadas y pantalla de firma. Recuperación del PDF identificado y su desplazamiento. Los trazos terminados se conservan por documento, persona y modalidad.
- Almacén cifrado AES-GCM, con claves distintas para identificación y cifrado, separado por acceso del portal. No guarda el token dentro de IndexedDB ni introduce documentos privados en la caché pública de la PWA. No sustituye las protecciones del dispositivo ni protege frente a scripts ejecutados en la propia aplicación.
- Comprobación online del acceso antes de restaurar datos. Acceso offline limitado a 24 horas desde la verificación. Desvincular elimina los registros protegidos del acceso actual. Una revocación solo puede conocerse al recuperar la conexión.
- Descarga individual y secuencial de documentos, comprobación SHA-256, preparación del visor PDF y retirada de copias locales. Los PDF importados conservan sus bytes; los documentos operativos usan el generador existente.
- Firma local de documentos descargados y jornadas previamente preparadas con conexión. Las horas de una jornada deben coincidir con la preparación; los cambios exigen preparar de nuevo con conexión.
- Cola persistente con Web Locks, UUID por operación, reintento al volver a primer plano o reconectar, espera progresiva y botón manual. Solo se retira una operación tras confirmación del servidor. No se presupone ejecución del navegador en segundo plano.
- El servidor vuelve a comprobar acceso, obra, propietario, versión, plantilla y firmas anteriores. Recibos de idempotencia privados; el mismo UUID con contenido distinto se rechaza. Los bloqueos serializan también los circuitos heredados de firma y guardado.
- Una operación nunca intentada puede cancelarse; las operaciones con envío incierto se conservan para conciliación. No se presentan como recibidas por el supervisor.
- Apartado de documentos firmados agrupado por periodo documental, mes y quincena; búsqueda por trabajador/documento. Se conserva ver/compartir y actualizar. Los pendientes mantienen los selectores de periodo existentes.
- Solicitudes para rectificar, sustituir, anular o retirar documentos del circuito de documentos obligatorios. El supervisor consulta y resuelve; rectificar/sustituir exige importar primero una versión nueva sin firmas de la misma obra. El anterior se archiva y conserva sus PDF y firmas. Las solicitudes registran motivo, actor y tiempos de servidor.
- Actas publicadas: listado local y descarga explícita del PDF para consultar sin cobertura. Las órdenes siguen requiriendo conexión.

## Pruebas locales

```sh
npm ci
npm run lint
npm run build
npm run test:foreman-offline
npm run test:foreman-publication
npm run test:mandatory-persistence
npm run test:visit-minutes
npm run test:independent-foreman-browser
```

- TypeScript y build de producción: pasan. Advertencia de tamaño de bundles de PDF/hojas de cálculo presente; no es error de compilación.
- PostgreSQL mediante PGlite: nuevas funciones y políticas, alcance, recibos, rechazo de otra firma, modificación/retirada/revocación, permisos de aprobación, conservación del original, sustitución sin firmas y jornada preparada con entrada/salida/encargado.
- Navegador Chromium: IndexedDB real y Service Worker real; reapertura sin red, cifrado, separación de accesos, cola tras recarga, sincronización única, conflicto, caducidad y limpieza. El transporte RPC está simulado en esta prueba; no es una prueba contra producción.
- Navegador Chromium de la interfaz completa con servicios simulados: navegación, recuperación del documento expandido, cuatro exclusiones de firma del encargado, EPIs/formación/maquinaria, captura azul, control horario y visor/compartir PDF. Vista de 390/820/1440 px y temas claro/oscuro. Capturas inspeccionadas del visor móvil.
- Regresiones: publicación, geometrías/solapamiento, editor de posiciones, recibos, clasificación, plantilla del encargado, PDF original, persistencia y actas. Las pruebas de actas usan PostgreSQL y PDF reales, Gmail/Storage simulados; no se envían correos reales.
- CI incorpora `test:foreman-offline` después de instalar Chromium. El resultado remoto se debe comprobar en el PR; no equivale a los resultados locales.

## Pendiente antes de dar por cerrado todo el alcance

- Aplicar la migración en un entorno de pruebas y probar con una cuenta de encargado real. No se ha cambiado la base de producción ni se ha desplegado esta rama.
- Probar suspensión/cierre por el sistema, llamadas, WhatsApp, reinicio del móvil y almacenamiento escaso en iPhone/Safari, PWA iOS, Android/Chrome e iPad. Chromium emulado no acredita esos dispositivos.
- Validar de extremo a extremo los nuevos botones de descarga de documentos operativos, la preparación de jornadas, los borradores de trazo y la descarga de actas contra el backend real.
- Completar prueba simultánea de dos dispositivos y de caída de red después del commit del servidor. Los recibos y bloqueos tienen pruebas locales, pero no se ha reproducido todavía ese flujo completo en dos dispositivos reales.
- El nuevo circuito de solicitudes versionadas cubre documentos obligatorios/importados y operativos presentes en `foreman_mandatory_documents`. Las jornadas históricas y los documentos adicionales de `foreman_documents` mantienen sus circuitos existentes; no se ha unificado su rectificación versionada con este nuevo circuito.
- No se ha creado una descarga masiva del histórico ni una eliminación administrativa definitiva. La retirada operativa conserva originales.
- La apertura sin red exige haber cargado previamente la PWA y el visor. El navegador puede retirar almacenamiento bajo presión; el guardado local no equivale a copia de seguridad del servidor.
- Los conflictos bloqueados requieren revisión: no hay resolución automática ni borrado de firmas pendientes con envío incierto.

## Migración e integración

Archivo: `supabase/migrations/20261020155724_foreman_offline_signatures.sql`.

Es aditiva. Crea almacén privado de recibos, funciones de snapshot/sincronización y solicitudes con RLS. Mueve las implementaciones heredadas de firma/guardado a un esquema privado y conserva sus nombres públicos mediante envoltorios que bloquean las filas antes de delegar. Revisar y aplicar primero en pruebas, con copia de seguridad y un encargado autorizado; comprobar que los permisos directos al esquema privado siguen revocados.

No añadir claves de servicio al frontend. No registrar firmas, PDF, tokens ni cuerpos completos de las operaciones. La cola no utiliza sondeo periódico y las descargas masivas son explícitas y secuenciales. Los recibos deben mantenerse mientras puedan llegar reintentos; no purgarlos sin definir antes la retención de operaciones offline.

Esta entrega debe permanecer en borrador hasta superar la CI y la validación de integración indicada. No afirma cubrir íntegramente todos los criterios del prompt maestro ni estar publicada.
