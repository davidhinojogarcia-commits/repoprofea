# Uso de herramientas y maquinaria por supervisor

Fecha: 15/10/2026. Rama `feat/inventory-usage-identification`, basada en producción `5fbece7`.

## Comportamiento

- El propietario del parque aparece en azul y el segundo supervisor aceptado en ámbar. La asignación de colores es común a leyenda, listado, tarjetas, resumen y trazabilidad, y no depende del orden de la respuesta del servidor. Ambos colores van acompañados de nombres y etiquetas; no se usa únicamente el color.
- Los equipos asignados a obra, en traslado o con estado heredado «En uso» muestran «En uso» y el nombre del responsable. Los disponibles, averiados, en reparación o fuera de servicio no se presentan como usados.
- En cada nuevo movimiento se elige quién está usando el equipo entre las personas con acceso aceptado al parque. El autor que registra el movimiento se conserva por separado.
- La leyenda muestra los equipos en uso de cada supervisor y permite filtrarlos. La búsqueda incluye responsable, ubicación, estado, nombre e identificadores y no distingue tildes. El cambio de parque limpia el filtro de responsable; también se limpia si ese usuario deja de tener acceso aceptado.
- Un equipo en uso sin responsable verificable muestra «Responsable pendiente de confirmar», sin asignarlo por suposición al propietario o al usuario conectado.
- Mejoras móviles: pestañas sin palabras partidas, indicadores en dos columnas y etiquetas visibles en modos claro y oscuro. Los diálogos del inventario declaran su función accesible.

## Errores corregidos y persistencia

El color anterior se obtenía con un hash y podía coincidir entre usuarios. Registrar movimientos atribuía siempre el equipo al autor, aunque estuviera anotando el uso del compañero; la vista offline también atribuía al editor las correcciones. Ahora se guarda un `responsable_id` en cada nuevo movimiento y se actualiza el equipo en la misma transacción. Correcciones y eliminaciones restauran el responsable del movimiento vigente, sin confundirlo con el editor. Cuando ya no tiene acceso aceptado, se muestra como pendiente de confirmar.

La nueva RPC valida sesión, permisos de escritura en ese parque, acceso aceptado del responsable, destino, estado y equipo activo. Bloquea el equipo durante la operación. Reutiliza el identificador del movimiento en los reintentos y rechaza su reutilización con datos diferentes. Un reintento antiguo no deshace una cesión posterior. Se mantienen las llamadas antiguas para clientes y colas offline previas.

El registro y las correcciones usan el mismo orden de bloqueo por equipo. La proyección offline conserva al usuario seleccionado; corregir un movimiento antiguo ya no sustituye el estado actual. Las fotos de un registro se reutilizan si falla el guardado y se reintenta con los mismos archivos.

## Pruebas ejecutadas

| Comprobación | Resultado |
| --- | --- |
| `npm run test:inventory-usage` | Aprobada: semántica de estados y colores, búsqueda y filtros; SQL real ejecutado en PostgreSQL embebido PGlite; servicio con transporte simulado; sección React completa en JSDOM. |
| SQL y permisos | Separación autor/usuario, traspaso entre supervisores, devolución, avería, corrección de historial, eliminación/restauración, auditoría, reintentos idempotentes, responsable pendiente/ajeno/revocado, denegación anónima, RLS entre parques, equipos de baja y compatibilidad con RPC antigua. Migración ejecutada dos veces sin reescribir equipos existentes. |
| React | Persistencia simulada al remontar, responsable explícito, selector solo con miembros aceptados, guardar lento, doble pulsación, error visible y reintento con mismo ID, una subida de foto, cambio de parque, devolución y posterior salida. |
| `npm run test:inventory-usage-browser` | Aprobada en Chromium Headless 141, a 390/820/1440 px, en claro y oscuro; componente completo con CSS de la aplicación, colores distintos, nombres, búsqueda/filtro, selector y guardado. Sin errores de página ni desbordamiento horizontal de la página. |
| Inspección visual | Capturas sintéticas de móvil en claro y escritorio en oscuro revisadas; se detectaron y corrigieron las pestañas partidas. No contienen documentos ni datos de trabajadores. |
| `npm run test:inventory-invitations` | Aprobada: creación, enlace, entrega simulada, aceptación y rechazo; permisos y persistencia de invitaciones. |
| `npm run test:low-consumption` | Aprobada: deduplicación, aislamiento, límites, actualización y limpieza de listeners del dashboard. |
| `npm run lint`, `npm run build`, `git diff --check` | Aprobadas. Se conserva la advertencia de Vite sobre paquetes opcionales de más de 900 kB. |

## Consumo y límites

En pruebas, buscar y filtrar hizo cero llamadas adicionales. Dos envíos simultáneos desde el formulario hicieron una sola petición; el reintento de un registro con foto reutilizó una subida. No se añade polling, suscripciones, caché entre usuarios ni dependencias.

La consulta de seguridad de Supabase se realizó como referencia sobre producción, sin modificarla. Devuelve avisos previos de funciones `SECURITY DEFINER` accesibles por roles, `search_path` de otra función y configuración de Auth; no demuestra que la migración nueva esté validada por el asesor en producción. Las RPC de inventario requieren autenticación y membresía; las nuevas pruebas verifican denegación a `anon` y a usuarios de otros parques. Referencia del [aviso sobre funciones privilegiadas](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable).

Pendiente de publicación: aplicar `20261015095243_inventory_usage_responsibility.sql` antes del frontend. Es aditiva y no rellena ni modifica movimientos históricos. No se ha aplicado a producción. `supabase migration list --local` no pudo conectarse a un servidor Supabase local en el puerto 54322; las comprobaciones de migración y RPC se ejecutaron en PGlite. No se ha probado un despliegue completo de Supabase ni concurrencia entre conexiones reales independientes.

Las pruebas de navegador usan datos y transporte simulados. Falta la prueba con las dos cuentas reales y dispositivos físicos (iPhone/Safari, Android e iPad). Las pantallas de documentos, PDF y firmas no se han modificado. La identificación nueva no se incorpora al informe PDF existente en este cambio.

Preparado para revisión, sin fusionar ni publicar en producción. El despliegue automático está deshabilitado en esta rama.
