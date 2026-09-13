from pathlib import Path

path = Path('components/ReconocimientosMedicosSection.tsx')
text = path.read_text(encoding='utf-8')

old_import = "import { extractClientDocumentText } from '../src/lib/clientDocumentText';"
new_import = "import { extractClientDocumentText } from '../src/lib/clientDocumentText';\nimport { analyzeMedicalDocumentText } from '../src/lib/medicalDocumentAnalyzer';\nimport { persistMedicalRecognition } from '../src/services/medicalRecognitionService';"
if new_import not in text:
    if old_import not in text:
        raise SystemExit('No se encontró import de extracción documental')
    text = text.replace(old_import, new_import, 1)

start_marker = "  // Handle single or multiple PDF/image files upload to /api/parse-medical-records\n"
end_marker = "  // Alias for backward compatibility\n"
start = text.find(start_marker)
end = text.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit('No se encontró el bloque de importación médica actual')

replacement = r'''  // Motor médico V2: análisis local determinista sobre texto nativo/OCR.
  // La IA deja de ser una dependencia del flujo principal.
  const handleProcessFiles = async (inputFiles: FileList | File[] | File) => {
    const rawFiles: File[] = inputFiles instanceof File ? [inputFiles] : Array.from(inputFiles);
    const validFiles = rawFiles.filter(file => {
      const lower = file.name.toLowerCase();
      return file.type === 'application/pdf' || file.type.startsWith('image/') || /\.(pdf|png|jpe?g|webp)$/i.test(lower);
    });

    if (!validFiles.length) {
      onToast('Seleccione documentos PDF o imágenes de reconocimientos médicos.', 'error');
      return;
    }

    setIsUploading(true);
    setLastUploadedFile(validFiles[0] || null);
    setLastUploadedFiles(validFiles);
    setSourceFilename(validFiles.length === 1 ? validFiles[0].name : `${validFiles.length} documentos`);
    setSourceFilenames(validFiles.map(f => f.name));
    setCandidateSourceFileFilter('todos');

    try {
      const allDetected: ParsedCandidateItem[] = [];
      const unreadable: string[] = [];

      for (let index = 0; index < validFiles.length; index += 1) {
        const file = validFiles[index];
        setUploadProgressText(`Documento ${index + 1}/${validFiles.length} · preparando lectura…`);
        const extracted = await extractClientDocumentText(file, message => {
          setUploadProgressText(`Documento ${index + 1}/${validFiles.length} · ${message}`);
        });

        if (!extracted.text.trim()) {
          unreadable.push(file.name);
          continue;
        }

        setUploadProgressText(`Documento ${index + 1}/${validFiles.length} · identificando trabajadores y aptitud…`);
        const detected = analyzeMedicalDocumentText(extracted.text, people, file.name);
        detected.forEach((item, itemIndex) => {
          const validated = revalidateCandidate({
            ...item,
            id: `${Date.now()}_${index}_${itemIndex}_${item.matchedPersonId || 'unmatched'}`,
            selected: item.confianza !== 'baja',
          });
          allDetected.push(validated);
        });
      }

      if (!allDetected.length) {
        setParsedResults([]);
        const extra = unreadable.length ? ` No se pudo obtener texto de: ${unreadable.join(', ')}.` : '';
        onToast(`No se reconocieron trabajadores con un resultado médico inequívoco.${extra}`, 'error');
        return;
      }

      // Si la misma persona aparece con resultados distintos, nunca se aplica automáticamente.
      const resultsByWorker = new Map<number, Set<string>>();
      allDetected.forEach(item => {
        if (!item.matchedPersonId) return;
        const set = resultsByWorker.get(item.matchedPersonId) || new Set<string>();
        set.add(item.resultado);
        resultsByWorker.set(item.matchedPersonId, set);
      });
      const conflictIds = new Set<number>(
        Array.from(resultsByWorker.entries()).filter(([, values]) => values.size > 1).map(([id]) => id)
      );

      const finalDetected = allDetected.map(item => conflictIds.has(item.matchedPersonId || -1)
        ? {
            ...item,
            confianza: 'baja' as const,
            selected: false,
            inconsistencias: [...(item.inconsistencias || []), 'Resultados médicos contradictorios para este trabajador. Revisar manualmente.'],
          }
        : item
      );

      setParsedResults(finalDetected);

      // Aplicación automática solo de coincidencias inequívocas de alta confianza.
      const autoApply = finalDetected.filter(item =>
        item.matchedPersonId && item.confianza === 'alta' && item.resultado && item.resultado !== 'Pendiente'
      );

      if (autoApply.length) {
        const appliedIds = new Set(autoApply.map(item => item.matchedPersonId as number));
        const updatedPeople = people.map(person => {
          if (!appliedIds.has(person.id)) return person;
          const match = autoApply.find(item => item.matchedPersonId === person.id)!;
          const aptitud = match.resultado === 'Apto con Limitación' ? 'Apto con limitaciones' : match.resultado;
          const limitations = match.resultado === 'Apto con Limitación' ? (match.limitaciones || '') : '';
          return {
            ...person,
            reconocimientoEstado: match.resultado,
            aptitudMedica: aptitud,
            limitacionesAptitud: limitations,
            reconocimientoLimitaciones: limitations,
            reconocimientoFecha: match.fechaReconocimiento || person.reconocimientoFecha || '',
            reconocimientoValidez: match.validez || person.reconocimientoValidez || '',
            reconocimientoObservaciones: match.observaciones || `Reconocimiento importado de ${match.archivoOrigen || 'documento médico'}.`,
            documentacionCompleta: match.resultado === 'No Apto' ? 'No' : person.documentacionCompleta,
          } as Person;
        });

        onUpdatePeople(updatedPeople);
        const changed = updatedPeople.filter(person => appliedIds.has(person.id));
        await Promise.allSettled(changed.map(person => persistMedicalRecognition(person)));
      }

      const reviewCount = finalDetected.filter(item => item.confianza !== 'alta' || !item.matchedPersonId).length;
      const aptos = autoApply.filter(item => item.resultado === 'Apto').length;
      const limitados = autoApply.filter(item => item.resultado === 'Apto con Limitación').length;
      const noAptos = autoApply.filter(item => item.resultado === 'No Apto').length;
      const summary = `${autoApply.length} aplicados automáticamente: ${aptos} aptos, ${limitados} aptos con limitaciones y ${noAptos} no aptos.`;
      onToast(reviewCount ? `${summary} ${reviewCount} caso(s) requieren revisión.` : summary, noAptos ? 'error' : 'success');
    } catch (error: any) {
      console.error('Motor médico V2:', error);
      onToast(error?.message || 'No se pudieron analizar los reconocimientos médicos.', 'error');
    } finally {
      setIsUploading(false);
      setUploadProgressText('');
    }
  };

'''

text = text[:start] + replacement + text[end:]
path.write_text(text, encoding='utf-8')
print('Motor médico V2 integrado')
