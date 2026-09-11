import React, { useState, useRef, useMemo } from 'react';
import { 
  FileUp, 
  Sparkles, 
  CheckCircle2, 
  AlertTriangle, 
  ShieldAlert, 
  X, 
  Activity, 
  Download, 
  Search, 
  Filter, 
  RefreshCw, 
  FileSpreadsheet, 
  FileText, 
  UserCheck, 
  UserX,
  AlertCircle,
  HelpCircle,
  Pencil,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Building2,
  CalendarRange,
  HeartPulse,
  RotateCcw,
  SlidersHorizontal,
  Check
} from 'lucide-react';
import { Person, MedicalRecordImportItem, getAptitudMedicaInfo } from '../types';
import { 
  formatDate, 
  prepareExcelData, 
  preparePDFData, 
  prepareRRMMExcelData, 
  prepareRRMMPDFData,
  preparePRLLimitacionesPDFData
} from '../src/lib/exportUtils';

interface ReconocimientosMedicosSectionProps {
  people: Person[];
  onUpdatePeople: (updatedPeople: Person[]) => void;
  onToast: (message: string, type: 'success' | 'error') => void;
}

interface ParsedCandidateItem extends MedicalRecordImportItem {
  id: string;
  matchedPersonId?: number;
  matchedPersonName?: string;
  selected: boolean;
}

