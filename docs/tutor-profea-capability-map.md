# Tutor PROFEA — mapa de capacidades verificadas

Versión del agente: 2026.10.10.2

## Fuente de verdad
Este mapa incluye las correcciones realizadas sobre `main` aa7059cb7421847a0efff9a6197a385042882eb8. Las pruebas con respuestas simuladas no certifican funcionamiento de producción. Las conversaciones previas y la documentación funcional no se consideran prueba de una capacidad si no existe implementación en el repositorio.

## Estado previo encontrado
- `components/ProfeaTutor.tsx`: chat flotante, continuidad en `sessionStorage`, navegación por vista, estados de tarea y respaldo local.
- `server.ts /api/profea-tutor`: respuesta generativa restringida a ayuda de uso; no ejecuta herramientas y declara expresamente que no modifica registros.
- `src/lib/profeaTutorKnowledge.ts`: base de conocimiento manual y no versionada por módulo.
- `src/services/databaseService.ts`: CRUD real con sesión Supabase y RLS; las actualizaciones de trabajadores exigen confirmación de persistencia.
- `src/services/preventionService.ts`: usa RPCs de Prevención. `save_prevention_record` proporciona idempotencia, validación de obra, control de concurrencia y eventos de trazabilidad.
- `src/services/permissionService.ts`: permisos granulares de recursos.
- Documentos obligatorios: la trazabilidad V2 y las migraciones de septiembre/octubre conservan documento original, trabajadores importados y validaciones de firma. El Tutor no debe firmar ni finalizar saltándose esas reglas.

## Capacidades habilitadas en esta rama
1. Ayuda contextual y navegación.
2. Consulta de obras visibles.
3. Búsqueda de trabajadores visibles sin enviar DNI al modelo.
4. Consulta de pendientes de reconocimiento médico por obra/periodo.
5. Aplicación de filtros de obra/periodo en la interfaz.
6. Creación de incidencias preventivas mediante el RPC existente, con verificación de respuesta de base de datos.
7. Contexto explícito de pantalla, obra y periodo.
8. Autenticación del endpoint del tutor mediante el token de sesión del usuario.
9. Borrado masivo de documentos obligatorios por obra con cálculo previo del alcance, confirmación firmada de 10 minutos, revalidación de obra/conjunto y borrado mediante el RPC existente.

## Límites deliberados
- No SQL arbitrario.
- No service-role en navegador ni para decisiones del modelo.
- Los borrados de documentos obligatorios solo se ejecutan tras una confirmación exacta firmada; otros cambios masivos, envíos a terceros y cierres definitivos siguen deshabilitados.
- No firmas por trabajadores.
- No se envían DNI, IBAN, NUSS ni detalles médicos al proveedor del modelo.
- El contenido de documentos importados no forma parte del prompt de sistema y nunca se interpreta como instrucciones.

## Actualización del conocimiento
Cuando se añada o cambie un módulo:
1. Verificar ruta, componente y servicio real.
2. Añadir/actualizar el módulo en `profeaTutorKnowledge.ts`.
3. Actualizar el catálogo estructurado del agente.
4. Añadir prueba de política/validación.
5. No marcar una capacidad como operativa hasta comprobar persistencia o resultado real.


## Mapa de módulos auditados

| Área | Vista / fuente principal | Capacidades verificadas |
| --- | --- | --- |
| Menú y modo guiado | `App.tsx`, `components/Sidebar.tsx` | selección de vista, modo guiado/completo y filtros globales |
| Obras y periodos | `App.tsx`, `databaseService.ts`, tablas `obras` / `trabajadores` | lectura por RLS y filtros activos |
| Gestión SAE | `src/services/saeService.ts` | necesidades, informes, candidatos y cambios de estado |
| Directorio | `src/services/databaseService.ts` | CRUD de trabajadores con persistencia y RLS |
| Reconocimientos médicos | `src/services/medicalRecognitionService.ts`, `citasService.ts` | persistencia de reconocimiento y CRUD de citas |
| Prevención | `src/services/preventionService.ts`, migración `20261006074525_prevention_incidents_and_checks.sql` | incidencias, comprobaciones, seguimiento, idempotencia y concurrencia |
| CAE / subcontratas | tablas/servicios de subcontratas y políticas existentes | acceso por propietario/recursos compartidos |
| Documentación de obra | componentes de documentación y exportación existentes | generación y exportación según flujos actuales |
| Documentación de encargados | `src/services/foremanPortalService.ts` | preparación, revisión, devolución, corrección, PDF y borrado con tombstones |
| Portal de encargados | `foremanPortalService.ts`, migraciones 20260928–20261003 | acceso por token, documentos, asistencia y firma |
| Inicios / Control presencia | `mandatoryTraceabilityServiceV2.ts` y migraciones V2 | documento original, trabajadores importados, geometría de firma, firma, envío, revisión y PDF firmado |
| Registro horario | portal de encargados / asistencia | altas y firmas según periodo/obra autorizados |
| Maquinaria y herramientas | `src/services/inventoryService.ts` | parques, elementos, movimientos, mantenimientos, documentos y compartición |
| Configuración | `user_settings` y configuración de aplicación | obras guardadas, responsables y preferencias persistentes |

