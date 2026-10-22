# Redacción escrita y dictada de actas

## Comportamiento

- «+ Añadir asunto»: separación manual. «Mejorar y desarrollar» trabaja solo sobre el punto seleccionado.
- «Dictar visita»: campo para el dictado del teclado del dispositivo, seguido de «Organizar dictado». No hay captura propia de audio, permiso de micrófono solicitado por la web ni detección automática del final del dictado.
- La propuesta es editable y se aplica expresamente. El original permanece visible durante la revisión. No se crean órdenes ni se modifican firmas desde esta función.
- Se conservan los asuntos existentes. Se permite mover, eliminar y unir manualmente; al unir se conservan los anexos de ambos asuntos. El único punto inicial vacío se sustituye por los asuntos dictados para no bloquear después la revisión.
- Si cambia el original durante una petición, no se aplica la respuesta. Tampoco se aplica sobre otro documento: el editor se reinicia al cambiar de acta u obra.
- El dictado pendiente utiliza el almacén local cifrado existente, separado del contenido del acta enviado al servidor. Se conserva tras guardar y recargar; se elimina al incorporarlo o descartarlo. La política de borradores existente caduca a los siete días y borra la copia al cerrar sesión.
- No se pasa a revisión y firmas mientras exista dictado o propuesta pendiente. Se puede descartar y continuar manualmente aunque falle la IA.

## Configuración y consumo

Reutiliza `@google/genai` instalado en el proyecto, cargado bajo demanda en servidor. No añade SDK, tabla, migración ni función serverless. Usa la ruta autenticada de actas y sus comprobaciones de cuenta activa, propiedad y permisos de obra. Los documentos existentes solo admiten la asistencia en estado borrador.

Variables exclusivamente de servidor:

- `GEMINI_API_KEY`: credencial existente del proveedor.
- `VISIT_WRITING_MODEL`: sustitución opcional del modelo predeterminado `gemini-2.5-flash-lite`. También se reconocen las credenciales existentes `GOOGLE_API_KEY` y `GOOGLE_GENERATIVE_AI_API_KEY`. No se incluyen claves en el código.

Sin configuración, la edición manual sigue funcionando. La asistencia puede consumir cuota o generar cargos del proveedor según modelo, entrada y salida; no se ha verificado una tarifa ni se ha contratado ningún servicio. Configurar el presupuesto/cuota de la cuenta antes de habilitarla.

Una petición explícita por acción; entrada hasta 12.000 caracteres, título de 200, salida máxima de 7.000 tokens y 40.000 caracteres, hasta 30 asuntos dictados, tiempo de proveedor de 25 s y cliente de 30 s. Sin reintentos automáticos, polling, audio ni generación de PDF por pulsación. Se conserva el guardado agrupado existente: copia local a 350 ms y autosave de contenido a 3,5 s; el dictado pendiente por sí solo no provoca escrituras periódicas al servidor.

Solo se envían modo, título y texto. Sin fotografías, PDF, firmas, asistentes ni detalles completos de la obra. Sin logs de contenido ni errores completos del proveedor. Las propuestas exitosas no se almacenan en una caché de servidor. Se comparte únicamente una operación idéntica en curso dentro del mismo usuario/ámbito. La protección de seis peticiones por minuto, una operación concurrente por usuario y hasta 500 usuarios en memoria es **por instancia**, no una cuota global distribuida. El límite global de gasto debe establecerse en el proveedor.

## Fidelidad y revisión humana

Se comprueban esquema, límites, ausencia de campos extra y conjunto literal de cifras. Se rechazan omisiones detectables de «no», «pendiente de comprobar» o «se propone». Son comprobaciones conservadoras, no una demostración de equivalencia semántica: pueden rechazar reformulaciones correctas y no detectan todas las invenciones, cambios de unidades, atribuciones o negaciones complejas. Las instrucciones del modelo prohíben esos cambios; el supervisor debe revisar siempre. Las correcciones humanas de la propuesta no están sujetas al filtro de cifras del proveedor, para permitir corregir expresamente un dato del original.

## Validación local ejecutada

