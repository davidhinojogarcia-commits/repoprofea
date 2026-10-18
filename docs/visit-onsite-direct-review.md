# Revisión y firma presencial directas

El botón principal del borrador pasa a ser **Revisar y firmar**. Guarda los cambios
pendientes, valida y fija la versión para participación y muestra las fichas de
revisión/firma de los asistentes. Cada persona sigue leyendo el contenido completo,
registrando su respuesta y confirmando expresamente su firma en el móvil del
supervisor. No se presume conformidad ni se omite la identificación presencial.

El recorrido presencial ya no abre la ventana de correos, genera un PDF provisional
para envío, consulta la autorización Gmail ni envía un borrador. El envío del PDF
definitivo y su publicación en el portal mantienen el flujo de finalización.

Solo cuando hay participantes remotos aparece la acción secundaria **Enviar borrador
a participantes remotos**. Su selector excluye a los asistentes presenciales. La
firma remota protegida continúa disponible con el procedimiento existente.

Se conserva la incorporación del encargado y técnico responsable de la versión
actual de main. El cambio se aplica sobre `7a0fe245ffe4ce50272b8902d775d15fd5c51e81`;
no modifica documentos firmados, permisos, esquema ni datos históricos.

## Cambios

- `VisitMinutesPanel.tsx`: apertura directa de participación con el comando
  existente `review`, destinatarios vacíos y bloqueo de doble pulsación; guardado
  previo; progreso «Redactar → Revisar y firmar»; correo remoto opcional.
- `VisitParticipantsEditor.tsx`: opción de recibir borrador solo para remotos;
  el envío final sigue siendo seleccionable para todos.
- `testVisitMinutes31Browser.mjs`: prueba el recorrido directo con Gmail simulado
  sin autorización, doble pulsación, ausencia de correos, fichas de participación,
  revisión y firmas, alternativa remota y caso exclusivamente presencial.

No hay migraciones ni dependencias nuevas. Se reutilizan los componentes y permisos
existentes siguiendo las pautas de React/Supabase. La acción principal elimina
el modal de revisión de correos y su confirmación del recorrido presencial, además
de las llamadas de previsualización de correo/PDF y envío de borrador. No se
atribuyen porcentajes de ahorro ni métricas de consumo de producción.

## Validación

Comandos: `node scripts/testVisitMinutes31Browser.mjs`, `npm run test:visit-minutes`,
`npm run lint`, `npm run build`, `git diff --check`.

El navegador usa React, handler, PostgreSQL y generación PDF reales con Gmail y
Storage simulados. Se comprueban anchos 390/820/1440, revisión presencial con
conformidad y disconformidad, firma remota, finalización/distribución parcial y
recuperación del borrador sin conexión. No se han realizado envíos reales ni
pruebas físicas en iPhone/Android/iPad. CI completo pendiente del PR.

Resultado local: navegador Chromium, dominio, integración PostgreSQL, firma mixta,
PDF, TypeScript, compilación y auditorías de capas/modales superados. El entorno
necesitó reinstalar el navegador de pruebas; Chromium Headless ejecutó después el
recorrido completo. Se conserva el aviso de compilación sobre chunks grandes.

Prueba manual: crear acta, añadir asistentes presenciales y contenido, pulsar
«Revisar y firmar», abrir la ficha de cada asistente y confirmar su respuesta y
firma; después «Finalizar acta y enviar» para distribuir el documento definitivo.

Preparado para validación, sin publicación en producción en esta tarea.
Reversión: revertir el commit; no hay cambios de datos que revertir.

## Precarga del encargado desde Configuración

El botón anterior creaba una ficha vacía. Ahora carga los recursos de Configuración
→ Obras y Recursos Preventivos mediante una proyección limitada de `user_settings`
del usuario autenticado. La carga se realiza una vez al abrir el módulo, en paralelo
con los datos existentes; añadir al encargado no genera más consultas.

La obra se selecciona por identificador y la configuración se enlaza por nombre
completo coincidente, sin aproximaciones por código o fragmentos. Si faltan datos
o la configuración es ambigua se indica que debe completarse; no se crea una ficha
vacía ni se utiliza una persona de otra obra. Se rellenan nombre, cargo/categoría
y teléfono. El correo queda vacío y «Recibe PDF final» desmarcado: puede revisar y
firmar presencialmente y consultar el documento definitivo en el portal autorizado.
La instantánea del borrador conserva los datos; no se reescriben actas firmadas al
modificar la configuración. No se conceden competencias técnicas por asistir.

Pruebas añadidas: selección exacta y ambigua de obra, datos incompletos, nombre/cargo/
teléfono sin correo, duplicación por pulsación, servicio real de lectura con
transporte simulado y proyección limitada al usuario, firma presencial del encargado
en el flujo completo con técnico remoto y publicación del mismo PDF en el portal.
El test unitario `scripts/testVisitForeman.ts` se incorpora a `test:visit-minutes`.
