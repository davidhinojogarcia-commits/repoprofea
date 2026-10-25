# Consulta de contratación anual — 25/10/2026

Antes de crear un trabajador, `enrichWorkerAnnualHiring` consultaba todos los
trabajadores del propietario y su JSON `data` completo para contar un DNI/año.
La consulta no paginaba explícitamente: podía truncarse con el límite REST.

Ahora solicita solo identificación y campos de fechas, incluidos los campos
JSON heredados como escalares. Para DNI alfanumérico aplica en servidor un
filtro OR sobre la columna y el JSON heredado. El patrón de subsecuencia es
intencionadamente amplio para conservar espacios/guiones; sigue verificándose
la igualdad normalizada exacta y el año en cliente. Se mantiene el filtro de
propietario. Identificadores antiguos con otra puntuación usan la consulta
proyectada paginada, sin interpolar sintaxis insegura. No se altera RLS.

Se pagina por ID, 500 filas, con lectura fresca. Una página repetida detiene la
operación antes de escribir para no guardar un recuento incompleto. Los errores
se propagan. No se cambia el contrato de escritura ni se deduplican altas.
El recuento conserva la semántica existente; no introduce una garantía atómica
para dos altas concurrentes ni una instantánea entre páginas. No hay migración
ni índice nuevo: no se ha medido un plan que justifique uno.

`test:worker-annual-lookup` ejecuta el servicio real `createDocument` con transporte
controlado y PostgreSQL PGlite. Comprueba DNI canónico y heredado, años por fecha,
quincena y JSON, aislamiento de propietario, falsos positivos del patrón,
paginación de más de 1000 filas, caracteres de filtro y fallo antes de escritura
si se repite la página. No usa personas reales ni escribe en producción.

Comparación reproducible local con el mismo conjunto sintético: la proyección
anterior de 1206 registros ocupa 2.060.465 bytes JSON; los cinco candidatos con
la nueva proyección, 896 bytes y una lectura. La primera cifra representa el
conjunto completo, sin simular el tope REST; no es transferencia medida de
producción. No se atribuye este resultado al consumo total ni se estima la
latencia de dispositivos reales. El caso de identificador no alfanumérico
necesita tres páginas y conserva el recuento fuera de las primeras 1000 filas.
