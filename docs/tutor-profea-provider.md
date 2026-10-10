# Tutor PROFEA — motor local

Tutor PROFEA no utiliza Gemini ni otro proveedor de modelo externo.

El endpoint `/api/profea-tutor` usa un planificador determinista del propio servidor de GestionProfea. Este planificador identifica únicamente intenciones admitidas por el catálogo cerrado de herramientas y nunca genera SQL ni accede con service-role.

Las consultas y escrituras autorizadas se ejecutan con el token Supabase del usuario y quedan sometidas a RLS/RPC. Las operaciones sensibles que requieren confirmación usan `TUTOR_CONFIRMATION_SECRET`; si el secreto no está configurado, esas confirmaciones no se pueden firmar y el borrado no se ejecuta.

Gemini sigue siendo una dependencia separada de otros procesos de análisis documental ya existentes en GestionProfea. No es una dependencia de Tutor PROFEA y la ausencia de `GEMINI_API_KEY` no impide usar el Tutor.
