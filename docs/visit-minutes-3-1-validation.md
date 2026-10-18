# Actas de visitas 3.1 — implementación y validación

Fecha: 18/10/2026. Rama: `feat/visit-minutes-3-1`. Base inspeccionada: `main` `49825ad79bea7b4535d57293bb151486f93cb8d5`, versión general 1.21.2. **Trabajo para validación, no autorización de producción.** No se han aplicado migraciones remotas, fusionado ni desplegado estos cambios. El PR debe permanecer en borrador mientras existan los pendientes descritos abajo.

## 1. Diagnóstico

La implementación existente ya tenía la corrección Gmail por lotes, confirmación de ID del proveedor, idempotencia persistente y conciliación de resultados inciertos. No se atribuye de nuevo el fallo histórico a un botón sin llamada real: véase `visit-review-mail-validation.md` para la evidencia anterior.

El flujo anterior seguía tratando el primer envío de revisión como acceso personal verificado mediante código, y exigía datos/campos separados que 3.1 elimina del formulario. Los anexos base64 se retransmitían dentro del estado completo en cada edición; añadir ocho archivos hasta 8 MB podía superar además el límite de cuerpo/respuesta de una función. La firma presencial requería separar revisión, apertura global de firmas y captura. Las competencias aparecían en el formulario de cada visita.

Se han separado finalidad de borrador, revisión documental, identificación y firma. La aceptación Gmail no se interpreta como recepción, lectura ni conformidad. Las respuestas negativas y el sentido de la firma se conservan.

## 2. Arquitectura y pantallas

- `VisitMinutesPanel`: tres etapas Redactar → Revisar → Firmar; alta/edición móvil; participantes compactos; selección explícita de destinatarios; borrador real previsualizable; estados de guardado y distribución; editar, rectificar y anular según estado. No hay polling. Las tarjetas se actualizan desde la respuesta de la operación sin volver a consultar el listado después de cada guardado.
- `VisitPointsEditor`: puntos estructurados, título opcional, descripción, orden, eliminación, anexos relacionados y creación de orden desde un punto. La descripción se exige antes de revisar, no mientras se escribe un borrador vacío.
- `VisitParticipantsEditor`: presencial, remoto y destinatario del PDF final. La marca de asistencia habilita el flujo presencial. No hay categoría «No asistente». No se requiere correo para la firma presencial; sí para las operaciones remotas/envíos seleccionados.
- `VisitContactsPanel` y `VisitWorkOrdersEditor`: competencias expresas en Configuración/Dirección facultativa, no asignadas por el mero cargo. Se mantienen las verificaciones de servidor y SQL. Destinatario de una orden opcional; seguimiento y comprobación competente independientes.
- `VisitOnsiteFlow` y `VisitSignaturePad`: acta completa, respuesta individual, atestación de identidad por supervisor y confirmación de trazo en una operación atómica `onsite-sign`. También permite guardar solo la revisión.
- `VisitAttachmentsEditor`, `visitAttachmentProcessing`: procesamiento local antes de subir. Tamaños original/resultante visibles. Se conserva el archivo compatible pequeño; compresión progresiva para imágenes grandes, orientación EXIF, memoria acotada por dimensiones/entrada y cierre de recursos. HEIC depende del decodificador nativo: si no está disponible, se solicita JPEG, sin añadir una biblioteca pesada ni subir el original gigante.
- `VisitPdfPreview`: reutiliza el visor continuo de PDF en modo lectura, sin herramientas de mover firmas. Modal con cuerpo desplazable y acciones accesibles. Los PDF originales protegidos incrustados como anexos pueden descargarse sin modificarlos.
- `visitDraftStore`: copia local AES-GCM, clave de dispositivo no exportable, separación por usuario y expiración de siete días comprobada al recuperar. Se elimina al cerrar sesión. No es protección contra XSS ni garantiza persistencia si el SO elimina el almacenamiento del navegador.
- `visitAssets`, `visitFileStorage`: metadatos compactos en PostgreSQL; una copia privada por hash/obra/propietario de cada anexo optimizado. Subidas de archivos individuales, no de originales gigantes. PDF provisional reutilizado por hash de contenido/versión; PDF definitivo conservado sin una segunda copia base64 en la base de datos. Descarga temporal de cinco minutos y comprobación SHA-256 en cliente/servidor.

## 3. Guardado y compatibilidad

