from pathlib import Path

path = Path('api/parse-medical-records.ts')
text = path.read_text(encoding='utf-8')

old_parse = """const parseAptitud = (context: string) => {
  if (/no\\s+apto/.test(context)) return 'No Apto';
  if (/apto\\s+con\\s+(limitacion|limitaciones|restriccion|restricciones)/.test(context)) return 'Apto con Limitación';
  if (/\\bapto\\b/.test(context)) return 'Apto';
  return '';
};
"""

new_parse = """const parseAptitud = (context: string) => {
  const value = normalizeText(context);
  if (/\\bno\\s+apt[oa]s?\\b/.test(value) || /\\bno\\s+apto\\b/.test(value)) return 'No Apto';
  if (/\\bapt[oa]s?\\s+con\\s+(limitacion|limitaciones|restriccion|restricciones)\\b/.test(value)) return 'Apto con Limitación';
  if (/\\bapt[oa]s?\\b/.test(value)) return 'Apto';
  if (/\\baptitud\\s+(favorable|positiva|correcta)\\b/.test(value)) return 'Apto';
  return '';
};

const parseGlobalAptitud = (text: string) => {
  const value = normalizeText(text);
  if (!value) return '';

  // Solo se acepta una aptitud global cuando el propio documento deja claro que
  // el listado completo comparte el mismo resultado. Si aparecen resultados
  // negativos o limitaciones, se obliga a resolver trabajador por trabajador.
  if (/\\bno\\s+apt[oa]s?\\b/.test(value) || /\\bapt[oa]s?\\s+con\\s+(limitacion|limitaciones|restriccion|restricciones)\\b/.test(value)) {
    return '';
  }

  const clearlyAptList = [
    /\\brelacion\\s+de\\s+(trabajadores|personas|empleados)\\s+apt[oa]s?\\b/,
    /\\blistado\\s+de\\s+(trabajadores|personas|empleados)\\s+apt[oa]s?\\b/,
    /\\btrabajadores\\s+apt[oa]s?\\b/,
    /\\btodos\\s+apt[oa]s?\\b/,
    /\\baptitud\\s+(favorable|positiva)\\b/,
    /\\bresultado\\s+apt[oa]\\b/,
    /\\bapt[oa]\\s+para\\s+(el|la)\\s+(puesto|trabajo)\\b/
  ].some(pattern => pattern.test(value));

  return clearlyAptList ? 'Apto' : '';
};
"""

old_local = """    const filename = String(file?.filename || file?.fileName || 'documento.pdf');
    for (const worker of workers) {
      const name = String(worker?.apellidosNombre || '').trim();
      if (!name) continue;
      const context = findWorkerContext(text, name);
      if (!context) continue;
      const resultado = parseAptitud(context);
      if (!resultado) continue;
      const originalContextIndex = normalizeText(text).indexOf(context.slice(0, Math.min(80, context.length)));
      const nearbyRaw = originalContextIndex >= 0 ? text.slice(Math.max(0, originalContextIndex - 300), originalContextIndex + 700) : text;
      records.push({
        dni: String(worker?.dni || ''), apellidosNombre: name, resultado,
        limitaciones: resultado === 'Apto con Limitación' ? 'Revisar limitaciones indicadas en el documento.' : '',
        fechaReconocimiento: isoDateFromText(nearbyRaw) || isoDateFromText(text),
        validez: '', centroMedico: 'No especificado',
        observaciones: 'Extraído localmente del PDF al no requerir servicio externo de IA.',
        confianza: 'media', archivoOrigen: filename
      });
    }
"""

new_local = """    const filename = String(file?.filename || file?.fileName || 'documento.pdf');
    const globalAptitud = parseGlobalAptitud(text);
    const documentDate = isoDateFromText(text);

    for (const worker of workers) {
      const name = String(worker?.apellidosNombre || '').trim();
      if (!name) continue;
      const context = findWorkerContext(text, name);
      if (!context) continue;

      const localAptitud = parseAptitud(context);
      const resultado = localAptitud || globalAptitud;
      if (!resultado) continue;

      records.push({
        dni: String(worker?.dni || ''), apellidosNombre: name, resultado,
        limitaciones: resultado === 'Apto con Limitación' ? 'Revisar limitaciones indicadas en el documento.' : '',
        fechaReconocimiento: documentDate,
        validez: '', centroMedico: 'No especificado',
        observaciones: localAptitud
          ? 'Resultado localizado junto al trabajador mediante lectura local del PDF.'
          : 'Trabajador incluido en un listado cuya aptitud global figura expresamente en el documento.',
        confianza: localAptitud ? 'alta' : 'media', archivoOrigen: filename
      });
    }
"""

if old_parse not in text:
    raise SystemExit('parseAptitud block not found')
if old_local not in text:
    raise SystemExit('local fallback block not found')

text = text.replace(old_parse, new_parse, 1)
text = text.replace(old_local, new_local, 1)
path.write_text(text, encoding='utf-8')
print('medical local fallback patch applied')
