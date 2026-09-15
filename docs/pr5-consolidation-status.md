# Consolidación segura del PR #5 sobre main actual

Esta rama parte del `main` actual y recupera únicamente cambios del PR #5 que siguen siendo necesarios, evitando reintroducir migraciones o implementaciones ya sustituidas.

## Criterios

- No reaplicar `20260914163500_isolate_supervisor_data_and_share_workers.sql`: el `main` actual contiene migraciones posteriores de aislamiento y endurecimiento.
- Mantener las versiones actuales de aislamiento por supervisor, compartición de trabajadores, SAE, inventario y control horario.
- Normalizar expedientes CAE antiguos para que el antiguo requisito de recurso preventivo propio de la subcontrata no bloquee el expediente.
- El recurso preventivo se gestiona por obra/contratista; el encargado o interlocutor de la subcontrata es un dato de coordinación opcional.
- Pendiente de integración visual: selector explícito `Registrado / No registrado` para el Libro de Subcontratación en la ficha CAE, preservando el modelo `libroSubcontratacionEstado` ya existente en `types.ts`.

## Verificación requerida antes de merge

1. `npm run lint`
2. `npm run build`
3. Prueba con dos supervisores distintos y datos no compartidos.
4. Prueba de trabajador compartido en lectura y lectura/escritura.
5. Prueba de CAE con expediente legado que tuviera `recurso_preventivo` obligatorio/pendiente.
6. Prueba de informes CAE para verificar que el requisito legado no se lista como faltante.
7. Prueba del Libro de Subcontratación una vez integrada su selección visual.
