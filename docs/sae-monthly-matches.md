# Coincidencias mensuales de mano de obra cualificada

La detección anterior solo cruzaba primera y segunda quincena de la misma obra. La nueva comprobación informa de una contratación o previsión con 2001 en otra obra del supervisor, para el mes de un candidato mensual cualificado, aunque las categorías sean distintas.

## Reglas

- Identidad exclusivamente por nombre completo normalizado con la función existente `sae_private.name_key`: Unicode NFKD, acentos, mayúsculas y espacios. No consulta ni compara DNI/NIE, no usa coincidencias aproximadas ni cambia el orden de los nombres.
- Destino: candidato mensual (sin quincena), categoría informada distinta de peón, solicitud con mes y año válidos y obra consistente. Origen SAE: otra obra del mismo propietario, mes y año, candidato con 2001 o contratación registrada/vinculada. Las categorías de origen y destino no tienen que coincidir.
- Origen Directorio: trabajador del mismo propietario con nombre coincidente y periodo contractual válido que interseca el mes y año del destino, en otra obra. Se incluyen registros sin candidato SAE. Una ficha vinculada a un origen SAE se muestra una sola vez.
- Un 2001 sin registro se describe como **Previsto para contratar**. La contratación vinculada o el registro de Directorio con fechas se describe como **Contratación registrada**; esto no afirma que exista un contrato firmado.
- Fechas previstas: configuración anual del supervisor, usando los mismos extremos de periodo que el registro SAE existente. Contratos registrados: campos contractuales del trabajador, con compatibilidad con `data.periodoInicio/periodoFin`. No se infieren fechas de contrato desde la fecha de alta en la aplicación.
- La lectura solo muestra avisos y referencias. No asigna códigos, crea candidatos ni cambia contrataciones. Si las fechas conocidas no se solapan, se presenta un antecedente. Fechas ausentes, inválidas o configuración anual duplicada requieren revisión y deshabilitan la acción propuesta.
- Varias coincidencias de origen o entradas duplicadas del nombre en el informe de destino se muestran como ambiguas. Se pueden consultar y revisar; no se ofrece aplicar el resultado mediante la propuesta ambigua. Se conserva la asignación manual ordinaria para la revisión del supervisor.
- **Aplicar el código propuesto por coincidencia mensual** es una decisión expresa que muestra el código actual y el propuesto. Conserva cualquier resultado manual hasta aceptar; Enter no acepta, el doble clic no duplica la operación y los fallos conservan el código anterior.
- Informe finalizado sin reapertura, contratación vinculada/confirmada de destino, documento generado o solicitud cerrada: lectura informativa, sin aplicar códigos. Reabrir un borrador conserva sus versiones archivadas; la acción cambia únicamente el borrador.

## Implementación y consistencia

`list_sae_monthly_matches` devuelve una comprobación agrupada por solicitud. Se integra con los eventos de carga, importación, edición, registro, reapertura y recuperación del foco que ya usa SAE. No hay consultas periódicas ni una petición por candidato.

`sae_apply_monthly_2500` vuelve a comprobar identidad, origen, fechas, ambigüedad, estado del destino y firma de los datos antes de guardar. Usa el bloqueo transaccional por supervisor de SAE. Las escrituras de Directorio comparten ese bloqueo, y los registros de contratación utilizados se bloquean durante la decisión. Cambiar el origen, las fechas o el resultado de destino invalida una decisión obsoleta. Una petición repetida con la firma anterior no genera otra decisión.

La auditoría privada registra `monthly_accepted`, actor, candidato/informe de destino, código anterior/nuevo, origen SAE o trabajador de Directorio y contexto de obra, categoría y periodo. Las nuevas columnas son privadas; no se amplían permisos sobre tablas. Las RPC requieren sesión, permiso SAE y propiedad. Las funciones auxiliares no son ejecutables directamente por clientes.

La consulta del origen SAE abre su solicitud e informe. Para registros exclusivos de Directorio se muestran los datos de origen en una ficha desplegable de solo consulta.

## Pruebas

```sh
npm run test:sae-monthly
npm run test:sae-fortnights
npm run test:sae-alignment
npm run lint
npm run build
```

La suite SQL carga las migraciones reales en PostgreSQL/PGlite: nombre y apellidos, acentos/Unicode, DNI distintos ignorados, categorías distintas, obra/mes/año, previsión/registro, Directorio sin SAE y deduplicación, origen ajeno/propietario, informe prestado, fechas y solapamiento, configuración desconocida, ambigüedad, códigos manuales, firma obsoleta/repetida, informes emitidos, versiones archivadas, permisos y ACL/RLS.

La suite de navegador usa `SaeSection` y servicios reales con un adaptador HTTP a PGlite. Incluye consulta de origen, 2500 expreso, persistencia, error/reintento, cambios de origen, Enter, doble clic, fechas sin solapamiento, ambigüedad y Directorio en Chromium y WebKit, 390/820/1440. También conserva las regresiones de quincenas, registro, reapertura y PDF archivado. Autenticación, configuración visual y parser de importación utilizan fronteras sintéticas. WebKit local usa bibliotecas extraídas y omite únicamente la comprobación del inventario de paquetes del host.

Consultar el PR para los resultados de la CI del commit final. La migración `20261023214422_sae_monthly_work_matches.sql` debe aplicarse y verificarse antes de publicar la nueva interfaz. No se ha validado esta nueva funcionalidad con dos sesiones HTTP remotas simultáneas ni en dispositivos físicos.

## Regla por posición del listado de destino

Con periodos solapados, la posición persistida `source_position.orderNumber` determina la propuesta: 1 → código numérico único de «Otros motivos» del catálogo del informe; 2 → 2500. No es la quincena ni el orden de consulta. Otras posiciones o posición desconocida permiten consultar el aviso pero no proponen un código. Catálogo ausente o ambiguo para la posición 1 bloquea la propuesta. La sustitución requiere pulsar expresamente el botón que muestra el código. Cambiar posición o catálogo invalida la firma anterior.

La RPC `sae_apply_monthly_2500` conserva su nombre por compatibilidad, pero guarda exclusivamente el código recalculado por el servidor. La decisión bloquea además la fila de configuración anual durante su comprobación y guardado.
