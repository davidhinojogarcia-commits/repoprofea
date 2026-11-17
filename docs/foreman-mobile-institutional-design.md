# Norma de interfaz institucional · Portal de Encargados

Aplicación: GestionProfea. Alcance: todos los documentos, fichajes, firmas y módulos que se abren desde el portal móvil.

## Principios obligatorios

1. **Primero móvil:** diseñar, revisar y probar desde 320 y 390 píxeles, además de 820 píxeles (tableta vertical), 1366 píxeles táctiles (tableta horizontal) y escritorio con ratón. La página nunca debe desplazarse horizontalmente por una fila de acciones. La cinta de navegación puede desplazarse horizontalmente de forma independiente.
2. **Identidad institucional:** azul `#00548e` para acciones principales y selección de módulo; tonos neutros con contraste para las secundarias; rojo solo para destruir, revocar o avisar de riesgos; verde solo para estados finalizados y envíos que de verdad proceden. No cambiar estilos en escritorio sin motivo documentado.
3. **Acciones homogéneas:** botón mínimo de 44 px, objetivo recomendado de 50–52 px para interacción táctil. Un mismo grupo usa anchos, bordes, esquinas, tipografía, altura y alineación compatibles. Los textos largos deben envolver sin cortarse y no debe haber botones huérfanos; si sobran tres acciones en dos columnas, la última ocupa la fila completa en teléfono.
4. **Jerarquía y economía vertical:** la acción principal aparece claramente distinguida; las secundarias se agrupan sin proliferación de barras; eliminar o revocar pide confirmación específica. Priorizar controles nativos de fecha y selección para Safari iOS y Android.
5. **Accesibilidad:** foco visible por teclado, `aria-pressed` en las secciones seleccionables, etiquetas accesibles, área táctil suficiente, contraste texto/fondo y soporte de modo oscuro; respetar `prefers-reduced-motion`. No depender solo del color para comunicar el estado.
6. **Integridad documental:** ningún cambio visual puede saltarse autorizaciones, firmas, bloqueos de estado o confirmaciones. Un documento firmado o enviado no puede editarse de forma silenciosa. No introducir acciones nuevas que disparen dos mutaciones mediante doble toque.

## Implementación reutilizable

Las reglas de geometría y estilo residen en `index.css` bajo el prefijo `.fp-portal-ui`: `fp-section-tab`, `fp-action-row`, `fp-action-row--two`, `fp-action-row--adaptive`, `fp-action-row--stack-mobile`, `fp-action-button`, `fp-document-card`. La hoja de firma usa `fp-signature-actions`, incluso al renderizarse fuera del árbol principal mediante un portal.

No introducir reglas globales que alteren los botones de Directorio, Administración o Supervisión.

## Verificación de cada modificación

- `node scripts/testForemanDraftEditing.mjs` para control documental y permisos.
- `node scripts/testForemanPublicationUi.mjs` para el circuito de publicación, avisos y navegación.
- `node scripts/testForemanPortalResponsiveBrowser.mjs` y `BROWSER_ENGINE=webkit node scripts/testForemanPortalResponsiveBrowser.mjs` para geometría real renderizada en teléfonos, tabletas y PC.
- Regresiones existentes de control horario, documentos laborales, Partes y avisos, Prevención, actas y PDFs.
- La ausencia de desbordamientos o fallos en simuladores no sustituye la última verificación manual en dispositivos reales.

No fusionar ni publicar una modificación que falle cualquiera de las pruebas de su alcance.