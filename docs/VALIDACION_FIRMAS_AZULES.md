# Firmas azules, estabilidad y consumo — propuesta 1.21.3

Rama: `feat/blue-signatures-quality`. Fecha: 14/10/2026. Base remota revisada: `fc638f58a0dff674bad074201e2da6a44c210c21`. Sin fusión, publicación, cambios de datos de producción, migraciones ni dependencias nuevas.

## Alcance y referencia inicial

Aplicación React/Vite, API Vercel y servicios Supabase; PDF originales con overlay PDF-lib, documentos generados con jsPDF, vistas/verificación con PDF.js. Se revisaron los scripts, CI y la política `Supabase_Low_Consumption_Policy.md`. No se encontraron AGENTS.md aplicables en el checkout ni sus directorios superiores.

Tres capturadores cubren los roles trabajador/encargado/supervisor: portal (jornadas, obligatorios y documentos adicionales), documentos de obra y renuncias SAE. Antes usaban `#111827`; los dos últimos pintaban un fondo blanco en el PNG. Los generadores y servicios mantienen los bytes de las imágenes, por lo que no requieren recolorear datos almacenados. Las regresiones iniciales de consumo/caché y TypeScript pasaron.

Se inventariaron 161 sitios de registro en components/src/api. Se corrigieron los puntos explícitos de carga de respuestas, filas importadas y nombres de archivo en Gmail, inventario y análisis CAE; también el diagnóstico del portal. No se afirma que todos los errores posibles de la aplicación hayan sido reproducidos.

## Cambios y causas corregidas

- `signatureInk.ts` centraliza #164B9B y grosor. `useHandwrittenSignature` conserva alpha y bordes suaves, permite borrar/repetir, identifica el puntero activo y restaura imágenes existentes sin recolorearlas. El cambio de tamaño conserva el contenido y su proporción, sin añadir movimientos ni texturas.
- El panel del portal se cerraba antes de confirmar la escritura. Ahora sigue abierto, conserva el trazo si falla, muestra el error y bloquea el doble guardado mediante una referencia inmediata. Tras guardar se comprueba la imagen exacta recuperada, no sólo la existencia de una firma anterior. También se valida el acceso/documento devuelto.
- Los generadores jsPDF deformaban algunas imágenes con dimensiones fijas y ocultaban errores de inserción mediante catch vacío. `addSignatureImage` conserva proporción/alpha y detiene la generación si la firma no puede incrustarse. Aplicado a jornadas, obligatorios generados, documentos de obra y renuncias SAE.
- El overlay rechaza originales con diccionarios de firma digital criptográfica. No intenta aplanarlos, volverlos a firmar ni cambiar sus firmas. No hay recoloreado de imágenes históricas o importadas.
- La verificación original/final abría PDF.js sin cerrar ambas tareas. Ahora las destruye incluso si falla la comparación. La vista del portal cancela su tarea al desmontarse.
- El token del portal es clave de montaje de toda la pantalla: los estados e imágenes locales no se reutilizan entre accesos.

## Optimizaciones medidas

| Escenario controlado | Antes | Después | Verificación |
| --- | ---: | ---: | --- |
| Una carga en curso y diez refrescos manuales solapados | 33 consultas | 6 consultas | Ejecución de la clase base y la nueva con el mismo transporte retenido; se mantiene una carga nueva tras finalizar la anterior. Un guardado posterior vuelve a leer. |
| Abrir un documento sin firmas | 1 lectura de imágenes | 0 lecturas de imágenes | UI completa del portal con contador de RPC; los metadatos autorizados ya indican que no hay firmas. |
| Workers PDF activos al acabar la prueba de captura/PDF | No se cerraban los dos de cada verificación | 0 de 27 creados quedan activos | Instrumentación real de Worker en Chromium. |
| Mensajes informativos SW/notificaciones incluidos en producción | 4 puntos de log | 0 puntos activos | Restringidos a DEV; textos ausentes en JS compilado. |

Las cargas simultáneas de miniaturas se agrupan por token/documento; no hay efectos de red dentro de actualizadores de estado React. Se preservan las lecturas de permisos, la verificación tras guardar, invalidaciones, aislamiento y eventos de auditoría. Los errores accionables conservan tipo/estado/código admitido y un ID de correlación; no se incluyen cargas originales ni mensajes arbitrarios del proveedor.

