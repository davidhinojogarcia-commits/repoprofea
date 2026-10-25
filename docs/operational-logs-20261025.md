# Diagnóstico sin datos privados — 25/10/2026

La utilidad existente `src/lib/operationalLog.ts` estaba importada en cuatro
archivos y solo cubría una parte de sus errores. Se conecta a los diagnósticos del navegador y
servidor: importación, PDF, firma/portal, SAE, directorio, reconocimientos,
calendario, CAE, inventario, configuración, Gmail, Tutor y copias. La revisión
AST comprueba 192 llamadas con etiquetas estáticas. Se conservan los consumidores
preexistentes y se amplía su cobertura.

La salida conserva etiqueta, nivel warn/error, estado HTTP permitido, códigos
conocidos y correlación. No contiene message, stack, cuerpo de respuesta,
documentos, firmas, nombres, nombres de archivo, claves ni tokens. No se vuelca
el error original aunque la aplicación o el proveedor lo incluya. Si leer sus
propiedades falla, se registra un diagnóstico saneado en vez de romper el flujo.
Los errores siguen propagándose y los mensajes de la interfaz no se modifican.
No se sustituye console globalmente ni se filtran fallos de las pruebas.

Se mantienen los avisos estáticos de compatibilidad/recuperación y el arranque
del servidor. Dos trazas internas de reintento Gemini solo se muestran en
desarrollo. No se cambia la selección de proveedor ni la política de reintentos.
No hay muestreo o supresión de errores/seguridad: cada llamada conserva su nivel.

## Las cuatro clases de registros

1. Navegador: saneamiento en las llamadas de la aplicación; los diagnósticos de
   red del propio navegador o de extensiones no están bajo este control.
2. Servidor: misma utilidad, códigos/correlación; sin contenido del proveedor.
3. Auditoría funcional de PostgreSQL: no se añaden ni eliminan eventos. LOGIN,
   trazabilidad de firmas y decisiones SAE conservan sus reglas existentes.
4. Infraestructura Supabase: no se desactivan logs ni se cambian niveles o
   retención. La corrección PT409 ya publicada elimina la causa del bucle SAE.

## Pruebas y medición

`test:operational-logs` usa un error sintético con secretos/documento/prompt y
comprueba que no aparecen en los registros, mantiene estados/códigos/niveles,
exige correlación y tolera propiedades de error que lanzan excepciones. Revisa
además los consumidores reales con el AST TypeScript: no admite error/warn
directos con datos dinámicos ni etiquetas derivadas de documentos/archivos.

Para esa misma entrada sintética, los argumentos JSON serializados pasan de
58.259 a 138 bytes; se mantiene una llamada de error. No es una medida del
tráfico de producción ni un porcentaje global de ahorro. Tampoco es el formato
exacto de almacenamiento de Vercel/Supabase. Los datos originales reales nunca
se utilizan para medir una posible exposición.

Cambios mecánicos de diagnósticos/imports, sin modificar consultas, respuestas,
permisos, documentos ni diseño. Requiere TypeScript, compilación y CI completa
del commit final antes de publicarse por su alcance transversal. No tiene
migración ni modifica datos. Revertir este cambio no debe revertir la corrección
PT409 de SAE ni la recuperación de sesión ya publicadas.
