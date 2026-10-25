# Redacción escrita y dictada de Actas

## Funcionamiento

El supervisor crea los asuntos escritos manualmente y puede mejorar cada asunto con IA. El dictado del teclado se introduce como texto y la IA propone su organización por asuntos. La propuesta se revisa, se puede editar y solo se incorpora mediante una acción expresa. No se generan órdenes, firmas, correos ni PDF automáticamente.

La asistencia conserva el original, rechaza cifras o reservas omitidas detectables y evita aplicar una respuesta sobre un asunto modificado mientras se esperaba. El dictado pendiente se conserva en el almacén local cifrado existente. Una propuesta o dictado pendiente bloquea el paso a firma hasta incorporarlo o descartarlo. Los filtros de fidelidad no sustituyen la revisión técnica y semántica del supervisor.

## Proveedor y cuenta gratuita

Groq es el proveedor predeterminado, con `openai/gpt-oss-20b` y salida JSON estructurada estricta. Se utiliza HTTPS directamente desde servidor, sin SDK adicional ni Vercel AI Gateway. La ruta Gateway anterior se ha retirado.

- `GROQ_API_KEY`: clave exclusivamente de servidor, sin prefijo VITE_. Nunca compartirla por chat ni incluirla en el repositorio.
- `VISIT_WRITING_PROVIDER`: `groq` por defecto. `gemini` mantiene la integración anterior únicamente si se selecciona expresamente; no es un respaldo automático.
- `VISIT_WRITING_GROQ_MODEL`: sustitución opcional del modelo. El antiguo `VISIT_WRITING_MODEL` no afecta a Groq.

Para coste cero, crear una cuenta en https://console.groq.com y mantenerla en **Free**, sin añadir método de pago ni actualizar a Developer. Los límites dependen del modelo/cuenta; al agotarlos Groq devuelve 429. El código no puede consultar ni acreditar el plan de facturación asociado a una clave: una clave de una cuenta actualizada a pago podría generar cargos. No se configura ninguna cuenta, secreto ni facturación automáticamente.

La IA funciona en nube y la interfaz existente se utiliza desde móvil/tablet; no requiere ordenador encendido. No es un servicio ilimitado ni una garantía de disponibilidad futura.

Fuentes oficiales revisadas el 23/10/2026:
- https://console.groq.com/docs/billing-faqs
- https://console.groq.com/docs/rate-limits
- https://console.groq.com/docs/structured-outputs
- https://console.groq.com/docs/your-data

## Datos, permisos y consumo

Se reutiliza POST `/api/visit-minutes`, encaminado a la función existente Gmail. La generación exige sesión, cuenta activa, permiso de escritura en la obra y, si existe acta, propiedad y estado borrador. Solo se envían modo, título y texto, sin fotos, PDF, firmas, asistentes ni datos completos de obra.

Groq permite activar Zero Data Retention en los controles de datos de la organización, también para clientes gratuitos. Debe comprobarlo el administrador antes de utilizar textos reales: este código no puede activar ni verificar esa opción. Sin ella existen excepciones de retención para fiabilidad/abuso. La documentación no acredita residencia europea; los datos retenidos se alojan en EE. UU. No equivale a la exigencia ZDR por petición de la propuesta Gateway anterior. Usar texto sintético hasta verificar estos controles y la adecuación del servicio a los datos de Actas.

Vite no sustituye claves de servidor en el navegador. Los errores usan mensajes/códigos fijos: no se leen errores del proveedor ni se registran claves, prompts o respuestas privadas. Entrada máxima 12.000 caracteres, título 200, salida 7.000 tokens/40.000 caracteres y plazo 25 s. No hay reintentos, herramientas ni cambio automático de proveedor. Se conservan una operación en curso por usuario, unión de solicitudes idénticas y seis propuestas por minuto por instancia; no es un límite global de cuenta.

## Estado y errores

`writing-status` devuelve únicamente `configured`, `providerConfigured` y `model`, sin caché. Solo comprueba que exista una clave no vacía para el proveedor seleccionado. No llama al proveedor ni demuestra validez, plan gratuito, cuota disponible o ZDR.

| Situación | Respuesta |
| --- | --- |
| Sin clave o proveedor inválido (incluido gateway) | 503 / VISIT_WRITING_NOT_CONFIGURED |
| Groq 401/403 | 503 / VISIT_WRITING_AUTH_REQUIRED |
| Groq 402 | 503 / VISIT_WRITING_QUOTA |
| Límite de Groq | 429 / VISIT_WRITING_RATE_LIMIT |
| Red, respuesta incompleta, JSON inválido o proveedor | 502 / VISIT_WRITING_PROVIDER_FAILED |

