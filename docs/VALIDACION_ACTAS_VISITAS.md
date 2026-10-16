# Actas de visitas de obra — implementación y validación

Fecha: 16 de octubre de 2026. Base: `main` f76e7d856a6268eee7a649e5cf3f8d52452c240a. Rama: `feat/worksite-visit-minutes`.

## Implementación

- Navegación completa y guiada: **Actas de visitas**. Acceso también desde Documentación de obra, manteniendo la obra seleccionada.
- Configuración: **Dirección facultativa**, contactos activos/inactivos, nombre, apellidos, función, entidad, teléfono, correo y funciones por obra. No guarda firmas reutilizables. Se permite guardar contactos sin correo; no pueden recibir emails hasta completarlo.
- Actas con numeración única de servidor, revisión para concurrencia, versiones, fecha y horas de visita, emplazamiento, municipio, promotor, autor, asuntos, acuerdos con responsable/plazo, observaciones, próxima visita y anexos.
- Participación independiente: asistencia, conformidad, firma requerida/opcional y distribución final. Admite directorio, supervisor y personas añadidas manualmente; guardar un contacto habitual conserva sus otras asociaciones a obras.
- Flujo: borrador → revisión → conformidades completas → firma → PDF final conservado → distribución individual. Disconformidades y cambios bloquean la apertura de firma. Corregir contenido emitido abre nueva versión y archiva la anterior; no reutiliza respuestas ni firmas.
- Firma presencial con identificación declarada por el supervisor y confirmación de la persona, o en su dispositivo con enlace personal y código de correo. Tinta centralizada `#164B9B`, transparencia, borrado/repetición y conservación de proporción al cambiar el tamaño de pantalla.
- PDF institucional con paginación del cuerpo, versiones, marcas de tramitación, fechas, conformidades, firmas y anexos. Los PDF anexos conservan las dimensiones/orientaciones de sus páginas; los bytes originales permanecen en la instantánea del acta.
- Seguimiento posterior de acuerdos y traslado de pendientes a una nueva visita; no altera el PDF firmado.

## Persistencia, permisos e identidad

Migración aditiva: `supabase/migrations/20261016102205_worksite_visit_minutes.sql`. **No aplicada a producción.** No modifica documentos ni tablas históricas.

Ocho tablas nuevas con RLS. Los clientes no tienen permisos directos de escritura ni acceso a archivos, tokens, códigos, eventos o colas. Las mutaciones pasan por el servidor autenticado y una máquina de estados; la transacción verifica revisión, idempotencia, permisos actuales y, para participantes externos, la sesión y su revocación. Las RPC de escritura son `SECURITY INVOKER`, con ejecución solo para `service_role` y `search_path` vacío.

El autor modifica y distribuye sus actas mientras conserva permiso de modificación en la obra. Compartir una obra solo en lectura no permite crear actas ni firmar/enviar por el autor. El propietario de la obra puede consultar las actas de colaboradores. El historial propio se conserva para consulta tras perder permiso de modificación; las nuevas operaciones y accesos externos quedan bloqueados. Se respetan las reglas existentes de administración y permisos por UUID/nombre/código.

Enlaces aleatorios de 256 bits, sin información personal, en el fragmento de URL; este fragmento no viaja al servidor como ruta o referente. Se guardan huellas del token y una copia cifrada para preparar correos. Caducidad de siete días y revocación/renovación por el autor. Se mantiene el fragmento para que recargar la página siga abriendo el portal; la sesión de verificación permanece únicamente en memoria y una recarga completa requiere verificar de nuevo el correo.

El enlace solo no entrega el contenido: exige un código al correo almacenado del participante. Código de seis dígitos, diez minutos, cinco intentos, un minuto entre solicitudes y diez solicitudes por enlace. Sesión de una hora, sin persistir en almacenamiento del navegador. El participante solo puede responder/firmar por sí mismo, en su acta y versión. No se utiliza correo, participante, propietario o URL arbitrarios del cliente como autorización.

La comprobación de acceso al correo y la declaración presencial **no son identificación certificada ni firma electrónica cualificada**. La huella SHA-256 sirve para verificar integridad del archivo conservado; no se presenta como sello de tiempo o firma criptográfica. Las firmas digitales de documentos anexos deben verificarse en sus originales, no en la copia de sus páginas incorporada al acta.

