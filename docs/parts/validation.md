# Partes y avisos — verificación y entrega

Rama: `feat/partes-avisos-20261026`, desde `main` `4b07dc080c9dd1aa77d1468e743f559ef7549103`.
No se autoriza fusión, despliegue ni migración de producción con esta entrega. La rama tiene `git.deploymentEnabled=false` en Vercel.

## Implementación

- Entrada principal en Portal de Encargados; sección en menús guiado/completo del supervisor; historial por contratación/ID en Directorio.
- A: borrador, declaración firmada del encargado, comunicación directa y recepción. No aprobación individual del supervisor.
- B: declaración, envío, revisión/devolución/aclaración/archivo/desestimación, nueva ratificación tras corrección, autorización firmada y comunicación.
- C: propuesta firmada para valoración con versiones congeladas de antecedentes; constancia de remisión realizada por canal autorizado. No correo automático ni potestad sancionadora.
- Acuse de recibo, observaciones/disconformidad y negativa/entrega no realizada diferenciados. Disconformidad pendiente no computa hasta revisión motivada y firmada.
- Firma táctil existente azul; hash, versión, revisión leída, actor, método de acceso y hora del servidor. No identidad cualificada inferida de una imagen.
- PDF institucional privado, copias históricas, firmas proporcionadas, integridad SHA-256 y reutilización del fichero válido. Las actuaciones firmadas y su PDF se guardan en la misma transacción; si falla el PDF no se confirma la actuación. Documentos y anexos se sirven por API autenticada, sin enlaces públicos permanentes.
- Catálogo ampliable y reglas operativas auditadas por obra. Riesgo, urgencia, dudas y reiteración fuerzan revisión. No reclasificación crítica por encargado.
- Comparabilidad exige mismo supervisor, obra estable, contratación estable y motivo. Confirmación humana de antecedentes, ventana aprobada y exclusión de archivados, desestimados, anulados, bloqueados y entregas no acreditadas. Tres avisos no elevan ni sancionan automáticamente.
- Notificación genérica persistida en la transacción; indicador y Realtime del supervisor; Web Push mediante VAPID existente, alta explícita del dispositivo, cola con lease, idempotencia y máximo tres intentos. Aceptación del proveedor no equivale a recepción física.
- Borradores en IndexedDB AES-GCM reutilizando `visitDraftStore`, ámbito por usuario/hash del enlace y caducidad heredada de siete días. Recuperación al recargar/minimizar y sincronización explícitamente solicitada al recuperar red. No firmas/tokens en el borrador; actuaciones formales solo se confirman online.

## Pruebas reproducibles

```sh
npm install --no-audit --no-fund
npx playwright install --with-deps chromium webkit
npm run test:parts
npm run test:parts-browser
npm run lint
npm run build
```

`test:parts` ejecuta el handler real, generación PDF real y la migración real en PostgreSQL/PGlite. Simula únicamente transporte Auth/PostgREST y entrega al proveedor Push. Incluye aislamiento entre cuentas y obras con nombres homónimos; política por obra; bloqueo sin política; RLS/ACL; accesos revocados; firmas obligatorias/obsoletas; concurrencia CAS; doble autorización; pérdida de confirmación después de commit y reintento sin duplicados; comparación invalidada entre lectura y commit; PDF manipulado; anexos ajenos; fechas civiles y cambios de horario de Madrid; paginación estable y proyección; tres avisos sin sanción automática; bloqueo de conservación y reintentos Push limitados. No son conexiones simultáneas a producción: PGlite usa una conexión con comandos HTTP intercalados y puntos de concurrencia explícitos.

`test:parts-browser` usa React, firma táctil, IndexedDB, service worker, HTTP y handler reales con PGlite. Sustituye la frontera de sesión del SDK. En cada motor prueba 390/820/1440, claro/oscuro, recuperación offline tras recarga, reconexión, aviso directo y recepción con disconformidad. Además: sesiones HTTP separadas de encargado/supervisor, rechazo de comunicación prematura B, devolución/corrección/nueva firma, autorización, negativa sin firma inventada, descarga PDF, horizontal 844×390 y descarte de una respuesta tardía al cambiar de cuenta. No prueba voz real: el texto representa apuntes escritos/transcritos por teclado.

