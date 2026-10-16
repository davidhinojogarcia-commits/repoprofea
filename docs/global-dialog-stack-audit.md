# Auditoría global de ventanas (16/10/2026)

## Causa reproducida

La confirmación global AppDialogHost tenía posición y prioridad exclusivamente en utilidades de Tailwind generadas en tiempo de ejecución. Con ellas ausentes/retrasadas, el diálogo quedaba con `position:static` dentro del flujo de la página; las tarjetas transformadas podían cubrirlo. La prueba anterior a la corrección falla exactamente por esta propiedad. El parche previo de ModalPortal no corregía este segundo sistema de confirmaciones.

## Alcance y cambios

- Revisión de todos los componentes TSX y usos de createPortal/ModalPortal. Dos ventanas de compartir (individual y masiva) utilizaban portales propios sin la secuencia global: ahora usan ModalPortal, conservando permisos y operaciones existentes.
- Confirmaciones, alertas y solicitudes de texto: posición/capa explícitas en línea y geometría CSS propia, sin depender de Tailwind. Las ventanas previas se ocultan mientras aparece una confirmación y vuelven al cerrarla.
- Corregido Enter sobre Cancelar, que podía ejecutar la confirmación; se conserva la acción nativa del botón. Devolución de foco al elemento de origen.
- Auditoría estructural en CI: impide nuevos portales modales fuera de los dos componentes base. DirectoryStatusFilter es la única excepción, por insertar un filtro en su contenedor, no una ventana modal.
- No hay cambios en datos, firmas, originales, RPC ni permisos. Las pruebas no eliminan documentos reales ni comparten registros reales.

## Validaciones

Superadas localmente: TypeScript, compilación, auditorías de capas/pila/overlays y regresión del portal de encargados (firmas/PDF/modelos/zoom/compartición).

La nueva prueba `testAppDialogBrowser.mjs` usa React y los componentes reales AppDialogHost, ModalPortal, ShareRecordButton y BulkShareButton, con servicios de compartir simulados. Carga todas las hojas de producción y ejecuta también sin las utilidades del CDN: confirmación delante de tarjetas transformadas y un modal previo, hit-testing real, cancelar, Escape, Enter en Cancelar, una única eliminación simulada al confirmar, foco, desplazamiento, mensajes largos, cola, avisos y campo de texto. Matriz: 390/820/1440 px, claro/oscuro. Chromium local superado; Chromium y WebKit configurados en CI.

Se han inspeccionado las capturas de la confirmación móvil. El intento de WebKit local no disponía de las bibliotecas del sistema necesarias; su validación se delega a la CI con las dependencias instaladas.

Límites: la revisión de todos los componentes es estructural, no una ejecución manual de cada formulario con una cuenta real. Los recorridos funcionales automatizados del repositorio se ejecutan en CI. No se acredita iPhone/iPad/Android físico ni se garantiza la ausencia de cualquier fallo futuro; la nueva batería hace reproducible y detectable esta clase de regresión.

## Inventario de ventanas que usan la capa común

83 componentes TSX inspeccionados; 36 componentes contienen ventanas ModalPortal.

- `components/AdditionalWorksiteDocumentsPanel.tsx`
- `components/AdminPanel.tsx`
- `components/AdministrativeDataAssignmentBridge.tsx`
- `components/AnnualHiringPeriodsPanel.tsx`
- `components/AuthGate.tsx`
- `components/BulkEditModal.tsx`
- `components/BulkShareButton.tsx`
- `components/CalendarioIntegrado.tsx`
- `components/CameraScannerModal.tsx`
- `components/ChecklistConfigModal.tsx`
- `components/ChecklistReviewModal.tsx`
- `components/Configuracion.tsx`
- `components/EditPersonModal.tsx`
- `components/FileUploaderIA.tsx`
- `components/ForemanAccessButton.tsx`
- `components/ForemanDocumentsDashboard.tsx`
- `components/ForemanMobilePortal.tsx`
- `components/ForemanModelSettings.tsx`
- `components/GoogleCalendarModal.tsx`
- `components/ImportDuplicateModal.tsx`
- `components/InventorySection.tsx`
- `components/MandatoryPdfAnchorEditor.tsx`
- `components/MandatoryTraceabilityModal.tsx`
- `components/MandatoryWorksiteReviewModal.tsx`
- `components/MedicalSpecialAttentionReportModal.tsx`
- `components/Papelera.tsx`
- `components/PdfViewerModal.tsx`
- `components/PeriodicReportModal.tsx`
- `components/PersonListView.tsx`
- `components/PushNotificationManagerModal.tsx`
- `components/RegistrationForm.tsx`
- `components/SaeRenunciationBridge.tsx`
- `components/SaeSection.tsx`
- `components/ShareRecordButton.tsx`
- `components/SubcontratasSection.tsx`
- `components/VisitMinutesPanel.tsx`
