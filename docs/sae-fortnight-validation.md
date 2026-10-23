# Automatización SAE entre las dos quincenas

## Situación inspeccionada

Base: `main` en `7099001723dbfcbabfeb6c80f842eb89c93ce4e6`.
`SaeSection.registerWorker` crea la ficha y después confirma `sae_candidates.status = contratado`, con un trabajador vinculado. Marcar `2001`, preseleccionar o preparar un contrato no confirma la contratación.

El catálogo real `SAE_RESULT_CODES`, en `src/services/saeService.ts`, contiene **2212 = Otros motivos** y **2500 = Ya estaba ocupado el puesto de trabajo**. El informe persiste ese catálogo en `detected_legend`. El servidor consulta el catálogo persistido y exige una única equivalencia numérica exacta para «Otros motivos»; si falta o está duplicada, conserva el resultado y muestra una incidencia. Los códigos de origen deben existir en su catálogo.

Se inspeccionaron en producción únicamente metadatos de columnas, restricciones y triggers SAE. El año está en `sae_needs.hiring_year`; la quincena y el mes del candidato no bastan por sí solos. No se consultaron ni modificaron trabajadores reales para probar la mejora.

## Cambios

| Archivo | Responsabilidad |
|---|---|
| `supabase/migrations/20261023140416_sae_fortnight_codes.sql` | Regla transaccional, activación sin backfill, aislamiento, permisos, bloqueo por supervisor, decisiones con versión y auditoría privada |
| `src/services/saeFortnightService.ts` | RPC de conciliación y decisiones |
| `src/services/saeService.ts` | Escrituras verificadas en línea y comparación de `updated_at` para rechazar ediciones obsoletas |
| `components/SaeSection.tsx` | Carga y actualización tras los eventos SAE, recuperación al volver a la pantalla, protección de operaciones repetidas y selección recuperable |
| `components/SaeCodeNotice.tsx` | Motivo discreto e incidencias; mantener/aplicar sin confirmación por Enter |
| `scripts/testSaeFortnightSql.mjs` | Pruebas ejecutables del SQL real en PostgreSQL/PGlite |
| `scripts/testSaeFortnightBrowser.mjs` | Pantalla SAE y servicios reales conectados mediante un adaptador de prueba a PostgreSQL/PGlite |
| `package.json`, `.github/workflows/ci.yml` | Suite reproducible SQL + Chromium + WebKit dentro de la CI completa existente |

## Reglas y protección

- Primera quincena confirmada (`contratado` + vínculo de trabajador), código 2001: segunda quincena 2500. Cualquier otro código válido: código único de Otros motivos.
- Comparación exacta del nombre normalizado con Unicode NFKD, sin marcas de acento, con espacios unificados y sin distinción de mayúsculas. Sin distancia de edición, abreviaturas ni coincidencias parciales.
- Misma obra canónica por código; solo si falta código se utiliza su nombre exacto normalizado. Se exige consistencia entre candidato, solicitud e informe, mismo propietario, mes y año. No se infieren equivalencias dudosas de obras.
- Más de una coincidencia en cualquiera de las quincenas o DNI incompatibles: incidencia, sin nueva asignación. No se cruzan informes de otro supervisor.
- No se crea un informe inexistente. La inserción posterior de los candidatos de segunda quincena activa la comprobación.
- Código manual previo, incluso vacío después de una edición: requiere mantener o aplicar. La decisión queda vinculada a la versión de origen/propuesta. Mantener o Escape conserva el código y evita reiterar el mismo aviso. Una decisión sobre una versión antigua falla sin sobrescribir.
- Se excluyen periodos mensuales, especiales y terceras quincenas. Un código de origen desconocido o configuración incompleta no genera códigos arbitrarios.
- Contratación de destino confirmada/vinculada, informe confirmado/finalizado, cualquier versión finalizada previa, documento generado o solicitud cerrada: no se actualiza; se informa de que requiere rectificación.
- Anulación o desaparición del origen después de una asignación: se conserva el resultado y se muestra incidencia. No se borra ni reinventa silenciosamente un resultado anterior.
- La migración no modifica filas SAE existentes. Abrir una pareja histórica no activa un backfill. Una nueva confirmación/corrección explícita de origen o una nueva importación de destino sí puede activar un borrador apto, nunca un informe emitido.
- Bloqueos de transacción por supervisor antes de las escrituras de candidatos, informes, solicitudes y documentos SAE; actualización condicional de candidatos por versión. Las asignaciones sin cambios no escriben de nuevo. La auditoría registra actor autenticado, servidor, códigos, candidatos e informes; no hay logs por trabajador.
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

