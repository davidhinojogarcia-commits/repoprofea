# Validación posterior al PR #291 — 19/10/2026

## Estado de publicación
El PR #291 está fusionado en b86e7316054ffeb6dc576975f36eef2f5248b640.
CI del merge: build success. Producción comprobada antes de esta tarea: commit
97af602b0118994b792efc50139fc97352820ec3, descendiente del merge.
No se ha fusionado esta rama ni promovido la vista previa a producción.

## Entorno creado
Rama: qa/prevention-report-291.
Despliegue: dpl_CRjPfCWaHuBd3MuT5oNwyiTkdZAi, READY, preview.
URL protegida: https://gestionprofea-2wtxhoypa-davidhinojogarcia.vercel.app/
Se proporciona al usuario un enlace temporal de acceso, sin guardarlo aquí.
Código original del componente PreventionSection y servicios de main 97af602.
Datos e imágenes sintéticos; módulo Supabase sustituido al compilar por fake-db.ts.
Sin autenticación de aplicación ni conexiones a producción. CSP connect-src none.
La compilación rechaza endpoints/clave de producción en el paquete.
Mutaciones de ejemplo rechazadas; solo consulta/exportación.
Esta es una vista aislada del módulo, no una réplica completa con base de datos.

## Comprobaciones ejecutadas
- Build local y build de Vercel: correctos.
- Chromium remoto, interfaz publicada: seleccionar imagen vertical -> Compartir PDF ->
  evento de descarga confirmado y mensaje de generación.
- Dos imágenes/texto largo -> descarga confirmada. Registro de llamadas:
  list_prevention_records -> get_prevention_acta_history ->
  get_prevention_record_details:v -> get_prevention_record_details:h.
  No se consulta la imagen de la obra B excluida por el filtro.
- Fotografía ausente -> mensaje explícito de recuperación fallida.
- Fotografía corrupta -> mensaje explícito de incorporación fallida.
- Acceso denegado simulado -> mensaje explícito de acceso denegado.
- Detalles de registro: imagen vertical visible en la interfaz.
- Generador original ejecutado localmente en Node: PDF de 7 páginas con 2 imágenes
  sintéticas distintas; proporciones originales y límites de página comprobados.
  Páginas 6 y 7 renderizadas y revisadas visualmente: vertical/horizontal visibles,
  pies de página sin solapamiento con imágenes.
- Generador local rechaza imágenes ausentes, corruptas y URL externa.

## Límites y bloqueos
El navegador descargó los PDF, pero los bytes descargados no son accesibles desde
el contenedor; no se atribuye al PDF descargado la inspección realizada sobre el
PDF local independiente. El visor de descargas interno del navegador no está
disponible por la política del entorno.
No se han comprobado fotos privadas de producción ni permisos SQL reales en esta
ejecución: la capa de datos de esta vista es simulada. No se han probado iPhone,
Android ni iPad físicos, ni compartir con destinatario/aplicación externa.
No se ha ejecutado otra vez toda la batería de regresión global.

## Criterio de cierre
La interfaz y el generador pasan las pruebas representativas descritas.
El cierre integral requiere una incidencia autorizada con fotografía almacenada:
recuperación real, imagen vertical completa y proporcionada en el PDF descargado,
sin mezclar obras/periodos, y validación en los dispositivos de uso.
Los fallos de recuperación deben mostrar error y no entregar un PDF incompleto.
El caso de error se debe simular en pruebas sin corromper datos de producción.

## Reutilización
Abrir el enlace temporal, elegir escenario, pulsar Compartir PDF.
Para recrear: npm ci y npm run build en qa/prevention-report.
No fusionar esta rama de QA en main como funcionalidad de producción.