Diferencia de conectividad: Chromium recarga con `context.setOffline(true)`. Playwright/WebKit presenta un error documentado al rechazar navegaciones atendidas incluso por un service worker con respuesta literal ([microsoft/playwright #42775](https://github.com/microsoft/playwright/issues/42775)). Para WebKit se detiene realmente el servidor HTTP, se exige recarga de un documento nuevo desde caché con el servidor inaccesible y se comprueba el borrador recuperado. La interfaz detecta el fallo real del contexto y conserva el trabajo; no depende únicamente de `navigator.onLine`, que no es una prueba de acceso al servidor. Se reinicia el origen y se confirma la recuperación con «Comprobar conexión», que renueva la validación de permisos. WebKit no emite de forma fiable eventos de conectividad bajo esta emulación. No se omiten las aserciones ni se capturan errores de navegación para declararlos éxito. Una caída del origen no equivale a una prueba física del modo avión de Safari. El mismo escenario puede reproducirse con Chromium mediante `PARTS_ORIGIN_OUTAGE=1 node scripts/testPartsBrowser.mjs`. La prueba verifica además que un 403 real no restablece el contexto autorizado desde caché: conserva el texto local y bloquea el guardado en servidor.

Con `PARTS_EVIDENCE_DIR=/tmp/parts-evidence` guarda capturas y PDF sintéticos; la CI adjunta `partes-browser-evidence` durante tres días. Ningún dato real se utiliza.

## Resultados y límites

- Local: pruebas del handler/PostgreSQL y flujo Chromium ejecutadas satisfactoriamente. TypeScript y compilación ejecutados; repetir/consultar CI del commit final al revisar cambios posteriores.
- Regresión local: Actas (dominio, firmas, versiones, PDF e integración) y publicación/documentos del portal ejecutados. La CI completa contiene autenticación, SAE, Directorio, prevención, reconocimientos, inventario, firmas, notificaciones, correo y demás regresiones existentes; su resultado pertenece al SHA concreto del PR.
- WebKit local: runtime descargado; faltan bibliotecas del sistema y el instalador de este entorno falla por permisos de apt. La CI instala dependencias y debe superar ambos motores; no presentar el intento local fallido como validación.
- Sin migración en Supabase real, sin despliegue, sin pruebas reales de VAPID/Supabase Realtime o correos, sin uso de iPhone/Android/iPad físicos. No se certifica funcionamiento en producción.
- Se revisaron visualmente páginas PDF sintéticas mediante Poppler. No se alteran originales ni firmas existentes de otros módulos.

## Consumo y límites técnicos

Listas de 25 registros, cursor de fecha/ID y metadatos; detalle bajo demanda; trabajadores por páginas de 250 (límite 2.000 en una obra); máximo 100 antecedentes presentados por detalle; no peticiones por pulsación ni polling. Una suscripción del supervisor se limpia al salir/cambiar de cuenta. Reutilización de cuatro ficheros verificados en memoria durante 45 s, borrada al cambiar de cuenta. PDF persistido por revisión, sin regenerarlo en descargas repetidas.

Máximo cuatro anexos por versión, 1,5 MB por anexo, hasta doce anexos privados almacenados por registro y PDF generado de 3 MB para respetar el transporte de Vercel. Se comprimen imágenes con la utilidad existente. No se guardan audios ni se añade proveedor IA o dependencia nueva de pago. Los ficheros privados usan el patrón existente de bytes en PostgreSQL, con base64: consumen cuota de base de datos, aproximadamente 4/3 del tamaño binario más metadatos; no se promete almacenamiento gratuito ilimitado. Evaluar el uso antes de una implantación masiva.

Sin datos de consumo en producción ni comparación previa equivalente para un módulo nuevo. No se atribuyen porcentajes de ahorro ni reducción de logs de infraestructura. La aplicación no registra textos, firmas, tokens ni documentos en logs. Los errores se devuelven con códigos genéricos; el estado y la auditoría funcional permiten diagnosticar conflictos sin volcar contenido en consola.

## Pendientes reales antes de activar

1. Responsable laboral/DPD: validar entidad empleadora, régimen y convenio, competencias, destinatario, base jurídica, información al trabajador, audiencia, criterios y plazos por obra. Una política técnica de prueba no es validación jurídica. No activar una obra con empleadores/régimen distintos que esta política común no represente.
2. Supervisor registra la política aprobada por obra (identificación del revisor, criterios y plazos). Sin ella se permiten borradores pero se bloquean firma/envío, autorización, recepción y elevación/remisión formales.
3. Canal de entrega: el menú del sistema para compartir requiere comprobación manual del destinatario y no acredita recepción. No verifica técnicamente teléfonos/correos externos ni envía correos automáticamente. La remisión C es una constancia declarada de un acto efectuado fuera de la app.
4. Identidad: acceso portador por obra, no autenticación personal fuerte del encargado; recepción del trabajador asistida en ese móvil. El responsable debe validar que el procedimiento y custodia de enlaces son adecuados.
5. Conservación: alerta por plazo configurado y bloqueo motivado disponible. No purgas automáticas de evidencias; supresión/levantamiento del bloqueo requieren procedimiento específico autorizado del responsable, aún pendiente de concreción jurídica. No borrar tablas para resolver solicitudes de derechos.
6. Offline: tras una apertura online previa. TTL siete días y claves en el mismo origen; el cifrado no protege contra XSS o un dispositivo desbloqueado. No se prometen firmas formales offline ni conservación indefinida.
7. Identidad laboral: el historial sigue el ID de contratación del Directorio; no une contratos distintos automáticamente por nombre. No compartir entre supervisores ni convertir homónimos en una misma persona.
8. Validación física: iPhone/Safari, Android/Chrome, iPad/Safari; teclado/dictado nativo, táctil, compartir, Push real, suspensión/reanudación, varias pestañas/dispositivos y cambios de red. Usar datos ficticios en entorno no productivo.
