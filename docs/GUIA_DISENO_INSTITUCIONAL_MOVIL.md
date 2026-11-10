# Criterios institucionales de interfaz · GestionProfea

Estas reglas son referencia para **todas** las modificaciones de interfaz y deben contrastarse en revisión de código. Mantener la coherencia con los componentes y estilos existentes prevalece sobre introducir colores o patrones nuevos.

## Móvil primero (obra, iPhone Safari y Android Chrome)
- Diseñar inicialmente para 360–390 px. No permitir desbordamiento horizontal de página, formularios, listas, tarjetas ni cuadros de diálogo.
- Acciones táctiles con altura mínima 44 px, separaciones consistentes (8–12 px) y etiquetas cortas pero inequívocas.
- Usar filas de acciones del mismo ancho/alto o cuadrículas de 2 columnas; permitir 1 columna cuando el texto no quepa sin recortarlo.
- Mantener visibles los pasos operativos principales: redactar, guardar, revisar, firmar y finalizar. Agrupar acciones infrecuentes en `details/summary` o un menú accesible.
- No ocultar errores, avisos de guardado, pendientes de revisión o riesgos de envío.

## Diseño institucional y accesibilidad
- Reutilizar tokens, variantes y componentes de GestionProfea; color de acción principal institucional `#00548E`.
- Conservar la paleta, tipografías, radios, bordes y patrones de tarjetas de la app; estilos coherentes en modo claro y oscuro.
- Priorizar contraste, `focus-visible`, etiquetas accesibles y orden lógico de tabulación. Los estados y errores no dependerán únicamente del color.
- Usar `min-w-0` en cuadrículas y contenido truncado con `title`/alternativa accesible cuando proceda.

## Tarjetas y flujos de actas
- En listados mostrar por defecto **número, obra, fecha, estado y pendientes**. Evitar listados de nombres o textos largos que aumenten innecesariamente la altura.
- Las acciones peligrosas (eliminar/anular) no estarán mezcladas con acciones habituales y mantendrán la confirmación y trazabilidad existentes.
- Formularios secundarios y participantes pueden plegarse, pero deben conservar campos, datos, firmas, permisos, historial y funcionalidades.
- Revisar siempre que la adaptación visual no modifica los documentos PDF originales ni los estados jurídicos de las actas.

## Criterios mínimos de aceptación
- TypeScript, build y regresiones existentes sin errores.
- Validar en Chromium y WebKit simulando móvil 360/390 px, tableta ~820 px y escritorio.
- Comprobar no desbordamiento, anchura y altura de botones, orden de lectura, estados plegables, guardado y acceso a acciones.
- Verificar en dispositivos físicos iPhone/Safari y Android/Chrome cuando la publicación afecte a un proceso en obra; registrar explícitamente si esa validación no se ha realizado.
