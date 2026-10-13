# Avisos móviles de documentos para encargados

El botón «Activar avisos de mi obra» registra el dispositivo con el acceso vigente del portal. El permiso se pide al pulsar el botón. En iPhone/iPad, abrir previamente el portal instalado en la pantalla de inicio. Android: usar un navegador compatible con Web Push (Chrome/Firefox). Las suscripciones actuales admiten los servicios de Google, Mozilla y Apple.

Después de verificar el envío guardado de Inicio / Incorporación o Control de presencia, el supervisor llama a `/api/foreman-push`. El servidor autentica su JWT con Supabase, comprueba propiedad y publicación, reclama los avisos pendientes y envía Web Push. Los RPC nunca permiten leer claves de otros propietarios ni enviar documentos de otra obra. No se utiliza una clave `service_role`.

El aviso contiene el nombre de la obra, el tipo de documento y su periodo; nunca nombres de trabajadores, firmas, PDFs ni el token de acceso. Al tocarlo se abre `/encargados?document=UUID`, usando el acceso que ya está guardado en el dispositivo. Se abre y destaca el documento, se limpian los filtros de periodo y se mantiene la comprobación de acceso a la obra. Un aviso con el portal abierto dispara una actualización puntual; no hay sondeo periódico.

Cada aviso conserva un resultado por documento, fecha de publicación y dispositivo. Los envíos aceptados no se repiten al pulsar «Comprobar / reintentar aviso móvil». Los fallos permiten hasta tres intentos con un mínimo de 30 segundos entre intentos; una concesión de envío se recupera tras dos minutos. Los códigos 404/410 desactivan el dispositivo caducado. La renovación/revocación del acceso excluye sus suscripciones antiguas. Diez dispositivos activos como máximo por acceso.

El resultado confirma aceptación por el servicio push, no recepción ni lectura en el móvil. El dispositivo puede estar sin conexión o tener los avisos silenciados; el servicio conserva el aviso hasta 24 horas. Los avisos repetidos usan una etiqueta estable y `renotify:false` para evitar alertas repetidas después de un resultado ambiguo. No se promete entrega exactamente una vez.

La publicación no se deshace si el aviso falla. La confirmación del supervisor muestra por separado el documento publicado y el resultado móvil. Si el navegador del supervisor se cierra antes de llamar al servidor, o falla la red, se puede usar el botón de comprobar/reintentar en el documento publicado. Los reintentos son explícitos, no una tarea automática en segundo plano.

## Publicación

1. Aplicar `supabase/migrations/20261013141555_foreman_mobile_push.sql` antes de habilitar la nueva interfaz. Es aditiva; no modifica documentos, firmas ni posiciones existentes.
2. Configurar en Vercel producción `FOREMAN_PUSH_VAPID_PUBLIC_KEY`, `FOREMAN_PUSH_VAPID_PRIVATE_KEY` (secreta) y `FOREMAN_PUSH_VAPID_SUBJECT`. Las claves se generan una sola vez y se conservan para futuras publicaciones. No compartir las claves de producción con previews.
3. Fusionar y desplegar el código. El nuevo service worker actualiza la caché estática a v16. `/api/foreman-push` debe ser una función Node accesible junto a `/api/profea-tutor`.
4. Desde un móvil de prueba, activar avisos; enviar un documento de su obra; comprobar el aviso con la aplicación cerrada, tocarlo y verificar que abre ese documento. Desactivar y verificar que deja de recibir avisos. Repetir en Android y en iPhone instalado.

## Validación automatizada

- `npm run test:foreman-push`: SQL real en PGlite con roles anon/authenticated, aislamiento, concesiones concurrentes, deduplicación, caducidad, permisos y transferencia de dispositivos; handler Node con transporte simulado; API de navegador y service worker con eventos simulados.
- `npm run test:foreman-publication`: publicación, recibo, filtros de obra/mes/quincena, firmas, geometría, PDF original y retirada.
- `npm run test:mandatory-persistence` y `npm run test:low-consumption`: persistencia real frente a caché/offline y regresiones de consumo.
- `npm run lint` y `npm run build`.

Las pruebas automáticas no sustituyen la comprobación de recepción con un dispositivo físico y su permiso concedido.
