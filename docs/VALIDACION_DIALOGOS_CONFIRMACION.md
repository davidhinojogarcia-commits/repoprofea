# Confirmaciones delante de documentos y ventanas

## Cambio

La confirmación global ya se renderizaba mediante un portal en `document.body`, pero su posición fija, geometría y nivel de superposición dependían exclusivamente de las utilidades del CDN de Tailwind. El CSS compilado sólo garantizaba visibilidad e interacción. Sin esas utilidades, el navegador calculaba `position: static`: la ventana podía quedar en el flujo, detrás de las tarjetas o fuera de la zona visible.

Se fijan las reglas críticas en el CSS de la aplicación: pantalla completa, capa superior, fondo de bloqueo, tamaño del panel, desplazamiento interno y márgenes seguros. La presentación conserva las utilidades existentes. En pantallas de hasta 480 px, las acciones aparecen en una columna para que los textos largos se lean completos.

Se corrige además el manejo de Enter: si el foco está en Cancelar, se ejecuta la cancelación propia del botón; el contenedor ya no la convierte en confirmación.

## Evidencias y límites

- Antes del cambio, la nueva prueba de navegador falla: `static !== fixed` al abrir una confirmación sin el generador externo de utilidades. Esto demuestra la dependencia; no demuestra qué condición concreta produjo la captura del iPhone del usuario.
- Después, `test:app-dialog-browser` valida el componente React real con y sin Tailwind, sobre tarjetas con transformación y una ventana ya abierta mediante ModalPortal. Comprueba geometría, orden real mediante `elementFromPoint`, cancelación, Escape, Enter sobre Cancelar, confirmación única, entrada de texto y avisos. Usa datos sintéticos y contadores en memoria; no borra documentos reales.
- Pruebas en Chromium: anchuras emuladas 390, 820 y 1440 px, temas claro y oscuro. Capturas inspeccionadas visualmente en móvil y tableta.
- Regresiones: publicación de documentos del encargado y flujo de actas en navegador con API/PostgreSQL de pruebas, Gmail simulado. Auditorías globales de modales, comprobación de tipos y compilación.
- No se ha validado en un iPhone físico ni en Safari real. La reproducción exacta de la captura original queda pendiente. No hay cambios en PDFs, firmas, permisos, persistencia ni migraciones.
- La compilación mantiene los avisos existentes de paquetes de más de 900 kB. No se añaden dependencias ni llamadas de producción.

Rama: `fix/global-confirmation-layer`. Despliegue automático de la rama desactivado; preparado para revisión y publicación autorizada.
