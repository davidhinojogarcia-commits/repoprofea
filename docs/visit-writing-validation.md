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
