# Desplazamiento de la previsualización de correos de actas

La previsualización de varios correos crecía fuera de la pantalla y dependía de utilidades de altura/desplazamiento generadas en ejecución. El bloqueo del fondo del modal impedía llegar a las acciones.

Se usa un panel de altura acotada al viewport con geometría CSS propia. Cabecera y botones permanecen fuera del área desplazable; solo la lista de correos se desplaza. Respeta las áreas seguras del dispositivo y permite envolver los botones en móvil. No cambia destinatarios, envíos, permisos ni contenido del acta.

Validación local: TypeScript y build superados. La prueba existente de actas usa React, API real y PostgreSQL embebido con Gmail simulado. Se añaden seis mensajes largos de previsualización y se comprueba desplazamiento real arriba/abajo, controles dentro del viewport y hit-testing, cancelación sin envío y confirmación posterior. Matriz claro/oscuro: 390×667, 1180×760 (tablet horizontal), 820×1180 y 1440×900. Captura de tablet revisada visualmente. Se conserva el recorrido completo de revisión, firma, PDF y distribución simulada.

No se enviaron correos reales. Pendiente validar desplazamiento táctil en iPad/iPhone físicos y con cuenta real. La CI y la publicación se registran en el PR.
