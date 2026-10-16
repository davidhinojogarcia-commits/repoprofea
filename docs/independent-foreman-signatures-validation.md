# Firma independiente del encargado: implementación y validación

Base revisada: `43add695f0aded8939e9b4a93f6ddcab4247f439` (main, 16/10/2026).
Rama: `feat/independent-foreman-signatures`. No autoriza fusión ni publicación.

## Comportamiento

- EPIs, formación e información y maquinaria: el supervisor abre **Configurar firma del encargado** en la tarjeta del documento normalizado, indica si corresponde y si es obligatoria, ajusta el recuadro y guarda el modelo. Los modelos quedan aislados por propietario y su reutilización es explícita.
- Control horario: misma configuración por jornada y modelo. El encargado completa las entradas y salidas y pulsa **Firmar como encargado**. Los cambios posteriores de filas o plantilla invalidan su conformidad, conservando trazabilidad sin duplicar imágenes en los eventos.
- La firma se recoge con el SignaturePad existente, en azul `#164B9B`. La evidencia se recupera del servidor después de guardarla. Los PDF que abre el supervisor incorporan esa evidencia de forma independiente, conservando las firmas de trabajadores.
- Los documentos adicionales normalizados conservan su circuito existente de firma propia del encargado; su botón tiene la misma denominación.
- Contratos, prórrogas, controles de presencia e inicios: no muestran, admiten ni exigen firma del encargado. Tampoco bloquea su finalización una plantilla histórica que hubiese quedado activada. Los PDF históricos permanecen intactos.
- El editor de PDF original conserva su sistema de posiciones ajustables. La política se aplica también al generador de superposiciones. Los formatos de página incompatibles siguen requiriendo revisión.
- La firma se repite en las páginas compatibles del modelo, según el comportamiento ya existente. Cada documento tiene evidencia independiente: no se reutiliza la imagen de firma de otro documento.

## Pruebas superadas localmente

| Prueba | Evidencia y límites |
|---|---|
| `npm run lint` | TypeScript sin errores. |
| `npm run build` | Compilación de cliente y servidor correcta; persisten avisos de tamaño de paquetes. |
| `node scripts/testIndependentForemanSql.mjs` | Ejecuta las dos migraciones previas y la nueva sobre PostgreSQL embebido PGlite, repite la migración y llama a las RPC bajo roles anon/authenticated. Verifica propietarios, obras, tokens inválidos/revocados, límites y permisos, persistencia, reutilización de modelos, finalización obligatoria, cuatro exclusiones, conservación de firmas de trabajadores, reintento idempotente y eventos/RLS de control horario. No es una ejecución sobre Supabase alojado. |
| `node scripts/testIndependentForemanPdf.mjs` | PDF sintético de tres páginas: original y geometría de trabajadores intactos; firmas independientes, páginas y dimensiones preservadas; exclusiones en el generador. PDF normalizados de EPIs, formación, ambos identificadores de maquinaria y control horario incluyen la firma del encargado. El arnés adapta únicamente la importación CommonJS de AutoTable para Node. Los avisos de anchura de tabla aparecen tanto sin firma como con ella. |
| `node scripts/testIndependentForemanBrowser.mjs` | Chromium real con servicios simulados: navegación, cuatro exclusiones con metadatos históricos activados, EPIs/formación/maquinaria, captura azul real del lienzo, lectura tras escritura y recarga, captura del control horario, carga/guardado de modelos y controles a 390×844, 820×1180 y 1440×900, en claro y oscuro. También compara por rasterización el PDF original y el firmado de tres páginas fuera de las máscaras de firma. No acredita persistencia en Supabase real. |
| `node scripts/testEmploymentDocumentsBrowser.mjs` | Chromium: contratos de 3 y 4 páginas, prórrogas de 1 y 2; extracción, identificación, posición bajo el nombre, corrección manual, fidelidad de superposición y editor móvil/tablet/escritorio claro/oscuro. PDF sin personas sigue disponible para recuperación manual. Modelos sintéticos, no contratos privados reales. |
| `npm run test:foreman-publication` | Publicación explícita, retirada, RPC, geometría, solapamiento informativo, editor/borradores, conservación de coordenadas, PDF, recibo, quincenas y plantillas. Incluye las nuevas pruebas SQL y PDF en CI. |
| `npm run test:employment-documents` | Análisis/importación, aislamiento de obras y propietarios, originales, permisos, firmas y regresiones de interfaz de contratos/prórrogas. |
| `npm run test:mandatory-persistence` | Guardado, coordenadas, personas añadidas/rechazadas, reintentos y verificación contra red. |
| `node --import tsx scripts/testMandatoryTraceabilityV2.ts` y `...testMandatoryTraceabilityIntegrationV2.ts` | Modelo y contrato de integración V2. Se usó `node --import tsx`: el ejecutable CLI `tsx` no podía crear su socket IPC en este entorno. |
| `npm run test:pdf-signature-workspace` | 1600 conversiones de coordenadas y regresiones del análisis de contratos. |

También se renderizaron los PDF de prueba con Poppler y se inspeccionaron visualmente las casillas del encargado en EPIs y control horario. No se modificó el diseño de los documentos existentes.

## Pendiente antes de autorizar publicación

1. Aplicar la migración `20261016154418_independent_foreman_signature_scope.sql` en un entorno de pruebas Supabase y repetir el recorrido con cuentas reales de supervisor y encargado, incluidos cierre de sesión y nueva carga.
2. Confirmar los modelos documentales reales de EPIs, formación, maquinaria y las posiciones elegidas por el supervisor. Las comprobaciones automatizadas utilizan documentos sintéticos.
3. Probar el trazo táctil, desplazamiento, teclado, orientación y apertura/compartición del PDF en iPhone/Safari, Android y iPad/Safari físicos. Chromium con tamaños adaptativos no acredita estos dispositivos.
4. Validación funcional del usuario y autorización expresa antes de fusionar, aplicar migraciones de producción o publicar.

## Producción y seguridad

No se han ejecutado migraciones remotas, escrituras de datos de producción, fusiones ni despliegues. `vercel.json` desactiva los despliegues de esta rama. Las nuevas RPC de configuración son exclusivas del supervisor autenticado y propietario; las RPC móviles validan el token activo y la obra en cada operación. Las tablas de imágenes permanecen cerradas a acceso directo. El nuevo registro de eventos de jornada usa RLS por propietario y no contiene imágenes de firmas.
