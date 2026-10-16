# Apertura del PDF después del envío (16/10/2026)

El botón «Ver PDF» de Finalizados llamaba siempre a la RPC que sirve originales importados. Los documentos nativos de EPIs, formación y maquinaria no tienen ese archivo, por lo que aparecía «El PDF original no está disponible; debe volver a importarse».

La apertura y la compartición utilizan ahora el mismo generador que el supervisor para documentos nativos, con las firmas gráficas de trabajadores y la evidencia independiente del encargado recuperadas mediante las RPC existentes y su token. Los documentos importados y todos los contratos/prórrogas conservan la descarga del PDF firmado almacenado; nunca se acepta una variante original como firmada. No hay migración ni cambios de permisos o datos.

## Validación local superada

- `npm run lint`: TypeScript.
- `npm run build`: cliente y servidor.
- `node scripts/testIndependentForemanPdf.mjs`: PDFs originales, geometría y firmas independientes; modelos nativos y exclusiones.
- `node scripts/testIndependentForemanBrowser.mjs`: Chromium real; navegación y firma azul, lectura posterior/recarga, control horario, modelos y controles en móvil/tablet/escritorio claro/oscuro. Añadida apertura desde Finalizados y compartición de los tres modelos operativos con imágenes de ambas firmas; comparación exacta de bytes del contrato importado; rechazo de una respuesta original sin PDF firmado. Los documentos nativos no llaman a la RPC de originales. La prueba simula servicios, no una cuenta real de producción.

Pendiente: recorrido con cuentas reales y comprobación de apertura/compartición en Safari/iPhone, Android e iPad físicos. Los tamaños adaptativos de Chromium no acreditan el comportamiento táctil o Web Share de esos dispositivos.
