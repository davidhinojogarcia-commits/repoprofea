# Publicación conjunta SAE y equipos — 24/10/2026

Integra los PR #306 (sugerencia inversa de peones), #307 (periodo manual), #308 (centrado de etiquetas de equipos) y #309 (control visible de contratación por periodo).

Correcciones de integración: la prueba del contador espera a que los candidatos estén cargados antes de evaluar; las recargas de la suite SAE esperan a que terminen las peticiones para evitar abortos de navegación en WebKit. El servicio simulado del panel incluye el nuevo método de periodo manual. El ensayo SQL del periodo carga también la migración inversa para probar ambas juntas.

Validaciones locales: TypeScript, build, SQL de periodos, quincenas y coincidencias mensuales, cálculo del resumen, integración del resumen en Chromium y auditorías de modales. Los navegadores usan servicios de ensayo, no sesiones privadas de producción. Las pruebas WebKit y la CI de la integración deben terminar correctamente antes de publicar.

Orden de publicación: CI del commit conjunto correcta → aplicar las dos migraciones SAE en producción (inversa, después periodo manual) → pruebas transaccionales con rollback → fusionar → verificar Vercel READY y el commit servido.

Quedan fuera de esta publicación los PR #298 y #300: el primero requiere todavía integración del flujo offline en dos dispositivos y está desactualizado respecto a main; el segundo requiere credencial Groq gratuita, verificación de Free/ZDR y generación real escrita y dictada. No se configuran secretos, se compran créditos ni se habilita un proveedor sin esas comprobaciones.
