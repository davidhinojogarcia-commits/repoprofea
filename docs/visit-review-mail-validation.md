# Corrección del correo de actas y consumo

Rama `fix/visit-review-mail-delivery`. Base real: `557204a9225cf58d71bf5e44c7fa9b26414701c6`, versión declarada 1.21.2. No fusionar ni publicar sin autorización expresa. No hay migraciones nuevas.

## A. Diagnóstico y evidencia

Consulta de producción exclusivamente de lectura y agregada: tres eventos históricos `mail-failed` con `errorCode=GMAIL_RECONNECT_REQUIRED`. Los cuatro trabajos de revisión y cuatro de firma consultados constaban posteriormente como `sent`, con identificadores de Gmail. Esto prueba fallos de autorización y aceptación posterior registrada; **no prueba recepción en la bandeja**, ni permite afirmar que nunca se enviaran los mensajes. No se han leído ni extraído tokens, códigos o contenido de correos de producción.

El código sí llamaba a Gmail: `sendFlow → command(review) → get → send-job por destinatario → get → list`. Pero cerraba el modal antes de enviar, abría revisión antes de comprobar OAuth, mostraba los errores fuera del modal y carecía de acceso a reautorizar Gmail. Si no quedaban trabajos elegibles mostraba «0 correos aceptados en esta operación», aunque hubieran sido aceptados antes. Los trabajos inciertos no tenían reconciliación. Estos fallos de experiencia y recuperación se han reproducido con OAuth revocado simulado. El motivo exacto de una posible ausencia en la bandeja de entrada sigue sin comprobarse físicamente.

## B. Corrección

- `src/server/visitMinutesHandler.ts`: `sendVisitBatch`, `deliverVisitJob`, `visitJobs`, `mailResult`, `reconcileVisitMail`; mantiene el endpoint individual compatible. Comprueba autorización antes de abrir revisión/crear trabajos. Lotes de hasta dos destinatarios, una renovación OAuth por lote, enlaces consultados juntos y PDF final conservado leído una vez por lote; no regenera el original. Devuelve el resultado y los estados directamente, evitando sucesivos get/list y llamadas individuales desde React. Añade From con la cuenta OAuth real.
- `components/VisitMinutesPanel.tsx`: botón «Confirmar y enviar correos», estado «Enviando correos…», bloqueo contra doble pulsación y modal abierto ante errores. Cuenta remitente visible, resumen por destinatario, aceptación diferenciada de entrega/lectura, botón «Volver a autorizar Gmail» del sistema existente. Reintenta trabajos pendientes/fallidos, preserva los ya aceptados y permite consultar Enviados para resultados inciertos. Conserva revisión, observaciones, disconformidad y firma separadas.
- `src/server/gmailOAuth.ts`: renovación con timeout de 15 segundos y error de red normalizado, sin volcar respuestas del proveedor.
- Tests/fixture y CI: casos OAuth, fallos parciales, concurrencia, incertidumbre, reconciliación, navegador y benchmark reproducible. Rama sin despliegues automáticos Vercel.

- `api/gmail.ts`, `api/gmail-oauth-callback.ts` y el manejador compartido de errores: suprimen el volcado de respuesta Google y objetos de error completos. Los fallos inesperados dejan un único registro acotado `{status, code}` y los errores de autorización conocidos no generan una segunda traza de consola. La revocación no imprime objetos con datos sensibles.

Errores 403 de cuota, permisos y política de dominio se distinguen por el motivo normalizado del proveedor, sin volcar su cuerpo ni reintentar el resto de destinatarios cuando falla toda la cuenta. Referencia técnica: https://developers.google.com/workspace/gmail/api/guides/handle-errors .

## C. Gmail real: pendiente de autorización

**No se ha enviado ningún correo real en este trabajo.** La lectura agregada de producción no valida ahora la vigencia de los tokens ni sustituye la prueba real. Se requiere autorización expresa de la cuenta remitente y del destinatario de pruebas, y un entorno de prueba autorizado que no altere producción. La prueba debe usar el flujo de la app; enviar mediante otro conector no acreditaría este recorrido.

Debe conservarse solo ID del acta/trabajo/versión/destinatario, resultado, ID de Gmail, hora y código normalizado. Verificar aceptación del proveedor, aparición en Enviados y recepción física (incluyendo spam/filtros). Esta validación permanece abierta: no se considera el trabajo completamente aceptado solo por las simulaciones o CI.

## D. Seguridad y trazabilidad

Se reutilizan las claves únicas acta/versión/persona/tipo, operaciones idempotentes y el bloqueo PostgreSQL persistente de `visit_minutes_claim_mail`. Una doble pulsación o reintento no vuelve a enviar trabajos aceptados. El resultado incierto permanece bloqueado, incluso si se pierde la confirmación posterior a la aceptación. Se conserva el ID conocido del proveedor aunque falle el primer guardado.

Reconciliación explícita, sin polling: requiere permiso Gmail de lectura ya concedido, consulta solo el mensaje conocido o busca por Message-ID determinista, y comprueba etiqueta SENT y cabecera exacta. Un resultado ausente/ambiguo no habilita reenvío. La búsqueda no concede scopes nuevos ni usa otro remitente. Las sesiones y permisos del propietario se comprueban en cada petición. Ninguna contraseña, credencial, token de enlace, OTP o correo íntegro se registra en consola o eventos.

