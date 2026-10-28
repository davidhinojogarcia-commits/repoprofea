# Rechazo voluntario y Salida de obra — nota técnica y jurídica

Fecha de consulta: 28/10/2026. Versión de aplicación prevista: 1.21.6.
Repositorio inspeccionado desde main bcc88b84c5b75910747a183ad0b711e42aea7667.

## Alcance de las plantillas

La interfaz conserva «Rechazo voluntario». Con servicios iniciados y voluntad expresa de terminar, se recoge una comunicación de dimisión. Con contrato firmado y sin servicios iniciados se recoge una manifestación de no incorporación o de finalización, según lo declarado, sin convertirla en rechazo de oferta sin contrato. La finalización exige fecha de contrato, incorporación prevista, inicio efectivo sí/no, manifestación concreta, efectos, motivo, referencia del contrato, régimen aplicable, fuente oficial/artículo/ámbito y preaviso comprobados. Una confirmación explícita deja constancia del contraste consignado; no equivale a validación jurídica profesional.

Rechazar exclusivamente una tarea/puesto o comunicar un riesgo sin voluntad de cesar bloquea la preparación y la firma final. Se conserva el borrador y se indica el circuito de Prevención o Partes y avisos. No se genera una diligencia de negativa o ausencia. Solo la firma voluntaria del trabajador y la confirmación/firma del encargado finalizan el registro.

«Salida de obra» es una comunicación de ausencia temporal, con salida prevista o efectivamente constatada, comunicación real separada y regreso estimado por hora, duración o pendiente. La recepción no concede permiso. El artículo 37 ET no permite tratar cualquier consulta médica ordinaria como permiso retribuido universal. El régimen concreto y el órgano competente determinan su tratamiento; el PDF no lo califica. No hay descuentos, sanciones, fichajes ni cambios SAE automáticos.

## Fuentes oficiales consultadas y decisiones de implementación

