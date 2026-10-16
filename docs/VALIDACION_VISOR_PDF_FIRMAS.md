# Visor continuo y edición de firmas — validación del 16/10/2026

## Alcance y estado

Rama de desarrollo `feat/pdf-signature-workspace`. No se ha fusionado a main, publicado, aplicado migraciones ni escrito datos de producción. Se parte del PR #261 (`cb9527b6`) y se incorpora la corrección de capas del PR #264; ambas propuestas siguen sujetas a revisión. No se incorpora en bloque el PR #260: se mantiene la tinta de las nuevas capturas mediante una constante, sin recolorear imágenes guardadas.

## Causas comprobadas

1. El editor tenía un único canvas para la página seleccionada, por lo que no podía ofrecer scroll continuo entre páginas. La selección de página también podía cambiar el metadato de la firma. El visor nuevo separa navegación y edición.
2. Los campos rechazaban anchuras superiores a 160 puntos y alturas superiores a 40; el valor controlado volvía inmediatamente al anterior. No existían asas de dimensionado.
3. Tocar el canvas colocaba una firma sin un modo explícito de edición. Se separan «Navegar por documento» y «Mover firma».
4. La regla global de modales imponía z-index 40 y geometría de área de trabajo al portal de pantalla completa; la navegación tenía z-index 50. Se conserva la solución del PR #264.
5. El OCR real de los formularios produce variantes como «Ellla» y «TRABAJADORÍA». Las reglas estrictas no las reconocían. Además, el nombre en la tabla de datos podía competir con la zona de firma y los spans OCR solapados podían contar como varias ubicaciones.
6. Existían tareas PDF.js sin destruir en extracción, análisis general y comparación de fidelidad. La nueva prueba de navegador detectó dos workers retenidos por una comparación; la corrección deja cero activos al cerrar el recorrido probado.

## Implementación

- `components/MandatoryPdfViewport.tsx`: visor común de páginas continuas; scroll vertical y horizontal; rueda, arrastre con ratón y navegación táctil; zoom con botones y Ctrl/Meta+rueda; ajustar ancho/página; pinza nativa donde el navegador la permite; navegación por páginas sin cambiar la firma; centrado inicial en la zona detectada; herramientas plegables.
- Capa DOM independiente del canvas para mover la firma y dimensionar sus cuatro esquinas con Pointer Events y captura del puntero. Controles por teclado y coordenadas PDF reales. Navegar no modifica ni confirma firmas.
- `components/MandatoryPdfAnchorEditor.tsx`: controles numéricos con coma/punto, dimensiones limitadas por la página en lugar de los topes anteriores, restablecimiento, ajustes plegables, pantalla completa con respaldo cuando la API no existe, bloqueo inmediato de doble guardado y error visible conservando el borrador.
- `src/lib/pdfSignatureCoordinates.ts`: transformaciones completas PDF/viewport, incluidas rotaciones, zoom y desplazamiento del origen; dimensionado y límites. No muta los anchors existentes.
- `src/lib/employmentDocumentAnalysis.mjs`: variantes OCR observadas y acotadas; separación entre bloque de datos y campo de firma; «Fdo.» asociado al nombre exacto; columna del trabajador; espacio disponible y confianza; agrupación de spans solapados del mismo campo. Dos campos distintos o baja confianza siguen pendientes. No se presupone la última página.
- `src/lib/pdfOcrCache.ts`, `src/lib/clientDocumentText.ts`, `src/lib/mandatoryPdfOverlay.ts`: reutilización del OCR por File/página en contratos/prórrogas, sin almacenamiento persistente ni mezcla por nombre de archivo; liberación de tareas/worker en finalización y error. El visor limita los píxeles del canvas, renderiza cerca del área visible y libera los lienzos alejados; editar un cuadro no vuelve a renderizar el PDF.
- `components/ModalPortal.tsx`, `notification-modal-layout.css`, `index.css`: modo fullscreen explícito y geometría contenida, scroll con min-height:0 y paneles que se pueden ocultar; los modales normales conservan el modo workspace.
- `src/lib/signatureInk.ts`, `components/ForemanMobilePortal.tsx`, `components/AdditionalWorksiteDocumentsPanel.tsx`, `components/SaeRenunciationBridge.tsx`: nuevas capturas en `#164B9B`. Las imágenes anteriores permanecen intactas; el generador mantiene el ajuste proporcional dentro del cuadro aprobado.
- `scripts/testPdfSignatureCoordinates.ts`, `scripts/testPdfSignatureWorkspaceBrowser.mjs`, `scripts/testSignatureEditorLayeringBrowser.mjs`, `scripts/testEmploymentDocumentAnalysis.mjs`, `package.json`, `.github/workflows/ci.yml`: pruebas y regresiones. `vercel.json` desactiva los despliegues automáticos de la rama.

El mismo editor sigue siendo la entrada única de ajustes para contratos, prórrogas, inicios, controles de presencia y los demás documentos obligatorios importados. No se crea un flujo alternativo de importación ni se cambian las RPC de persistencia o publicación.

## Pruebas ejecutadas con resultado correcto