### Reglas especialmente verificadas en documentación obligatoria

- Los flujos V2 conservan el documento original y mantienen identidades documentales independientes del Directorio.
- La detección y firma trabajan con los trabajadores del documento importado; las migraciones de integridad impiden cerrar si faltan firmas/posiciones requeridas.
- La generación del PDF firmado y su fidelidad están cubiertas por regresiones existentes.
- Tutor PROFEA no dispone de herramienta para firmar por un trabajador.
- El borrado usa el RPC existente `delete_foreman_mandatory_documents`, que crea tombstones y está sujeto al usuario autenticado; el trigger de auditoría registra los borrados.

## Herramientas operativas de esta rama

| Herramienta | Tipo | Confirmación | Verificación |
| --- | --- | --- | --- |
| `list_works` | consulta | no | RLS / REST |
| `search_workers` | consulta | no | RLS / REST, datos personales minimizados |
| `list_pending_medical` | consulta | no | RLS / REST, sin diagnóstico médico |
| `list_mandatory_documents` | consulta | no | RLS de documentación |
| `prepare_inventory_fault_report` | consulta/preparación | no | RLS de inventario |
| `navigate` | interfaz | no | vista permitida |
| `apply_filters` | interfaz | no | filtros de cliente, sin persistencia |
| `create_prevention_incident` | escritura | orden explícita | RPC, idempotencia, eventos |
| `prepare_delete_mandatory_documents` | preparación sensible | sí, antes de borrar | calcula conjunto exacto, no modifica |

La ejecución posterior del borrado no se solicita al modelo: el servidor valida una confirmación firmada, usuario, caducidad, obra activa y que el conjunto de documentos no haya cambiado antes de llamar al RPC real.


## Correcciones del 10 de octubre

- Endpoint único compartido por Express local y api/profea-tutor.ts en Vercel.
- Planificador conectado a filtros etiquetados y registro de incidencias con datos explícitos. Si faltan campos ofrece un formulario en el chat, sin asignar fecha, categoría o prioridad por defecto.
- Registro de incidencia exige respuesta RPC válida y lectura posterior del mismo ID y datos; respuestas vacías, parciales o ausencia de fila producen error sin etiqueta Verificado.
- Consultas paginadas de trabajadores, obras, documentos e inventario, con orden estable y techo de seguridad explícito de 10.000 filas. JSON legado recuperado mediante proyecciones concretas, sin data completo.
- Pendientes médicos incluye vencimiento de fechas ISO y excluye aptos vigentes aunque conserven un indicador antiguo de necesidad; no interpreta limitaciones ni emite decisiones médicas.
- Confirmación de borrado vuelve a consultar todos los documentos visibles de la obra y rechaza adiciones o pérdidas respecto del conjunto preparado. El RPC recibe solo los IDs firmados; un documento añadido tras la última lectura no queda incluido. La comprobación de alcance y borrado son dos peticiones separadas.
- Se valida perfil activo; navegación a Administración exige rol admin. RLS/RPC siguen siendo la autoridad para datos.
- Errores no se marcan verificados, ni se oculta un fallo de sesión con instrucciones genéricas. La conversación se limpia al cambiar o cerrar sesión.

## Evidencia de validación

Pruebas de política existentes, 27 regresiones del agente/handler y prueba React con JSDOM del formulario, envío, navegación, filtros, errores de sesión y limpieza entre cuentas. Prevención se valida además con Postgres/PGlite local. Tipos y compilación completos comprobados. La validación contra sesiones reales en producción sigue siendo una comprobación distinta; no se certifica a partir de mocks.

Ejemplos de órdenes:

- `Aplica filtros; obra: nombre exacto; periodo: periodo exacto`
- `Registra una incidencia` abre el formulario de datos obligatorios.
- `Registra una incidencia; obra: nombre exacto; fecha: AAAA-MM-DD; categoría: Otros; prioridad: Media; título: título; tarea: tarea; descripción: descripción`

Si se solicita un borrado, revisar el alcance mostrado antes de Confirmar. Cancelar no ejecuta el RPC.