Los enlaces, OTP por destinatario, caducidad, límites, aislamiento de obra/usuario y formalización de nueva versión mantienen sus pruebas existentes. La observación/disconformidad queda como estado y comentario persistente del acta, visible al supervisor al consultar/actualizar; no se añade otro correo automático ni sondeo para notificarlo.

## E. Medición antes/después

Misma fixture sintética, API real y motor PostgreSQL PGlite; Gmail y OAuth simulados. Desde previsualizar hasta completar el envío; se excluye crear el acta. Baseline ejecutada cargando el código anterior desde Git, no una estimación. Los RPC de lectura de permisos se contabilizan como consultas, no como escrituras. JSON adjunto en `docs/visit-review-mail-metrics.json`.

| Indicador | Antes, 1 / 4 destinatarios | Después, 1 / 4 destinatarios |
| --- | ---: | ---: |
| Peticiones Supabase, incluidas lecturas de permisos | 29 / 56 | 19 / 34 |
| Peticiones de escritura, incluidas auxiliares | 4 / 13 | 4 / 11 |
| Escrituras RPC de estado: commit/claim/finish | 3 / 9 | 3 / 9 |
| Invocaciones de función desde frontend | 6 / 9 | 2 / 3 |
| Renovaciones OAuth | 1 / 4 | 1 / 2 |
| Llamadas Gmail de envío necesarias | 1 / 4 | 1 / 4 |
| Eventos de auditoría de aceptación | 1 / 4 | 1 / 4 |
| Consola de aplicación instrumentada | 0 líneas, 0 bytes | 0 líneas, 0 bytes |
| PDF almacenado por este flujo de revisión | 0, 0 bytes | 0, 0 bytes |
| Tiempo local con Gmail simulado, una muestra | 70 / 113 ms | 55 / 74 ms |
| Tiempo real de Gmail/Vercel | No medido | No medido |
| Volumen de logs de plataforma Vercel/Supabase | No medido | No medido |
| Memoria temporal real de plataforma | No medida | No medida |

Dos sondas adicionales del manejador Gmail compartido, con errores completamente sintéticos y consola Node capturada en un stream:

| Caso controlado | Antes | Después |
| --- | ---: | ---: |
| Error esperado de autorización | 1 línea / 44 bytes | 0 líneas / 0 bytes |
| Error inesperado con diagnóstico sintético de 2 KB | 6 líneas / 2276 bytes | 1 línea / 67 bytes |

Estas sondas miden la salida concreta de la aplicación en esos casos; no estiman el volumen mensual de logs de plataforma. El registro operativo conserva código y estado sin diagnóstico íntegro, tokens ni objetos de respuesta. Hay una prueba que exige que un marcador sensible sintético no aparezca en el log.

Para cuatro personas: 39 % menos peticiones Supabase, 67 % menos invocaciones y 50 % menos renovaciones OAuth en la fixture. No se atribuye esa reducción al volumen de logs real ni a la latencia de producción. La auditoría necesaria y los estados no se eliminan. El tiempo local sirve como diagnóstico del banco de pruebas, no como predicción de entrega real. No se crean PDF temporales para revisar; no se elimina ningún archivo firmado, versión, evidencia u original.

Reproducción en un checkout que contenga el commit base:

```bash
VISIT_MAIL_BASE_REF=557204a9225cf58d71bf5e44c7fa9b26414701c6 node scripts/measureVisitMail.mjs before
node scripts/measureVisitMail.mjs after
```

## F–G. Pruebas y regresiones

Superadas localmente: TypeScript; tests de actas dominio/PDF/integración; órdenes/competencias/seguimiento; nueva integración de correo con cuatro destinatarios, privacidad, OAuth revocado y renovación/red, destinatario inválido, cuota 429 y 403 (dailyLimitExceeded), permisos insuficientes 403 y política de dominio diferenciados, fallo parcial y reintento selectivo, doble petición concurrente, aceptación con pérdida de respuesta o persistencia, reconciliación y aislamiento entre supervisores. Gmail es simulado; el handler y PostgreSQL/PDF son reales.

Chromium local superado: modal permanece abierto con OAuth inválido, error y botón de reautorización dentro del diálogo, llamada al inicio OAuth existente con cuenta remitente y retorno controlados, estado de firma no habilitada antes de completar revisión, recuperación con doble pulsación sin duplicar, revisión/OTP/firma/final/PDF y portal; resoluciones móvil/tablet/escritorio y claro/oscuro. El navegador utiliza usuarios sintéticos. CI ejecuta también este recorrido con WebKit y las regresiones completas del repositorio: firmas independientes de encargado, contratos/prórrogas, inicios/presencia, EPIs/formación/maquinaria, control horario, originales, permisos, Gmail de otros módulos, modales y persistencia. Consultar el resultado definitivo de CI en el PR, sin confundir pruebas configuradas con superadas.

Pendientes: envío y recepción real autorizados, cuentas reales en entorno de pruebas, dispositivos Android/iPhone/iPad físicos y Safari/PWA nativo. No se ha publicado esta corrección ni modificado datos/configuración de producción.

## H. Entrega

PR en borrador para revisión técnica y autorización de la prueba real. Sin cambios de esquema ni dependencias. Una nueva versión o firma conserva las versiones, órdenes e instrucciones y el PDF original. No fusionar ni desplegar automáticamente esta rama.
