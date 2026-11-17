import { reportOperationalError } from '../src/lib/operationalLog.js';
import { analyzeMedicalDocumentText } from '../src/lib/medicalDocumentAnalyzer';

const normalize = (value: unknown) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const files = Array.isArray(body.files) && body.files.length
      ? body.files
      : body.fileBase64
        ? [{
            filename: body.filename || body.fileName || 'documento',
            extractedText: body.extractedText || body.localText || '',
          }]
        : [];

    if (!files.length) {
      return res.status(400).json({ error: 'No se ha recibido ningún documento para analizar.' });
    }

    const workers = Array.isArray(body.existingWorkers)
      ? body.existingWorkers
      : Array.isArray(body.people)
        ? body.people
        : [];

    if (!workers.length) {
      return res.status(400).json({ error: 'No hay trabajadores registrados para cotejar el reconocimiento.' });
    }

    const records: any[] = [];
    const unreadable: string[] = [];

    for (const file of files) {
      const filename = String(file?.filename || file?.fileName || 'documento');
      const text = String(file?.extractedText || file?.localText || '').trim();
      if (normalize(text).length < 20) {
        unreadable.push(filename);
        continue;
      }
      records.push(...analyzeMedicalDocumentText(text, workers as any, filename));
    }

    if (!records.length) {
      return res.status(422).json({
        error: unreadable.length
          ? `No se pudo extraer texto suficiente de: ${unreadable.join(', ')}.`
          : 'No se han reconocido trabajadores registrados con un resultado médico inequívoco.',
        records: [],
      });
    }

    const resultSets = new Map<string, Set<string>>();
    for (const record of records) {
      const key = String(record.matchedPersonId || normalize(record.apellidosNombre));
      const values = resultSets.get(key) || new Set<string>();
      values.add(record.resultado);
      resultSets.set(key, values);
    }

    const finalRecords = records.map(record => {
      const key = String(record.matchedPersonId || normalize(record.apellidosNombre));
      if ((resultSets.get(key)?.size || 0) <= 1) return record;
      return {
        ...record,
        confianza: 'baja',
        inconsistencias: ['Resultados contradictorios para este trabajador. Revisar manualmente.'],
      };
    });

    return res.status(200).json({
      success: true,
      records: finalRecords,
      provider: 'medical-engine-v2-local-ocr',
      fallback: false,
      unreadable,
    });
  } catch (error: any) {
    reportOperationalError('[medical-engine-v2]', error);
    return res.status(500).json({
      error: error?.message || 'No se pudieron analizar los reconocimientos médicos.',
    });
  }
}