Base inspeccionada: `8dfcae5d1f0bf5ee18436e0ec43e994781e467be` (main, PR #295).

- `npm run lint`: pasa.
- `npm run build`: pasa; persiste la advertencia existente sobre tamaños de paquetes grandes.
- `npm run test:visit-writing`: pasa. Dominio y API real sobre PostgreSQL embebido/PGlite, permisos/RLS, cuenta inactiva, usuario ajeno y solo lectura, borradores, adaptador HTTP del SDK, respuesta inválida/truncada/error, original conservado y petición mínima. Respuestas del proveedor simuladas.
- `node scripts/testVisitWritingBrowser.mjs` con Chromium: pasa. Panel React real, servicio y PostgreSQL; edición, propuesta/aplicación/descarte, doble pulsación, cambios durante la llamada, error de IA, dictado por texto, recuperación cifrada tras guardado y recarga, combinación/movimiento/eliminación, ausencia de órdenes automáticas, modo sin conexión y geometría a 390/820/1440 px.
- `npm run test:visit-minutes`: pasa. Actas antiguas/nuevas, versiones inmutables, PDF real de una y varias páginas, firmas, anexos, persistencia, revisión, distribución y portal. Gmail/Storage simulados.
- `node scripts/testVisitMinutes31Browser.mjs` con Chromium: pasa. Regresión completa del panel, PDF, capas, revisión, firmas presenciales/remotas, envío parcial, publicación, recuperación sin conexión y conflictos.
- `node scripts/testVisitAttachmentsBrowser.mjs` con Chromium: pasa. Compresión real de una fotografía sintética de 7.707.616 a 1.370.995 bytes, orientación y no repetición del procesamiento.
- `npm run test:visit-work-orders` y `npm run test:visit-mail`: pasan. Sin enviar correos reales.

Los nuevos comandos de dominio/API y de navegador se incluyen en CI. La rama deshabilita su despliegue automático en `vercel.json`.

## Pendiente antes de activar en producción

- Ejecutar las pruebas de WebKit en CI: el motor se descargó, pero el entorno local carece de bibliotecas de sistema y no pudo instalarlas. No se declara WebKit validado localmente.
- Prueba real de generación y fidelidad en español con credencial/modelo autorizados: no disponibles en este entorno. Las pruebas simuladas acreditan integración y protecciones, no la calidad de un modelo real.
- Dictado real con el teclado, interrupción por llamada/bloqueo y comportamiento del teclado en iPhone/Safari, iPad/Safari y Android/Chrome físicos. No se ha usado un micrófono ni dispositivo físico.
- Cuentas reales de producción, correo y almacenamiento privados no utilizados en estas pruebas.
- Revisar el resultado de CI y autorizar expresamente cualquier fusión/despliegue posterior.

## Comprobación de configuración tras la publicación

La acción POST `writing-status` de la ruta existente devuelve únicamente disponibilidad de credencial y nombre de modelo. Es pública, no consulta datos de obras, no devuelve claves y no llama al proveedor. Permite comprobar la configuración real de la función desplegada, en lugar de inferirla a partir de la lista de variables de Vercel. No acredita validez de la credencial ni una generación real.

## Activación pendiente y comprobación reproducible (22/10/2026)

Revisión de main `7099001723dbfcbabfeb6c80f842eb89c93ce4e6` y de producción:
- Despliegue `dpl_32hxBwgnZ5NYVfYAtk7dCfKsSaeP`, READY y asociado a ese commit.
- POST público `/api/visit-minutes`, cuerpo `{"action":"writing-status"}`: HTTP 200, `configured=false`, `providerConfigured=false`, modelo `gemini-2.5-flash-lite`.
- Vercel registra `GEMINI_API_KEY` como secreto para Production y Preview. Su valor no es recuperable; la presencia en la lista no acredita contenido ni validez.
- El código rechaza con 503/`VISIT_WRITING_NOT_CONFIGURED` si las tres variables están ausentes, vacías o solo contienen espacios. La primera no vacía tiene prioridad; una clave inválida no activa el alias siguiente y se informa como fallo del proveedor.
- Se elimina la sustitución de claves de servidor en `vite.config.ts`. Una compilación Vite con claves sintéticas verifica que sus valores no llegan al navegador.
- No se ha sustituido ningún secreto ni redesplegado. No se ha ejecutado generación real ni usado una cuenta de producción.

Para completar la activación:
1. El titular debe guardar una clave Gemini válida como secreto `GEMINI_API_KEY` en Vercel, proyecto GestionProfea, ámbito Production, sin publicarla en chat, código ni capturas. No utilizar prefijos VITE_.
2. Una vez incorporada la protección de compilación y superada la CI, publicar el commit aprobado con la nueva variable.
3. Preparar un archivo local privado (permisos 0600) con un access token vigente obtenido de una sesión autorizada, sin compartirlo. Seleccionar el UUID real de una obra propia.
4. Ejecutar desde el repositorio:

```bash
VISIT_WRITING_TEST_TOKEN_FILE=/ruta/privada/sesion.txt \
VISIT_WRITING_TEST_WORKSITE_ID=UUID_DE_OBRA_PROPIA \
node --import tsx scripts/verifyVisitWritingProduction.ts
```

El script comprueba estado sin caché, denegación anónima y dos propuestas reales (escrito/dictado), esquema, cifras y reservas. Usa texto sintético; no crea ni guarda actas, correos, firmas ni PDF, y no imprime token, clave o contenido de la propuesta. Dos propuestas pueden consumir cuota. Para una vista previa autorizada, `VISIT_WRITING_TEST_ORIGIN` permite indicar su origen HTTPS.

Criterio de cierre: script real satisfactorio más revisión humana de la propuesta, incorporación explícita al borrador y persistencia tras guardar/reabrir desde la interfaz. La prueba con proveedor simulado y el indicador `configured=true` no acreditan por sí solos generación real ni calidad semántica.

Validación local de esta corrección: pasan `node scripts/testClientSecretIsolation.mjs`, `node --import tsx scripts/testVisitWriting.ts` y `node scripts/testVisitWritingApi.mjs` (proveedor simulado y PGlite). El verificador de producción compila con esbuild. No se ha ejecutado la CI completa ni el flujo real autenticado en esta revisión.
