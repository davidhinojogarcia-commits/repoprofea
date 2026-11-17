# Publicación y reversión — requiere autorización posterior

## Cambio de datos

Migración aditiva `supabase/migrations/20261026211733_parts_and_notices.sql`. Crea siete tablas: registros, eventos/versiones, activos privados, políticas por obra, notificaciones, suscripciones Push y entregas Push. No modifica trabajadores, contrataciones SAE, originales PDF ni firmas de otros módulos.

Las tablas tienen RLS. El navegador solo puede leer registros/políticas/notificaciones propias con perfil activo; no firma, cambia estados ni lee activos/eventos directamente. Las RPC de escritura/Push son exclusivamente `service_role`; el handler valida sesión/acceso y permisos en cada petición. La clave se reutiliza del entorno del servidor y no pasa al cliente.

`parts_commit` usa bloqueo por propietario, comparación de revisión e identificador idempotente; valida perfil/acceso, obra, trabajador/contratación, antecedentes y digest de cada activo. Firma, PDF, evento y aviso se confirman atómicamente. Eventos y activos son inmutables para el rol de la aplicación. Los índices corresponden a listas por propietario/acceso, historial por trabajador, unicidad del PDF/revisión, idempotencia y cola Push.

## Orden futuro

1. Revisar PR y CI del SHA final; resolver pendientes jurídicos/físicos y aprobar expresamente la fusión/publicación.
2. Ensayar la migración en un proyecto de pruebas aislado con esquema actual, RLS, usuarios ficticios y copia de seguridad. PGlite no sustituye este ensayo de infraestructura.
3. Aplicar la migración aditiva antes del frontend/API. Confirmar tablas, funciones, grants, políticas e inclusión de notificaciones en `supabase_realtime`.
4. Verificar credenciales existentes del servidor y VAPID sin imprimirlas. El Push ausente no impide el registro del parte; se muestra su estado real.
5. Publicar una sola vez el commit autorizado, verificar READY y SHA servido; comprobar A/B/C, PDF, aislamiento y errores iniciales con registros de prueba autorizados.
6. Configurar solo políticas aprobadas. No copiar la política sintética de los tests ni activar procedimientos sancionadores.

## Reversión

Revertir el commit del frontend/API o deshabilitar su acceso. Mantener privadas las tablas/evidencias ya creadas; el código anterior no las consume. Desactivar las suscripciones Push del módulo mediante procedimiento de administración autorizado si fuera necesario. No borrar tablas, firmas, registros ni ficheros reales. Una migración de supresión o modificación de evidencias requiere evaluación, copia de seguridad y autorización separadas; no se entrega un `DROP ... CASCADE` de producción.

Riesgos: clave de servicio comprometida, enlace portador compartido, cuotas de DB/transferencia, bibliotecas/variaciones de Safari, permisos Push, políticas jurídicas incompletas y canales externos no verificados. No resolverlos reduciendo RLS ni anunciando una firma cualificada. Sin validación de infraestructura, física y jurídica no se recomienda activar el módulo con datos laborales reales.
