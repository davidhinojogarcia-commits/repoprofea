# Automatización SAE entre las dos quincenas

## Situación inspeccionada

Base de la corrección: `main` en `3e5a96aa807606a2e2822e7bf314c25066538b4e` (PR #301 publicado).

La prueba física comunicada por el supervisor detectó que guardar 2001 sin «Registrar trabajador» no asignaba 2500. Se verificaron seis coincidencias reales de nombre, obra y mes: todas tenían código 2001 en origen, ninguna estaba registrada/vinculada y los seis destinos estaban sin código y sin bloqueo. La implementación original exigía contratación confirmada, según el requisito anterior.

**Requisito actualizado por el usuario:** guardar el resultado SAE basta para activar la regla. Registrar el trabajador es una operación independiente. Se reproduce el fallo original con seis pares sintéticos antes de aplicar la nueva migración y se comprueba que la actualización resuelve los seis sin crear fichas.

El catálogo real `SAE_RESULT_CODES`, en `src/services/saeService.ts`, contiene **2212 = Otros motivos** y **2500 = Ya estaba ocupado el puesto de trabajo**. El informe persiste ese catálogo en `detected_legend`. El servidor consulta el catálogo persistido y exige una única equivalencia numérica exacta para «Otros motivos»; si falta o está duplicada, conserva el resultado y muestra una incidencia. Los códigos de origen deben existir en su catálogo.

Durante la entrega inicial se inspeccionaron en producción metadatos de columnas, restricciones y triggers SAE. En el diagnóstico posterior se consultaron también estados y coincidencias agregadas de los candidatos afectados, sin modificar datos reales. El año está en `sae_needs.hiring_year`; la quincena y el mes del candidato no bastan por sí solos. No se consultaron ni modificaron trabajadores reales para probar la mejora.

## Cambios

| Archivo | Responsabilidad |
|---|---|
| `supabase/migrations/20261023195934_sae_code_selection_trigger.sql` | Nuevo disparador por código guardado, recuperación acotada de ediciones explícitas auditadas tras el lanzamiento; sustituye solo dos funciones privadas |
| `supabase/migrations/20261023140416_sae_fortnight_codes.sql` | Regla transaccional, activación sin backfill, aislamiento, permisos, bloqueo por supervisor, decisiones con versión y auditoría privada |
| `src/services/saeFortnightService.ts` | RPC de conciliación y decisiones |
| `src/services/saeService.ts` | Escrituras verificadas en línea y comparación de `updated_at` para rechazar ediciones obsoletas |
| `components/SaeSection.tsx` | Carga y actualización tras los eventos SAE, recuperación al volver a la pantalla, protección de operaciones repetidas y selección recuperable |
| `components/SaeCodeNotice.tsx` | Motivo discreto e incidencias; mantener/aplicar sin confirmación por Enter |
| `scripts/testSaeFortnightSql.mjs` | Pruebas ejecutables del SQL real en PostgreSQL/PGlite |
| `scripts/testSaeFortnightBrowser.mjs` | Pantalla SAE y servicios reales conectados mediante un adaptador de prueba a PostgreSQL/PGlite |
| `package.json`, `.github/workflows/ci.yml` | Suite reproducible SQL + Chromium + WebKit dentro de la CI completa existente |

## Reglas y protección

- Código guardado en la primera quincena, aunque no haya registro ni vínculo de trabajador: 2001 → 2500; otro código válido → código único de Otros motivos (2212 en el catálogo actual). Una preselección sin código no activa la regla. Registrar después no invalida una decisión de mantener el código manual.
- Comparación exacta del nombre normalizado con Unicode NFKD, sin marcas de acento, con espacios unificados y sin distinción de mayúsculas. Sin distancia de edición, abreviaturas ni coincidencias parciales.
- Misma obra canónica por código; solo si falta código se utiliza su nombre exacto normalizado. Se exige consistencia entre candidato, solicitud e informe, mismo propietario, mes y año. No se infieren equivalencias dudosas de obras.
- Más de una coincidencia en cualquiera de las quincenas o DNI incompatibles: incidencia, sin nueva asignación. No se cruzan informes de otro supervisor.
- No se crea un informe inexistente. La inserción posterior de los candidatos de segunda quincena activa la comprobación.
- Código manual previo, incluso vacío después de una edición: requiere mantener o aplicar. La decisión queda vinculada a la versión de origen/propuesta. Mantener o Escape conserva el código y evita reiterar el mismo aviso. Una decisión sobre una versión antigua falla sin sobrescribir.
- Se excluyen periodos mensuales, especiales y terceras quincenas. Un código de origen desconocido o configuración incompleta no genera códigos arbitrarios.
- Contratación de destino confirmada/vinculada, informe confirmado/finalizado, documento generado o solicitud cerrada: no se actualiza; se informa de que requiere rectificación. Un histórico previo también bloquea, salvo que el supervisor haya reabierto expresamente el borrador. Reabrir permite corregir ese borrador y crear una nueva versión, conservando las versiones archivadas.
- Retirada del código o desaparición del origen después de una asignación: se conserva el resultado y se muestra incidencia. No se borra ni reinventa silenciosamente un resultado anterior.
- La migración no modifica filas SAE existentes. Abrir una pareja histórica no activa un backfill. Una nueva asignación/corrección explícita del código de origen o una nueva importación de destino sí puede activar un borrador apto, nunca un informe emitido.
- Bloqueos de transacción por supervisor antes de las escrituras de candidatos, informes, solicitudes y documentos SAE; actualización condicional de candidatos por versión. Las asignaciones sin cambios no escriben de nuevo. La auditoría registra actor autenticado, servidor, códigos, candidatos e informes; no hay logs por trabajador.
- La finalización verifica en el servidor todos los identificadores y códigos del PDF antes de permitir su descarga. Comparte bloqueo con las asignaciones; rechaza una versión obsoleta y una repetición idéntica no duplica el archivo histórico. Las importaciones por lotes concilian una vez por solicitud afectada.
- El esquema `sae_private` no se expone al cliente: RLS sin políticas públicas y sin permisos de tablas ni funciones para `anon`/`authenticated`. La RPC pública valida sesión, permiso y propietario antes de acceder. Las funciones privilegiadas tienen `search_path` vacío y referencias calificadas.

## Reproducción

```sh
npm ci
npx playwright install --with-deps chromium webkit
npm run test:sae-fortnights
npm run test:sae-alignment
npm run test:employment-worksites
npm run test:calendar-dates
npm run test:visit-writing
npm run lint
npm run build
```

La suite SQL comprueba actualización desde la versión publicada, seis asignaciones por código sin registro, otro código sin registro, selección sin código, blanco manual, registro posterior sin repetir decisiones, no coincidencia, nombres/acentos, homónimos, DNI, obra/mes/año, periodos excluidos, edición manual anterior y posterior, mantener/aplicar, propuesta obsoleta y repetida, anulaciones, importación posterior, documentos emitidos, histórico, ACL/RLS y rollback íntegro ante fallo seguido de recuperación sin duplicación de asignaciones.

La suite de navegador usa la pantalla completa `SaeSection`, `saeService` y `saeFortnightService` reales, y ejecuta la migración real en PGlite. Autenticación, configuración anual, parser de importación y creación de la ficha se sustituyen por fronteras sintéticas. Comprueba primero selección de 2001 sin registro, segundo informe actualizado y persistido sin ninguna ficha creada; después registro y enlace, actualización del segundo informe, persistencia al recargar, modificación manual, mantener/aplicar/Escape/Enter, error y reintento, doble clic y actualización al recuperar el foco, en 390/820/1440 px. Genera un PDF representativo con pdf-lib, utiliza el generador SAE real, provoca una corrección concurrente, verifica que la versión obsoleta no se descarga y después extrae del PDF descargado el código confirmado. Una corrección posterior del origen no cambia ese informe finalizado. Carga Tailwind y el CSS de la aplicación y comprueba que la acción cabe en la pantalla. No acredita la importación de un PDF SAE institucional, Supabase remoto ni Safari/iOS físico.

## Evidencia de la entrega anterior (PR #301)

- SQL/PGlite: satisfactorio.
- Chromium 390/820/1440, pantalla + servicios + PostgreSQL local: satisfactorio; captura móvil inspeccionada.
- WebKit 390/820/1440, pantalla + servicios + PostgreSQL local: satisfactorio. El runtime local utilizó bibliotecas de navegador extraídas en un directorio temporal; no es Safari físico.
- TypeScript y build: satisfactorios. El build conserva las advertencias previas sobre tamaño de chunks y la referencia existente a `directorio-toolbar.css`.
- Regresiones de alineación SAE, asignación de obras en contratos, calendario en cinco zonas horarias y redacción de Actas (proveedor simulado): satisfactorias.
- CI remota: consultar el resultado del commit final en el PR. No sustituirlo por el de otro commit.
- La primera ejecución `39970390669` se detuvo al instalar navegadores: `ubuntu-latest` ejecutó Ubuntu 26.04 y Playwright 1.56.1 no lo admite. Se fija `ubuntu-24.04`; no se eliminan pruebas ni se actualiza Playwright fuera del alcance del cambio.

## Corrección por código guardado: validación y alcance

La nueva migración añade `code_applied_at` en el estado privado. Recupera únicamente ediciones manuales explícitas auditadas desde la activación del PR #301 cuyo último código coincide con el actual; no hace escrituras sobre candidatos o informes al migrar. La siguiente conciliación aplica la regla a borradores aptos. Los pares históricos sin eventos posteriores al lanzamiento siguen excluidos.

Las funciones mantienen permisos, aislamiento, bloqueo por supervisor, validación de catálogos/identidad y protección de documentos emitidos. Las decisiones se vinculan al origen y a los códigos, sin depender del registro de la ficha. Retirar el código de origen conserva el resultado de destino y muestra una incidencia para revisión.

La mano de obra cualificada se presenta como «Mensual» en la interfaz actual. Un informe sin primera/segunda quincena identificables sigue fuera de este cruce. La corrección no transforma un informe mensual en dos quincenas ni aplica cambios entre meses.

Pruebas locales de esta revisión: SQL/PGlite (incluida actualización desde la versión anterior con seis personas), Chromium y WebKit en 390/820/1440, TypeScript y build: satisfactorios. Alineación SAE y calendario en cinco zonas horarias: satisfactorios. WebKit local necesita bibliotecas extraídas y omite la comprobación del inventario de paquetes del host; se ejecuta el navegador real. Pendientes: CI del commit final y publicación de la nueva migración/interfaz. No atribuir a esta corrección la validación física de la entrega anterior. Consultar el PR para resultados definitivos.

## Corrección de informes reabiertos

El diagnóstico posterior encontró un informe de octubre con `__workflow_state=review`, una versión archivada y un candidato coincidente con 2001 en origen. El servidor lo mantenía bloqueado únicamente por existir esa versión. La pantalla permitía modificar manualmente el borrador, pero la automatización no podía recalcularlo. En la prueba de septiembre no había una coincidencia de segunda quincena; no procede cruzar meses ni inventar un candidato.

`20261023210429_sae_reopened_draft_codes.sql` alinea el bloqueo con la reapertura explícita. La RPC `sae_reopen_report` valida propietario y permiso, comparte el bloqueo con la finalización y actualiza solo el estado de trabajo antes de conciliar. Conserva el histórico del servidor sin recibir una copia posiblemente obsoleta del navegador. La pantalla refresca candidatos, propuestas e informes tras reabrir.

Se mantienen bloqueados los informes finalizados que no se hayan reabierto, las contrataciones de destino confirmadas, los documentos generados y las solicitudes cerradas. Las modificaciones manuales, incluido el borrado deliberado del código, requieren decisión antes de sustituirse. Las correcciones del borrador no cambian los códigos de las versiones archivadas.

Pruebas añadidas: reapertura repetida sin pérdida de histórico, permisos de otro supervisor y anónimo, recalculado automático del borrador, blanco manual con propuesta, versión 2 conservando la versión 1, protección de documentos emitidos y PDF archivado con su código original después de corregir el borrador. Consultar el PR para el resultado final de navegadores, CI y publicación.