export const ReconocimientosMedicosSection: React.FC<ReconocimientosMedicosSectionProps> = ({
  people,
  onUpdatePeople,
  onToast
}) => {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgressText, setUploadProgressText] = useState<string>('');
  const [isDragging, setIsDragging] = useState(false);
  const [lastUploadedFile, setLastUploadedFile] = useState<File | null>(null);
  const [lastUploadedFiles, setLastUploadedFiles] = useState<File[]>([]);
  const [parsedResults, setParsedResults] = useState<ParsedCandidateItem[] | null>(null);
  const [sourceFilename, setSourceFilename] = useState<string>('');
  const [sourceFilenames, setSourceFilenames] = useState<string[]>([]);
  const [candidateSourceFileFilter, setCandidateSourceFileFilter] = useState<string>('todos');
  const [filterStatus, setFilterStatus] = useState<string>('todos');
  const [filterObra, setFilterObra] = useState<string>('todas');
  const [filterQuincena, setFilterQuincena] = useState<string>('todos');
  const [filterAptitud, setFilterAptitud] = useState<string>('todas');
  const [sortBy, setSortBy] = useState<'nombre' | 'dni' | 'obra' | 'quincena' | 'cita' | 'aptitud' | 'validez'>('nombre');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [exportScope, setExportScope] = useState<'filtered' | 'all'>('filtered');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [editingPerson, setEditingPerson] = useState<Person | null>(null);
  const [candidateFilterTab, setCandidateFilterTab] = useState<'todos' | 'inconsistencias' | 'validos'>('todos');
  const [editingCandidate, setEditingCandidate] = useState<ParsedCandidateItem | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Normalize DNI helper
  const cleanDni = (val?: string) => val ? val.trim().toUpperCase().replace(/[\s-]/g, '') : '';

  // Helper to normalize Spanish names for ultra-robust matching (removes accents, punctuation, extra spaces)
  const normalizeSpanishName = (name?: string): string => {
    if (!name) return '';
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // remove diacritics / accents (García -> Garcia)
      .replace(/[,.;:\-_/\\()]/g, ' ')  // replace punctuation with space
      .replace(/\s+/g, ' ')
      .trim();
  };

  const SPANISH_STOP_WORDS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'san', 'santa', 'da', 'di']);

  // Robust worker finder matching strictly by Nombre y Apellidos (no DNI lookup)
  const findWorkerByName = (extractedName?: string, workerList: Person[] = []): Person | undefined => {
    if (!extractedName || !extractedName.trim()) return undefined;

    const normTarget = normalizeSpanishName(extractedName);
    if (!normTarget) return undefined;

    // 1. Direct exact normalized match (e.g. "juan garcia lopez" === "juan garcia lopez")
    const exact = workerList.find(p => normalizeSpanishName(p.apellidosNombre) === normTarget);
    if (exact) return exact;

    // 2. Check if comma separates "Apellidos, Nombre" -> test reversed "Nombre Apellidos"
    if (extractedName.includes(',')) {
      const parts = extractedName.split(',').map(p => p.trim());
      if (parts.length === 2 && parts[0] && parts[1]) {
        const reversed = normalizeSpanishName(`${parts[1]} ${parts[0]}`);
        const reversedMatch = workerList.find(p => normalizeSpanishName(p.apellidosNombre) === reversed);
        if (reversedMatch) return reversedMatch;
      }
    }

    // 3. Token-based matching (handles inverted word orders like "GARCIA LOPEZ JUAN" vs "JUAN GARCIA LOPEZ")
    const targetTokens = normTarget.split(' ').filter(t => t.length > 1 && !SPANISH_STOP_WORDS.has(t));
    if (targetTokens.length === 0) return undefined;

    let bestMatch: Person | undefined = undefined;
    let bestScore = 0;

    for (const person of workerList) {
      const personNorm = normalizeSpanishName(person.apellidosNombre);
      if (!personNorm) continue;

      // Check reversed comma in person record
      let personReversed = '';
      if (person.apellidosNombre?.includes(',')) {
        const pParts = person.apellidosNombre.split(',').map(p => p.trim());
        if (pParts.length === 2 && pParts[0] && pParts[1]) {
          personReversed = normalizeSpanishName(`${pParts[1]} ${pParts[0]}`);
        }
      }

      if (personNorm === normTarget || (personReversed && personReversed === normTarget)) {
        return person;
      }

      const personTokens = personNorm.split(' ').filter(t => t.length > 1 && !SPANISH_STOP_WORDS.has(t));
      if (personTokens.length === 0) continue;

      // Shared tokens check
      const sharedTokens = targetTokens.filter(tt =>
        personTokens.some(pt => pt === tt || (tt.length > 3 && pt.startsWith(tt)) || (pt.length > 3 && tt.startsWith(pt)))
      );

      const allTargetInPerson = targetTokens.every(tt => personTokens.some(pt => pt === tt));
      const allPersonInTarget = personTokens.every(pt => targetTokens.some(tt => tt === pt));
      const tokenRatio = (sharedTokens.length * 2) / (targetTokens.length + personTokens.length);

      if (allTargetInPerson || allPersonInTarget) {
        if (tokenRatio > bestScore) {
          bestScore = 1.0;
          bestMatch = person;
        }
      } else if (tokenRatio >= 0.7 && tokenRatio > bestScore) {
        bestScore = tokenRatio;
        bestMatch = person;
      }
    }

    return bestScore >= 0.7 ? bestMatch : undefined;
  };

  // Helper for client-side DNI validation (Spanish Modulo 23)
  // In medical examination lists, DNIs do NOT appear, so empty DNI is standard and valid.
  const validateDniClient = (dniRaw?: string): { isValid: boolean; normalized: string; error?: string } => {
    if (!dniRaw || !dniRaw.trim()) {
      return { isValid: true, normalized: '' }; // DNI no consta en reconocimientos médicos, normal y válido
    }
    const clean = dniRaw.trim().toUpperCase().replace(/[\s.-]/g, '');
    const letters = 'TRWAGMYFPDXBNJZSQVHLCKE';

    const dniMatch = clean.match(/^(\d{8})([A-Z])$/);
    if (dniMatch) {
      const num = parseInt(dniMatch[1], 10);
      const expectedLetter = letters[num % 23];
      if (dniMatch[2] !== expectedLetter) {
        return {
          isValid: false,
          normalized: clean,
          error: `Letra DNI '${dniMatch[2]}' discordante (se esperaba '${expectedLetter}')`
        };
      }
      return { isValid: true, normalized: clean };
    }

    const nieMatch = clean.match(/^([XYZ])(\d{7})([A-Z])$/);
    if (nieMatch) {
      let prefix = '0';
      if (nieMatch[1] === 'Y') prefix = '1';
      else if (nieMatch[1] === 'Z') prefix = '2';
      const num = parseInt(prefix + nieMatch[2], 10);
      const expectedLetter = letters[num % 23];
      if (nieMatch[3] !== expectedLetter) {
        return {
          isValid: false,
          normalized: clean,
          error: `Letra NIE '${nieMatch[3]}' discordante (se esperaba '${expectedLetter}')`
        };
      }
      return { isValid: true, normalized: clean };
    }

    return {
      isValid: false,
      normalized: clean,
      error: `Formato DNI/NIE no reglamentario (${clean.length} caracteres)`
    };
  };

  const validateDateClient = (dateRaw?: string): { isValid: boolean; normalized: string; error?: string } => {
    if (!dateRaw || !dateRaw.trim()) {
      return { isValid: false, normalized: '', error: 'Fecha no detectada' };
    }
    let clean = dateRaw.trim();
    const esMatch = clean.match(/^(\d{1,2})[\/\.-](\d{1,2})[\/\.-](\d{4})$/);
    if (esMatch) {
      clean = `${esMatch[3]}-${esMatch[2].padStart(2, '0')}-${esMatch[1].padStart(2, '0')}`;
    }
    const isoMatch = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!isoMatch) {
      return { isValid: false, normalized: clean, error: 'Formato de fecha inválido (se espera AAAA-MM-DD)' };
    }
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10);
    const day = parseInt(isoMatch[3], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2020 || year > 2035) {
      return { isValid: false, normalized: clean, error: 'Fecha anómala o fuera de rango' };
    }
    return { isValid: true, normalized: clean };
  };

  const validateCentroClient = (centroRaw?: string): { isValid: boolean; normalized: string; error?: string } => {
    if (!centroRaw || !centroRaw.trim()) {
      return { isValid: false, normalized: 'No especificado', error: 'Centro médico emisor no especificado' };
    }
    const clean = centroRaw.trim();
    if (['no especificado', 'desconocido', 'n/a', '-', 'sin especificar'].includes(clean.toLowerCase())) {
      return { isValid: false, normalized: 'No especificado', error: 'Centro médico emisor no especificado' };
    }
    return { isValid: true, normalized: clean };
  };

  const revalidateCandidate = (candidate: ParsedCandidateItem): ParsedCandidateItem => {
    // Validate DNI format only if manually specified
    const dniRes = validateDniClient(candidate.dni);
    const dateRes = validateDateClient(candidate.fechaReconocimiento);
    const centroRes = validateCentroClient(candidate.centroMedico);

    const inconsistencias: string[] = [];
    if (!dniRes.isValid && candidate.dni) inconsistencias.push(dniRes.error!);
    if (!dateRes.isValid) inconsistencias.push(dateRes.error!);
    if (!centroRes.isValid) inconsistencias.push(centroRes.error!);

    let confianza: 'alta' | 'media' | 'baja' = 'alta';
    if (!dateRes.isValid || inconsistencias.length >= 2) {
      confianza = 'baja';
    } else if (!centroRes.isValid || inconsistencias.length === 1) {
      confianza = 'media';
    }

    // Match strictly by Nombre y Apellidos against hired workers (never requiring DNI in document)
    let matched: Person | undefined = undefined;
    if (candidate.matchedPersonId) {
      matched = people.find(p => p.id === candidate.matchedPersonId);
    }
    if (!matched && candidate.apellidosNombre) {
      matched = findWorkerByName(candidate.apellidosNombre, people);
    }

    // Assign worker DNI from system database if matched
    const finalDni = matched ? matched.dni : (dniRes.normalized || candidate.dni || '');

    return {
      ...candidate,
      dni: finalDni,
      fechaReconocimiento: dateRes.normalized || candidate.fechaReconocimiento,
      centroMedico: centroRes.normalized,
      dniValido: true,
      fechaValida: dateRes.isValid,
      centroValido: centroRes.isValid,
      confianza,
      inconsistencias,
      matchedPersonId: matched ? matched.id : undefined,
      matchedPersonName: matched ? matched.apellidosNombre : undefined,
      selected: !!matched && (candidate.selected ?? true)
    };
  };

  // Calculate statistics using centralized getAptitudMedicaInfo
  const totalHired = people.length;
  const aptosCount = useMemo(() => people.filter(p => getAptitudMedicaInfo(p).estado === 'Apto').length, [people]);
  const conLimitacionCount = useMemo(() => people.filter(p => getAptitudMedicaInfo(p).estado === 'Apto con limitaciones').length, [people]);
  const noAptosCount = useMemo(() => people.filter(p => getAptitudMedicaInfo(p).estado === 'No Apto').length, [people]);
  const pendientesCount = useMemo(() => people.filter(p => getAptitudMedicaInfo(p).estado === 'Pendiente').length, [people]);

  // Unique obras and quincenas list for dropdown filters
  const uniqueObras = useMemo(() => {
    const set = new Set<string>();
    people.forEach(p => {
      if (p.obra && p.obra.trim()) set.add(p.obra.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
  }, [people]);

  const uniqueQuincenas = useMemo(() => {
    const set = new Set<string>();
    people.forEach(p => {
      if (p.quincena && p.quincena.trim()) set.add(p.quincena.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
  }, [people]);

  // Sort toggle handler
  const handleSort = (column: 'nombre' | 'dni' | 'obra' | 'quincena' | 'cita' | 'aptitud' | 'validez') => {
    if (sortBy === column) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('asc');
    }
  };

  // Handle single or multiple PDF/image files upload to /api/parse-medical-records
  const handleProcessFiles = async (inputFiles: FileList | File[] | File) => {
    const rawFiles: File[] = inputFiles instanceof File 
      ? [inputFiles] 
      : Array.from(inputFiles);

    if (!rawFiles || rawFiles.length === 0) {
      onToast('No se seleccionó ningún archivo para procesar.', 'error');
      return;
    }

    // Filter valid files (PDF or images)
    const validFiles: File[] = [];
    const invalidFiles: string[] = [];

    rawFiles.forEach(file => {
      const fileNameLower = file.name.toLowerCase();
      const isPdf = fileNameLower.endsWith('.pdf') || file.type === 'application/pdf';
      const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(file.name);
      if (isPdf || isImage) {
        validFiles.push(file);
      } else {
        invalidFiles.push(file.name);
      }
    });

    if (validFiles.length === 0) {
      onToast('Por favor, seleccione documentos en formato PDF o imagen (JPG, PNG).', 'error');
      return;
    }

    if (invalidFiles.length > 0) {
      onToast(`Se omitieron ${invalidFiles.length} archivo(s) no compatibles (${invalidFiles.join(', ')}). Procesando ${validFiles.length} válido(s)...`, 'error');
    }

    setIsUploading(true);
    setLastUploadedFiles(validFiles);
    setLastUploadedFile(validFiles[0]);
    const fileNames = validFiles.map(f => f.name);
    setSourceFilenames(fileNames);
    setSourceFilename(fileNames.length === 1 ? fileNames[0] : `${fileNames.length} archivos (${fileNames.join(', ')})`);
    setUploadProgressText(`Cargando ${validFiles.length} archivo(s)...`);

    try {
      // Read all files as base64 concurrently
      const filesPayload = await Promise.all(
        validFiles.map(async (file) => {
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const res = (reader.result as string) || '';
              const clean = res.includes(',') ? res.split(',')[1] : res;
              resolve(clean);
            };
            reader.onerror = (err) => reject(err);
            reader.readAsDataURL(file);
          });

          const isPdf = file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
          const mimeType = file.type || (isPdf ? 'application/pdf' : 'image/jpeg');

          return {
            filename: file.name,
            mimeType,
            fileBase64: base64
          };
        })
      );

      setUploadProgressText(
        validFiles.length > 1 
          ? `Analizando ${validFiles.length} documentos conjuntamente con IA...` 
          : 'Analizando documento con IA...'
      );

      // Send payload with both files array and single file fields for backward and forward compatibility
      const response = await fetch('/api/parse-medical-records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: filesPayload,
          fileBase64: filesPayload[0]?.fileBase64,
          pdfBase64: filesPayload[0]?.fileBase64,
          filename: filesPayload[0]?.filename,
          mimeType: filesPayload[0]?.mimeType,
          existingWorkers: people.map(p => ({
            id: p.id,
            dni: p.dni,
            apellidosNombre: p.apellidosNombre,
            obra: p.obra,
            quincena: p.quincena
          }))
        })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Error al procesar los reconocimientos médicos con IA');
      }

      const data = await response.json();
      const records: MedicalRecordImportItem[] = data.records || [];

      if (!records || records.length === 0) {
        onToast('La IA no ha detectado registros de aptitud médica en los archivos proporcionados.', 'error');
        setIsUploading(false);
        return;
      }

      const currentYear = new Date().getFullYear().toString();

      // Match extracted records with current hired workers EXCLUSIVELY by Nombre y Apellidos (no DNI in medical sheets)
      const mappedResults: ParsedCandidateItem[] = records.map((rec, idx) => {
        // Identification strictly by Nombre y Apellidos
        const matched = findWorkerByName(rec.apellidosNombre, people);

        // Filter out any false DNI warnings since medical lists do not include DNIs
        const filteredInconsistencias = (rec.inconsistencias || []).filter(
          inc => !inc.toLowerCase().includes('dni') && !inc.toLowerCase().includes('nif') && !inc.toLowerCase().includes('letra')
        );

        const uniqueSuffix = Math.random().toString(36).substring(2, 9);
        const origFile = rec.archivoOrigen || (validFiles.length === 1 ? validFiles[0].name : undefined);

        return {
          ...rec,
          id: `rec-${idx}-${Date.now()}-${uniqueSuffix}`,
          dni: matched ? matched.dni : (rec.dni || ''),
          validez: rec.validez || currentYear,
          archivoOrigen: origFile,
          matchedPersonId: matched ? matched.id : undefined,
          matchedPersonName: matched ? matched.apellidosNombre : undefined,
          selected: !!matched, // select by default if matched in plantilla
          dniValido: true, // DNI is not required on medical lists
          inconsistencias: filteredInconsistencias
        };
      });

      setParsedResults(mappedResults);
      setCandidateSourceFileFilter('todos');
      const matchedCount = mappedResults.filter(m => m.matchedPersonId).length;

      const successMsg = validFiles.length > 1
        ? `IA completada con éxito: ${records.length} reconocimientos extraídos de ${validFiles.length} archivos analizados conjuntamente (${matchedCount} trabajadores identificados en plantilla).`
        : `IA completada: ${records.length} reconocimientos extraídos (${matchedCount} trabajadores identificados en plantilla).`;

      onToast(successMsg, 'success');
    } catch (error: any) {
      console.error('Error importing medical records:', error);
      let errorMsg = error.message || 'Error al comunicarse con el servicio de IA para reconocimientos médicos.';
      if (
        errorMsg.includes('503') ||
        errorMsg.includes('high demand') ||
        errorMsg.includes('UNAVAILABLE') ||
        errorMsg.includes('Spikes in demand')
      ) {
        errorMsg = 'El servicio de IA está experimentando alta demanda momentánea en Google. Por favor, vuelve a intentarlo en unos segundos.';
      } else if (errorMsg.includes('429') || errorMsg.includes('RESOURCE_EXHAUSTED')) {
        errorMsg = 'Límite de peticiones de IA alcanzado temporalmente. Por favor, espera unos instantes antes de reintentar.';
      }
      onToast(errorMsg, 'error');
    } finally {
      setIsUploading(false);
      setUploadProgressText('');
    }
  };

  // Alias for backward compatibility
  const handleProcessPdf = (file: File) => handleProcessFiles(file);

  // Apply selected results to worker records
  const handleApplyResults = () => {
    if (!parsedResults) return;

    const toApply = parsedResults.filter(r => r.selected && r.matchedPersonId);
    if (toApply.length === 0) {
      onToast('No hay reconocimientos seleccionados asociados a trabajadores contratados.', 'error');
      return;
    }

    const currentYear = new Date().getFullYear().toString();
    let noAptoCount = 0;

    const updatedPeople = people.map(p => {
      const match = toApply.find(item => item.matchedPersonId === p.id);
      if (match) {
        const isNoApto = match.resultado === 'No Apto';
        if (isNoApto) {
          noAptoCount++;
        }
        const aptitudVal = match.resultado === 'Apto con Limitación' ? 'Apto con limitaciones' : match.resultado;
        return {
          ...p,
          reconocimientoEstado: match.resultado,
          aptitudMedica: aptitudVal,
          limitacionesAptitud: match.resultado === 'Apto con Limitación' ? (match.limitaciones || '') : '',
          // VALIDACIÓN AUTOMÁTICA: Si el resultado es 'No Apto', marcar automáticamente la documentación en 'No'
          documentacionCompleta: isNoApto ? 'No' : p.documentacionCompleta,
          reconocimientoFecha: match.fechaReconocimiento || p.reconocimientoFecha || new Date().toISOString().split('T')[0],
          reconocimientoValidez: match.validez || p.reconocimientoValidez || currentYear,
          reconocimientoLimitaciones: match.resultado === 'Apto con Limitación' ? (match.limitaciones || '') : '',
          reconocimientoObservaciones: match.observaciones || p.reconocimientoObservaciones || (isNoApto ? 'Reconocimiento Médico No Apto - Contratación no autorizada' : '')
        };
      }
      return p;
    });

    onUpdatePeople(updatedPeople);

    if (noAptoCount > 0) {
      onToast(`¡${toApply.length} reconocimientos registrados! ⚠️ ATENCIÓN: ${noAptoCount} trabajador(es) "No Apto" marcados automáticamente con documentación en 'No' y resaltados en rojo para evitar contrataciones erróneas.`, 'error');
    } else {
      onToast(`¡Se han registrado ${toApply.length} reconocimientos médicos en las fichas de los trabajadores contratados con validez ${currentYear}!`, 'success');
    }
    setParsedResults(null);
  };

  // Toggle selection for an item in the preview
  const handleToggleSelectCandidate = (id: string) => {
    setParsedResults(prev => {
      if (!prev) return null;
      return prev.map(item => item.id === id ? { ...item, selected: !item.selected } : item);
    });
  };

  // Select or deselect all matched items
  const handleToggleSelectAll = (select: boolean) => {
    setParsedResults(prev => {
      if (!prev) return null;
      return prev.map(item => item.matchedPersonId ? { ...item, selected: select } : item);
    });
  };

  // Filtered and Sorted list of workers according to user criteria
  const filteredAndSortedWorkers = useMemo(() => {
    const filtered = people.filter(p => {
      const aptInfo = getAptitudMedicaInfo(p);

      // Filtro por obra seleccionada
      if (filterObra !== 'todas' && (p.obra || '').trim() !== filterObra) {
        return false;
      }

      // Filtro por período / quincena seleccionada
      if (filterQuincena !== 'todos' && (p.quincena || '').trim() !== filterQuincena) {
        return false;
      }

      // Filtro por aptitud médica específica
      if (filterAptitud !== 'todas') {
        if (filterAptitud === 'Apto' && aptInfo.estado !== 'Apto') return false;
        if (filterAptitud === 'Apto con limitaciones' && aptInfo.estado !== 'Apto con limitaciones') return false;
        if (filterAptitud === 'No Apto' && aptInfo.estado !== 'No Apto') return false;
        if (filterAptitud === 'Pendiente' && aptInfo.estado !== 'Pendiente') return false;
      }

      // Filtro por estado legacy / tarjetas estadísticas superiores
      if (filterStatus !== 'todos') {
        if (filterStatus === 'apto' && aptInfo.estado !== 'Apto') return false;
        if (filterStatus === 'limitacion' && aptInfo.estado !== 'Apto con limitaciones') return false;
        if (filterStatus === 'no_apto' && aptInfo.estado !== 'No Apto') return false;
        if (filterStatus === 'pendiente' && aptInfo.estado !== 'Pendiente') return false;
      }

      // Búsqueda en texto libre
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchName = (p.apellidosNombre || '').toLowerCase().includes(q);
        const matchDni = (p.dni || '').toLowerCase().includes(q);
        const matchObra = (p.obra || '').toLowerCase().includes(q);
        const matchQuincena = (p.quincena || '').toLowerCase().includes(q);
        const matchLimitaciones = (aptInfo.limitaciones || p.reconocimientoLimitaciones || '').toLowerCase().includes(q);
        const matchCentro = (p.sitioReconocimiento || '').toLowerCase().includes(q);
        return matchName || matchDni || matchObra || matchQuincena || matchLimitaciones || matchCentro;
      }

      return true;
    });

    // Ordenación según selección del usuario
    return filtered.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case 'nombre':
          cmp = (a.apellidosNombre || '').localeCompare(b.apellidosNombre || '', 'es');
          break;
        case 'dni':
          cmp = (a.dni || '').localeCompare(b.dni || '');
          break;
        case 'obra':
          cmp = (a.obra || '').localeCompare(b.obra || '', 'es');
          break;
        case 'quincena':
          cmp = (a.quincena || '').localeCompare(b.quincena || '', 'es');
          break;
        case 'cita': {
          const citaA = `${a.citaDia || ''} ${a.citaHora || ''}`;
          const citaB = `${b.citaDia || ''} ${b.citaHora || ''}`;
          cmp = citaA.localeCompare(citaB);
          break;
        }
        case 'aptitud': {
          const weight: Record<string, number> = {
            'No Apto': 1,
            'Apto con limitaciones': 2,
            'Pendiente': 3,
            'Apto': 4
          };
          const wA = weight[getAptitudMedicaInfo(a).estado] || 5;
          const wB = weight[getAptitudMedicaInfo(b).estado] || 5;
          cmp = wA - wB;
          break;
        }
        case 'validez': {
          const vA = a.reconocimientoValidez || '';
          const vB = b.reconocimientoValidez || '';
          cmp = vA.localeCompare(vB);
          break;
        }
        default:
          cmp = 0;
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });
  }, [people, filterObra, filterQuincena, filterAptitud, filterStatus, searchQuery, sortBy, sortOrder]);

  // Alias for backward compatibility in existing JSX references
  const filteredWorkers = filteredAndSortedWorkers;

  // Toggle or change sorting column
  const handleSortToggle = (column: 'nombre' | 'dni' | 'obra' | 'quincena' | 'cita' | 'aptitud' | 'validez') => {
    if (sortBy === column) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('asc');
    }
  };

  // Helper to determine dataset to export based on user scope choice
  const getDataToExport = () => {
    if (exportScope === 'filtered') {
      return filteredAndSortedWorkers;
    }
    return people;
  };

  // Quick export handlers respecting user filtered & sorted data
  const handleExportRelacionExcel = async () => {
    try {
      const dataToExport = getDataToExport();
      if (dataToExport.length === 0) {
        onToast('No hay trabajadores en la selección actual para exportar.', 'error');
        return;
      }
      const { buffer, filename } = await prepareExcelData(dataToExport);
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      onToast(`Relación de contratados (${dataToExport.length} trabajadores) exportada a Excel`, 'success');
    } catch (err: any) {
      onToast('Error al exportar Excel: ' + err.message, 'error');
    }
  };

  const handleExportRelacionPdf = () => {
    try {
      const dataToExport = getDataToExport();
      if (dataToExport.length === 0) {
        onToast('No hay trabajadores en la selección actual para exportar.', 'error');
        return;
      }
      const { doc, filename } = preparePDFData(dataToExport);
      doc.save(filename);
      onToast(`Relación de contratados (${dataToExport.length} trabajadores) exportada a PDF`, 'success');
    } catch (err: any) {
      onToast('Error al exportar PDF: ' + err.message, 'error');
    }
  };

  const handleExportRRMMExcel = async () => {
    try {
      const dataToExport = getDataToExport();
      if (dataToExport.length === 0) {
        onToast('No hay trabajadores en la selección actual para exportar.', 'error');
        return;
      }
      const { buffer, filename } = await prepareRRMMExcelData(dataToExport);
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      onToast(`Informe de Reconocimientos Médicos (${dataToExport.length} registros) exportado a Excel`, 'success');
    } catch (err: any) {
      onToast('Error al exportar Excel de Reconocimientos Médicos: ' + err.message, 'error');
    }
  };

  const handleExportRRMMPdf = () => {
    try {
      const dataToExport = getDataToExport();
      if (dataToExport.length === 0) {
        onToast('No hay trabajadores en la selección actual para exportar.', 'error');
        return;
      }
      const { doc, filename } = prepareRRMMPDFData(dataToExport);
      doc.save(filename);
      onToast(`Informe de Reconocimientos Médicos (${dataToExport.length} registros) exportado a PDF`, 'success');
    } catch (err: any) {
      onToast('Error al exportar PDF de Reconocimientos Médicos: ' + err.message, 'error');
    }
  };

  const handleExportPRLLimitacionesPdf = () => {
    try {
      const dataToExport = getDataToExport();
      const workersWithLimitations = dataToExport.filter(p => {
        const aptInfo = getAptitudMedicaInfo(p);
        if (aptInfo.estado === 'Apto con limitaciones') return true;
        const lim = (aptInfo.limitaciones || p.reconocimientoLimitaciones || '').trim();
        if (!lim) return false;
        const lower = lim.toLowerCase();
        if (['ninguna', 'ninguno', 'sin limitaciones', 'sin restricción', 'sin restricciones', 'no', '-', 'ninguna limitación', 'sin limitacion', 'n/a'].includes(lower)) {
          return false;
        }
        return lim.length > 0;
      });

      if (workersWithLimitations.length === 0) {
        onToast(`No se han detectado trabajadores con limitaciones físicas en la selección actual (${dataToExport.length} trabajador(es) evaluados).`, 'error');
        return;
      }

      const { doc, filename, count } = preparePRLLimitacionesPDFData(dataToExport);
      doc.save(filename);
      onToast(`Informe de Situación de Trabajadores con Especial Atención generado con éxito (${count} trabajador(es) con limitaciones físicas detectadas).`, 'success');
    } catch (err: any) {
      onToast('Error al generar PDF de informe de salud en obra: ' + err.message, 'error');
    }
  };

  const handleResetFilters = () => {
    setFilterObra('todas');
    setFilterQuincena('todos');
    setFilterAptitud('todas');
    setFilterStatus('todos');
    setSearchQuery('');
  };

  const hasActiveFilters = filterObra !== 'todas' || filterQuincena !== 'todos' || filterAptitud !== 'todas' || filterStatus !== 'todos' || searchQuery.trim() !== '';

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      
      {/* 1. Top Informative Summary & Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Contratados</span>
            <Activity className="w-4 h-4 text-blue-500" />
          </div>
          <p className="text-2xl font-extrabold text-slate-800 dark:text-slate-100 mt-2">{totalHired}</p>
          <span className="text-[10px] text-slate-400">Total en plantilla</span>
        </div>

        <div className="bg-emerald-50/60 dark:bg-emerald-950/20 p-4 rounded-2xl border border-emerald-200 dark:border-emerald-900/40 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">Aptos</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-2xl font-extrabold text-emerald-800 dark:text-emerald-200 mt-2">{aptosCount}</p>
          <span className="text-[10px] text-emerald-600/80 dark:text-emerald-400/80">Completamente aptos</span>
        </div>

        <div className="bg-amber-50/60 dark:bg-amber-950/20 p-4 rounded-2xl border border-amber-200 dark:border-amber-900/40 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider">C/ Limitación</span>
            <ShieldAlert className="w-4 h-4 text-amber-600" />
          </div>
          <p className="text-2xl font-extrabold text-amber-800 dark:text-amber-200 mt-2">{conLimitacionCount}</p>
          <div className="flex items-center justify-between mt-1">
            <span className="text-[10px] text-amber-600/80 dark:text-amber-400/80">Con restricciones</span>
            {conLimitacionCount > 0 && (
              <button
                type="button"
                onClick={handleExportPRLLimitacionesPdf}
                className="text-[10px] font-bold text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 flex items-center gap-1 cursor-pointer transition-colors"
                title="Generar listado PDF exclusivo para el Técnico de Prevención"
              >
                <Download className="w-3 h-3" />
                <span>PDF PRL</span>
              </button>
            )}
          </div>
        </div>

        <div className="bg-red-50/60 dark:bg-red-950/20 p-4 rounded-2xl border border-red-200 dark:border-red-900/40 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-red-700 dark:text-red-400 uppercase tracking-wider">No Aptos</span>
            <AlertTriangle className="w-4 h-4 text-red-600" />
          </div>
          <p className="text-2xl font-extrabold text-red-800 dark:text-red-200 mt-2">{noAptosCount}</p>
          <span className="text-[10px] text-red-600/80 dark:text-red-400/80">No aptos para puesto</span>
        </div>

        <div className="bg-slate-100 dark:bg-slate-800/60 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs col-span-2 sm:col-span-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Pendientes</span>
            <HelpCircle className="w-4 h-4 text-slate-500" />
          </div>
          <p className="text-2xl font-extrabold text-slate-700 dark:text-slate-200 mt-2">{pendientesCount}</p>
          <span className="text-[10px] text-slate-500">Sin registrar aún</span>
        </div>
      </div>

      {/* 2. PDF Upload Box with AI */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 sm:p-8 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-blue-50 dark:bg-blue-950/40 text-[#00548E] dark:text-blue-400 rounded-xl">
                <FileUp className="w-5 h-5" />
              </div>
              <h3 className="text-base sm:text-lg font-bold text-slate-800 dark:text-slate-100">
                Importación con IA de Reconocimientos Médicos
              </h3>
              <span className="inline-flex items-center gap-1 bg-blue-100 text-[#00548E] dark:bg-blue-900/40 dark:text-blue-300 text-[10px] font-extrabold px-2 py-0.5 rounded-full">
                <Sparkles className="w-3 h-3" /> IA Gemini
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-2xl leading-relaxed">
              Cargue uno o varios documentos oficiales (PDF o imágenes) con la relación de reconocimientos médicos (vigilancia de la salud / toldos). La IA analizará todos los archivos conjuntamente en una sola lista unificada, identificando y vinculando a cada trabajador por su <strong>Nombre y Apellidos</strong>, asociando automáticamente el DNI de la plantilla municipal, registrando la aptitud médica (Apto, No Apto o Apto con Limitación) y guardando las limitaciones específicas con validez {new Date().getFullYear()}.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto min-w-0">
            {lastUploadedFiles.length > 0 && !isUploading && !parsedResults && (
              <button
                type="button"
                onClick={() => handleProcessFiles(lastUploadedFiles)}
                className="flex w-full sm:w-auto min-w-0 items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs text-center leading-tight shadow-md shadow-amber-500/10 transition-all cursor-pointer"
                title={`Reintentar procesar ${lastUploadedFiles.length} archivo(s) con IA`}
              >
                <RefreshCw className="w-4 h-4" />
                <span>Reintentar con IA ({lastUploadedFiles.length} doc{lastUploadedFiles.length > 1 ? 's' : ''})</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="flex w-full sm:w-auto min-w-0 items-center justify-center gap-2.5 px-4 sm:px-5 py-3 rounded-2xl bg-[#00548E] hover:bg-blue-800 text-white font-bold text-xs text-center leading-tight shadow-md shadow-blue-500/10 transition-all cursor-pointer disabled:opacity-50"
            >
              {isUploading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>{uploadProgressText || 'Analizando con IA...'}</span>
                </>
              ) : (
                <>
                  <FileUp className="w-4 h-4" />
                  <span className="min-w-0 whitespace-normal break-words">Importar Reconocimientos (Varios PDF / Imagen)</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Hidden multi-file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,application/pdf,image/png,image/jpeg,image/webp,.jpg,.jpeg,.png"
          className="hidden"
          onChange={(e) => {
            const files = e.target.files;
            if (files && files.length > 0) {
              handleProcessFiles(files);
              e.target.value = '';
            }
          }}
        />

        {/* Drag and Drop Zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            const files = e.dataTransfer.files;
            if (files && files.length > 0) handleProcessFiles(files);
          }}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all ${
            isDragging 
              ? 'border-[#00548E] bg-blue-50/50 dark:bg-blue-950/20' 
              : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50'
          }`}
        >
          <div className="flex flex-col items-center justify-center gap-2">
            <div className="w-12 h-12 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400 shadow-xs">
              <FileText className="w-6 h-6 text-[#00548E] dark:text-blue-400" />
            </div>
            <div>
              <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
                Arrastre aquí uno o varios archivos (PDF o imágenes) con los reconocimientos médicos o haga clic para examinar
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Búsqueda e identificación por <strong>Nombre y Apellidos</strong>. Análisis multi-archivo simultáneo (puede seleccionar y analizar múltiples PDF, JPG y PNG juntos)
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 3. AI Parsing Preview Modal / Box if records were parsed */}
      {parsedResults && (() => {
        const inconsistentCount = parsedResults.filter(
          r => !r.fechaValida || !r.centroValido || r.confianza === 'baja' || (r.inconsistencias && r.inconsistencias.length > 0)
        ).length;
        const validCount = parsedResults.length - inconsistentCount;

        const displayedCandidates = parsedResults.filter(item => {
          const hasIssue = !item.fechaValida || !item.centroValido || item.confianza === 'baja' || (item.inconsistencias && item.inconsistencias.length > 0);
          if (candidateFilterTab === 'inconsistencias' && !hasIssue) return false;
          if (candidateFilterTab === 'validos' && hasIssue) return false;
          if (candidateSourceFileFilter !== 'todos' && item.archivoOrigen && item.archivoOrigen !== candidateSourceFileFilter) return false;
          return true;
        });

        return (
          <div className="bg-white dark:bg-slate-900 rounded-3xl border-2 border-blue-500/40 dark:border-blue-500/40 p-6 shadow-xl space-y-5 animate-in fade-in duration-300">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Sparkles className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  <h4 className="text-base font-extrabold text-slate-800 dark:text-slate-100">
                    Resultados de Reconocimientos Médicos Reconocidos por la IA ({parsedResults.length} registros extraídos)
                  </h4>
                  {sourceFilenames.length > 1 && (
                    <span className="inline-flex items-center gap-1 bg-blue-100 dark:bg-blue-900/60 text-[#00548E] dark:text-blue-300 text-[10px] font-extrabold px-2 py-0.5 rounded-full">
                      {sourceFilenames.length} archivos unificados
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Documento(s): <strong className="text-slate-700 dark:text-slate-200">{sourceFilename}</strong>. Compruebe los datos extraídos y confirme para registrarlos en las fichas de los trabajadores.
                </p>

                {sourceFilenames.length > 1 && (
                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">Archivos analizados conjuntamente:</span>
                    {sourceFilenames.map((fname, i) => {
                      const countForFile = parsedResults.filter(r => r.archivoOrigen === fname).length;
                      return (
                        <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px] font-medium border border-slate-200 dark:border-slate-700">
                          <FileText className="w-3 h-3 text-blue-500 shrink-0" />
                          <span className="truncate max-w-[180px]" title={fname}>{fname}</span>
                          <span className="text-[10px] font-bold text-slate-400">({countForFile})</span>
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setParsedResults(null);
                    setCandidateSourceFileFilter('todos');
                  }}
                  className="px-3 py-2 text-xs font-semibold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  Descartar
                </button>
                <button
                  type="button"
                  onClick={handleApplyResults}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md shadow-emerald-600/20 transition-all cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Aplicar a Fichas de Trabajadores</span>
                </button>
              </div>
            </div>

            {/* Inconsistency summary alert banner */}
            {inconsistentCount > 0 ? (
              <div className="p-4 bg-red-50/90 dark:bg-red-950/50 border-2 border-red-300 dark:border-red-800/80 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs shadow-xs">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-black uppercase tracking-wide text-red-700 dark:text-red-300 block sm:inline mr-2">
                      ⚠️ Validación Asistida por IA - {inconsistentCount} registro(s) con alertas:
                    </span>
                    <span className="text-red-800 dark:text-red-200">
                      Los campos marcados en <strong>rojo</strong> (DNI, Fecha o Centro) presentan inconsistencias de formato o baja confianza en el reconocimiento OCR. Puede editarlos directamente haciendo clic en el botón de edición (✏️) antes de importar.
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setCandidateFilterTab('inconsistencias')}
                  className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white font-bold text-[11px] rounded-lg shrink-0 transition-colors shadow-xs"
                >
                  Ver Solo Inconsistencias ({inconsistentCount})
                </button>
              </div>
            ) : (
              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 rounded-2xl flex items-center gap-2 text-xs text-emerald-800 dark:text-emerald-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>
                  <strong>Validación óptima:</strong> Todos los campos extraídos (DNI con dígito de control, fechas y centros) han superado la validación automática con alta confianza.
                </span>
              </div>
            )}

            {/* Advertencia si hay No Aptos detectados */}
            {parsedResults.some(item => item.resultado === 'No Apto') && (
              <div className="p-3 bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-800 rounded-2xl flex items-center gap-2.5 text-xs text-amber-900 dark:text-amber-200 shadow-xs">
                <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <div>
                  <span className="font-black uppercase tracking-wide mr-1.5 text-amber-700 dark:text-amber-300">
                    Trabajadores "No Apto" Detectados:
                  </span>
                  <span>
                    Al aplicar a las fichas, el campo <strong>documentacionCompleta</strong> se marcará automáticamente en <strong>"No"</strong> para impedir contrataciones indebidas.
                  </span>
                </div>
              </div>
            )}

            {/* Filters Tabs & Selection Controls */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800/90 p-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => setCandidateFilterTab('todos')}
                  className={`px-3 py-1.5 rounded-lg font-bold text-[11px] transition-all cursor-pointer ${
                    candidateFilterTab === 'todos'
                      ? 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 shadow-xs'
                      : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                  }`}
                >
                  Todos ({parsedResults.length})
                </button>
                <button
                  type="button"
                  onClick={() => setCandidateFilterTab('inconsistencias')}
                  className={`px-3 py-1.5 rounded-lg font-bold text-[11px] transition-all flex items-center gap-1 cursor-pointer ${
                    candidateFilterTab === 'inconsistencias'
                      ? 'bg-red-600 text-white shadow-xs'
                      : inconsistentCount > 0
                      ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50'
                      : 'text-slate-400'
                  }`}
                >
                  <AlertTriangle className="w-3 h-3" />
                  <span>Con Inconsistencias ({inconsistentCount})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCandidateFilterTab('validos')}
                  className={`px-3 py-1.5 rounded-lg font-bold text-[11px] transition-all flex items-center gap-1 cursor-pointer ${
                    candidateFilterTab === 'validos'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/50'
                  }`}
                >
                  <CheckCircle2 className="w-3 h-3" />
                  <span>Válidos ({validCount})</span>
                </button>
              </div>

              {/* Quick selection buttons & File filter */}
              <div className="flex flex-wrap items-center gap-3 text-xs">
                {sourceFilenames.length > 1 && (
                  <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800/90 px-2 py-1 rounded-xl">
                    <FileText className="w-3.5 h-3.5 text-blue-500" />
                    <span className="text-slate-500 font-medium">Filtrar por archivo:</span>
                    <select
                      value={candidateSourceFileFilter}
                      onChange={(e) => setCandidateSourceFileFilter(e.target.value)}
                      className="px-2 py-0.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 focus:outline-hidden"
                    >
                      <option value="todos">Todos los archivos ({parsedResults.length})</option>
                      {sourceFilenames.map((fname, i) => {
                        const count = parsedResults.filter(r => r.archivoOrigen === fname).length;
                        return (
                          <option key={i} value={fname}>{fname} ({count})</option>
                        );
                      })}
                    </select>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <span className="text-slate-500 font-medium">Seleccionar:</span>
                  <button
                    type="button"
                    onClick={() => handleToggleSelectAll(true)}
                    className="text-[#00548E] dark:text-blue-400 font-bold hover:underline"
                  >
                    Todos los emparejados
                  </button>
                  <span className="text-slate-300">|</span>
                  <button
                    type="button"
                    onClick={() => handleToggleSelectAll(false)}
                    className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 font-medium"
                  >
                    Deseleccionar todos
                  </button>
                </div>
              </div>
            </div>

            {/* Table of extracted results */}
            <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-slate-700">
                    <th className="p-3 w-10 text-center">Sel.</th>
                    <th className="p-3">Confianza IA</th>
                    {sourceFilenames.length > 1 && <th className="p-3">Archivo Origen</th>}
                    <th className="p-3">Trabajador en Listado Médico</th>
                    <th className="p-3">DNI (Plantilla)</th>
                    <th className="p-3">Centro Médico</th>
                    <th className="p-3">Fecha Reconocimiento</th>
                    <th className="p-3">Emparejado en Plantilla</th>
                    <th className="p-3">Aptitud</th>
                    <th className="p-3">Limitaciones Extraídas</th>
                    <th className="p-3 text-center">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {displayedCandidates.map((item, idx) => {
                    const isMatched = !!item.matchedPersonId;
                    const isNoApto = item.resultado === 'No Apto';
                    const hasIssues = !item.fechaValida || !item.centroValido || item.confianza === 'baja' || (item.inconsistencias && item.inconsistencias.length > 0);

                    return (
                      <tr 
                        key={`candidate_${item.id || idx}_${idx}`}
                        className={`transition-colors ${
                          hasIssues
                            ? 'bg-red-50/70 dark:bg-red-950/30 hover:bg-red-100/70 dark:hover:bg-red-950/50 border-l-4 border-l-red-500'
                            : isNoApto
                            ? 'bg-amber-50/70 dark:bg-amber-950/30 hover:bg-amber-100/70 dark:hover:bg-amber-950/50 border-l-4 border-l-amber-500'
                            : !isMatched 
                            ? 'opacity-75 bg-slate-50/50 dark:bg-slate-900/30' 
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                        }`}
                      >
                        {/* Checkbox */}
                        <td className="p-3 text-center">
                          <input
                            type="checkbox"
                            checked={item.selected}
                            disabled={!isMatched}
                            onChange={() => handleToggleSelectCandidate(item.id)}
                            className="w-4 h-4 rounded border-slate-300 text-[#00548E] focus:ring-[#00548E] cursor-pointer"
                          />
                        </td>

                        {/* Confianza badge */}
                        <td className="p-3">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-wide ${
                            item.confianza === 'alta'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                              : item.confianza === 'media'
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                              : 'bg-red-600 text-white shadow-xs font-black'
                          }`}>
                            {item.confianza === 'baja' ? (
                              <>
                                <AlertTriangle className="w-3 h-3 text-white" />
                                <span>Baja Confianza</span>
                              </>
                            ) : item.confianza === 'media' ? (
                              <>
                                <HelpCircle className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                                <span>Media</span>
                              </>
                            ) : (
                              <>
                                <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                                <span>Alta</span>
                              </>
                            )}
                          </span>
                        </td>

                        {/* Archivo Origen (si son varios archivos) */}
                        {sourceFilenames.length > 1 && (
                          <td className="p-3">
                            <span 
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px] font-semibold max-w-[130px] truncate"
                              title={item.archivoOrigen || 'Documento'}
                            >
                              <FileText className="w-3 h-3 text-blue-500 shrink-0" />
                              <span className="truncate">{item.archivoOrigen || 'Documento'}</span>
                            </span>
                          </td>
                        )}

                        {/* Trabajador Extraído */}
                        <td className="p-3 font-semibold text-slate-800 dark:text-slate-100">
                          <div className="flex items-center gap-1.5">
                            <span>{item.apellidosNombre || 'Sin nombre detectado'}</span>
                            {isNoApto && (
                              <span className="bg-red-600 text-white text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0">
                                NO APTO
                              </span>
                            )}
                          </div>
                        </td>

                        {/* DNI / NIE (Asignado desde la Plantilla por Nombre y Apellidos) */}
                        <td className="p-3">
                          {isMatched && item.dni ? (
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-slate-700 dark:text-slate-200 font-bold">
                                {item.dni}
                              </span>
                              <span className="text-[9px] bg-blue-100 dark:bg-blue-950 text-[#00548E] dark:text-blue-300 px-1.5 py-0.5 rounded font-bold border border-blue-200 dark:border-blue-800 shrink-0">
                                Plantilla
                              </span>
                            </div>
                          ) : item.dni ? (
                            <span className="font-mono text-slate-600 dark:text-slate-400 font-medium">
                              {item.dni}
                            </span>
                          ) : (
                            <span className="text-slate-400 dark:text-slate-500 italic text-[11px]">
                              No consta en listado
                            </span>
                          )}
                        </td>

                        {/* Centro Médico with Red Highlighting on Inconsistency */}
                        <td className="p-3">
                          {item.centroValido ? (
                            <span className="text-slate-700 dark:text-slate-300 font-medium">
                              {item.centroMedico || 'No especificado'}
                            </span>
                          ) : (
                            <div className="space-y-1">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-100 dark:bg-red-900/60 text-red-700 dark:text-red-300 font-bold border border-red-300 dark:border-red-700 text-[11px] shadow-xs">
                                <AlertCircle className="w-3.5 h-3.5 text-red-600 dark:text-red-400 shrink-0" />
                                <span>{item.centroMedico || 'No especificado'}</span>
                              </span>
                              <span className="block text-[10px] text-red-600 dark:text-red-400 font-semibold leading-tight">
                                Centro no detectado
                              </span>
                            </div>
                          )}
                        </td>

                        {/* Fecha Reconocimiento with Red Highlighting on Inconsistency */}
                        <td className="p-3">
                          {item.fechaValida ? (
                            <div>
                              <span className="text-slate-700 dark:text-slate-300 font-medium">
                                {item.fechaReconocimiento ? formatDate(item.fechaReconocimiento) : '-'}
                              </span>
                              <div className="text-[10px] text-slate-400 font-semibold">Validez: {item.validez || new Date().getFullYear()}</div>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-100 dark:bg-red-900/60 text-red-700 dark:text-red-300 font-bold border border-red-300 dark:border-red-700 text-[11px] shadow-xs">
                                <AlertCircle className="w-3.5 h-3.5 text-red-600 dark:text-red-400 shrink-0" />
                                <span>{item.fechaReconocimiento || 'Fecha ausente'}</span>
                              </span>
                              <span className="block text-[10px] text-red-600 dark:text-red-400 font-semibold leading-tight">
                                Fecha no válida o ausente
                              </span>
                            </div>
                          )}
                        </td>

                        {/* Emparejado en Plantilla (Por Nombre y Apellidos) */}
                        <td className="p-3">
                          {isMatched ? (
                            <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-bold">
                              <UserCheck className="w-4 h-4 shrink-0" />
                              <span className="truncate max-w-[160px]" title={item.matchedPersonName}>
                                {item.matchedPersonName}
                              </span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1 text-slate-400 dark:text-slate-500 italic text-[11px]">
                              <UserX className="w-3.5 h-3.5 shrink-0" />
                              <span>Sin coincidencia en plantilla</span>
                            </div>
                          )}
                        </td>

                        {/* Resultado Aptitud */}
                        <td className="p-3">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-extrabold uppercase tracking-wide ${
                            item.resultado === 'Apto' 
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300' 
                              : item.resultado === 'Apto con Limitación'
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
                              : 'bg-red-600 text-white shadow-xs'
                          }`}>
                            {item.resultado === 'Apto con Limitación' && <ShieldAlert className="w-3 h-3" />}
                            {item.resultado === 'Apto' && <CheckCircle2 className="w-3 h-3" />}
                            {item.resultado === 'No Apto' && <AlertTriangle className="w-3 h-3" />}
                            {item.resultado}
                          </span>
                        </td>

                        {/* Limitaciones */}
                        <td className="p-3 text-slate-600 dark:text-slate-300">
                          {item.limitaciones ? (
                            <div className="p-1 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded text-[11px] text-amber-900 dark:text-amber-200 font-medium">
                              {item.limitaciones}
                            </div>
                          ) : (
                            <span className="text-slate-400 italic text-[11px]">Sin limitaciones</span>
                          )}
                        </td>

                        {/* Action: Inline correction button */}
                        <td className="p-3 text-center">
                          <button
                            type="button"
                            onClick={() => setEditingCandidate(item)}
                            className="p-1.5 rounded-xl text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/50 transition-all cursor-pointer"
                            title="Editar y corregir datos extraídos"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* Candidate Edit Modal for Instant Inconsistency Correction */}
      {editingCandidate && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 max-w-lg w-full shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Pencil className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
                <div>
                  <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                    Corregir Datos Extraídos por OCR
                  </h4>
                  {editingCandidate.archivoOrigen && (
                    <p className="text-[11px] text-slate-400">
                      Archivo: <span className="font-semibold text-slate-600 dark:text-slate-300">{editingCandidate.archivoOrigen}</span>
                    </p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingCandidate(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-600 dark:text-slate-300 font-bold mb-1">
                  Trabajador en Listado Médico (Apellidos y Nombre)
                </label>
                <input
                  type="text"
                  value={editingCandidate.apellidosNombre || ''}
                  onChange={(e) => {
                    const newName = e.target.value;
                    const autoMatch = findWorkerByName(newName, people);
                    setEditingCandidate({
                      ...editingCandidate,
                      apellidosNombre: newName,
                      matchedPersonId: autoMatch?.id,
                      matchedPersonName: autoMatch?.apellidosNombre,
                      dni: autoMatch?.dni || editingCandidate.dni
                    });
                  }}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-medium"
                />
              </div>

              <div>
                <label className="block text-slate-600 dark:text-slate-300 font-bold mb-1">
                  Vincular con Trabajador de la Plantilla (Búsqueda por Nombre y Apellidos)
                </label>
                <select
                  value={editingCandidate.matchedPersonId || ''}
                  onChange={(e) => {
                    const selId = e.target.value;
                    if (!selId) {
                      setEditingCandidate({
                        ...editingCandidate,
                        matchedPersonId: undefined,
                        matchedPersonName: undefined
                      });
                    } else {
                      const sel = people.find(p => p.id === selId);
                      if (sel) {
                        setEditingCandidate({
                          ...editingCandidate,
                          matchedPersonId: sel.id,
                          matchedPersonName: sel.apellidosNombre,
                          dni: sel.dni,
                          selected: true
                        });
                      }
                    }
                  }}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-medium text-slate-800 dark:text-slate-100"
                >
                  <option value="">-- Sin vincular / Trabajador externo --</option>
                  {people.map((p, idx) => (
                    <option key={`p_opt_${p.id}_${idx}`} value={p.id}>
                      {p.apellidosNombre} ({p.dni}) {p.obra ? `- Obra: ${p.obra}` : ''}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-slate-400 mt-1">
                  Los listados de vigilancia médica no contienen DNI. Al emparejar por nombre, el DNI oficial se asigna automáticamente desde la plantilla.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-600 dark:text-slate-300 font-bold mb-1">
                    DNI / NIE (Asignado de Plantilla)
                  </label>
                  <input
                    type="text"
                    value={editingCandidate.dni || ''}
                    onChange={(e) => setEditingCandidate({ ...editingCandidate, dni: e.target.value })}
                    placeholder="Asignado automáticamente"
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-mono uppercase font-bold"
                  />
                  {editingCandidate.dni && (
                    <p className={`text-[10px] mt-1 font-semibold ${validateDniClient(editingCandidate.dni).isValid ? 'text-emerald-600' : 'text-red-500'}`}>
                      {validateDniClient(editingCandidate.dni).isValid ? '✓ DNI / NIE de plantilla' : validateDniClient(editingCandidate.dni).error}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-slate-600 dark:text-slate-300 font-bold mb-1">
                    Fecha Reconocimiento
                  </label>
                  <input
                    type="date"
                    value={editingCandidate.fechaReconocimiento || ''}
                    onChange={(e) => setEditingCandidate({ ...editingCandidate, fechaReconocimiento: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-600 dark:text-slate-300 font-bold mb-1">
                  Centro Médico Emisor
                </label>
                <input
                  type="text"
                  value={editingCandidate.centroMedico || ''}
                  placeholder="Ej: Quirónprevención, Mutua Universal, etc."
                  onChange={(e) => setEditingCandidate({ ...editingCandidate, centroMedico: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-600 dark:text-slate-300 font-bold mb-1">
                    Resultado Aptitud
                  </label>
                  <select
                    value={editingCandidate.resultado}
                    onChange={(e) => setEditingCandidate({ ...editingCandidate, resultado: e.target.value as any })}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold"
                  >
                    <option value="Apto">Apto</option>
                    <option value="Apto con Limitación">Apto con Limitación</option>
                    <option value="No Apto">No Apto</option>
                    <option value="Pendiente">Pendiente</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-600 dark:text-slate-300 font-bold mb-1">
                    Año Validez
                  </label>
                  <input
                    type="text"
                    value={editingCandidate.validez || new Date().getFullYear().toString()}
                    onChange={(e) => setEditingCandidate({ ...editingCandidate, validez: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-600 dark:text-slate-300 font-bold mb-1">
                  Limitaciones Físicas (si aplica)
                </label>
                <textarea
                  rows={2}
                  value={editingCandidate.limitaciones || ''}
                  placeholder="Restricciones de carga, alturas, etc."
                  onChange={(e) => setEditingCandidate({ ...editingCandidate, limitaciones: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl resize-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setEditingCandidate(null)}
                className="px-4 py-2 rounded-xl text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 text-xs font-semibold"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  const revalidated = revalidateCandidate(editingCandidate);
                  setParsedResults(prev => prev ? prev.map(p => p.id === revalidated.id ? revalidated : p) : null);
                  setEditingCandidate(null);
                  onToast('Registro actualizado y revalidado con éxito', 'success');
                }}
                className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-md shadow-blue-600/20"
              >
                Guardar Corrección
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Filter, Search, Sort & Export Actions Bar */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-4">
        
        {/* Row 1: Search and Dropdown Filters (Obra, Período, Aptitud) */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          
          {/* Search */}
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar por trabajador, DNI, obra, quincena o restricciones..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-8 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-[#00548E] text-slate-800 dark:text-slate-100 placeholder:text-slate-400"
            />
            {searchQuery && (
              <button 
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                title="Limpiar búsqueda"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Dropdown Filters: Obra, Quincena, Aptitud */}
          <div className="flex flex-wrap items-center gap-2">
            
            {/* Filter by Obra */}
            <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-1.5 text-xs">
              <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <label htmlFor="filter-obra-select" className="text-slate-500 font-semibold text-[11px] whitespace-nowrap">Obra:</label>
              <select
                id="filter-obra-select"
                value={filterObra}
                onChange={(e) => setFilterObra(e.target.value)}
                className="bg-transparent text-xs font-bold text-slate-700 dark:text-slate-200 focus:outline-none cursor-pointer max-w-[150px] truncate"
              >
                <option value="todas">Todas ({people.length})</option>
                {uniqueObras.map(obra => {
                  const count = people.filter(p => (p.obra || '').trim() === obra).length;
                  return (
                    <option key={`obra_opt_${obra}`} value={obra}>
                      {obra} ({count})
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Filter by Quincena / Período */}
            <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-1.5 text-xs">
              <CalendarRange className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <label htmlFor="filter-quincena-select" className="text-slate-500 font-semibold text-[11px] whitespace-nowrap">Período:</label>
              <select
                id="filter-quincena-select"
                value={filterQuincena}
                onChange={(e) => setFilterQuincena(e.target.value)}
                className="bg-transparent text-xs font-bold text-slate-700 dark:text-slate-200 focus:outline-none cursor-pointer max-w-[140px] truncate"
              >
                <option value="todos">Todos los períodos</option>
                {uniqueQuincenas.map(q => {
                  const count = people.filter(p => (p.quincena || '').trim() === q).length;
                  return (
                    <option key={`quincena_opt_${q}`} value={q}>
                      {q} ({count})
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Filter by Aptitud */}
            <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-1.5 text-xs">
              <HeartPulse className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <label htmlFor="filter-aptitud-select" className="text-slate-500 font-semibold text-[11px] whitespace-nowrap">Aptitud:</label>
              <select
                id="filter-aptitud-select"
                value={filterAptitud}
                onChange={(e) => {
                  setFilterAptitud(e.target.value);
                  if (e.target.value === 'todas') setFilterStatus('todos');
                }}
                className="bg-transparent text-xs font-bold text-slate-700 dark:text-slate-200 focus:outline-none cursor-pointer"
              >
                <option value="todas">Todas las aptitudes</option>
                <option value="Apto">Apto ({aptosCount})</option>
                <option value="Apto con limitaciones">Apto con limitaciones ({conLimitacionCount})</option>
                <option value="No Apto">No Apto ({noAptosCount})</option>
                <option value="Pendiente">Pendiente ({pendientesCount})</option>
              </select>
            </div>

            {/* Reset Filters Button */}
            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 rounded-xl transition-all cursor-pointer border border-rose-200 dark:border-rose-900/40"
                title="Restablecer todos los filtros aplicados"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Limpiar</span>
              </button>
            )}
          </div>
        </div>

        {/* Row 2: Status Pills for Quick Selection & Sort Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800/80">
          
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-bold text-slate-400 mr-1 flex items-center gap-1">
              <SlidersHorizontal className="w-3 h-3" />
              Filtro rápido:
            </span>
            <button
              type="button"
              onClick={() => {
                setFilterStatus('todos');
                setFilterAptitud('todas');
              }}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                filterStatus === 'todos' && filterAptitud === 'todas'
                  ? 'bg-[#00548E] text-white shadow-xs' 
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
              }`}
            >
              Todos ({totalHired})
            </button>
            <button
              type="button"
              onClick={() => {
                setFilterStatus('apto');
                setFilterAptitud('Apto');
              }}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                filterStatus === 'apto' || filterAptitud === 'Apto'
                  ? 'bg-emerald-600 text-white shadow-xs' 
                  : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100'
              }`}
            >
              Aptos ({aptosCount})
            </button>
            <button
              type="button"
              onClick={() => {
                setFilterStatus('limitacion');
                setFilterAptitud('Apto con limitaciones');
              }}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                filterStatus === 'limitacion' || filterAptitud === 'Apto con limitaciones'
                  ? 'bg-amber-600 text-white shadow-xs' 
                  : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 hover:bg-amber-100'
              }`}
            >
              C/ Limitación ({conLimitacionCount})
            </button>
            <button
              type="button"
              onClick={() => {
                setFilterStatus('no_apto');
                setFilterAptitud('No Apto');
              }}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                filterStatus === 'no_apto' || filterAptitud === 'No Apto'
                  ? 'bg-red-600 text-white shadow-xs' 
                  : 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 hover:bg-red-100'
              }`}
            >
              No Aptos ({noAptosCount})
            </button>
            <button
              type="button"
              onClick={() => {
                setFilterStatus('pendiente');
                setFilterAptitud('Pendiente');
              }}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                filterStatus === 'pendiente' || filterAptitud === 'Pendiente'
                  ? 'bg-slate-700 text-white shadow-xs' 
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
              }`}
            >
              Pendientes ({pendientesCount})
            </button>
          </div>

          {/* Sort Controls */}
          <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-1 text-xs">
            <span className="text-slate-500 font-semibold text-[11px] whitespace-nowrap">Ordenar por:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="bg-transparent text-xs font-bold text-slate-800 dark:text-slate-100 focus:outline-none cursor-pointer"
            >
              <option value="nombre">Nombre y Apellidos</option>
              <option value="dni">DNI / NIE</option>
              <option value="obra">Obra</option>
              <option value="quincena">Quincena / Período</option>
              <option value="cita">Fecha Cita Médica</option>
              <option value="aptitud">Aptitud Médica</option>
              <option value="validez">Año de Validez</option>
            </select>
            <button
              type="button"
              onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
              className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
              title={sortOrder === 'asc' ? 'Cambiar a orden descendente' : 'Cambiar a orden ascendente'}
            >
              {sortOrder === 'asc' ? (
                <span className="flex items-center gap-0.5 text-[10px] font-extrabold text-[#00548E] uppercase">
                  <ArrowUp className="w-3.5 h-3.5" /> Asc
                </span>
              ) : (
                <span className="flex items-center gap-0.5 text-[10px] font-extrabold text-[#00548E] uppercase">
                  <ArrowDown className="w-3.5 h-3.5" /> Desc
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Row 3: Export Configuration & Action Buttons */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
          
          {/* Export Scope Selector */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-slate-500 whitespace-nowrap flex items-center gap-1">
              <Download className="w-3.5 h-3.5 text-[#00548E]" />
              Exportar según necesidad:
            </span>
            <div className="inline-flex bg-slate-100 dark:bg-slate-800 p-0.5 rounded-xl text-xs font-semibold">
              <button
                type="button"
                onClick={() => setExportScope('filtered')}
                className={`px-2.5 py-1 rounded-lg text-[11px] transition-all cursor-pointer ${
                  exportScope === 'filtered'
                    ? 'bg-white dark:bg-slate-900 text-[#00548E] font-bold shadow-xs'
                    : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
                title="Exportar únicamente los trabajadores que coinciden con los filtros aplicados"
              >
                Solo filtrados ({filteredAndSortedWorkers.length})
              </button>
              <button
                type="button"
                onClick={() => setExportScope('all')}
                className={`px-2.5 py-1 rounded-lg text-[11px] transition-all cursor-pointer ${
                  exportScope === 'all'
                    ? 'bg-white dark:bg-slate-900 text-[#00548E] font-bold shadow-xs'
                    : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
                title="Exportar toda la base de datos de trabajadores contratados"
              >
                Toda la plantilla ({people.length})
              </button>
            </div>
          </div>

          {/* Action Export Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Quick PDF Report for Prevention Technician / Resource */}
            <button
              type="button"
              id="btn-reporte-tecnico-prl"
              onClick={handleExportPRLLimitacionesPdf}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-700 text-white text-xs font-bold transition-all cursor-pointer shadow-xs hover:shadow-md border border-amber-600/70 active:scale-95"
              title="Descargar Informe de Situación de Trabajadores con Especial Atención (Para uso en obra reservado para el encargado de la obra - recurso preventivo)"
            >
              <ShieldAlert className="w-3.5 h-3.5 text-amber-100 shrink-0" />
              <span>Listado PRL (PDF)</span>
            </button>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleExportRRMMPdf}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-900/40 text-[#00548E] dark:text-blue-300 text-xs font-bold transition-all cursor-pointer border border-blue-200 dark:border-blue-900/40"
                title={`Descargar Informe Oficial de Reconocimientos Médicos en PDF (${exportScope === 'filtered' ? 'Filtrados' : 'Toda la plantilla'})`}
              >
                <Download className="w-3.5 h-3.5" />
                <span>Informe Reconocimientos (PDF)</span>
              </button>
              <button
                type="button"
                onClick={handleExportRRMMExcel}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-900/40 text-[#00548E] dark:text-blue-300 text-xs font-bold transition-all cursor-pointer border border-blue-200 dark:border-blue-900/40"
                title={`Descargar Informe Oficial de Reconocimientos Médicos en Excel (${exportScope === 'filtered' ? 'Filtrados' : 'Toda la plantilla'})`}
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Informe Reconocimientos (Excel)</span>
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleExportRelacionPdf}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold transition-all cursor-pointer border border-slate-200 dark:border-slate-700"
                title={`Descargar Relación de Contratados en PDF con columnas de Aptitud (${exportScope === 'filtered' ? 'Filtrados' : 'Toda la plantilla'})`}
              >
                <FileText className="w-3.5 h-3.5 text-red-500" />
                <span>PDF Relación</span>
              </button>

              <button
                type="button"
                onClick={handleExportRelacionExcel}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold transition-all cursor-pointer border border-slate-200 dark:border-slate-700"
                title={`Descargar Relación de Contratados en Excel con columna de Aptitud (${exportScope === 'filtered' ? 'Filtrados' : 'Toda la plantilla'})`}
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                <span>Excel Relación</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Contextual Banner for Health Status / Prevention Resource view */}
      {(filterStatus === 'limitacion' || filterAptitud === 'Apto con limitaciones') && (
        <div className="p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800/70 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs shadow-xs animate-in fade-in duration-200">
          <div className="flex items-center gap-2.5 text-amber-900 dark:text-amber-200">
            <div className="p-2 bg-amber-100 dark:bg-amber-900/60 rounded-xl shrink-0 text-amber-700 dark:text-amber-300">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <p className="font-bold text-sm text-amber-950 dark:text-amber-100">
                Informe de Alta Atención: Situación de Salud de Trabajadores Contratados
              </p>
              <p className="text-amber-800/90 dark:text-amber-300/90 text-xs">
                Informe para uso en obra reservado para el encargado-recurso preventivo. Muestra las restricciones y limitaciones de salud detectadas para la adaptación de puestos de trabajo.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleExportPRLLimitacionesPdf}
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-bold text-xs transition-all shrink-0 cursor-pointer shadow-xs active:scale-95"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Exportar PDF Alta Atención ({filteredAndSortedWorkers.length})</span>
          </button>
        </div>
      )}

      {/* 5. Workers List with Recognition Status and Limitations */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-[#00548E] dark:text-blue-400" />
            <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">
              Registro de Reconocimientos de los Trabajadores Contratados ({filteredAndSortedWorkers.length} de {people.length})
            </h4>
            {hasActiveFilters && (
              <span className="px-2 py-0.5 rounded-md bg-blue-100 dark:bg-blue-950/60 text-[#00548E] dark:text-blue-300 text-[10px] font-bold">
                Filtros activos
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-400 font-medium">
            <span>Orden actual: <strong className="text-slate-600 dark:text-slate-300 uppercase">{sortBy} ({sortOrder === 'asc' ? '↑ Asc' : '↓ Desc'})</strong></span>
            <span>•</span>
            <span>Año oficial: {new Date().getFullYear()}</span>
          </div>
        </div>

        {filteredAndSortedWorkers.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 mx-auto">
              <AlertCircle className="w-6 h-6" />
            </div>
            <p className="text-sm font-bold text-slate-600 dark:text-slate-300">
              No se han encontrado trabajadores con los filtros aplicados
            </p>
            <p className="text-xs text-slate-400">
              Pruebe a cambiar el filtro de obra, período, estado de aptitud o restablecer los filtros.
            </p>
            <button
              type="button"
              onClick={handleResetFilters}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#00548E] text-white text-xs font-bold rounded-xl shadow-xs hover:bg-[#004270] transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Restablecer Filtros</span>
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50/80 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-700 select-none">
                  {/* Trabajador */}
                  <th 
                    className="p-3.5 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    onClick={() => handleSortToggle('nombre')}
                    title="Clic para ordenar por Nombre y Apellidos"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Trabajador</span>
                      {sortBy === 'nombre' ? (
                        sortOrder === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-[#00548E] dark:text-blue-400" /> : <ArrowDown className="w-3.5 h-3.5 text-[#00548E] dark:text-blue-400" />
                      ) : (
                        <ArrowUpDown className="w-3 h-3 text-slate-300 dark:text-slate-600" />
                      )}
                    </div>
                  </th>

                  {/* DNI / NIE */}
                  <th 
                    className="p-3.5 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    onClick={() => handleSortToggle('dni')}
                    title="Clic para ordenar por DNI/NIE"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>DNI / NIE</span>
                      {sortBy === 'dni' ? (
                        sortOrder === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-[#00548E] dark:text-blue-400" /> : <ArrowDown className="w-3.5 h-3.5 text-[#00548E] dark:text-blue-400" />
                      ) : (
                        <ArrowUpDown className="w-3 h-3 text-slate-300 dark:text-slate-600" />
                      )}
                    </div>
                  </th>

                  {/* Quincena / Obra */}
                  <th 
                    className="p-3.5 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    onClick={() => handleSortToggle(sortBy === 'obra' ? 'quincena' : 'obra')}
                    title="Clic para ordenar por Obra o Quincena"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Quincena / Obra</span>
                      {sortBy === 'obra' || sortBy === 'quincena' ? (
                        sortOrder === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-[#00548E] dark:text-blue-400" /> : <ArrowDown className="w-3.5 h-3.5 text-[#00548E] dark:text-blue-400" />
                      ) : (
                        <ArrowUpDown className="w-3 h-3 text-slate-300 dark:text-slate-600" />
                      )}
                    </div>
                  </th>

                  {/* Cita Médica */}
                  <th 
                    className="p-3.5 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    onClick={() => handleSortToggle('cita')}
                    title="Clic para ordenar por Fecha de Cita Médica"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Cita Médica</span>
                      {sortBy === 'cita' ? (
                        sortOrder === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-[#00548E] dark:text-blue-400" /> : <ArrowDown className="w-3.5 h-3.5 text-[#00548E] dark:text-blue-400" />
                      ) : (
                        <ArrowUpDown className="w-3 h-3 text-slate-300 dark:text-slate-600" />
                      )}
                    </div>
                  </th>

                  {/* Aptitud Reconocimiento */}
                  <th 
                    className="p-3.5 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    onClick={() => handleSortToggle('aptitud')}
                    title="Clic para ordenar por Aptitud Médica"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Aptitud Médica</span>
                      {sortBy === 'aptitud' ? (
                        sortOrder === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-[#00548E] dark:text-blue-400" /> : <ArrowDown className="w-3.5 h-3.5 text-[#00548E] dark:text-blue-400" />
                      ) : (
                        <ArrowUpDown className="w-3 h-3 text-slate-300 dark:text-slate-600" />
                      )}
                    </div>
                  </th>

                  <th className="p-3.5">Limitaciones Específicas</th>

                  {/* Validez */}
                  <th 
                    className="p-3.5 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    onClick={() => handleSortToggle('validez')}
                    title="Clic para ordenar por Año de Validez"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Validez</span>
                      {sortBy === 'validez' ? (
                        sortOrder === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-[#00548E] dark:text-blue-400" /> : <ArrowDown className="w-3.5 h-3.5 text-[#00548E] dark:text-blue-400" />
                      ) : (
                        <ArrowUpDown className="w-3 h-3 text-slate-300 dark:text-slate-600" />
                      )}
                    </div>
                  </th>

                  <th className="p-3.5 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredAndSortedWorkers.map((person, idx) => {
                  const aptInfo = getAptitudMedicaInfo(person);
                  const isApto = aptInfo.estado === 'Apto';
                  const isLimitacion = aptInfo.estado === 'Apto con limitaciones';
                  const isNoApto = aptInfo.estado === 'No Apto';
                  const isPendiente = aptInfo.estado === 'Pendiente';

                  const hasLimitations = isLimitacion || !!aptInfo.limitaciones;

                  return (
                    <tr 
                      key={`rec_worker_${person.id}_${idx}`}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="p-3.5 font-bold text-slate-800 dark:text-slate-100">
                        {person.apellidosNombre}
                      </td>
                      <td className="p-3.5 font-mono text-slate-600 dark:text-slate-300">
                        {person.dni}
                      </td>
                      <td className="p-3.5 text-slate-600 dark:text-slate-400">
                        <div className="font-semibold text-slate-700 dark:text-slate-200">{person.quincena || '-'}</div>
                        <div className="text-[11px] text-slate-500">{person.obra || 'Sin obra asignada'}</div>
                      </td>
                      <td className="p-3.5 text-slate-600 dark:text-slate-400">
                        {person.citaDia ? (
                          <>
                            <div>{formatDate(person.citaDia)} @ {person.citaHora || 'Hora no asignada'}</div>
                            <div className="text-[11px] text-slate-400 truncate max-w-[150px]">{person.sitioReconocimiento || 'Centro médico'}</div>
                          </>
                        ) : (
                          <span className="text-slate-400 italic">Sin cita fijada</span>
                        )}
                      </td>
                      <td className="p-3.5">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-extrabold uppercase tracking-wide border ${
                          isApto 
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800' 
                            : isLimitacion
                            ? 'bg-orange-50 text-orange-700 border-orange-300 dark:bg-orange-950/50 dark:text-orange-300 dark:border-orange-800'
                            : isNoApto
                            ? 'bg-red-50 text-red-700 border-red-300 dark:bg-red-950/50 dark:text-red-300 dark:border-red-800'
                            : 'bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
                        }`}>
                          <span className={`w-2 h-2 rounded-full shrink-0 ${
                            isApto 
                              ? 'bg-emerald-500' 
                              : isLimitacion 
                              ? 'bg-orange-500' 
                              : isNoApto 
                              ? 'bg-red-500' 
                              : 'bg-slate-400'
                          }`} />
                          {isApto && <CheckCircle2 className="w-3 h-3" />}
                          {isLimitacion && <ShieldAlert className="w-3 h-3 text-orange-600 dark:text-orange-400" />}
                          {isNoApto && <AlertTriangle className="w-3 h-3 text-red-600 dark:text-red-400" />}
                          <span>{aptInfo.estado}</span>
                        </span>
                      </td>
                      <td className="p-3.5 max-w-[280px]">
                        {hasLimitations && aptInfo.limitaciones ? (
                          <div className="p-2 bg-orange-50 dark:bg-orange-950/30 border border-orange-300 dark:border-orange-800/60 rounded-xl text-[11px] text-orange-900 dark:text-orange-200 font-medium leading-tight">
                            <div className="flex items-center gap-1 font-bold text-orange-800 dark:text-orange-300 mb-0.5">
                              <ShieldAlert className="w-3 h-3 shrink-0" />
                              <span>Restricciones:</span>
                            </div>
                            {aptInfo.limitaciones}
                          </div>
                        ) : isApto ? (
                          <span className="text-emerald-600 dark:text-emerald-400 text-[11px] font-medium">Sin limitaciones</span>
                        ) : isNoApto ? (
                          <span className="text-red-600 dark:text-red-400 text-[11px] font-medium">{person.reconocimientoObservaciones || 'No apto para desempeñar el puesto'}</span>
                        ) : (
                          <span className="text-slate-400 italic text-[11px]">-</span>
                        )}
                      </td>
                      <td className="p-3.5 text-slate-600 dark:text-slate-400 font-medium">
                        {person.reconocimientoValidez ? (
                          <span className="font-bold text-slate-700 dark:text-slate-200">
                            Año {person.reconocimientoValidez}
                          </span>
                        ) : (
                          <span className="text-slate-400 italic">Año {new Date().getFullYear()}</span>
                        )}
                      </td>
                      <td className="p-3.5 text-right">
                        <button
                          type="button"
                          onClick={() => setEditingPerson(person)}
                          className="p-2 text-slate-500 hover:text-[#00548E] hover:bg-blue-50 dark:hover:bg-blue-950/30 rounded-xl transition-all cursor-pointer"
                          title="Editar aptitud médica y limitaciones"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 6. Quick Individual Edit Modal for Medical Recognition */}
      {editingPerson && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 max-w-lg w-full shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-[#00548E] dark:text-blue-400" />
                <h4 className="text-base font-bold text-slate-800 dark:text-slate-100">
                  Editar Aptitud Médica
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setEditingPerson(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl">
              <div className="text-sm font-bold text-slate-800 dark:text-slate-100">{editingPerson.apellidosNombre}</div>
              <div className="text-xs text-slate-500">DNI: {editingPerson.dni} | {editingPerson.obra} ({editingPerson.quincena})</div>
            </div>

            <div className="space-y-4 text-xs">
              <div className="space-y-1.5">
                <label className="block font-bold text-slate-700 dark:text-slate-200">Estado de Aptitud</label>
                <select
                  value={editingPerson.reconocimientoEstado || 'Pendiente'}
                  onChange={(e) => {
                    const newStatus = e.target.value;
                    setEditingPerson({
                      ...editingPerson,
                      reconocimientoEstado: newStatus,
                      ...(newStatus === 'No Apto' ? { documentacionCompleta: 'No' } : {})
                    });
                  }}
                  className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none text-xs text-slate-800 dark:text-slate-100 font-semibold"
                >
                  <option value="Pendiente">Pendiente</option>
                  <option value="Apto">Apto</option>
                  <option value="Apto con Limitación">Apto con Limitación</option>
                  <option value="No Apto">No Apto</option>
                </select>
              </div>

              {editingPerson.reconocimientoEstado === 'No Apto' && (
                <div className="p-3 rounded-xl bg-red-100/90 dark:bg-red-950/60 border border-red-300 dark:border-red-800 text-xs text-red-900 dark:text-red-200 flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-red-600 shrink-0 animate-bounce" />
                  <div className="leading-tight">
                    <strong className="block text-red-700 dark:text-red-300 uppercase font-black">Validación de Contratación:</strong>
                    <span>Al marcar como <strong>"No Apto"</strong>, la documentación se cambiará automáticamente a <strong>"No"</strong> y la ficha del trabajador se resaltará en rojo para evitar contrataciones erróneas.</span>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="block font-bold text-slate-700 dark:text-slate-200">Año de Validez</label>
                  <input
                    type="text"
                    value={editingPerson.reconocimientoValidez || new Date().getFullYear().toString()}
                    onChange={(e) => setEditingPerson({
                      ...editingPerson,
                      reconocimientoValidez: e.target.value
                    })}
                    className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none text-xs text-slate-800 dark:text-slate-100"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block font-bold text-slate-700 dark:text-slate-200">Fecha Reconocimiento</label>
                  <input
                    type="date"
                    value={editingPerson.reconocimientoFecha || ''}
                    onChange={(e) => setEditingPerson({
                      ...editingPerson,
                      reconocimientoFecha: e.target.value
                    })}
                    className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none text-xs text-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>

              {editingPerson.reconocimientoEstado === 'Apto con Limitación' && (
                <div className="space-y-1.5 p-3 rounded-xl bg-amber-500/10 border border-amber-300 dark:border-amber-700/50">
                  <div className="flex items-center gap-1.5 font-bold text-amber-700 dark:text-amber-300">
                    <ShieldAlert className="w-4 h-4 text-amber-600" />
                    <span>Limitaciones y Restricciones del Trabajador</span>
                  </div>
                  <textarea
                    rows={3}
                    value={editingPerson.reconocimientoLimitaciones || ''}
                    onChange={(e) => setEditingPerson({
                      ...editingPerson,
                      reconocimientoLimitaciones: e.target.value
                    })}
                    placeholder="Especifique las limitaciones (ej: Evitar carga de peso > 15 kg, prohibición de trabajos en altura, uso de gafas de protección graduadas...)"
                    className="w-full p-2 bg-white dark:bg-slate-800 border border-amber-300 dark:border-amber-700/50 rounded-lg focus:outline-none text-xs text-slate-800 dark:text-slate-100 resize-none font-medium"
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <label className="block font-bold text-slate-700 dark:text-slate-200">Observaciones Médicas</label>
                <input
                  type="text"
                  value={editingPerson.reconocimientoObservaciones || ''}
                  onChange={(e) => setEditingPerson({
                    ...editingPerson,
                    reconocimientoObservaciones: e.target.value
                  })}
                  placeholder="Detalles sobre el centro o informe médico..."
                  className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none text-xs text-slate-800 dark:text-slate-100"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-100 dark:border-slate-800 pt-4">
              <button
                type="button"
                onClick={() => setEditingPerson(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-500 hover:text-slate-700"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  const isNoApto = editingPerson.reconocimientoEstado === 'No Apto';
                  const finalPerson = {
                    ...editingPerson,
                    documentacionCompleta: isNoApto ? 'No' : editingPerson.documentacionCompleta
                  };
                  const updated = people.map(p => p.id === editingPerson.id ? finalPerson : p);
                  onUpdatePeople(updated);
                  if (isNoApto) {
                    onToast(`Reconocimiento guardado como 'No Apto'. Documentación establecida en 'No' y resaltada en rojo.`, 'error');
                  } else {
                    onToast(`Reconocimiento médico de ${editingPerson.apellidosNombre} actualizado.`, 'success');
                  }
                  setEditingPerson(null);
                }}
                className="px-4 py-2.5 bg-[#00548E] hover:bg-blue-800 text-white font-bold text-xs rounded-xl shadow-md transition-all cursor-pointer"
              >
                Guardar Cambios
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