Debounce local de 350 ms y servidor de 3,5 s, sin una petición por tecla. Un guardado en curso no sustituye cambios posteriores del formulario. La operación pendiente se conserva cifrada antes de enviarla; si se pierde su confirmación se reproduce el mismo identificador. La revisión esperada en servidor impide sobrescribir cambios de otro dispositivo. Un conflicto conserva los dos contenidos, no los combina silenciosamente. La interfaz distingue copia local, pendiente y confirmación de servidor.

Se intenta conservar la copia al ocultar/cerrar la página; no se puede garantizar la finalización de una operación asíncrona si Safari o el SO terminan abruptamente el proceso. Esta limitación requiere prueba física y no se anuncia como garantía absoluta.

Los campos históricos no se borran. Un borrador antiguo presenta su contenido como un punto; un documento emitido/firmado antiguo conserva su versión y PDF original. Las rectificaciones crean nueva versión y revocan accesos anteriores. Un cliente antiguo no puede abrir/alterar silenciosamente un acta 3.1; el formulario nuevo comprueba la capacidad del servidor antes de habilitar su uso. No se selecciona la primera obra cuando hay varias sin una selección inequívoca.

## 4. Revisión, firmas y Gmail

El primer correo seleccionado lleva un PDF con marca «BORRADOR — PENDIENTE DE REVISIÓN Y FIRMA». No crea acceso de firma, enlace OTP ni código. Solo se envía a los destinatarios seleccionados. Abrir esta fase sin destinatarios permite continuar con revisión presencial, sin simular un envío.

La firma presencial registra persona, modalidad, versión, respuesta, intención, actor que comprueba identidad y hora de servidor. Tinta nueva `#164B9B`. Cada participante tiene un lienzo separado. No se presenta como firma cualificada. Una discrepancia admite firma de conocimiento/reservas, nunca se convierte en conformidad. Se exige tratamiento documentado de discrepancias antes del cierre.

La firma remota permanece como solicitud independiente, con enlace individual temporal y código separado, revocación y control de destinatario/versión. El cambio de modalidad invalida accesos anteriores mientras no exista firma completada. Recordatorios individuales persistentes con deduplicación y límite temporal; no reenvío masivo automático.

`Finalizar acta y enviar` congela la versión y conserva el PDF/hash, publica la referencia en el portal autorizado y prepara trabajos finales individuales. Después se intenta Gmail. Un error del proveedor no revierte el cierre ni oculta el PDF. Los reintentos solo procesan trabajos fallidos/pendientes; los inciertos requieren conciliación. Se requiere ID válido de Gmail para «aceptado» y no se inventa entrega/lectura.

**Prueba Gmail real pendiente.** Ya consta autorización del usuario para usar el remitente `davidhinojogarcia@gmail.com` y el destinatario de prueba `david.hinojo.garcia@dipucadiz.es`. No falta volver a pedir esa elección: falta una conexión OAuth del entorno de pruebas accesible al flujo de la app. No se han extraído credenciales de producción ni enviado correos mediante otro conector para aparentar una prueba de la app. El runner `visitMailLocal.mjs` y su documentación permiten la comprobación real cuando exista ese entorno. Deben verificarse ID de aceptación, Enviados y recepción física por separado.

## 5. Portal, integridad y seguridad

Se mantiene «Actas de visitas» separado de contratos/inicios. Publicación final por obra autorizada, mismo PDF/SHA que el supervisor; lectura acreditada distinta de aceptación. Órdenes pendientes enlazadas entre visitas, evidencias, responsables y verificación competente. El encargado no puede verificarse unilateralmente.

Autenticación/perfiles activos y permisos de obra se comprueban en servidor. Las tablas de assets/cache tienen RLS habilitada y sin permisos para `anon`/`authenticated`; solo el servicio autorizado opera tras validar sesión/obra. Los objetos son privados. Se comprueba pertenencia, tipo, tamaño, hash y límite total también en servidor/SQL. Se conserva la infraestructura de idempotencia, auditoría mínima e inmutabilidad existente.

Ningún token, enlace personal, OTP, firma, PDF ni cuerpo completo de correo se añade a logs. Los eventos documentales persistentes siguen separados de consola. La copia final no se regenera al descargar ni tras fallar Gmail. PDF con firma/formulario que supera 1,5 MB se rechaza sin modificarlo; un PDF pequeño protegido conserva sus bytes y, cuando se incorpora como anexo al acta, se incrusta el original, sin invalidar silenciosamente sus firmas al copiar páginas.

