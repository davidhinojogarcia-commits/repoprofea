# Tutor PROFEA — mapa de capacidades verificadas

Versión de conocimiento: 2026.10.06.1

## Fuente de verdad
Este mapa se deriva del código de `main` en el commit `1bf90c6fa15bdef35a2158869ed712457b3242d2`. Las conversaciones previas y la documentación funcional no se consideran prueba de una capacidad si no existe implementación en el repositorio.

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
3. Búsqueda de trabajadores visibles con minimización de datos.
4. Consulta de pendientes de reconocimiento médico por obra/periodo.
5. Aplicación de filtros de obra/periodo en la interfaz.
6. Creación de incidencias preventivas mediante el RPC existente, con verificación de respuesta de base de datos.
7. Contexto explícito de pantalla, obra y periodo.
8. Autenticación del endpoint del tutor mediante el token de sesión del usuario.
9. Borrado masivo de documentos obligatorios por obra con cálculo previo del alcance, confirmación firmada de 10 minutos, revalidación de obra/conjunto y borrado mediante el RPC existente.

## Límites deliberados
- No SQL arbitrario.
- No service-role en navegador ni para decisiones del Tutor.
- Los borrados de documentos obligatorios solo se ejecutan tras una confirmación exacta firmada; otros cambios masivos, envíos a terceros y cierres definitivos siguen deshabilitados.
- No firmas por trabajadores.
- No se exponen DNI, IBAN, NUSS ni detalles médicos innecesarios al planificador local.
- El contenido de documentos importados se trata como datos y nunca como instrucciones ejecutables.

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

La ejecución posterior del borrado no depende de ningún modelo externo: el servidor valida una confirmación firmada, usuario, caducidad, obra activa y que el conjunto de documentos no haya cambiado antes de llamar al RPC real.


## Motor del Tutor
- Tutor PROFEA usa un planificador determinista local ejecutado en el servidor de GestionProfea.
- No llama a Gemini ni a otro proveedor de modelo para interpretar órdenes o sintetizar resultados.
- Las herramientas permitidas están en un catálogo cerrado y siguen usando la sesión y los permisos RLS/RPC del usuario.
- Gemini puede seguir existiendo en otros flujos independientes de análisis documental de la aplicación; no forma parte de Tutor PROFEA.
