import { eq } from 'drizzle-orm';
import { db } from './index.ts';
import { users, obras, workers, subcontratistas, appConfig } from './schema.ts';

// User management with upsert
export async function getOrCreateUser(uid: string, email: string, displayName?: string) {
  try {
    const result = await db
      .insert(users)
      .values({
        uid,
        email,
        displayName: displayName || null,
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email,
          ...(displayName ? { displayName } : {}),
        },
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Database query getOrCreateUser failed:', error);
    throw new Error('Failed to synchronize user account.', { cause: error });
  }
}

// Obras Operations
export async function getDbObras() {
  try {
    return await db.select().from(obras);
  } catch (error) {
    console.error('Database query getDbObras failed:', error);
    throw new Error('Failed to retrieve obras catalog.', { cause: error });
  }
}

export async function upsertDbObra(nombre: string, recursoNombre?: string, recursoCategoria?: string) {
  try {
    const result = await db
      .insert(obras)
      .values({
        nombre,
        recursoPreventivoNombre: recursoNombre || null,
        recursoPreventivoCategoria: recursoCategoria || 'Encargado de Obra',
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: obras.nombre,
        set: {
          recursoPreventivoNombre: recursoNombre || null,
          recursoPreventivoCategoria: recursoCategoria || 'Encargado de Obra',
          updatedAt: new Date(),
        },
      })
      .returning();
    return result[0];
  } catch (error) {
    console.error('Database query upsertDbObra failed:', error);
    throw new Error('Failed to save obra.', { cause: error });
  }
}

export async function deleteDbObra(nombre: string) {
  try {
    await db.delete(obras).where(eq(obras.nombre, nombre));
    return { success: true };
  } catch (error) {
    console.error('Database query deleteDbObra failed:', error);
    throw new Error('Failed to delete obra.', { cause: error });
  }
}

// Workers Operations
export async function getDbWorkers() {
  try {
    return await db.select().from(workers);
  } catch (error) {
    console.error('Database query getDbWorkers failed:', error);
    throw new Error('Failed to retrieve workers list.', { cause: error });
  }
}

export async function upsertDbWorker(workerData: any) {
  try {
    const values = {
      supervisorResponsable: workerData.supervisorResponsable || null,
      numOferta: workerData.numOferta || null,
      obra: workerData.obra,
      categoria: workerData.categoria || null,
      quincena: workerData.quincena || null,
      apellidosNombre: workerData.apellidosNombre,
      dni: workerData.dni,
      fechaNacimiento: workerData.fechaNacimiento || null,
      periodoInicio: workerData.periodoInicio || null,
      periodoFin: workerData.periodoFin || null,
      telefono: workerData.telefono || null,
      calzado: workerData.calzado || null,
      formacion: workerData.formacion || 'No',
      lugarFormacion: workerData.lugarFormacion || null,
      citaDia: workerData.citaDia || null,
      citaHora: workerData.citaHora || null,
      sitioReconocimiento: workerData.sitioReconocimiento || null,
      documentacionCompleta: workerData.documentacionCompleta || 'No',
      observaciones: workerData.observaciones || null,
      fechaRegistro: workerData.fechaRegistro || new Date().toISOString(),
      necesitaReconocimiento: workerData.necesitaReconocimiento || null,
      aptitudMedica: workerData.aptitudMedica || null,
      limitacionesAptitud: workerData.limitacionesAptitud || null,
      reconocimientoEstado: workerData.reconocimientoEstado || null,
      reconocimientoFecha: workerData.reconocimientoFecha || null,
      reconocimientoValidez: workerData.reconocimientoValidez || null,
      reconocimientoLimitaciones: workerData.reconocimientoLimitaciones || null,
      reconocimientoObservaciones: workerData.reconocimientoObservaciones || null,
      updatedAt: new Date(),
    };

    if (workerData.id && typeof workerData.id === 'number') {
      const updated = await db
        .update(workers)
        .set(values)
        .where(eq(workers.id, workerData.id))
        .returning();
      if (updated.length > 0) return updated[0];
    }

    const inserted = await db.insert(workers).values(values).returning();
    return inserted[0];
  } catch (error) {
    console.error('Database query upsertDbWorker failed:', error);
    throw new Error('Failed to save worker record.', { cause: error });
  }
}

export async function deleteDbWorker(id: number) {
  try {
    await db.delete(workers).where(eq(workers.id, id));
    return { success: true };
  } catch (error) {
    console.error('Database query deleteDbWorker failed:', error);
    throw new Error('Failed to delete worker record.', { cause: error });
  }
}

// Subcontratistas Operations
export async function getDbSubcontratistas() {
  try {
    return await db.select().from(subcontratistas);
  } catch (error) {
    console.error('Database query getDbSubcontratistas failed:', error);
    throw new Error('Failed to retrieve subcontractors.', { cause: error });
  }
}

export async function upsertDbSubcontratista(sub: any) {
  try {
    const checklistStr = typeof sub.checklist === 'string' ? sub.checklist : JSON.stringify(sub.checklist || []);
    const values = {
      id: sub.id,
      nombreEmpresa: sub.nombreEmpresa,
      cif: sub.cif,
      obra: sub.obra,
      municipio: sub.municipio || null,
      personaContacto: sub.personaContacto || null,
      telefono: sub.telefono || null,
      email: sub.email || null,
      actividadGremio: sub.actividadGremio || null,
      fechaInicioPrevista: sub.fechaInicioPrevista || null,
      supervisorResponsable: sub.supervisorResponsable || null,
      recursoPreventivo: sub.recursoPreventivo || null,
      numeroTrabajadoresPrevistos: sub.numeroTrabajadoresPrevistos ? Number(sub.numeroTrabajadoresPrevistos) : null,
      estadoExpediente: sub.estadoExpediente || 'pendiente',
      checklist: checklistStr,
      fechaRegistro: sub.fechaRegistro || new Date().toISOString(),
      fechaActualizacion: sub.fechaActualizacion || new Date().toISOString(),
      notas: sub.notas || null,
      updatedAt: new Date(),
    };

    const result = await db
      .insert(subcontratistas)
      .values(values)
      .onConflictDoUpdate({
        target: subcontratistas.id,
        set: {
          ...values,
          updatedAt: new Date(),
        },
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Database query upsertDbSubcontratista failed:', error);
    throw new Error('Failed to save subcontractor.', { cause: error });
  }
}

export async function deleteDbSubcontratista(id: string) {
  try {
    await db.delete(subcontratistas).where(eq(subcontratistas.id, id));
    return { success: true };
  } catch (error) {
    console.error('Database query deleteDbSubcontratista failed:', error);
    throw new Error('Failed to delete subcontractor.', { cause: error });
  }
}

// App Configurations
export async function getDbConfig(key: string) {
  try {
    const result = await db.select().from(appConfig).where(eq(appConfig.key, key));
    return result[0]?.value ? JSON.parse(result[0].value) : null;
  } catch (error) {
    console.error(`Database query getDbConfig(${key}) failed:`, error);
    throw new Error('Failed to retrieve configuration.', { cause: error });
  }
}

export async function setDbConfig(key: string, value: any) {
  try {
    const valStr = JSON.stringify(value);
    const result = await db
      .insert(appConfig)
      .values({ key, value: valStr, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: appConfig.key,
        set: { value: valStr, updatedAt: new Date() },
      })
      .returning();
    return result[0];
  } catch (error) {
    console.error(`Database query setDbConfig(${key}) failed:`, error);
    throw new Error('Failed to save configuration.', { cause: error });
  }
}