- TypeScript (`npm run lint`) y compilación (`npm run build`). Se conserva el aviso de paquetes grandes; no se realiza una reestructuración ajena a este trabajo.
- `npm run test:employment-documents`: contratos/prórrogas, identidad, estado pendiente, original, permisos, idempotencia, SQL/PGlite y publicación explícita.
- `npm run test:employment-worksites`: códigos únicos/dudosos, lotes manuales/Gmail consecutivos, no heredar obra seleccionada, errores OCR, propuestas, confirmación y reintento.
- `npm run test:foreman-publication` y `npm run test:mandatory-persistence`: bytes, dimensiones, posiciones, reapertura, RPC, fallos de red, revisión persistida, periodos/quincenas y solapamientos informativos.
- Pruebas de detección de trabajadores, anclaje de firmas y trazabilidad V2 (modelo, SQL, E2E de corrección/versionado y contrato de integración).
- Pruebas de capas, pila y auditoría global de modales, contraste claro/oscuro y bajo consumo.
- `npm run test:pdf-signature-workspace`: 1600 conversiones de coordenadas con zoom/rotaciones, origen desplazado, límites, dimensionado y aislamiento de caché por File/página. Regresiones de etiquetas OCR, tabla de datos, spans duplicados, página intermedia y ambigüedad.
- Prueba Chromium con PDF.js/PDF-lib reales: PDF nativo de cuatro páginas con firma en la segunda, scroll continuo/horizontal, zoom, ajuste ancho/página, invariancia de coordenadas al navegar, dimensiones 230×70 puntos, arrastre y dimensionado con ratón y con eventos táctiles, doble guardado, fallo/reintento, reapertura y fidelidad del PDF firmado.
- La misma prueba recorre contrato, prórroga, inicio, control de presencia y EPIs con navegación táctil, paneles plegados y coordenadas conservadas. Los eventos táctiles son automatizados, no una prueba física.
- Prueba del PR #264: 24 combinaciones de seis tamaños, dos estados de menú y dos temas, hit-testing de controles, guardado y foco. Se comprueba también que el modal normal conserva su geometría.
- La batería anterior de navegador también pasó contratos de 3/4 páginas, prórrogas de 1/2, identidad, firma/fidelidad, PDF sin trabajadores reconocidos y vistas PC/tablet/móvil claro/oscuro.

## Documentos privados reales

Se ejecutó la importación del cliente con los dos PDF escaneados aportados, usando Tesseract.js y el modelo español `4.0.0_best_int` predeterminado. Los recursos del motor y del idioma se sirvieron localmente para no depender de las descargas CDN durante la prueba. OCR, lectura de páginas y generación/comparación PDF fueron reales; catálogo y persistencia se simularon.

| Documento | Páginas | Identidad y ubicación | Original |
|---|---:|---|---|
| Contrato aportado | 3 | Nombre contrastado; zona del trabajador en página 3, sin seleccionar empresa/representante | Base64 idéntico y SHA-256 conservado |
| Prórroga aportada | 1 | Nombre contrastado; zona del trabajador en página 1 | Base64 idéntico y SHA-256 conservado |

Hashes originales comprobados de nuevo al terminar:

- Contrato: `30d5a289de5866f13502cf42afddb76a21f229b796d5b1b11b65beb0e11ac219`.
- Prórroga: `1cf083e551af064a3aba82756cd1723c1d7c34b38e06c62a57ee8bcb879461a9`.

Tras confirmar manualmente se generaron PDF firmados de prueba: páginas, dimensiones, rotaciones, texto y comparación visual fuera de las zonas aprobadas correctos. Se inspeccionaron visualmente el editor y la firma en ambos documentos. Se conservaron los originales; la salida firmada es un archivo nuevo. Ningún PDF privado, nombre, OCR, captura o firma de prueba se incorpora al repositorio. El cierre final de la prueba registra cero workers activos.

## Límites y validación pendiente

- Las pruebas usan Chromium automatizado y tamaños de viewport; no acreditan Chrome/Edge instalados en Windows ni Android, iPhone/iPad físicos o Safari/WebKit. Tampoco acreditan la pinza táctil de esos dispositivos.
- Reapertura de UI con los anchors guardados y persistencia PostgreSQL/PGlite están probadas por separado. No equivalen a una sesión autenticada de producción. Catálogo, servicios y transporte se controlan en las pruebas de cliente.
- Falta el recorrido autenticado supervisor → publicación explícita → encargado real → devolución → recarga del supervisor, con los originales y posiciones contrastados en la cuenta real. No se han enviado documentos ni avisos a encargados reales.
- La detección probada cubre estos modelos reales y variaciones nativas. No garantiza cualquier escaneado: ilegibilidad, confianza insuficiente, varios campos o geometría no fiable conservan revisión manual. Las páginas rotadas/cortadas sin geometría segura no reciben una propuesta automática de contrato.
- No se modifica ni reclasifica ningún documento anterior. La UI conserva los anchors recibidos al abrir; el guardado sigue siendo explícito.

## Criterio de aceptación para integrar y publicar

1. CI correcta del commit final y revisión de la rama integrada con las propuestas #261/#264.
2. En un entorno que contenga esta rama, verificar con cuenta real la reapertura, envío y devolución de contrato/prórroga; conservar hashes del original, identidades, páginas y geometría aprobada.
3. Probar en los dispositivos físicos disponibles el desplazamiento, navegación/edición, tamaño del cuadro, pinza y zonas seguras.
4. Obtener autorización expresa antes de fusionar a main o publicar. No se ha realizado ninguna de esas acciones.
