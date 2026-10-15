# Invitaciones al parque mediante Gmail

Fecha: 15/10/2026. Incluido en `feat/inventory-usage-identification`, PR #263.

## Cambio

La tarjeta de invitación pendiente incorpora **Enviar invitación por Gmail**, además de copiar el enlace y reintentar el servicio de correo anterior. Utiliza la conexión Gmail del supervisor guardada en GestionProfea. No depende de Resend ni de la conexión Gmail del asistente de ChatGPT. No envía correos al abrir la tarjeta.

El nuevo POST `/api/gmail?action=send-inventory-invite` recibe únicamente el identificador de la invitación. El servidor determina el destinatario desde el registro persistido y comprueba sesión, autor de la invitación, estado pendiente, permisos actuales para compartir el parque, perfiles activos y coincidencia con el correo actual del destinatario. No acepta remitente, destinatario, texto ni URL aportados por el cliente.

La conexión Gmail y el token pertenecen al usuario autenticado. Se verifica el permiso de envío, se renueva el acceso y se envía un mensaje de texto con el enlace de aceptación. El destino usa un dominio canónico o una configuración HTTPS del servidor (`INVENTORY_APP_URL`); no utiliza Host ni parámetros de la petición. No incluye adjuntos, firmas, documentos, tokens ni otras URL de la sesión. La aceptación sigue correspondiendo al destinatario mediante el flujo existente.

Solo se muestra «Invitación enviada por Gmail desde…» tras recibir confirmación y un identificador de mensaje. Se distinguen falta de conexión, autorización caducada, permiso de envío insuficiente, límite temporal y resultado no confirmado. No hay reintentos automáticos. Si el resultado es incierto, se pide comprobar Enviados antes de reintentar. Un bloqueo de interfaz impide el envío simultáneo por los dos canales y las dobles pulsaciones. No se afirma idempotencia entre peticiones independientes o sesiones diferentes.

## Pruebas ejecutadas

- `npm run test:inventory-gmail`: handler real con servicios externos simulados. Verifica destinatario persistido, remitente de la conexión propia, enlace canónico, contenido UTF-8/base64url, permanencia de la invitación pendiente, autenticación, autor, permisos del parque, revocación, perfiles activos, destinatario cambiado, conexión ausente, permiso de envío, OAuth caducado, rechazo de Google, limitación y respuesta sin ID. Incluye regresión del envío de PDF existente.
- `npm run test:inventory-invitations`: SQL de invitaciones, servicio anterior e interfaz React real. Añade cliente Gmail real con transporte simulado, Bearer de la sesión actual, cuerpo con solo el ID, fallo de OAuth, respuesta de éxito inválida, fallo de red, reintento, confirmación del remitente y protección frente a envíos simultáneos. Conserva las pruebas de enlace, portapapeles, aceptación y rechazo.
- `npm run test:inventory-invitations-browser`: Chromium Headless real con cliente Gmail real y API simulada, a 390/820/1440 px. Incluye el nuevo botón, autorización ausente, reintento y confirmación del remitente; sin errores de página.
- `npm run test:gmail-authorization`: aprobado; recuperación de permisos, renovación, callback, estados y conexión existentes.
- `npm run test:inventory-usage` y `test:inventory-usage-browser`: aprobados tras añadir Gmail, sin cambios en la asignación por supervisor.
- `npm run lint`, `npm run build` y empaquetado independiente de `api/gmail.ts` con esbuild: aprobados. Se conserva la advertencia existente de tamaño de paquetes opcionales de Vite.
- Consulta agregada de solo lectura en la base real: existe una conexión Gmail del propietario del parque con permiso `gmail.send`. No se han leído ni extraído sus tokens. Esto no comprueba que Google siga aceptando su autorización.

Referencia técnica: [envío de mensajes con la API oficial de Gmail](https://developers.google.com/workspace/gmail/api/guides/sending).

## Límites y publicación

No se ha enviado ningún mensaje real ni se han modificado invitaciones reales. El perfil del plugin de Gmail se consultó solo para comprobar disponibilidad; sus credenciales no se transfieren a la aplicación. Queda pendiente comprobar la entrega real al buzón y la aceptación con la cuenta del compañero después de publicar.

El cambio Gmail no requiere una migración nueva ni nuevos permisos OAuth si ya existe `gmail.send`. El PR #263 conserva la migración pendiente de responsables de equipos, que debe aplicarse antes de publicar ese conjunto. Sin fusionar ni desplegar esta ampliación.
