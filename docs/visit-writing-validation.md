# Redacción escrita y dictada de Actas

## Funcionamiento

El supervisor crea los asuntos escritos manualmente y puede mejorar cada asunto con IA. El dictado del teclado se introduce como texto y la IA propone su organización por asuntos. La propuesta se revisa, se puede editar y solo se incorpora mediante una acción expresa. No se generan órdenes, firmas, correos ni PDF automáticamente.

La asistencia conserva el original, rechaza cifras o reservas omitidas detectables y evita aplicar una respuesta sobre un asunto modificado mientras se esperaba. El dictado pendiente se conserva en el almacén local cifrado existente. Una propuesta o dictado pendiente bloquea el paso a firma hasta incorporarlo o descartarlo. Los filtros de fidelidad no sustituyen la revisión técnica y semántica del supervisor.

## Proveedor y autenticación

El proveedor predeterminado es Vercel AI Gateway con `openai/gpt-5.4-mini`. Modelo y endpoints comprobados en el catálogo completo de Gateway el 22/10/2026: salida estructurada y endpoints OpenAI/Azure con ZDR y exclusión de entrenamiento.

- Vercel: habilitar OIDC en el proyecto GestionProfea. La identidad temporal se obtiene del contexto de la petición mediante `@vercel/oidc`, con alternativa a la variable de entorno de Vercel. No se copia ni se imprime el token.
- Fuera de Vercel: puede configurarse explícitamente una clave de Gateway en `AI_GATEWAY_API_KEY`, solo en servidor.
- `VISIT_WRITING_PROVIDER`: `gateway` por defecto. `gemini` permite seleccionar expresamente la integración anterior.
- `VISIT_WRITING_GATEWAY_MODEL`: sustitución opcional del modelo de Gateway. La antigua `VISIT_WRITING_MODEL` solo afecta a Gemini, evitando que su valor existente rompa la nueva ruta.
- Las claves `GEMINI_API_KEY`, `GOOGLE_API_KEY` y `GOOGLE_GENERATIVE_AI_API_KEY` únicamente se utilizan cuando se selecciona Gemini expresamente.

No existe cambio automático a Gemini ante un fallo de Gateway. La clave anterior se conserva y no se ha recuperado su contenido.

## Datos, permisos y consumo

Se reutiliza POST `/api/visit-minutes`, encaminado a la función existente Gmail, sin añadir funciones serverless, tablas ni migraciones. La generación exige sesión, cuenta activa, permiso de escritura en la obra y, si existe acta, propiedad y estado borrador.

Solo se envían modo, título y texto. No se adjuntan fotos, PDF, firmas, asistentes ni datos completos de obra. Conviene evitar datos personales innecesarios dentro del texto libre.

Cada petición a Gateway exige `zeroDataRetention: true` y restringe proveedores mediante `only: ['openai','azure']`. Si la política no puede cumplirse, falla; no se relaja ni se cambia a otro modelo automáticamente. Retención cero y exclusión de entrenamiento son políticas del proveedor, no una garantía sobre la exactitud de la redacción ni acreditación de residencia europea.

El SDK y el código de proveedor se cargan bajo demanda únicamente en servidor. Vite no sustituye claves de servidor en el navegador. Los errores devueltos son mensajes y códigos fijos, sin imprimir errores crudos del SDK, prompts, tokens ni respuestas privadas. No se activa telemetría de contenido ni Custom Reporting.

Entrada máxima de 12.000 caracteres, título de 200, salida de 7.000 tokens/40.000 caracteres, plazo de 25 s. No hay reintentos automáticos del SDK ni modelos de respaldo. Se conserva una operación en curso por usuario, unión de solicitudes idénticas y seis propuestas por minuto por instancia. Esto no es un presupuesto global: el límite monetario global debe configurarse y comprobarse en Gateway. No se han comprado créditos ni activado recargas automáticas.

## Estado y errores

La acción pública `writing-status` responde con `configured`, `providerConfigured` y `model`, con `Cache-Control: no-store`. Comprueba presencia de autenticación mediante un acceso síncrono al contexto: no refresca tokens, consulta datos ni llama al proveedor. Un valor true no acredita validez, saldo ni generación.

| Situación | Respuesta |
| --- | --- |
| Sin identidad/clave o proveedor inválido | 503 / VISIT_WRITING_NOT_CONFIGURED |
| Gateway 401/403 | 503 / VISIT_WRITING_AUTH_REQUIRED |
| Gateway 402 por saldo o presupuesto | 503 / VISIT_WRITING_QUOTA |
| Límite del proveedor | 429 / VISIT_WRITING_RATE_LIMIT |
| Fallo, respuesta incompleta o inválida | 502 / VISIT_WRITING_PROVIDER_FAILED o validación de propuesta |

En todos los casos el original permanece disponible y se puede continuar manualmente.

## Comprobaciones reproducibles

```bash
npm run lint
npm run build
npm run test:visit-writing
node scripts/testClientSecretIsolation.mjs
npm run test:visit-minutes
npm run test:visit-writing-browser
```

`testVisitWritingGateway.mjs` usa el SDK real con HTTP simulado y PostgreSQL/PGlite: identidad OIDC por contexto/entorno, permisos, escrito/dictado, política ZDR, proveedores permitidos, fidelidad, ausencia de fallback, límites y errores sin secretos. No demuestra por sí solo acceso a la cuenta real ni saldo.

Para la generación real con una sesión autorizada, guardar un access token vigente en un archivo privado (permisos 0600) y elegir el UUID de una obra propia. No compartirlo por chat ni ponerlo en argumentos:

```bash
VISIT_WRITING_TEST_TOKEN_FILE=/ruta/privada/sesion.txt \
VISIT_WRITING_TEST_WORKSITE_ID=UUID_DE_OBRA_PROPIA \
node --import tsx scripts/verifyVisitWritingProduction.ts
```

El verificador comprueba el estado sin caché, rechazo sin sesión y dos propuestas reales, escrita y dictada, con esquema/cifras/reservas. No crea ni guarda actas, no genera PDF, no envía correo ni imprime credenciales o contenido privado. Las dos propuestas pueden consumir saldo. `VISIT_WRITING_TEST_ORIGIN` permite utilizar una vista previa HTTPS autorizada.

## Evidencia y cierre

En esta revisión pasan TypeScript, build completo, dominio/API de redacción, SDK Gateway con HTTP simulado, aislamiento de secretos y regresiones de Actas con PostgreSQL/PDF reales. El flujo React de redacción pasa en Chromium a 390/820/1440 px. WebKit local está bloqueado por dependencias del sistema que este entorno no permite instalar; debe acreditarse en CI.

La rama temporal `validation/visit-writing-gateway-live` contiene una comprobación exclusivamente de vista previa protegida y texto sintético, sin acceso a obras, base de datos ni sesiones privadas. Ese punto de comprobación no forma parte de la rama final de producto.

Criterio de cierre: CI del commit final satisfactoria, generación real con identidad/saldo disponibles y revisión humana de la propuesta; además, incorporación expresa y persistencia al guardar/reabrir con una sesión autorizada. No se acreditan iPhone/Safari, Android o iPad físicos mediante emulación ni pruebas automatizadas.

