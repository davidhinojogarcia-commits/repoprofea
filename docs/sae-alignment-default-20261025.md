# Posición predeterminada de códigos SAE

Guardar posición conserva la posición del informe abierto y establece X/Y
como predeterminados de la cuenta para los informes importados posteriormente.
El guardado automático de movimientos sigue limitado al informe actual;
solo el botón explícito cambia el predeterminado. Permite negativos y cero,
redondeados a centésimas de milímetro. Guardar sin mover también establece
como predeterminada la posición actual.

Se reutiliza user_settings y patch_user_settings con una clave propia
saeReportAlignment, sin reescribir app ni otras preferencias. Versión,
propietario y coordenadas se validan; la respuesta RPC verifica el guardado.
No hay caché local: cada nueva importación lee una proyección del ajuste de
su propietario, una vez antes de subir el original. Si falla esa lectura,
se detiene la importación para no utilizar cero silenciosamente. El ajuste
se copia a alignment_offset_x/y de todos los candidatos de la nueva
importación; source_position sigue conteniendo las coordenadas originales.
La generación PDF y la vista previa reutilizan las columnas existentes.

Los informes ya importados conservan sus posiciones, aunque todavía estén en
borrador. Los cambios posteriores del predeterminado no mueven informes
anteriores ni modifican PDF originales, finalizados o versiones archivadas.
El predeterminado permanece en servidor sin caducidad hasta cambiarlo.
Se aplica en clientes con esta versión al crear una importación; una carga
concurrente iniciada antes de guardar puede haber leído el ajuste anterior.
No se han probado dos dispositivos físicos.

Persistencia por informe y del predeterminado son operaciones separadas.
Si el segundo guardado falla, el mensaje distingue el informe ya guardado y
el predeterminado pendiente; se permite reintentar sin mover coordenadas.
No se declara éxito a partir de una clave encontrada o una copia local.

Sin tablas, migraciones, permisos ni dependencias nuevas. Una lectura
proyectada por importación y un RPC por pulsación explícita; sin sondeos,
suscripciones ni logs adicionales. La rama no genera despliegues automáticos.

Pruebas del servicio real con transporte/Storage sintéticos: guardar/cargar,
negativos/cero, nueva importación, cambio de cuenta, preservación de otras
preferencias, coordenadas originales e informes anteriores, fallo de red y
no-op no verificable. Regresión de alineación por informe conservada. Visor
React/PDF real: guardar sin mover, autosave separado del predeterminado,
fallo/reintento del predeterminado, desplazamientos negativos, serialización,
recarga y orientación móvil/tablet. Chromium local; Chromium y WebKit en CI.
No se escriben datos reales para probarlo.
