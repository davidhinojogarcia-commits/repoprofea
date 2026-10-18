# Registro diario: solo fichas firmadas

Fecha: 2026-10-16. Base: main f76e7d856a6268eee7a649e5cf3f8d52452c240a.

## Cambio

El listado de Registro diario de jornada del panel de documentación de encargados solo incluye jornadas con alguna ficha que contenga las imágenes de las firmas de entrada y salida. La descarga aplica el mismo criterio por trabajador, independientemente del estado global de la jornada. Los marcadores de resumen `signed` no se consideran imágenes exportables. Si no hay fichas completas se informa del motivo y no se genera un PDF vacío.

No hay escrituras, migraciones, nuevas llamadas ni cambios de permisos. Los trabajadores sin firmar o con una sola firma siguen guardados y disponibles en Control horario para terminar el proceso. Los archivos históricos no se modifican. Los demás modelos documentales mantienen sus filtros y generación.

Si una imagen de firma está dañada, se detiene la descarga con un error visible en lugar de ocultar el fallo y exportar su casilla vacía. Comprobado para entrada y salida con imágenes deliberadamente ilegibles.

## Evidencia local

- `npm run test:signed-attendance`: aprobado. Siete registros sintéticos mezclados producen dos páginas, únicamente las dos fichas con ambas firmas; casos de una página, ninguna firma, solo entrada/salida, marcadores y estados draft/completed/reviewed. Reapertura con pdf-lib, orientación horizontal y datos de entrada intactos.
- React real en JSDOM: listado excluye jornadas sin ambas firmas aunque estén completed/reviewed; conserva una jornada draft con fichas completas. Regresión de publicación, retirada, revocación, recarga y filtros por obra, mes y quincena aprobada.
- `npm run test:foreman-publication`: aprobado, incluidas pruebas SQL en PostgreSQL local embebido y persistencia de coordenadas.
- `npm run test:mandatory-persistence` y `npm run test:low-consumption`: aprobados.
- `npm run lint`, `npm run build` y `git diff --check`: aprobados. Se mantiene el aviso previo de chunks grandes.
- PDF generado con la función real, reabierto y renderizado con Poppler: inspección visual de sus dos páginas, firmas sintéticas visibles en entrada/salida, tablas y orientación conservadas. Ningún documento personal utilizado.

## Límites

Validación local y servicios simulados en las pruebas de interfaz; no se ha probado con cuentas corporativas en producción ni con dispositivos físicos. El cambio no se fusiona ni se despliega sin autorización.
