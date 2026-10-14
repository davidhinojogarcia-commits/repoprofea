# PR 257 · Contratos y Prórrogas · GestionProfea 1.21.0

Validación técnica del 14/10/2026. Rama `feat/foreman-contracts-extensions`. No se ha fusionado ni publicado en Vercel.

## Comportamiento implementado

El botón existente **Importar documento** admite Inicio, Control de presencia, Contratos y Prórrogas. Se conservan los bytes originales y su SHA-256; no se reconstruye el documento. Los contratos de tres páginas y las prórrogas de una página son casos habituales, no límites rígidos.

El reconocimiento del trabajador exige un bloque de trabajador explícito en el PDF. La identidad impresa tiene prioridad; una coincidencia inequívoca del Directorio puede reutilizar su identificador. No se toma al representante de la empresa como firmante. Se propone la firma debajo del nombre cuando la zona resulta inequívoca. Las sugerencias quedan sin confirmar. Las páginas rotadas o recortadas y las zonas ambiguas requieren colocación manual.

El supervisor puede revisar la identidad, cambiar la página, encuadrar el área, confirmar y guardar. Si falta el trabajador o falla el OCR, el original permanece como borrador para recuperar manualmente la persona. El servidor exige un único trabajador activo y posición confirmada manualmente antes de publicar. El envío al portal continúa siendo explícito.

El portal muestra los tipos nuevos en Control inicios, con los mismos filtros por obra, mes y quincena. La firma se guarda y el PDF se construye como una copia del original con la imagen de firma superpuesta. El supervisor recibe los mismos bytes firmados persistidos. No se permite finalizar el contrato o prórroga sin su firma obligatoria. El historial existente registra importación, revisión, publicación, firma y devolución; no se añade otra pantalla de actividad.

## Evidencia local

| Comprobación | Resultado y alcance |
| --- | --- |
| `npm run test:employment-documents` | Reconocimiento conservador, nombres con coma, exclusión del empleador, varias identidades, zonas ambiguas, original conservado al fallar OCR, PostgreSQL real en PGlite, interfaces React del supervisor y portal para ambos tipos. |
| PostgreSQL | Migración completa aplicada dos veces sin errores; contratos 3/4 páginas, prórrogas 1/2; regresión de Inicio y Control después de aplicar la nueva migración. Confirmación manual, guardado/reapertura, aislamiento por propietario/obra, token inválido, borrador no visible ni descargable por el portal, identidad no editable por encargado, firma obligatoria, huellas, fidelidad y reintentos idempotentes. |
| `npm run test:employment-browser` | Chromium con extracción PDF.js y superposición PDF-lib reales. PDF sintéticos de 3/4/1/2 páginas, identidad correcta, sugerencia debajo del nombre, revisión en editor, firma visible y fidelidad satisfactoria. Transporte a Supabase simulado en esta prueba; no equivale a un recorrido con una cuenta real. |
| Interfaz | 390×844, 820×1180 y 1440×900, temas claro/oscuro, paneles de controles y PDF. Sin desbordamientos de botones ni pie fuera de pantalla. Capturas y PDF firmados inspeccionados visualmente. |
| `npm run test:foreman-publication` | Regresiones de publicación, retirada, revocación, borradores atómicos, posiciones, solapamiento, original con firmas, recibo y quincenas. |
| Persistencia y firmas | `test:mandatory-persistence`, anclaje, detección de trabajadores y trazabilidad V2 correctos. |
| Avisos y consumo | `test:foreman-push`, pruebas de consumo y refresco matinal correctos. No se añaden sondeos ni nuevos avisos periódicos. |
| Tipos y compilación | `npm run lint`, `npm run build` y `git diff --check` correctos. `dist/**` se excluye de TypeScript para no analizar el código minificado generado después del build. |

Las pruebas de interfaz usan datos sintéticos y límites de API simulados. La prueba SQL verifica las RPC en PostgreSQL, pero no mide recepción física en un teléfono ni comprueba los modelos concretos de contratos del supervisor. La fidelidad comprueba páginas, dimensiones, texto y diferencias visuales fuera de las zonas de firma.

## Supabase de producción

La migración `20261014063754_foreman_contracts_extensions.sql` está aplicada en `gestion-profea`. Se verificó el registro remoto, la restricción de tipos y los permisos efectivos después de aplicarla. Las tablas de documentos, PDF y trabajadores documentales mantienen RLS.

Las RPC de importación, inicialización, guardado y asignación deniegan EXECUTE a `anon`. Las RPC del portal conservan EXECUTE para `anon` porque su autorización es el token activo y su correspondencia con propietario y obra. Los borradores de contratos no son descargables mediante el token; las vías antiguas no pueden firmarlos, finalizarlos ni cambiar su identidad.

El asesor de seguridad no introduce advertencias nuevas: mantiene los avisos existentes de funciones con token disponibles a `anon`, tablas privadas con RLS sin políticas, `mandatory_v2_box_valid` con search_path mutable y protección de contraseñas filtradas desactivada. No se declara el proyecto libre de avisos. Referencias: [funciones disponibles a anon](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [search_path](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable).

## Comprobación funcional real pendiente con el supervisor

1. Importar un contrato real de tres páginas y una prórroga real de una página. Confirmar trabajador, obra, fecha y quincena. Verificar que el original permanece idéntico.
2. Abrir **Ajustar firmas**, revisar la sugerencia y encuadrarla si hace falta. Guardar, cerrar y reabrir para confirmar que se conserva.
3. Enviar manualmente al portal de la obra. Comprobar que no se ve antes del envío ni en otro portal.
4. Firmar en un Android y en iPhone/Safari reales. Comprobar giro de pantalla, manejo del PDF y firma táctil; finalizar y devolver.
5. Descargar el firmado desde la cuenta del supervisor y revisar las páginas completas, la posición de la firma y la persistencia tras recargar. Probar también una retirada/corrección y un Inicio y Control habituales.
6. Si se activan avisos, confirmar físicamente la recepción del aviso en ambos teléfonos. Las pruebas automáticas de Web Push no demuestran esta recepción.

La rama tiene el despliegue automático de Vercel desactivado. No se ha gastado un despliegue para estas pruebas locales. El PR queda preparado para revisión y para decidir la publicación después de las comprobaciones reales indicadas.

## Reproducir

`npm ci`, `npm run test:employment-documents`, `npx playwright install --with-deps chromium`, `npm run test:employment-browser`, `npm run test:foreman-publication`, `npm run lint`, `npm run build`.

La prueba de navegador obtiene el script de Tailwind con curl. Para ejecutarla sin esa descarga, establecer `SIGNATURE_TAILWIND_SCRIPT` a una copia local; `SIGNATURE_BROWSER_EXECUTABLE` permite usar un Chromium instalado. `EMPLOYMENT_TEST_OUTPUT` conserva capturas y PDF sintéticos en el directorio indicado.
