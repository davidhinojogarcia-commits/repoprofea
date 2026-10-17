# Actas sin acuerdos: editar y eliminar

Rama `fix/visit-minutes-edit-delete`, sobre producción `79b3d68220221dd0c72ea3b08266762c3816d222`. Alcance confirmado por el usuario: acciones sobre **actas completas**.

- Se retiran el formulario de acuerdos, su arrastre a visitas nuevas y su seguimiento separado. Las órdenes e instrucciones conservan sus emisores, permisos, evidencias y seguimiento.
- Los borradores antiguos con acuerdos quedan pendientes de guardar al abrirlos para edición; al guardar se retira ese campo de la nueva redacción. No se reescriben documentos emitidos ni PDF firmados. Los acuerdos de un documento histórico siguen siendo contenido de esa versión; solo aparecen si existen, sin una sección vacía en las actas nuevas.
- Cada tarjeta propia dispone de Editar y Eliminar; también aparecen en el acta abierta. Editar un borrador conserva su versión. Editar un acta emitida requiere confirmación y reutiliza la corrección existente: nueva versión, nueva revisión y firmas, conservando el PDF original.
- Eliminar reutiliza la anulación transaccional existente. Pide confirmación, revoca accesos de revisión y trabajos pendientes, conserva versiones y PDF, y oculta el registro del listado habitual. Se consulta mediante el filtro «Eliminadas / anuladas». No es un borrado físico ni elimina órdenes emitidas o su historial.
- El servidor verifica propiedad y permisos de obra, revisión concurrente y operaciones idempotentes. La marca de propietario para las tarjetas es orientativa; las acciones vuelven a consultar los permisos reales. No se añaden consultas por fila, polling, tablas, suscripciones, dependencias ni logs de datos.

## Validación

Las pruebas de integración comprueban propietario/lector compartido, rechazo de eliminación ajena, listado tras retirada, consulta explícita del archivo y bytes idénticos del PDF firmado. Las pruebas de navegador añaden cancelar edición/eliminación, nueva versión, guardar y recargar, retirar y recargar, archivo, conservación del original y órdenes independientes, y retirada de acuerdos de un borrador antiguo. El recorrido existente conserva revisión, Gmail simulado, OTP, firmas, PDF y portal.

Superadas localmente: TypeScript, dominio/PDF/integración de actas, permisos y seguimiento de órdenes, correo simulado y el recorrido completo Chromium. Consultar la ejecución CI del PR para distinguir pruebas completas superadas de las configuradas. Los tamaños 390/820/1440 y Chromium/WebKit son emulación; no acreditan pruebas físicas Android/iPhone/iPad. No se han enviado correos reales, aplicado migraciones, fusionado ni publicado esta rama.
