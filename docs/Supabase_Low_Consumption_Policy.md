# Política general de bajo consumo Supabase

Esta política es obligatoria para cualquier desarrollo nuevo o modificación de GestionProfea.

## Objetivo
Mantener el consumo de Supabase controlado y evitar picos de Logs Ingest, transferencia y peticiones repetidas sin perder funcionalidad.

## Reglas obligatorias
1. Una pantalla inactiva no debe hacer peticiones periódicas.
2. Evitar polling. Si es imprescindible, limitarlo a ventanas horarias y deduplicar por usuario/dispositivo.
3. Toda lectura REST repetida usa caché corta por defecto. Las lecturas críticas usan `fresh:true`.
4. Las RPC de solo lectura (`get_*`, `list_*`, `resolve_*`) se coalescen y cachean brevemente.
5. Cualquier mutación invalida la caché inmediatamente.
6. No usar `select=*` en listados si la pantalla no necesita todas las columnas.
7. No transferir PDFs, firmas, Base64, snapshots o blobs en listados. Cargarlos bajo demanda.
8. Agrupar inserciones, actualizaciones y borrados cuando puedan ejecutarse en lote.
9. Auditoría de aplicación: solo eventos LOGIN. No registrar CREATE/UPDATE/DELETE genéricos.
10. No consultar logs de Supabase de forma amplia o repetida. Para diagnóstico, usar ventanas mínimas y filtros concretos.
11. Los backups completos son operaciones costosas y no deben dispararse por navegación o refrescos de pantalla.
12. Las vistas en segundo plano o pestañas ocultas no deben refrescar datos.
13. Ante HTTP 402/429 se detienen las comprobaciones automáticas para no agravar el consumo.
14. Todo módulo nuevo debe pasar una revisión de consumo antes de fusionarse a main.

## Presupuesto orientativo
- Apertura de pantalla: 1-3 lecturas.
- Operación de guardado: 1-3 peticiones.
- Pantalla quieta: 0 peticiones.
- App cerrada: 0 peticiones.
- Documentación de encargados: solo comprobaciones limitadas y cargas incrementales.