| Fuente | Precepto/alcance contrastado | Aplicación |
| --- | --- | --- |
| [Estatuto de los Trabajadores, texto BOE](https://www.boe.es/buscar/act.php?id=BOE-A-2015-11430) | Arts. 3.5, 37 y 49.1.d; entrada en vigor original 13/11/2015; el consolidado consultado señala actualización publicada 21/10/2026 | Sin renuncia genérica a derechos; dimisión solo si inequívoca; preaviso según convenio/costumbre, nunca universal; permisos sujetos al supuesto legal y régimen aplicable. Se revisó el articulado, no solo el índice. El consolidado es informativo. |
| [Ley General de la Seguridad Social](https://www.boe.es/buscar/act.php?id=BOE-A-2015-11724) | Art. 267, situaciones legales de desempleo | El registro no decide prestaciones ni crea situación legal de desempleo. |
| [SEPE: baja voluntaria y desempleo](https://sepe.es/HomeSepe/preguntas-frecuentes/detalle-pregunta?detail=%2Fpreguntas%2Fprestaciones-por-desempleo%2Frequisitos-de-acceso-a-las-prestaciones%2Fpuedo-cobrar-el-paro-tras-una-baja-voluntaria) | Requisito de involuntariedad y supuestos posteriores | No afirmar pérdida automática de prestaciones ni emitir una decisión administrativa. |
| [LPRL](https://www.boe.es/buscar/act.php?id=BOE-A-1995-24292) | Art. 21.1.b y 21.2; entrada original 10/02/1996; consolidado con actualización 09/04/2026 | La interrupción de actividad ante riesgo grave e inminente no se transforma en dimisión. |
| [SAE: comunicar contratación](https://ws054.juntadeandalucia.es/portalsae/quiero-contratar/comunicar-contrato) y [contratación laboral](https://www.juntadeandalucia.es/organismos/sae/areas/servicios-empresas/contratacion-laboral.html) | Comunicaciones por la empresa mediante los canales oficiales; relevancia del convenio aplicable | Generar un PDF interno no realiza ni sustituye esos trámites. No se llama a SAE/SEPE. |
| [SAE: gestión de ofertas](https://ws054.juntadeandalucia.es/portalsae/quiero-contratar/gestionar-oferta-empleo) | La fuente distingue selección, formalización y comunicación; advierte particularidades de PFEA | No crear una variante para candidatos sin contratar ni deducir comunicaciones efectuadas. |
| [RGPD en DOUE/BOE](https://www.boe.es/buscar/doc.php?id=DOUE-L-2016-80807) | Arts. 5.1.c, e, f, 9 y 32; aplicación desde 25/05/2018 | Motivos generales, privacidad, acceso mínimo y ninguna captura adicional de biometría. El acceso directo EUR-Lex presentó una comprobación de navegador; se consultó el texto publicado en BOE/DOUE. |
| [LOPDGDD](https://www.boe.es/buscar/act.php?id=BOE-A-2018-16673) | Art. 5, confidencialidad | Firmas y documentos no aparecen en QR, API pública ni enlaces permanentes de descarga. |
| [AEPD: justificantes laborales](https://www.aepd.es/preguntas-frecuentes/3-proteccion-de-datos-en-el-ambito-laboral/FAQ-0301-pueden-contener-datos-de-salud-los-justificantes-de-ausencia-laboral) | Minimización; información necesaria según el derecho laboral ejercido | Basta «Consulta médica». Solo se registra el estado del justificante; no se incorpora el documento clínico al PDF ni se habilita una nueva carga de justificantes. |
| [eIDAS, publicación DOUE/BOE](https://www.boe.es/buscar/doc.php?id=DOUE-L-2014-81822) | Arts. 25 y 26: efectos y requisitos diferenciados | Se identifica la firma como trazo en pantalla vinculado a contenido, versión, actuación y operador. No se afirma firma avanzada o cualificada. El sistema no implementa un servicio de confianza ni una validación eIDAS. |
| [Ley 6/2020](https://www.boe.es/buscar/act.php?id=BOE-A-2020-14046) | Arts. 1–3, documentos electrónicos y marco complementario | No prometer identidad absoluta ni eficacia probatoria cualificada por guardar PNG o SHA-256. |

La URL inicial de obligaciones/infracciones del SEPE no pudo recuperarse con el buscador en esta ejecución; no se ha empleado para fundamentar sanciones ni textos del PDF. No se han inventado códigos SAE ni consecuencias administrativas.

## Cuestiones que no se pueden verificar desde el repositorio

No consta un convenio/régimen concreto confirmado para cada contratación, ni un preaviso universal, ni una aprobación profesional de estas plantillas. Esos extremos no se suplen con PROFEA o con la entidad configurada. El formulario exige las referencias reales para preparar un rechazo. En la no incorporación con contrato firmado sigue siendo necesaria la valoración del contrato y del caso concreto; no se automatiza una calificación extintiva.

No se establece un plazo nuevo de conservación. La entidad responsable debe aplicar su política documental, base jurídica, información al trabajador y procedimiento de conservación/rectificación/supresión o bloqueo que corresponda. No se programa borrado de documentos firmados ni se impone conservación indefinida por una regla del módulo. El archivo permite consulta, descarga y anulación motivada, conservando la evidencia. La implantación técnica no valida jurídicamente la política de conservación existente.

No se presupone que el encargado pueda conceder permisos, decidir sobre retribución o representar al órgano competente en un cese. No se incorpora una firma obligatoria del supervisor. La firma del encargado es recepción/conocimiento de lo consignado y observado. La firma del trabajador es voluntaria y sobre la versión visible. Se distingue firmante de operador de dispositivo.

## Diseño técnico

- Un mismo componente `WorkforceDocumentsPanel` se abre desde los dos nuevos botones del Portal de Encargados y los dos apartados de Documentos de Obra. Misma API y mismo registro privado, sin copias entre módulos.
- Se reutilizan `SignaturePad`/`useHandwrittenSignature`, la entrega manual `openPartFile`, el almacén de borradores cifrados `visitDraftStore`, autenticación Supabase, resolución canónica de obra y validación de PNG del circuito de Partes.
- Contexto institucional tomado de la obra en servidor, sin constantes de empleador/CIF. Se puede actualizar explícitamente la instantánea de un borrador, con versión nueva y retirada de firmas; los firmados conservan la anterior.
- Trabajador consultado por `(owner_id,id)`. `obra_id` prevalece; se admite la etiqueta legada solo cuando no hay FK de obra. El servidor revalida la obra del encargado y la cuenta activa en cada operación. El propietario autenticado accede solo a su ámbito, sin una escalada global por rol admin.
- `workforce_documents` conserva instantánea, versión, revisión, estado y PDF definitivo. `workforce_document_events` registra cada actuación y evidencia anterior. RLS activada, sin acceso directo de anon/authenticated. La RPC es SECURITY INVOKER y solo ejecutable por service_role; el servidor es la frontera autorizada. El aviso informativo de RLS sin políticas es deliberado en estas tablas privadas; no es una concesión pública.
- Exclusión mutua transaccional por documento, comparación de revisión e idempotencia ligada al hash de petición. El PDF definitivo se genera en servidor y se guarda en la misma transacción que la segunda firma. No se responde con éxito antes de ese commit.
- La diligencia de regreso genera PDF separado. No cambia el PDF de salida. Una previsión no se convierte en hora efectiva: para cerrar un intervalo inicialmente previsto se exige salida efectiva comprobada y regreso efectivo. Sin ambos no se calcula intervalo real.
- El directorio puede retirar al trabajador activo sin borrar ni bloquear la documentación histórica. Ediciones, preparación y firmas nuevas revalidan su contratación actual, también al hacer commit. Las actuaciones posteriores sobre un documento histórico no recrean al trabajador.
- Borradores locales cifrados, caducidad heredada de siete días, separados por propietario/obra/tipo/rol. No se guardan trazos, JWT ni tokens del portal en esa cola. Las firmas se reintentan durante la sesión con la misma operación; tras recargar se consulta la persistencia real.
- No hay suscripciones nuevas. Búsqueda por obra y paginación de 30 personas/documentos; lista proyectada sin firmas. Errores del módulo sin payloads, tokens, DNI o motivos en logs.
- La identidad gráfica reutiliza logo y esquema institucional de los PDF de servidor. Paginación de párrafos largos y proporción de firmas conservadas. Borradores identificados; descargas definitivas desde bytes persistidos.

## Verificación

El detalle final de ejecución y publicación se registra en `Validacion_rechazo_salida_20261028.md`. Los scripts usan datos sintéticos. PGlite ejecuta PostgreSQL embebido con frontera de autenticación simulada: no se presenta como una sesión productiva Supabase. La comprobación PostgreSQL remota usa `verifyWorkforceDocumentsPostgres.sql` dentro de una transacción revertida. Las pruebas de navegador ejercitan los componentes completos y peticiones HTTP locales con el handler real, pero la autenticación y los servicios previos del portal son fixtures.