## 6. Consumo medido

Escenario reproducible: un PNG sintético válido de **855.872 bytes**, creación y cinco ediciones confirmadas. Comparación del handler de main inspeccionado frente al nuevo, compartiendo fixture PostgreSQL y librerías de validación; HTTP Supabase/Storage/Gmail simulado. Incluye la subida única del anexo en el caso nuevo. No incluye interacción humana ni facturación real. Resultado JSON: `visit-minutes-3-1-metrics.json`. Comando: `VISIT_BASELINE_HANDLER=<copia auditada del handler de main> node scripts/measureVisitMinutes31.mjs`.

| Indicador del escenario | Antes | Después |
| --- | ---: | ---: |
| Invocaciones lógicas de API | 6 | 7 |
| Peticiones REST a Supabase, incluidos RPC | 34 | 39 |
| Escrituras de estado, RPC commit | 6 | 6 |
| Bytes enviados en cuerpos de operaciones | 6.854.591 | 1.150.536 |
| Tamaño del estado actual PostgreSQL | 1.142.458 B | 1.571 B |
| Bytes de objeto privado de anexo | 0 (incluido en estado) | 855.872 B |
| Logs de aplicación / bytes | 0 / 0 | 0 / 0 |
| PDF temporales creados | 0 | 0 |
| Correos del escenario de edición | 0 | 0 |
| Duración de una ejecución local | 1.080 ms | 256 ms |

No se afirma que hayan bajado las consultas totales: la nueva subida privada y comprobación inicial añaden cinco peticiones REST y una invocación. Las ediciones posteriores reutilizan referencias sin volver a consultar metadatos inalterados; SQL conserva la comprobación atómica. El ahorro demostrado es en retransmisión y tamaño del estado, no en todas las métricas. Las duraciones son una muestra local con servicios simulados, **no un promedio de producción**.

Otras comprobaciones medidas:

- Compresión real Chromium: PNG sintético **7.707.616 → 1.370.995 bytes**, orientación EXIF corregida; resolución suficiente mantenida. No acredita legibilidad de toda fotografía real.
- Ocho assets de integración: **6.847.263 bytes**; estado guardado **4.522 bytes**. PDF borrador ~6,09 MB y definitivo ~6,09 MB, diez páginas; acceso privado fuera del JSON de la función. El PDF provisional idéntico se reutiliza, no se genera por cada destinatario.
- E2E Chromium de dos actas: 55 peticiones de actas, cuerpo máximo 5.159 bytes en ese caso con foto pequeña. Incluye configuración, revisiones, firmas, portal, errores y recuperación; no es coste por acta típico. Inactividad comprobada sin nuevas llamadas.
- No medidos: consumo facturado Vercel, almacenamiento global real, logs globales reales, memoria máxima del dispositivo físico, pulsaciones/tiempos humanos antes-después, promedio real Gmail y carga en red móvil. No se proporcionan porcentajes inventados.

## 7. Pruebas ejecutadas

Automatizadas reales de código/SQL/PDF, con proveedores externos simulados cuando procede:

