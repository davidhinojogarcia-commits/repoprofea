# Recuperación de autorización Gmail — 1.21.2

El 14/10/2026 se observaron en producción cuatro fallos al renovar Gmail entre las 14:35 y las 14:39 UTC. El estado anterior sólo comprobaba que existiese una fila en gmail_connections, por lo que seguía mostrando la cuenta como conectada. No se consultaron tokens ni contenido de correo.

La consulta de estado ahora prueba la renovación real. Google invalid_grant devuelve GMAIL_RECONNECT_REQUIRED y permite iniciar de nuevo el consentimiento desde la documentación o Configuración. Los fallos de cliente OAuth y los fallos temporales tienen códigos diferentes y no se presentan como autorización caducada. El fallo de Gmail pausa sus comprobaciones automáticas sin bloquear la actualización de los documentos.

El callback no confirma conexión cuando Google omite un refresh token y el anterior es inválido. Si el anterior sigue siendo válido, conserva ese token cifrado y guarda los permisos efectivamente devueltos para la misma cuenta.

Validación local: test:gmail-authorization ejecuta el servidor/callback con transportes simulados y componentes React con la API cliente real y transporte simulado. Cubre permiso expirado, badge, recuperación desde el dashboard, redirección a Google, scopes actualizados, falso éxito, pausado de reintentos y errores temporales. También se ejecutan lint, build y la regresión de publicación del supervisor. No sustituye el consentimiento real en la cuenta Google.

Pasos reales: recargar, pulsar Revisar Gmail, Volver a autorizar Gmail, aceptar los permisos en Google y revisar Gmail otra vez. La app no puede renovar un permiso que Google ha revocado sin consentimiento de su titular.

Si vuelve a caducar a los siete días, revisar en Google Cloud Console > Google Auth Platform > Audience si la aplicación permanece en Testing. Google documenta que las aplicaciones externas en Testing con permisos Gmail tienen refresh tokens de siete días. No se ha verificado el estado de esa consola ni se ha cambiado. Referencia: https://developers.google.com/identity/protocols/oauth2/#expiration
