# Herramientas: responsable del movimiento y Gmail de averías

Fecha: 2026-10-19. Base: main `97af602b0118994b792efc50139fc97352820ec3`.
Rama: `fix/inventory-supervisor-gmail`.

## Diagnóstico comprobado

El guardado de una avería en `InventorySection.tsx` abría un `mailto:` mediante
`window.location.href`. Esto delegaba la elección del remitente en la aplicación de
correo del dispositivo: no intervenía el Gmail OAuth del supervisor.

La columna Responsable utilizaba `responsable_actual`, que representa quién usa
el equipo y se libera al devolverlo o averiarse. El autor de cada movimiento ya
estaba registrado separadamente en `created_by` y `created_by_name`, pero no se
mostraba como supervisor responsable actual.

## Corrección

- Averías: acción autenticada `send-inventory-breakdown` dentro de `api/gmail.ts`.
  `inventoryBreakdownGmail.ts` consulta los datos guardados, destinatario del parque
  y conexión Gmail del actor. No admite remitente, destinatario ni cuerpo enviados
  por el navegador. Si hay un correo del supervisor configurado, debe coincidir
  con la conexión autorizada. Nunca se cambia a otra cuenta automáticamente.
- Se reutilizan renovación OAuth, cifrado de tokens y autorización existentes.
  Se exige permiso de envío. Solo un identificador válido devuelto por Gmail
  acredita aceptación; no se afirma entrega física.
- Persistencia privada por movimiento: reclamación atómica, máximo cinco intentos
  tras fallos confirmados y conciliación por Message-ID determinista en Enviados
  cuando existe permiso de lectura. Un resultado incierto no se reenvía
  automáticamente. Si Gmail acepta pero falla la persistencia, se concilia antes
  de repetir. Sin permiso de lectura se solicita comprobación manual.
- El movimiento se conserva aunque falle el correo. Se ofrece autorizar Gmail y
  reintentar desde la notificación o desde Movimientos sin registrar otra avería.
- `get_inventory_supervisors` obtiene el autor del último movimiento mediante RLS.
  Se muestra como supervisor responsable en todos los estados, separado del
  usuario efectivo del equipo. Los movimientos anteriores se recuperan sin
  reescribirlos. Una corrección histórica no atribuye el equipo a su editor;
  eliminar el último movimiento recupera el supervisor del anterior.
- Servicio, filtros, colores, búsqueda, contador y caché sin conexión utilizan
  esa distinción. La selección de usuario de un movimiento nuevo propone al
  supervisor actual en lugar de heredar al anterior.

No se han cambiado otros correos `mailto:` ajenos al aviso de avería.

## Seguridad y consumo

El servidor comprueba sesión, perfil activo, acceso RLS, autor de la avería y
pertenencia autorizada al parque. La tabla de envíos no es accesible por anon ni
authenticated; las funciones de escritura son exclusivas de service_role.
Conserva identificadores, estado, número de intentos y código normalizado, sin
guardar el correo completo, tokens, enlaces privados ni fotografías.

La lectura del supervisor añade una RPC por carga de inventario, ejecutada en
paralelo y con la caché existente por usuario/parque e invalidación por escritura.
Se reutilizan índices existentes y la función Gmail existente; no se añade otra
función Vercel ni polling. Los filtros siguen siendo locales.

Mediciones reproducidas en simulación: dos solicitudes simultáneas generan una
sola llamada de envío; reintentar un envío aceptado, una respuesta perdida o una
confirmación de persistencia perdida no genera otro mensaje. En navegador,
reintentar el aviso no añade otro movimiento. No se han medido latencias, consumo
Vercel/Supabase, volumen de logs ni entrega física en producción; no se atribuyen
porcentajes de ahorro.

## Pruebas

Superadas localmente:

- `npm run test:inventory-usage`: dominio, servicio real con transporte simulado,
  interfaz React/JSDOM y PostgreSQL local PGlite con RLS, historial y permisos.
  Aplica la migración dos veces, comprueba aislamiento, ACL del registro de envío,
  reclamación única, reintentos y conciliación.
- `npm run test:inventory-gmail`: integración del manejador real con transporte
  externo simulado; cuenta correcta, datos falsificados, acceso indebido, ausencia
  de OAuth, cuenta incorrecta, scopes, renovación fallida, cuota, concurrencia,
  respuesta sin ID y pérdida de confirmaciones.
- `npm run test:inventory-invitations`: regresiones SQL, servicio y React.
- `npm run test:gmail-authorization`: regresiones de renovación y autorización.
- Auditorías globales de capas/modales y pila: ejecutadas mediante
  `node --import tsx scripts/testGlobalModalAudit.ts` y
  `node --import tsx scripts/testGlobalModalStack.ts`. El lanzador CLI de tsx no
  pudo abrir su socket IPC en este entorno; el cargador Node ejecutó ambas pruebas.
- `npm run lint`, `npm run build` y `git diff --check`.

- `npm run test:inventory-usage-browser`: Chromium, 390/820/1440 píxeles,
  claro/oscuro, responsable propuesto, alta de movimiento y avería, fallo OAuth,
  reintento Gmail sin duplicar movimiento y sin abrir cliente de correo; sin
  errores de página ni desbordamiento horizontal.
- `npm run test:inventory-invitations-browser`: regresión de invitaciones, enlaces,
  error de autorización y recuperación en los mismos anchos.

Los transportes Gmail y Supabase del navegador son simulados.
Pendientes: Gmail autorizado real, recepción por el mecánico, base remota tras
migración y pruebas físicas iPhone/Safari, Android/Chrome e iPad/Safari.
No se ha enviado ningún correo real durante estas pruebas.

## Migración y reversión

`supabase/migrations/20261019134751_inventory_supervisor_breakdown_mail.sql` es
aditiva. Debe aplicarse antes de publicar el código. No altera asignaciones,
movimientos existentes ni archivos y conserva evidencia mínima de envío incluso
si se elimina posteriormente un movimiento mediante el procedimiento existente.
No se ha aplicado a producción.

Reversión recomendada: revertir el código de la aplicación y conservar el esquema
aditivo y sus evidencias. No borrar la tabla de envíos para volver a una versión
anterior. Si se vuelve al código anterior, su aviso de avería vuelve a utilizar
`mailto:`; debe comunicarse expresamente esa limitación.

## Validación del supervisor tras despliegue autorizado

1. Autorizar en Configuración el Gmail propio del supervisor y comprobar el correo
   configurado. Configurar el correo del mecánico en el parque correspondiente.
2. Mover una herramienta: Responsable debe mostrar al actor del movimiento.
   Si se elige otro usuario efectivo, ambos deben aparecer diferenciados.
3. Registrar una avería: comprobar el aviso de aceptación y el mensaje en Enviados
   del supervisor, además de su recepción por el destinatario autorizado.
4. Repetir el aviso desde Movimientos: no debe duplicarse un envío ya confirmado.
5. Con Gmail desconectado, comprobar que la avería sigue guardada y que se ofrece
   autorizar/reintentar; confirmar que no se abre el correo personal del dispositivo.
6. Recargar o usar otra sesión autorizada: el supervisor debe seguir visible.
   Comprobar también que un usuario ajeno no accede al parque ni envía sus avisos.