El original se conserva y se puede continuar manualmente en todos los casos.

## Comprobaciones reproducibles

```bash
npm run lint
npm run build
npm run test:visit-writing
node scripts/testClientSecretIsolation.mjs
npm run test:visit-minutes
npm run test:visit-writing-browser
```

`testVisitWritingGroq.mjs` simula HTTP y usa PostgreSQL/PGlite: permisos previos, escrito/dictado, aislamiento de datos, fidelidad, ausencia de clave, errores 401/403/402/429/500, red/JSON/truncamiento, sin reintentos ni fallback. No demuestra generación real.

Para la generación real con una sesión autorizada, guardar un access token vigente en un archivo privado (permisos 0600) y elegir el UUID de una obra propia. No compartirlo por chat ni ponerlo en argumentos:

```bash
VISIT_WRITING_TEST_TOKEN_FILE=/ruta/privada/sesion.txt \
VISIT_WRITING_TEST_WORKSITE_ID=UUID_DE_OBRA_PROPIA \
node --import tsx scripts/verifyVisitWritingProduction.ts
```

El verificador comprueba el estado sin caché, rechazo sin sesión y dos propuestas reales, escrita y dictada, con esquema/cifras/reservas. No crea ni guarda actas, no genera PDF, no envía correo ni imprime credenciales o contenido privado. Las dos propuestas consumen cuota del plan de la cuenta; verificar Free antes de ejecutarlas. `VISIT_WRITING_TEST_ORIGIN` permite utilizar una vista previa HTTPS autorizada.

## Evidencia y criterio de cierre

Validación local de Groq: pasan TypeScript, compilación completa, dominio/API/redacción con HTTP simulado, aislamiento de claves y regresiones completas de Actas con PostgreSQL/PDF reales. No se ha realizado generación real.

La CI anterior del commit 5ea900d corresponde a Gateway y no valida este cambio a Groq. Registrar la CI del nuevo commit separadamente.

Para cerrar: CI del commit final satisfactoria; cuenta confirmada Free sin método de pago; controles de datos revisados (ZDR); generación real escrita y dictada con el verificador y revisión humana; incorporación expresa, guardado y reapertura desde cuenta autorizada. Las pruebas automatizadas no acreditan dispositivos físicos iPhone/Android/iPad.

No se ha configurado una clave Groq ni ejecutado generación real. No fusionar/publicar automáticamente. Desde tablet se puede crear la cuenta y, cuando proceda configurar, introducir la clave directamente en la variable sensible GROQ_API_KEY del proyecto Vercel, nunca aquí; después será necesario un despliegue autorizado para que el runtime reciba la variable.

## Actualización sobre main — 25/10/2026

Se integra main `79f22edf01244d5c219afeae8522f65ad2ffc0fb` en esta rama,
conservando sus correcciones SAE PT409, recuperación de sesión, borradores
cifrados al salir, aislamiento entre cuentas, caché y toda la CI vigente.
La prueba de secretos ya está en main; se reutiliza sin duplicar pasos.
Solo se reintroducen los archivos del adaptador Groq y sus pruebas, la
documentación, las variables de ejemplo y la exclusión de despliegue automático.
No se sustituye package.json ni el workflow por sus versiones antiguas.

La producción sigue usando Gemini y devuelve configured=false. Los metadatos
de Vercel no contienen GROQ_API_KEY. No se descifraron secretos. No se ha
realizado generación real, ni se ha comprobado la cuenta o el dispositivo.

Fuentes oficiales comprobadas de nuevo el 25/10:
- https://console.groq.com/docs/rate-limits publica para Free y gpt-oss-20b
  30 peticiones/minuto, 1.000/día, 8.000 tokens/minuto y 200.000/día. Son
  referencias generales: los límites efectivos deben revisarse en la cuenta.
- https://console.groq.com/docs/your-data permite ZDR en Data Controls para
  todos los clientes. Sin ese ajuste pueden retenerse entradas/salidas hasta
  30 días por fiabilidad/abuso. Los datos retenidos se alojan en EE. UU.; no
  se acredita residencia europea ni que ZDR esté activado en esta cuenta.

El modelo Groq usa VISIT_WRITING_GROQ_MODEL y no la variable heredada
VISIT_WRITING_MODEL de Gemini. No hace falta sustituir esta última para Groq.
Mantener el PR en borrador hasta verificar Free, controles de datos,
credencial real, dos generaciones y revisión/incorporación/guardado/reapertura.
El verificador con sesión solo solicita propuestas; no valida por sí solo
la incorporación ni persistencia en la interfaz.
