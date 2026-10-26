# Partes y avisos — inspección y decisiones

Base remota: main 4b07dc080c9dd1aa77d1468e743f559ef7549103. Rama independiente feat/partes-avisos-20261026. Sin migraciones ni despliegues de producción autorizados.

Reutilización: ForemanMobilePortal y su token de obra (foreman_portal_access), trabajadores con clave compuesta (owner_id,id), perfiles activos, autenticación del servidor gmailOAuth, VisitSignaturePad/useHandwrittenSignature (azul #164B9B), ModalPortal/appDialog, PDF con logotipo institucional, visitDraftStore AES-GCM con espacio separado por cuenta/contexto, Web Push VAPID y service-worker existentes. offlineStore ordinario no cifra sus valores: no utilizarlo para contenido laboral sensible. PR #298 y #300 siguen independientes y no se incorporan.

Limitación de identidad: el portal usa una credencial portadora asociada a obra/nombre del encargado. No equivale a una identidad personal verificada ni firma cualificada. La evidencia debe reflejar el acceso autenticado por enlace y la declaración explícita del firmante. Nunca se deduce que el trabajador tiene cuenta ni que el encargado certifica su identidad por una imagen sola.

Circuitos: A permite comunicar tras firma del encargado. B requiere firma de revisión del supervisor. C prepara un expediente para valoración; no crea sanciones ni envía correos automáticamente. La recepción del trabajador no implica conformidad; negativa y entrega fallida no acreditan recepción. La clasificación preventiva/dudosa fuerza B y no es calificación jurídica.

Seguridad: operaciones de servidor con autorización renovada, máquina de estados, claves idempotentes y compare-and-swap transaccional. Tablas privadas con RLS, sin escritura directa del navegador. Instantáneas y eventos inmutables; firmas vinculadas a hash, versión, actor y hora de servidor. Adjuntos y PDF privados con acceso autenticado, sin URL pública. Listas proyectadas/paginadas; detalle bajo demanda. No sondeos, reenvíos infinitos ni logs de contenido.

Contabilidad de reiteración deshabilitada hasta configurar y validar un horizonte aplicable y criterios de comparabilidad. No transformar prescripción de faltas en plazo universal de conservación. No usar nombre como identificador, ni antecedentes para contratación/SAE. Conservación, bloqueo y supresión requieren validación y procedimiento auditado; sin purgas automáticas de datos reales.

La política se configura por `(owner_id,worksite_id)`, con versión y auditoría, porque una obra puede pertenecer a distinta entidad empleadora o régimen. Sin política aprobada: borradores solamente; no envíos/firmas/comunicaciones formales. No se solicitan secretos ni se modifican credenciales.

Los documentos se generan en el servidor y se insertan atómicamente con cada actuación firmada. El hash del contenido incluye identidad, obra, contratación, declarante, versión y hechos. Los eventos conservan además estado, revisiones, decisiones, firmas y recepción. Una corrección crea versión nueva, retira firmas de la versión vigente y exige nueva ratificación. La elevación congela las revisiones y contenidos referenciados: no depende de que el antecedente se archive después.

Los identificadores de trabajadores son de contratación: no se fusionan registros distintos por nombres coincidentes. Las búsquedas de obra exigen correspondencia inequívoca y código válido. El historial C y referencias comparativas de otras obras/accesos no se exponen al encargado. El supervisor recibe metadatos genéricos de notificaciones, nunca hechos en la pantalla bloqueada.

Véanse [verificación y límites](validation.md), [validación jurídica](legal-validation.md) y [publicación/reversión](release.md).