## Correo e integridad

Cuenta Gmail ya autorizada del autor, utilizando los componentes OAuth existentes. Revisión previa del destinatario, asunto, texto y adjunto, con confirmación explícita. Plantillas deterministas y profesionales: no inventan acuerdos ni generan resúmenes con otro proveedor.

Un correo por destinatario, sin revelar direcciones de otros participantes. La aceptación exige un identificador de Gmail. El archivo final se genera una vez, se conserva con su SHA-256 y se reutiliza para todas las descargas y envíos. Un archivo ausente o con huella incorrecta bloquea la operación; no se regenera silenciosamente.

Cola por acta/versión/persona/fase, reclamación atómica, máximo cinco intentos y actualización transaccional de resultado y trazabilidad. Un envío aceptado no vuelve a enviarse al repetir la petición. Un fallo de confirmación posterior a la aceptación, una interrupción de red o un envío abandonado quedan como resultado incierto; requieren comprobar Enviados y no se reintentan automáticamente. «Aceptado por Gmail» no acredita recepción o lectura.

## Pruebas realizadas

| Comprobación | Resultado y alcance |
| --- | --- |
| `npm run test:visit-minutes` | Aprobado: lógica, PDF real y handler real a través de la entrada Gmail, PostgreSQL embebido, roles y RLS. Servicios Google y autenticación de prueba simulados. |
| Versiones y persistencia | Revisiones desactualizadas, idempotencia, payload cambiado con el mismo identificador, firmas requeridas, rechazo/cambios, nuevas versiones sin firmas heredadas, originales históricos y seguimiento sin modificar el PDF. |
| Seguridad local | Ocho tablas con RLS, ausencia de escritura cliente, RPC sin acceso anónimo ni `SECURITY DEFINER`, obra ajena, cuenta inactiva, obra compartida en lectura/modificación y revocación de modificación. |
| Acceso externo | Enlace sin código, código incorrecto/utilizado/caducado, límite de intentos, caducidad de enlace/sesión, revocación y prohibición de actuar como otra persona o finalizar el acta. |
| Gmail | Destinatarios individuales, MIME/adjunto exacto, permiso de envío ausente, autorización rechazada, cuota, deduplicación, fallos parciales y pérdida de confirmación persistente tras aceptar Google. Sin correos reales. |
| PDF | Acta breve firmada de una página y acta de 16 páginas con texto largo, veinte firmas, fotografía sintética y anexo PDF en dos orientaciones. Reapertura con pdf-lib, dimensiones y entrada inmutable. Archivo corrupto rechazado sin reconstruirlo. |
| Inspección visual | Poppler: acta de una página, cuerpo de varias páginas, bloques de firmas y hoja de contacto de las 16 páginas. Anexos de geometría deliberadamente en blanco para verificar conservación; no son datos de usuario. |
| `npm run test:visit-minutes-browser` | Aprobado en Chromium: contactos guardados/recargados, borrador, error/reintento de guardado, conexión lenta, doble pulsación, revisión, OTP, conformidad, firma, descarga reabierta y distribución. Backend PostgreSQL y generación PDF reales; identidad/Gmail simulados. |
| Entrada de firma | Ratón y eventos de tacto/lápiz emulados con Chromium/CDP; borrado y repetición. Píxeles azules y transparentes comprobados. Cambio de tamaño sin estiramiento ni reducción acumulativa del trazo que ya cabe. |
| Adaptación | 390, 820 y 1440 px, claro/oscuro, sin desbordamiento horizontal. Superficie blanca de firma comprobada frente a los estilos globales del modo oscuro. |
| Regresión existente | `test:foreman-publication`, `test:mandatory-persistence`, `test:low-consumption`, `test:gmail-authorization`, `test:inventory-gmail` aprobados. Auditorías de modales aprobadas con `node --import tsx`; el lanzador CLI `tsx` necesita un socket IPC no permitido en este entorno. |
| Tipos y compilación | `npm run lint`, `npm run build`, `git diff --check` aprobados. Persisten avisos previos de chunks grandes. |

## Consumo y dependencias

