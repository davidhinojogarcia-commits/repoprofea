# Órdenes de obra — diseño y decisiones

Rama feat/visit-work-orders. Sin autorización para fusionar, aplicar migraciones remotas ni publicar producción.

- Conservar revisión y firma existentes. Nuevas órdenes tipadas en content.orders; acuerdos históricos conservados sin inventar emisores. Referencias a órdenes existentes en content.orderReferences, resueltas por servidor desde la misma obra; no copias.
- Registro vivo separado del JSON/PDF firmado: visit_work_orders + historial/definiciones/evidencias y operaciones idempotentes. Sin cambios retrospectivos de firmas o PDFs.
- Autorizaciones por obra explícitas y auditadas para emisor (persona/cargo/entidad, ámbitos técnicos/preventivos/recomendación) y verificador (usuario autenticado). Asistir no concede competencias. Solo responsable de obra/administrador puede concederlas; permiso de escritura de obra sigue siendo obligatorio.
- Órdenes con destinatario opcional (genéricas), fecha, plazo opcional, prioridad, naturaleza, ubicación, observaciones, referencias oficiales, anexos por id de los anexos del acta y justificación de decisiones reservadas.
- Sincronización transaccional al finalizar mediante wrapper de visit_minutes_commit existente. Se conserva su función base, permisos de servicio e idempotencia. Versiones/estados vivos no reescriben actas. Nuevas versiones requieren revisión y firma.
- Estados independientes: pending_communication, communicated, pending_execution, in_progress, executed_pending_verification, verified, breached, cancelled, superseded. Encargado solo avances/terminada pendiente; nunca verifica. Cancelar/sustituir requiere competencia y justificación. No hay borrado del historial.
- Publicación automática al firmar. Portal token validado activo y owner/obra exactos; solo lecturas de metadatos al entrar, PDF/evidencias a demanda y lectura confirmada explícita e idempotente. Sin polling ni eventos por lectura técnica.
- Confidencialidad: orden visible a toda obra o solo accesos de encargado expresamente seleccionados. Un PDF firmado no se redacta: si contiene órdenes restringidas no autorizadas, no se entrega ese PDF al acceso correspondiente. Órdenes compartibles siguen consultables sin revelar las demás.
- Portal: Actas de visitas → Actas firmadas / Órdenes pendientes. Seguimiento y evidencias autorizado por orden. Historial por demanda y paginado; pendientes entre visitas aun cerrada su acta.
- Revisión del contenido, lectura y verificación de ejecución son tres operaciones distintas. Intención de firma conformidad/reservas/conocimiento con nota, sin sustituir órdenes.
- No sustituye libros oficiales ni habilita cambios contractuales/económicos/plazos por firmar. Referencias oficiales explícitas.
- Pruebas: dominio, SQL/RLS/CAS/permisos/tokens, integración API PostgreSQL, PDF completo y fidelidad histórica, navegador/responsive/firmas/control horario/contratos/inicios. CI y resultados documentados en PR listo para validar; dispositivos físicos pendientes.

Infra existente: handler /api/visit-minutes usa servicio privado; mutaciones visit_minutes_commit security invoker solo service_role; obras por RLS auth y perfiles activos. Fixtures PGlite en scripts/visitMinutesTestServer.mjs. No logs con cuerpos, imágenes o tokens; metadatos paginados y evidencia separada.