No se midió facturación, Logs Ingest o tráfico real agregado de producción. Las cifras anteriores son mediciones del escenario indicado, no porcentajes extrapolados de mejora global. Los listados existentes que incluyen snapshots/firmas siguen requiriendo una revisión específica de su contrato de datos; no se eliminaron campos necesarios para el flujo actual.

## Validaciones ejecutadas

1. `test:signature-quality`: refrescos concurrentes, nueva lectura posterior, registros sin cargas sensibles, encaje proporcional y error explícito de imagen dañada.
2. `test:signature-browser`: Chromium real automatizado; tres capturadores reales aislados de sus pantallas contenedoras. Ventanas 390x844, 820x1180 y 1440x900; PointerEvents mouse/touch/pen y movimiento real del ratón del navegador. Azul/alpha/bordes, firma vacía, borrado, repetición, guardado lento, doble pulsación, error/reintento, PNG recuperado tras recarga, imagen histórica oscura conservada, redimensionado, PDF de 1/2/3/4 páginas y rotaciones 0/90/180/270. Error de PNG inválido y rechazo de firma digital. Los PDF se escribieron y reabrieron con PDF.js y pypdf/Poppler.
3. Dos modelos privados autorizados: contrato escaneado de 3 páginas y prórroga escaneada de 1. Entrada inalterada, páginas/dimensiones/texto y comparación visual fuera del recuadro de firma correctas. Se insertó un trazo de prueba en la zona inferior izquierda, revisada manualmente; esta comprobación no acredita la detección OCR automática de esos escaneados. No contienen un campo criptográfico PDF activo, aunque la imagen del escaneado muestra un sello/CSV preexistente que se conserva.
4. Inspección visual de seis PDF finales: contrato y prórroga privados, jornada, documento de obra, renuncia SAE y ejemplo girado. Imágenes incrustadas examinadas por separado: tinta RGB 22/75/155 y píxeles transparentes presentes en los seis. Es un trazo de prueba, no la firma real de una persona.
5. `test:employment-browser`: 3/4 páginas de contrato y 1/2 de prórroga, detección nativa, confirmación/recolocación del supervisor, conservación del original y diseños claro/oscuro móvil/tableta/PC; recuperación con cero trabajadores.
6. `test:employment-documents`, `test:foreman-publication`, `test:mandatory-persistence`: PostgreSQL local/PGlite, importación, publicación, firma/devolución, permisos propietario/token/obra, relectura de persistencia y casos inválidos. UI completa del portal con guardado fallido, doble guardado y reintento verificado.
7. Consumo/caché/fase 2, prevención, Tutor, avisos móviles y Gmail: correctos. Otros 15 grupos: anclaje, relación, detección, trazabilidad V2/integración/SQL/E2E, trabajador omitido, layering, contraste, pila/auditoría de modales, auditoría administrativa, originales temporales y alineación SAE: correctos.
8. TypeScript/lint, compilación y diff-check: correctos. CI incorpora las nuevas pruebas; requiere esperar su resultado al abrir el PR.

## Límites y comprobaciones pendientes

- No hay pruebas físicas de dedo/lápiz en iPhone, Android o iPad, ni Safari real. Touch/pen son eventos simulados en Chromium de escritorio; tamaños de móvil/tableta son emulación de viewport.
- No se usaron credenciales de usuario para un recorrido real completo en Supabase de producción ni se enviaron documentos reales a encargados. Los flujos de backend se probaron en PGlite y las pantallas con transporte controlado; las lecturas/guardados no se presentan como una prueba de cuenta real.
- Los modelos privados se utilizaron sólo en el entorno local, fuera del repositorio y de los artefactos de CI. No se suben documentos, nombres, DNI, firmas reales ni capturas con información privada.
- La protección criptográfica se comprobó con una estructura PDF sintética; no certifica la validez de certificados digitales ni sustituye un validador de firmas.
- Queda la validación funcional del usuario y su autorización expresa antes de fusionar/publicar. No se solicita esa autorización mientras la rama se prepara; producción permanece sin cambios.
