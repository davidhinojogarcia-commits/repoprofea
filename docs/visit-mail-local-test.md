# Prueba de correo sin un segundo proyecto Supabase

La rama y el proyecto gratuitos no han podido aprovisionarse: las ramas requieren Pro y la creación de proyecto devuelve el límite de dos proyectos gratuitos activos del propietario. No se ha pausado ninguna aplicación ni cambiado ningún plan.

`scripts/visitMailLocal.mjs` permite comprobar **el handler real de la rama → PostgreSQL PGlite local → OAuth/Gmail reales → persistencia local → reintento sin duplicado**, sin desplegar, usar Docker ni acceder a la base de producción. Reutiliza el código de Gmail de la app; no emplea el conector Gmail de ChatGPT. La autenticación de la app y el transporte REST Supabase pertenecen a la fixture aislada: este recorrido no demuestra Supabase alojado ni el botón en una sesión real. El botón y los enlaces completos tienen sus pruebas de navegador separadas con Google simulado.

## Configuración protegida necesaria

Vercel permite ejecutar las variables sensibles en sus funciones, pero la consulta de las tres variables OAuth relevantes devuelve metadatos sin su valor. No se han exportado claves ni leído tokens de la base de producción. Se necesita una conexión OAuth de desarrollo del sistema existente, configurada por el propietario de forma segura. No pegar credenciales en chats ni registrarlas en el repositorio.

1. Copiar `.env.visit-mail.example` a `.env.visit-mail.local`, ignorado por Git, y aplicar permisos `600`.
2. Configurar las dos direcciones autorizadas y el cliente OAuth de desarrollo del sistema existente. Dejar vacío `VISIT_TEST_GMAIL_REFRESH_TOKEN`: no es necesario copiarlo ni introducirlo manualmente. No utilizar service-role de producción.
3. Registrar `http://localhost:8765/api/gmail-oauth-callback` como URI de retorno de desarrollo del cliente Google y autorizar desde el mismo equipo:

   ```bash
   node --env-file=.env.visit-mail.local scripts/visitMailLocal.mjs --authorize
   ```

   Abrir `http://localhost:8765/connect`. Se reutilizan `api/gmail.ts` y `api/gmail-oauth-callback.ts`, con datos y autenticación de la fixture local. Google comprueba el consentimiento y la identidad; el refresh token se guarda automáticamente solo en `.env.visit-mail.local`, con permisos 600. El servidor escucha únicamente en loopback y no muestra códigos, estado OAuth ni tokens en consola. No se envía ningún correo en esta fase. Después, detener el servidor con Ctrl+C.

4. Comprobar presencia de configuración sin enviar:

   ```bash
   node --env-file=.env.visit-mail.local scripts/visitMailLocal.mjs
   ```

5. Ejecutar **una** prueba autorizada, con datos de acta sintéticos:

   ```bash
   node --env-file=.env.visit-mail.local scripts/visitMailLocal.mjs --send
   ```

Sin configuración el proceso termina indicando solo los nombres de las variables pendientes. No simula un éxito ni sustituye Google por un mock. El `From` se compara con la identidad verificada y solo se permite el destinatario configurado, sin Cc/Bcc ni cabeceras de destinatario repetidas.

Antes de llamar a Gmail se crea atómicamente `.visit-mail-attempt.local` con permisos `600`. Conserva únicamente identificadores internos, operación, hora, estado, ID Gmail y error normalizado. No contiene tokens, enlaces, direcciones ni cuerpos. Sobrevive al reinicio y bloquea otro envío cuando existe un intento; no se borra automáticamente, tampoco tras una respuesta incierta. El estado aceptado exige respuesta válida del proveedor y se contrasta con la persistencia local y un replay del mismo comando.

La recepción física permanece pendiente aunque exista ID de Gmail. El enlace del correo usa intencionadamente `local-visit-test.invalid`, para impedir que una prueba sintética apunte a producción; **no es un portal público ni un enlace de revisión funcional**. No se presenta este banco como prueba funcional completa en servicios alojados. Para esa última validación hará falta una pila Supabase aislada disponible y OAuth configurado allí.

## Validación disponible

```bash
node scripts/testVisitMailLocal.mjs
node scripts/testVisitMailDelivery.mjs
```

La prueba del ejecutor utiliza respuestas Google controladas y PostgreSQL local. Comprueba rechazo sin configuración, validación de cuenta y destinatario, bloqueo atómico persistente, fallo de red incierto, un solo envío y ausencia de credenciales en la auditoría. No envía correos reales.
