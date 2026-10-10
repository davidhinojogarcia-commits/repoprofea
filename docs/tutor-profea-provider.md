# Tutor PROFEA — agente local

Revisión: 10 de octubre de 2026.

## Arquitectura

Tutor PROFEA funciona como un agente especializado dentro de GestionProfea. Su planificación de órdenes y sus respuestas de operación se resuelven con lógica propia del servidor y la base de conocimiento versionada de la aplicación.

**Tutor PROFEA no usa Gemini ni otro proveedor externo de modelos.**

Las funciones de análisis documental que ya existan en otros módulos de GestionProfea son independientes del Tutor y no forman parte de este flujo.

## Seguridad y permisos

- La sesión del usuario se valida contra Supabase antes de ejecutar herramientas.
- Las herramientas usan el token del usuario y las políticas/RPC existentes; no usan `service_role`.
- No existe SQL arbitrario ni acceso genérico a la base de datos desde el Tutor.
- Cada acción disponible está en un catálogo cerrado.
- Las mutaciones requieren una orden explícita.
- Los borrados sensibles se preparan primero, muestran el alcance y requieren una confirmación firmada vinculada al usuario, obra e IDs.
- `TUTOR_CONFIRMATION_SECRET` se utiliza solo en el servidor para esas confirmaciones y nunca se expone al navegador.

## Consumo

El agente no realiza polling. Solo consulta Supabase cuando una orden requiere una herramienta de datos. Las respuestas de ayuda que no necesitan datos se resuelven localmente sin llamadas a Supabase.

## Funcionamiento degradado

Si una consulta de datos falla, el Tutor no simula el resultado. Informa del error y mantiene disponible la guía local de uso de la aplicación.

## Privacidad

Las consultas de herramientas minimizan los campos recuperados y evitan enviar o mostrar DNI, IBAN, NUSS o información médica detallada cuando no es necesaria.
