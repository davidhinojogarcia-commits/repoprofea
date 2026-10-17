# Órdenes e instrucciones de obra: validación

Rama: `feat/visit-work-orders`. Cambio aditivo sobre las actas existentes. Sin fusión, migración remota ni despliegue. La rama deshabilita despliegues Vercel automáticos.

## Comportamiento

Cada acta incorpora órdenes numeradas y referencias a órdenes anteriores de la misma obra. La revisión del contenido continúa antes de la firma; una discrepancia no elimina ni sustituye la orden. Cambios sustanciales requieren nueva versión, justificación, revisión y firma. Los acuerdos históricos permanecen disponibles.

Las competencias se conceden expresamente por el responsable de la obra o administrador, con justificación e historial. Asistir no concede capacidad para ordenar. Los ámbitos técnico, preventivo y recomendación son independientes. Verificar exige además cuenta activa con escritura de obra y competencia expresa vigente. Anular, sustituir y declarar incumplimiento requieren competencia y motivo; la sustitución identifica otra orden de la misma obra.

Al finalizar se conserva el PDF original y se publica automáticamente en Actas de visitas del portal de la obra. Dos pestañas: Actas firmadas y Órdenes pendientes. Confirmar lectura es una operación explícita, idempotente e independiente de aceptar el contenido o comprobar ejecución. Un encargado autorizado aporta avances y evidencias; declarar terminada una actuación no la cierra. Las órdenes incumplidas o ejecutadas pendientes siguen recuperándose entre visitas.

Las órdenes y referencias confidenciales restringen tanto la lista como el PDF completo. El original firmado no se redacta ni regenera: si el encargado no puede ver todas sus órdenes, ese PDF no se entrega. También se aplican las restricciones actuales a publicaciones anteriores. El historial y las evidencias conservan su audiencia de origen.

## Persistencia y consumo

Migración local `20261017083229_visit_work_orders.sql`, pendiente de aplicar en un entorno autorizado. RLS y revocación de acceso directo para anon/authenticated; API privada con comprobaciones de obra, perfil y token. Finalización y publicación transaccionales. Revisiones optimistas y claves idempotentes evitan duplicados; historial y definiciones separados del PDF firmado. Comprobación SHA-256 de los archivos conservados.

Sin polling, sin eventos por consultas, sin logs de cuerpos, imágenes, tokens ni PDF. Listas de 30 y eventos de 50, ampliación explícita. PDF y evidencias se obtienen al solicitarlos. Ocho evidencias y aproximadamente 1,5 MB por envío; límite acumulado de 30 MB codificados por orden para contener consumo. Los anexos del acta se referencian por identificador, sin duplicarlos por cada orden.

## Pruebas ejecutadas localmente

- TypeScript (`npm run lint`) y compilación de producción (`npm run build`).
- Dominio de órdenes: números/UUID, fechas/plazos, destinatarios/anexos, decisiones reservadas, competencias, límites del encargado y verificación competente.
- Integración API real → PostgreSQL PGlite → PDF real: varias órdenes, permisos, publicación, lectura idempotente, aislamiento, evidencias, concurrencia, cierre competente, referencias sin duplicados, correcciones/versiones e integridad de originales.
- Regresión existente de actas: máquina de estados, OTP, permisos/RLS, correo simulado, firmas, PDFs largos y anexos, Node ESM sin bundling, versiones inmutables.
- Chromium: editor de dos órdenes y competencia explícita; revisión y firma con mouse/touch/pen; persistencia tras recarga; portal, lectura, descarga idéntica al supervisor, declaración de ejecución y evidencia; 390/820/1440, claro/oscuro; previsualización de correos largos con acciones alcanzables y sin polling en reposo. Tamaños y entradas táctiles emulados.
- PDF de órdenes: extracción de texto y revisión visual de páginas renderizadas con Poppler.

La ejecución de CI amplía las regresiones del repositorio (firmas independientes, visor, modales, contratos/prórrogas, inicios/presencia, control horario, persistencia y otras). Su resultado definitivo debe consultarse en el PR; no debe confundirse la configuración de una prueba con su superación.

## Validación pendiente antes de producción

- Aplicar y probar la migración en Supabase de pruebas, nunca sobre producción sin autorización.
- iPhone/iPad físicos: Safari/PWA, teclado, rotación, scroll, aceptar/cancelar en diálogos, visor de PDF y descarga/compartición nativa. Android físico y lápiz real.
- Persistencia entre dispositivos físicos/cierre de sesión y cuentas reales autorizadas; revocación de competencias y acceso multiobra con el administrador.
- Entrega Gmail real a destinatarios de prueba expresamente autorizados; los tests no envían correos reales.
- Validación funcional del responsable: competencias asignadas, confidencialidad y referencias a libros oficiales. El sistema no sustituye libros obligatorios ni concede facultades contractuales, económicas o de plazo por firmar.

No se garantiza ausencia absoluta de defectos; se entregan comprobaciones reproducibles y límites explícitos para validar antes de autorizar un despliegue.