- Listado paginado de treinta actas, búsqueda/estado/obra en servidor. No descarga contenido, anexos o firmas para construir las tarjetas.
- No hay polling. Actualización manual y consultas canceladas al desmontar/cambiar filtros. El test de navegador comprueba que el contador de llamadas permanece inmóvil en reposo.
- El formulario detecta cambios mediante referencias inmutables: no serializa todos los anexos en cada pulsación de teclado. Las previsualizaciones se solicitan sobre borradores guardados, para no presentar una copia anterior como si incluyera los cambios pendientes.
- Una consulta de enlaces para todo el lote, comprobada con varios destinatarios; no una consulta por persona. La preparación reutiliza enlaces válidos y renueva los caducados/revocados al abrir la siguiente fase.
- Código de correo: una sola renovación OAuth por envío; las solicitudes demasiado frecuentes se rechazan antes de consultar Google.
- Escritura protegida contra doble pulsación y reintentos con el mismo identificador. Generación PDF solo al solicitar consulta o finalizar; el final se reutiliza byte por byte.
- No se añaden paquetes ni se cambian versiones. `pdf-lib` 1.17.1, ya presente, se clasifica como dependencia de producción al utilizarse ahora en servidor.
- Se conserva el número de entradas de funciones Vercel: `/api/visit-minutes` reescribe a una acción del handler Gmail existente. Carga diferida del módulo en ese handler. La rama tiene despliegue automático desactivado.
- El módulo no emite logs de documentos, firmas, cuerpos, credenciales o códigos. La trazabilidad se guarda con identificadores de acta, versión, persona, operación y envío; no se desactivan los logs existentes.
- No se han medido facturación, memoria o carga de una base de datos real en producción. No se atribuyen porcentajes de mejora.

## Normativa y decisiones pendientes

Fuentes oficiales consultadas el 16/10/2026:

- [Ley 38/1999, de Ordenación de la Edificación](https://www.boe.es/buscar/act.php?id=BOE-A-1999-21567), especialmente ámbito de aplicación y artículos 12–13 sobre dirección facultativa y Libro de Órdenes y Asistencias.
- [Real Decreto 1627/1997](https://www.boe.es/buscar/act.php?id=BOE-A-1997-22614), artículo 13 y contexto del Libro de Incidencias.

El acta de seguimiento es complementaria: no sustituye esos libros ni se declara que sus campos sean una lista universal de obligaciones reglamentarias. Los campos mínimos y firmas requeridas son controles internos de este flujo. La aplicación de normas, instrucciones del contrato/administración, custodia y plazo de conservación necesita validación institucional según la obra. No se configura borrado histórico automático.

Documentación técnica consultada: changelog Supabase y guía RLS actuales, incluida la retirada futura de cifrados TLS heredados; no requiere cambios en el cliente Node/fetch actual. Reescrituras de Vercel verificadas en su documentación oficial.

## Antes de publicar

1. Revisar el PR y autorizar migración/fusión/publicación. Aplicar la migración, comprobar grants/RLS y refrescar el esquema de PostgREST en el entorno elegido.
2. El servidor requiere las variables Supabase y Gmail ya existentes. `VISIT_APP_URL` es opcional, solo para una dirección HTTPS de entorno de pruebas; por defecto se usa el origen canónico de GestionProfea. No se confía en el Host enviado por el cliente.
3. Probar con cuentas autorizadas la entrega real de códigos/correos y la conexión Google. No se ha enviado ningún correo real durante esta tarea.
4. Verificar el recorrido con iPhone/iPad/Safari y Android físicos. El tacto/lápiz y tamaños descritos son emulación, no pruebas físicas.
5. Validar en Vercel la reescritura y ejecución publicadas: aquí se ha probado el gateway real local, no un despliegue nuevo.
6. Límites explícitos: cuarenta participantes, ocho anexos, 1,5 MB conjuntos de anexos y menos de 1,4 MB por archivo en la interfaz, PDF anexo de hasta treinta páginas, imágenes de hasta dieciséis megapíxeles y firma PNG reducida. Las imágenes dañadas o con dimensiones excesivas se rechazan antes de descomprimirlas cuando el formato lo permite. No hay conversión HEIC ni compresión automática de fotos grandes.

No se ha fusionado, aplicado la migración a producción ni desplegado esta rama.
