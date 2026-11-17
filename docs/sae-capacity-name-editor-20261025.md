# Avisos de previsión y corrección de nombres SAE

Se reutiliza buildSaeHiringSummary: misma solicitud/obra, periodo, categoría,
identidad normalizada y objetivo compartido entre informes. No se duplican
consultas ni se suman primera y segunda quincena. Las cantidades desconocidas
siguen pendientes de confirmar y no provocan falsos excesos.

Al incrementar el exceso con 2001/cambio de periodo, se confirma antes de
escribir usando AppDialogHost. Al registrar en un grupo excedido también se
confirma. Cancelar no escribe y restaura el selector. Hay guard síncrono para
la doble pulsación. El exceso se calcula en cliente, es orientativo y no es un
bloqueo transaccional de cupo para sesiones simultáneas: se permite continuar.
No se cambian códigos ni se anulan contrataciones automáticamente.

El listado muestra una alerta roja con previstos, seleccionados, exceso y
registrados. Los nombres/tarjetas seleccionados del grupo excedido se marcan
con texto, borde y etiqueta. Se marca el grupo, sin atribuir arbitrariamente a
una persona cuál sobra: el modelo actual no conserva un orden histórico de
selección inmutable. Al desaparecer el exceso, se retiran las marcas. Se
separa el 2001 pendiente de registrar de las contrataciones registradas.

Los campos de nombre se abren con Corregir nombre, etiquetas visibles,
Guardar nombre y Cancelar. Teclear y cancelar no escriben; guardar envía
apellidos/nombre/nombre normalizado en una actualización. No cambia el texto
original del PDF ni documentos archivados. Error conserva la corrección para
reintentar. Contratados e informes finalizados siguen protegidos. Tras guardar
se utiliza la sincronización existente para actualizar coincidencias.

Validación: TypeScript, compilación, dominio de recuentos; prueba React real
con servicios sintéticos, editor/cancelación/error/reintento/recarga,
confirmación real AppDialogHost antes de guardar 2001, cancelar/aceptar,
alerta, reversión del exceso, periodos, oficiales mensuales y tamaños
390/820/1440 en Chromium. WebKit se ejecuta en CI. No se acredita dispositivo
físico ni datos privados de producción. Sin migración ni nuevos logs/polling.
