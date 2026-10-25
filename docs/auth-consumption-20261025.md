# Sesión, caché y secretos — 25/10/2026

## Cambios comprobables

- Se elimina el `getUser()` remoto adicional de `supabaseData`. INITIAL_SESSION
  sigue inicializando la identidad con el SDK; RLS y perfil activo del servidor
  siguen autorizando. La respuesta de ese getUser competía con SIGNED_OUT.
- Lecturas de profiles/data_permissions siempre en red, sin usar la copia
  offline como autorización. El perfil tiene AbortController y un límite HTTP
  de 10 s. Los reintentos son acotados y 401/403 no se reintentan tres veces.
- La validación recibe la identidad del evento, agrupa lecturas simultáneas y
  descarta respuestas de un evento anterior, incluso tras salir o cambiar de
  cuenta. La renovación vuelve a comprobar el perfil activo.
- Recuperación explícita «Volver a comprobar sesión», con los estilos existentes.
  Los fallos temporales no cierran la sesión del SDK ni borran borradores.
- El cierre de sesión ya no llama a forgetVisitDraft: se conserva el trabajo
  cifrado y separado por propietario para recuperarlo al autenticarse. Se
  mantiene la política de caducidad del almacén existente.
- La caché de supervisor/técnico se vacía al cambiar de cuenta. Respuestas
  tardías no la repueblan ni sobrescriben la configuración de la cuenta nueva.
- Invalidar lecturas crea una generación nueva también para las peticiones
  en curso. Una consulta posterior al guardado no se une a una lectura vieja.
  Las escrituras diferentes siguen ejecutándose de forma independiente.
- Un guard síncrono impide dos inicios de sesión por doble submit. El registro
  LOGIN se conserva; sus fallos dejan un código de diagnóstico sin datos
  personales. Los avisos de validación no vuelcan objetos completos de error.
- Se elimina la sustitución de GEMINI_API_KEY en Vite y se reutiliza la prueba
  de aislamiento ya preparada en #300. No se cambia el proveedor en producción.

## Mediciones y alcance

| Operación acotada | Antes | Después |
| --- | --- | --- |
| getUser remoto adicional al importar supabaseData | 1 llamada en el código | 0, comprobado en el transporte de prueba |
| Dos lecturas simultáneas del mismo perfil | Ya existía coalescencia HTTP | 1 HTTP, coalescencia conservada; no se atribuye como mejora nueva |
| Lectura después de un guardado mientras otra sigue pendiente | Podía reutilizar la respuesta anterior | Obtiene la revisión nueva sin esperar a la anterior |
| Respuesta de perfil posterior a SIGNED_OUT/cambio de cuenta | Podía restaurar datos de una validación anterior | Rechazada por la generación vigente |
| Autorización con copia offline de perfil activo | Posible en la capa REST general | Rechazada hasta consultar el servidor |

Son pruebas locales con React real y transporte/SDK controlados; no son cifras
de tráfico o tiempos de usuario en producción. Consultar un perfil siempre en
red puede aumentar alguna lectura respecto a la caché previa: es necesario
para no mantener roles revocados. No se calcula un porcentaje global de ahorro.

Pasan TypeScript, compilación, testAuthRecovery, testAuthRecoveryBrowser en
Chromium 390/820/1440 y horizontal, testClientSecretIsolation,
test:low-consumption, test:consumption-cache y test:consumption-phase2.
Las pruebas de Actas/API y Chromium pasan con IA simulada. WebKit local no
arranca por bibliotecas del sistema ausentes; la CI debe ejecutar ese motor
con sus dependencias instaladas. No se acredita iPad/iPhone/Android físico,
voz real, dos dispositivos o una sesión privada de producción.

## Cobertura de la auditoría compartida

Acceso, resumen, SAE, directorio, registros, calendario, reconocimientos, CAE,
prevención, Actas, portal, documentos, inventario y configuración usan la capa
Supabase/databaseService o servicios RPC especializados. Se han inspeccionado
235 referencias query/rpc en componentes/servicios/App, los listeners, sondeos
y la caché compartida. La corrección de generación se aplica a esa capa; no
equivale a una prueba funcional manual de cada módulo.

Ya existen consultas parciales de configuración, proyección del directorio,
invalidación entre pestañas, caché acotada, revisiones incrementales de PDF,
auditoría de accesos y franjas de sondeo. No se crean soluciones paralelas ni
índices sin justificar. Las estadísticas del servidor mostraban 114 millones
de búsquedas por índice en 494 candidatos estimados: el bucle SAE explica una
carga desproporcionada; añadir índices no resuelve el SQLSTATE incorrecto.
Los contadores son acumulados, no una medición de latencia de cada pantalla.

## IA pendiente

La consulta de metadatos de Vercel, sin descifrar valores, confirma que falta
GROQ_API_KEY. #300 conserva el adaptador y las pruebas; sigue sin generación
real escrita/dictada, verificación Free/controles de datos y guardado/reapertura
con usuario real. El titular debe crear una clave en Groq Free y añadirla como
variable sensible de servidor en Vercel, empezando por la preview de #300.
Nunca enviarla al chat. No añadir tarjeta ni actualizar el plan.
Revisar después el modelo VISIT_WRITING_MODEL heredado para no enviar un nombre
de Gemini a Groq. No se modifica aquí ninguna variable ni se fusiona #300.

## Publicación y recuperación

No hay migración adicional para esta parte. Publicar solo tras CI satisfactoria
del commit final. Revertir el frontend conserva los borradores y datos; no
revertir la corrección PT409 de SAE al antiguo 40001. La causa física específica
del aviso del iPad sigue pendiente de reproducir con su sesión/dispositivo;
las carreras corregidas están demostradas en pruebas controladas.
