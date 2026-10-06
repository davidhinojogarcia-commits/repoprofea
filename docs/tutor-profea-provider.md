# Tutor PROFEA — proveedor, modelo y coste

Revisión: 6 de octubre de 2026.

## Integración encontrada

GestionProfea ya utiliza la Gemini Developer API mediante `@google/genai` en el servidor y la variable `GEMINI_API_KEY`. Para no introducir un segundo proveedor, Tutor PROFEA reutiliza esa integración, manteniendo la clave exclusivamente en servidor.

El modelo del tutor se configura con `TUTOR_MODEL`. La rama usa `gemini-3.7-flash` como valor por defecto estable. No se usa el alias `gemini-flash-latest` como valor por defecto porque la documentación oficial indica que los alias `latest` pueden cambiar de versión y recomienda una versión estable concreta para la mayoría de aplicaciones en producción.

Fuentes oficiales consultadas:
- https://ai.google.dev/gemini-api/docs/models
- https://ai.google.dev/gemini-api/docs/pricing

## Coste de referencia

A 6 de octubre de 2026, la tarifa estándar publicada para Gemini 3.7 Flash es de USD 0,75 por 1 millón de tokens de entrada y USD 3,75 por 1 millón de tokens de salida hasta el 31 de diciembre de 2026. Google anuncia USD 1,50 de entrada y USD 7,50 de salida a partir del 1 de enero de 2027.

El coste real depende del volumen y del nivel facturable de la cuenta. Tutor PROFEA reduce consumo recuperando solo la sección de conocimiento y los datos necesarios para cada orden.

## Dependencias y funcionamiento degradado

- `GEMINI_API_KEY`: servidor.
- `TUTOR_MODEL`: servidor; permite cambiar el modelo sin modificar el cliente.
- Supabase: las herramientas usan el token del usuario y RLS/RPC existentes; no usan `service_role`.
- Si el proveedor del modelo no está disponible, el resto de GestionProfea sigue operativo y el componente mantiene la ayuda local de respaldo. Las acciones de datos no se simulan en ese modo.

## Privacidad

El modelo recibe contexto funcional minimizado. Las herramientas filtran los resultados antes de la síntesis y no envían DNI, IBAN, NUSS ni datos médicos detallados cuando no son necesarios.
