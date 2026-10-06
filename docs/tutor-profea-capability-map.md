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
3. Búsqueda de trabajadores visibles sin enviar DNI al modelo.
4. Consulta de pendientes de reconocimiento médico por obra/periodo.
5. Aplicación de filtros de obra/periodo en la interfaz.
6. Creación de incidencias preventivas mediante el RPC existente, con verificación de respuesta de base de datos.
7. Contexto explícito de pantalla, obra y periodo.
8. Autenticación del endpoint del tutor mediante el token de sesión del usuario.

## Límites deliberados
- No SQL arbitrario.
- No service-role en navegador ni para decisiones del modelo.
- No borrados, cambios masivos, envíos a terceros ni cierre definitivo de documentos en esta primera herramienta de escritura.
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
