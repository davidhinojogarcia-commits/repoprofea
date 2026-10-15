# Invitaciones de herramientas y maquinaria

Fecha: 15 de octubre de 2026. Rama `fix/inventory-invitation-sharing`, basada en producción `fc638f5`.

## Causa y alcance

La invitación se guarda antes de solicitar el envío. La función `inventory-share-invite` requiere `RESEND_API_KEY` y `INVENTORY_INVITE_FROM_EMAIL`; si faltan, responde 503 y la interfaz solo mostraba ese fallo. No había una opción para recuperar y copiar el enlace de una invitación pendiente. La bandeja de aceptación dentro de Herramientas y maquinaria ya existía.

Se incorpora enlace copiable inmediatamente después de crear la invitación y desde la lista de personas pendientes, instrucciones para acceder a la bandeja y reintento explícito de correo sin crear otra invitación. El enlace contiene únicamente `inventoryInvite`: no hereda parámetros ni fragmentos de la sesión. Si el portapapeles falla, el campo permite selección y copia manual. Se añade actualización manual y explicación si el enlace no tiene una invitación pendiente para la cuenta actual.

La interfaz exige confirmación `{ok:true, delivery:'sent'}` antes de anunciar envío. Se bloquean envíos/aceptaciones simultáneos por doble pulsación y el reintento mientras está en curso el envío inicial. La URL se limpia tras responder correctamente. No se modifican permisos, SQL, funciones desplegadas ni datos existentes; el enlace no es una credencial y solo el destinatario puede responder al RPC.

## Verificación

- `npm run test:inventory-invitations`: aprobado. PostgreSQL embebido PGlite ejecuta las definiciones SQL existentes de creación, listado, aceptación, rechazo y revocación. Verifica reutilización de pendientes, aislamiento del destinatario, denegación anónima, ausencia de acceso antes de aceptar, persistencia, revocación y rechazo de respuesta duplicada.
- El mismo grupo prueba el servicio real con transporte simulado y la sección React real en JSDOM: correo ausente/fallido, confirmación de envío, recuperar pendiente sin escritura, copia manual/portapapeles, parámetros privados excluidos, doble envío, actualización, error de respuesta y reintento, aceptación y rechazo.
- `npm run test:inventory-invitations-browser`: aprobado en Chromium Headless 141. Controles accesibles del componente real, portapapeles denegado, envío lento, error y reintento a 390, 820 y 1440 píxeles. Sin errores de página. Ventanas emuladas y correo simulado; no es prueba en móvil físico ni verificación visual de toda la aplicación autenticada.
- `npm run test:low-consumption`: aprobado, incluidas regresiones de dashboard y limpieza de suscripciones.
- `npm run lint`, `npm run build` y `git diff --check`: aprobados. Vite mantiene su advertencia de paquetes opcionales de más de 900 kB.
- Base de datos real, solo lectura: existe una invitación pendiente; los RPC están habilitados para `authenticated` y denegados a `anon`. En una transacción revertida, se comprobó que el listado ejecutado bajo el rol `authenticated` y el identificador del destinatario devuelve la invitación. No se respondió ni se modificó la invitación real. Esto valida SQL/permisos, no una sesión real de navegador.

## Llamadas y límites

Recuperar/copiar el enlace de una invitación ya cargada hace cero llamadas adicionales y cero escrituras. Un doble envío concurrente produce una llamada por operación (medido en pruebas); cada reintento explícito hace una llamada al servicio de correo. No se añade polling, caché, suscripción ni dependencia.

El envío automático sigue requiriendo configurar Resend y un remitente autorizado en Supabase. No se han proporcionado ni inventado esas credenciales, ni enviado mensajes reales de prueba. Se mantiene el error de entrega y se ofrece una vía utilizable sin correo. Queda pendiente la entrega real al buzón y la aceptación desde la sesión real del compañero.

Cambios preparados para revisión, sin fusionar ni desplegar a producción. No requieren migraciones.