La suite SQL comprueba asignación, confirmación auténtica frente a selección, no coincidencia, nombres/acentos, homónimos, DNI, obra/mes/año, periodos excluidos, edición manual anterior y posterior, mantener/aplicar, propuesta obsoleta y repetida, anulaciones, importación posterior, documentos emitidos, histórico, ACL/RLS y rollback íntegro ante fallo seguido de recuperación sin duplicación de asignaciones.

La suite de navegador usa la pantalla completa `SaeSection`, `saeService` y `saeFortnightService` reales, y ejecuta la migración real en PGlite. Autenticación, configuración anual, parser de importación y creación de la ficha se sustituyen por fronteras sintéticas. Comprueba registro y enlace, actualización del segundo informe, persistencia al recargar, modificación manual, mantener/aplicar/Escape/Enter, error y reintento, doble clic y actualización al recuperar el foco, en 390/820/1440 px. Carga Tailwind y el CSS de la aplicación y comprueba que la acción cabe en la pantalla. No acredita importación de un PDF real, Supabase remoto ni Safari/iOS físico.

## Evidencia local y CI

- SQL/PGlite: satisfactorio.
- Chromium 390/820/1440, pantalla + servicios + PostgreSQL local: satisfactorio; captura móvil inspeccionada.
- WebKit 390/820/1440, pantalla + servicios + PostgreSQL local: satisfactorio. El runtime local utilizó bibliotecas de navegador extraídas en un directorio temporal; no es Safari físico.
- TypeScript y build: satisfactorios. El build conserva las advertencias previas sobre tamaño de chunks y la referencia existente a `directorio-toolbar.css`.
- Regresiones de alineación SAE, asignación de obras en contratos, calendario en cinco zonas horarias y redacción de Actas (proveedor simulado): satisfactorias.
- CI remota: consultar el resultado del commit final en el PR. No sustituirlo por el de otro commit.

## Pendientes y criterio de fusión/publicación

1. CI completa satisfactoria del SHA exacto propuesto.
2. Aplicar primero la migración en un entorno Supabase aislado autorizado y verificar REST/RPC con dos cuentas de supervisor y sesiones simultáneas. PGlite prueba SQL y ACL, pero no acredita PostgREST ni dos conexiones remotas concurrentes.
3. Probar un PDF SAE representativo, la ficha y el reconocimiento médico, el contrato/PDF final y la reapertura desde dos dispositivos, sin alterar datos oficiales. Las regresiones automatizadas existentes siguen ejecutándose en la CI.
4. Verificación física en iPhone/Safari, Android/Chrome e iPad/Safari. WebKit automatizado no equivale a esos dispositivos.
5. Revisión de seguridad de la migración en ese entorno (asesores de Supabase), especialmente el esquema privado, RPC y permisos del rol autenticado. No se ejecutan asesores locales del CLI porque requieren una instancia Supabase completa; se prueban los permisos efectivos en PGlite.
6. Autorización expresa antes de fusionar, migrar producción o publicar. Desplegar la aplicación **después** de la migración; la nueva pantalla requiere la RPC. No se han configurado secretos, aplicado migraciones remotas ni publicado producción.

La creación de una ficha y la confirmación SAE siguen siendo dos operaciones existentes. Se comprueba la respuesta de confirmación y se intenta compensar una creación rechazada solo si una lectura en línea demuestra que la ficha no quedó vinculada. Una pérdida total de conexión entre ambas operaciones requiere recuperar el estado del servidor; esta entrega no afirma atomicidad de todo el proceso de alta. La automatización de códigos, sus decisiones y su auditoría sí son transaccionales.

No aprobar publicación hasta resolver las comprobaciones de entorno aislado. Las incidencias de identidad/configuración o documentos emitidos requieren revisión del supervisor, no sustituciones forzadas.
