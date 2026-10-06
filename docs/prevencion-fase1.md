# Prevención: incidencias y comprobaciones por obra

La primera fase añade **Incidencias y alertas** al grupo **Prevención y CAE** y a la vista guiada. El portal del encargado incorpora **Prevención**, limitado a su obra mediante el token existente.

## Comportamiento

- Incidencias y situaciones peligrosas sin lesión: obra, fecha, tarea, categoría, prioridad comunicada, descripción, medidas, responsable y plazo. Una fotografía opcional JPG/PNG/WebP se convierte a JPEG reducido; se descarga solo al abrir el detalle.
- Comprobación previa de seis aspectos, todos obligatorios. Si se detecta un problema, se exigen riesgo, medidas y responsable y el registro queda pendiente. Registrar una comprobación completa no autoriza por sí mismo el inicio de trabajos.
- El supervisor gestiona seguimiento y cierre; cerrar exige medidas y responsable. El encargado comunica y consulta los registros de su obra, pero no los cierra.
- Historial persistido por operación con estado, medidas, responsable, plazo y fecha. Se conserva el registro inicial; se muestran los últimos 100 cambios.
- Filtros por obra, estado y fechas, recuentos y tabla por obra. Hasta 500 registros recientes, con aviso si el conjunto es parcial. No se calculan tasas de accidentes ni rankings de seguridad.
- Aviso de prioridad alta o plazo vencido. AEMET se consulta por enlace manual. Alertas meteorológicas automáticas y recordatorios de hidratación quedan para otra fase.

## Persistencia y permisos

Migración: `supabase/migrations/20261006074525_prevention_incidents_and_checks.sql`.

Se crean `prevention_records` y `prevention_events`, con RLS y lectura del propietario. Escrituras por RPC, sin escrituras directas de los roles del cliente. El supervisor registra obras de su configuración. El acceso del encargado se obtiene del hash y estado activo de `foreman_portal_access`; no se aceptan propietario ni obra arbitrarios como autorización.

Los reintentos de altas con el mismo UUID y contenido no duplican registros ni historial. Las modificaciones requieren la versión `updated_at` leída y rechazan conflictos. El cambio y su historial se guardan en la misma transacción.

## Verificación reproducible

```sh
npm ci --no-audit --no-fund
npm run test:prevention
npm run lint
npm run build
```

`test:prevention` ejecuta validaciones y filtros, aplica SQL real en Postgres local (PGlite) y prueba el componente React en un DOM simulado (JSDOM) conectado a esa base. No utiliza datos reales ni accede a producción.

Cobertura: aislamiento de propietarios, rechazo anónimo sin token, obra y revocación del encargado, imposibilidad de cerrar desde el portal, cierre sin medidas, conflictos, reapertura, historial, fotos y reintentos. Interfaz: alta, recarga, seguimiento y comprobación previa.

Las regresiones existentes de firmas, reconocimiento de trabajadores, clasificación, periodos, orden de exportación, trazabilidad y capas de ventanas se ejecutaron localmente con `node --import tsx` para TypeScript y `node` para MJS.

## Pendiente antes de activar

La base usada por GestiónProfea es `oanurwzoymkmwmxoyzqi`. Las conexiones disponibles no tienen acceso a ese proyecto; la migración no se ha aplicado en producción. Debe aplicarse y verificarse con usuarios y tokens reales antes de publicar.

La revisión visual en navegador, móvil y tablet permanece pendiente: no hay navegador ejecutable disponible y la descarga de Chromium falló. Las pruebas DOM verifican interacción y persistencia, no aspecto visual ni notificaciones del sistema operativo.

La rama de revisión tiene el despliegue automático deshabilitado en `vercel.json`. No fusionar ni publicar hasta la validación del usuario. El módulo apoya los protocolos aprobados; no sustituye evaluación de riesgos, plan de seguridad y salud ni decisiones de los responsables preventivos.