- Dominio legado y 3.1: puntos, campos retirados, límites ocho/8 MB, respuestas, reservas, no doble firma, versión y cierre.
- Integración del handler con PostgreSQL PGlite: RLS, roles, obra ajena/compartida/inactiva, OTP, caducidad/revocación, concurrencia, idempotencia, historial, originales inmutables y publicación.
- `testVisitMinutes31`: ocho assets, subida fallida/reintento/deduplicación, imagen/PDF corrupto, aislamiento, estados compactos, PDF >4,5 MB privado, primer borrador seleccionado sin código, firma presencial atómica, remota protegida, final y publicación aunque falle Gmail, distribución final parcial/reintento y hash original.
- `testVisitMinutesMixed`: modalidades, identidad del supervisor, discrepancias, recordatorios/cooldown, revocación y pendientes mínimos.
- `testVisitMailDelivery`: OAuth ausente/caducado/renovado, correo inválido, varios mensajes privados, cuota, fallo parcial, doble pulsación, resultado incierto y aceptación con pérdida de confirmación/conciliación. **No son correos reales.**
- `testVisitMinutes31Browser`: React → HTTP → handler → PostgreSQL → PDF, Chromium. Crear, puntos/reordenar/eliminar, orden desde punto, permisos de Configuración, técnico sin duplicar, autosave, error/reintento, cero polling, borrador PDF, destinatarios seleccionados, dos firmas presenciales independientes, remota con OTP, fallo parcial final, descarga exacta del portal, copia cifrada offline, recuperación, respuesta perdida y conflicto entre dispositivos. Modales por delante, scroll, acciones alcanzables y sin overflow a 390/820/1440, temas claro/oscuro.
- `testVisitAttachmentsBrowser`: JPEG/PNG pequeños intactos, imagen >1,5 MB comprimida, EXIF 6, reutilización, formato/corrupción/dimensiones/entrada excesiva, fallo de canvas y HEIC no decodificable. PDF grande sin firma optimizado sin rasterizar; PDF firmado/formulario grande no reescrito; pequeño firmado byte a byte. Las firmas PDF de esta prueba son estructuras sintéticas, no una validación de certificados.
- PDF renderizado con Poppler e inspección visual de primera página borrador y página de firmas final; marca, contenido, proporciones y reservas visibles. Prueba PDF legado: acta extensa, veinte firmas, anexos, orientación y entrada inmutable.
- TypeScript y build completos superados; advertencia de bundles grandes opcionales preexistentes, sin precarga inicial añadida. No equivalen por sí solos a aceptación funcional.

Fallos encontrados y corregidos: código de recordatorio legado con condición SQL NULL; selectors/nombres accesibles tras reordenar puntos; control de intención de firma; reset de selección de borrador al pasar a destinatario final; referencia obsoleta tras extraer el flujo presencial; descarga asíncrona sin await; sincronización de copia local al recibir respuesta; reintento de confirmación perdida; lectura redundante de assets inalterados. Los fallos de instalación WebKit se documentan, no se cuentan como verde.

## 8. Regresiones superadas en este trabajo

`test:prevention`, `test:tutor-agent`, `test:employment-documents`, `test:employment-worksites`, firmas/anclajes obligatorios, detección de trabajadores, `test:mandatory-persistence`, `test:sae-alignment`, `test:gmail-authorization`, inventario/invitaciones/uso/Gmail, `test:foreman-publication`, trazabilidad SQL y corrección/versionado E2E, órdenes de obra, correos y actas legadas. También consumo bajo/modelo/UI, consumo fase 2 y caché, contraste claro/oscuro, descarga firmada del supervisor, clasificación de obra/periodo y ordenación de relaciones.

La prueba UI de bajo consumo tenía un stub obsoleto: solo leía la primera de varias importaciones del mismo servicio y no podía compilar el dashboard actual. Se corrigió únicamente el stub para reunir sus exports, sin relajar aserciones; la prueba de horarios, pestaña oculta, peticiones mínimas, actualización manual y parada por cuota vuelve a pasar. No se cambió el comportamiento productivo del dashboard para adaptar la prueba.

En Chromium: confirmaciones globales, visor continuo/firma PDF, contratos/prórrogas, firma independiente del encargado. Incluyen originales, contratos/inicios/presencia excluidos de firma de encargado, EPIs/formación/maquinaria/control horario, colores, posiciones, recargas y dimensiones de móvil/tableta/escritorio. La compatibilidad de firma se conserva por defecto: `MandatoryPdfViewport` solo cambia al solicitar expresamente modo lectura.

Algunos scripts `tsx` no pudieron abrir su pipe IPC en este contenedor; se ejecutaron las mismas pruebas con `node --import tsx`, sin cambiar sus aserciones. WebKit descargado, **no ejecutable aquí** por bibliotecas del sistema ausentes; la instalación de dependencias fue rechazada por permisos. CI está preparado para instalar dependencias y ejecutar ambos motores, pero su resultado debe consultarse, no presumirse.

No se afirma cobertura funcional completa de CAE, directorio o reconocimientos médicos por estas pruebas: no se han rediseñado y siguen requiriendo el smoke manual completo previsto antes de producción.

## 9. Migraciones, publicación y reversión

Migraciones nuevas, solo probadas localmente:

1. `20261017160440_visit_minutes_mixed_signatures.sql`: resumen mínimo, recordatorios idempotentes, cambio de modalidad y revocación.
2. `20261018085541_visit_minutes_points_assets.sql`: bucket privado, tablas de metadatos/cache, origen de PDF base64 o Storage y comprobación de assets en el commit transaccional.

