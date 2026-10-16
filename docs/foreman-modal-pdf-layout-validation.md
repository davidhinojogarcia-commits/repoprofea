# Corrección de capas y visor PDF (16/10/2026)

Las capturas móviles mostraban la configuración de firma detrás de las tarjetas y el PDF reducido a una esquina. La hoja global `notification-modal-layout.css` imponía `z-index:40/1000 !important` a los portales y anulaba la secuencia global de capas. El visor además utilizaba el diseño workspace pese a anunciar pantalla completa y dependía de utilidades generadas en tiempo de ejecución para su geometría.

Cambios:

- Los portales conservan su capa creciente; los valores heredados quedan limitados a overlays que siguen dentro de `#root`. La geometría esencial del portal se declara también en línea.
- Visor PDF y configuración de firma usan explícitamente el portal fullscreen. Sus estructuras tienen CSS propio, con cabecera fija, cuerpo desplazable y controles accesibles.
- El PDF ocupa el ancho disponible. Controles de ampliar/reducir/ajustar a pantalla (100–300 %) y desplazamiento horizontal/vertical cuando corresponde; el lienzo se renderiza de nuevo al cambiar escala.
- Sin cambios en archivos originales, firmas, datos, RPC ni permisos.

Validación:

- Reproducido el fallo antes de corregirlo: la prueba de navegador con estilos de producción fallaba porque la capa del portal había sido rebajada.
- TypeScript y auditorías de capas, pila y overlays globales superadas.
- Chromium real con todas las hojas importadas por `index.tsx`: visor y configuración a 390×844, 820×1180 y 1440×900, en claro y oscuro; geometría de pantalla completa, ancho del lienzo, comprobación del elemento realmente situado delante, cierre, ampliación y desplazamiento. Fondo con contexto de capa elevado para detectar ventanas que queden detrás. Pila de dos ventanas workspace comprueba prioridad creciente.
- Se mantienen las regresiones de firmas, PDF nativos/importados, compartición, navegación, modelos y persistencia simulada.
- Capturas revisadas visualmente: PDF móvil y configuración del encargado.

Límites: servicios simulados en Chromium. No acredita recorrido con cuenta real ni Safari/iPhone, Android o iPad físicos. La CI y el resultado de publicación se registran en el PR.