Orden futuro autorizado: copia de seguridad → aplicar a entorno aislado → comprobar bucket privado/RLS/RPC → código servidor/cliente del mismo release → pruebas reales → validación expresa de producción. No ejecutar SQL destructivo de reversión sobre evidencias. Antes de crear datos 3.1 puede revertirse el código conservando las columnas/tablas añadidas. Después de crear datos 3.1 no desplegar un backend antiguo que ignore puntos/Storage: deshabilitar temporalmente la creación 3.1 y preparar una corrección hacia adelante, conservando archivos y hashes. No eliminar tablas, firmas ni versiones para «deshacer» el cambio.

## 10. Pendientes y riesgos que impiden darlo por terminado

1. **Gmail/OAuth y Storage reales en entorno aislado**: aceptación Gmail y recepción física, aislamiento con Supabase real, URLs privadas y RLS desplegadas. No se ha alterado producción para resolver la falta de entorno de pruebas. No se ha contratado ni creado infraestructura de pago.
2. **WebKit y dispositivos físicos**: iPhone/Safari, iPad/Safari y Android/Chrome; teclado, orientación, lápiz/dedo, zoom, compartir, HEIC auténtico, bloqueo/suspensión del SO y memoria real. La emulación de Chromium no sustituye estas pruebas.
3. **Retención/limpieza automática de temporales de servidor**: se evita duplicar originales y el PDF por destinatario, pero los assets retirados y las previsualizaciones de contenidos descartados pueden conservarse. No hay aún un recolector automático seguro con leases/referencias históricas. No se ha añadido un borrado cron que pueda competir con una firma/envío. Debe implementarse/probarse antes de considerar cumplida la optimización exhaustiva; no ejecutar borrados manuales indiscriminados. Los definitivos/versiones/evidencias no son temporales. La caducidad de enlaces no implica borrar archivos.
4. **Expiración local**: se comprueba al recuperar el usuario; no hay purga global programada de borradores caducados de otros usuarios del dispositivo. Logout sí elimina su copia/clave. Revisión de política de conservación pendiente.
5. **Validación humana** de legibilidad de fotografías/documentos y smoke de módulos no cubiertos funcionalmente; no se promete mantenerse siempre en planes gratuitos.

## 11. Guion de validación del supervisor

Solo en el entorno de prueba autorizado con migraciones y Gmail conectado:

1. Configurar contactos/competencias de la obra una vez. Abrir a 390 px o teléfono; Nueva acta, confirmar obra y añadir dos puntos. Reordenar, borrar un tercero, crear una orden sin destinatario.
2. Adjuntar una foto >1,5 MB; verificar ambos tamaños y «Archivo confirmado» después del guardado. Desconectar, editar, reconectar/recargar y recuperar; «Guardado» debe aparecer únicamente con confirmación servidor.
3. Enviar borrador: comprobar marca PDF y seleccionar solo el destinatario de prueba. Pulsar Confirmar y enviar correos. Debe llegar un borrador sin código/enlace de firma. Guardar ID Gmail y comprobar la bandeja por separado.
4. Asistente presencial sin correo: Revisar y firmar aquí; supervisor comprueba identidad, asistente lee, responde y firma. Otro asistente disconforme firma conocimiento: su discrepancia permanece visible y el lienzo debe comenzar vacío.
5. Para un remoto, solicitar firma protegida independiente; comprobar enlace/código, revisión y firma de esa persona, no de otra.
6. Registrar tratamiento de discrepancias; Finalizar acta y enviar. Provocar fallo controlado Gmail: el PDF debe seguir disponible en el portal. Reintentar solo pendientes, sin duplicar los aceptados.
7. Comparar SHA/bytes del PDF supervisor y encargado. Cambiar a otra obra/encargado: sin mezcla de documentos. Comprobar lectura y órdenes sin permitir al encargado verificarlas.
8. Rectificar una versión emitida: nueva revisión/firmas y enlaces antiguos revocados; PDF final anterior intacto. Anular con justificación, sin eliminar su evidencia.

**Estado de aceptación: parcial y verificable, no completado ni listo para producción.** PR en borrador: https://github.com/davidhinojogarcia-commits/repoprofea/pull/289 . CI remoto iniciado; su resultado no se presupone por los verdes locales. El código y las pruebas disponibles quedan en rama/PR para continuar las validaciones pendientes.
