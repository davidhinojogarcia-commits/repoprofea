from pathlib import Path
import re

p = Path('App.tsx')
s = p.read_text()

anchor = "import { persistMedicalRecognition } from './src/services/medicalRecognitionService';"
s = s.replace(anchor, anchor + "\nimport { loadAppBusinessSettings, saveAppBusinessSettings, clearLegacyBusinessSettings } from './src/services/appSettingsService';")

repls = {
"  const [savedObras, setSavedObras] = useState<string[]>(() => JSON.parse(localStorage.getItem('obrasGuardadas') || '[]'));": "  const [savedObras, setSavedObras] = useState<string[]>([]);",
"  const [savedLugares, setSavedLugares] = useState<string[]>(() => JSON.parse(localStorage.getItem('lugaresFormacion') || '[]'));": "  const [savedLugares, setSavedLugares] = useState<string[]>([]);",
"  const [savedSitios, setSavedSitios] = useState<string[]>(() => JSON.parse(localStorage.getItem('sitiosReconocimiento') || '[]'));": "  const [savedSitios, setSavedSitios] = useState<string[]>([]);",
"  const [savedTelefonos, setSavedTelefonos] = useState<string[]>(() => JSON.parse(localStorage.getItem('telefonosGuardados') || '[]'));": "  const [savedTelefonos, setSavedTelefonos] = useState<string[]>([]);",
"  const [savedCategorias, setSavedCategorias] = useState<string[]>(() => {\n    const saved = localStorage.getItem('categoriasGuardadas');\n    return saved ? JSON.parse(saved) : ['Peón', 'Oficial de 1ª', 'Encargado'];\n  });": "  const [savedCategorias, setSavedCategorias] = useState<string[]>(['Peón', 'Oficial de 1ª', 'Encargado']);",
"  const [workStartHour, setWorkStartHour] = useState<string>(() => localStorage.getItem('workStartHour') || '08:00');": "  const [workStartHour, setWorkStartHour] = useState<string>('08:00');",
"  const [workEndHour, setWorkEndHour] = useState<string>(() => localStorage.getItem('workEndHour') || '15:00');": "  const [workEndHour, setWorkEndHour] = useState<string>('15:00');",
}
for old, new in repls.items():
    if old not in s: raise SystemExit('No encontrado bloque settings: ' + old[:50])
    s = s.replace(old, new, 1)

s, n = re.subn(r"\n  useEffect\(\(\) => \{\n    localStorage\.setItem\('obrasGuardadas'.*?\n  \}, \[savedObras, savedLugares, savedSitios, savedTelefonos, savedCategorias\]\);\n\n  useEffect\(\(\) => \{\n    localStorage\.setItem\('workStartHour'.*?\n  \}, \[workStartHour, workEndHour\]\);\n", "\n", s, count=1, flags=re.S)
if n != 1: raise SystemExit('No se encontró persistencia local de catálogos/horario')

s, n = re.subn(r"\n  // Limpieza automática de registros de papelera que lleven más de 30 días\n  useEffect\(\(\) => \{.*?\n  \}, \[\]\);\n", "\n", s, count=1, flags=re.S)
if n != 1: raise SystemExit('No se encontró limpieza local de papelera')

marker = "  const [workEndHour, setWorkEndHour] = useState<string>('15:00');\n"
block = """
  const businessSettingsHydratedRef = useRef(false);
  const businessSettingsSaveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadAppBusinessSettings().then(settings => {
      if (cancelled) return;
      setSavedObras(settings.savedObras);
      setSavedLugares(settings.savedLugares);
      setSavedSitios(settings.savedSitios);
      setSavedTelefonos(settings.savedTelefonos);
      setSavedCategorias(settings.savedCategorias);
      setWorkStartHour(settings.workStartHour);
      setWorkEndHour(settings.workEndHour);
      businessSettingsHydratedRef.current = true;
      clearLegacyBusinessSettings();
    }).catch(error => {
      console.error('Error cargando configuración empresarial desde Supabase:', error);
      setToast({ message: 'No se pudo cargar la configuración desde Supabase.', type: 'error' });
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!businessSettingsHydratedRef.current) return;
    if (businessSettingsSaveTimerRef.current) window.clearTimeout(businessSettingsSaveTimerRef.current);
    businessSettingsSaveTimerRef.current = window.setTimeout(() => {
      void saveAppBusinessSettings({
        savedObras, savedLugares, savedSitios, savedTelefonos, savedCategorias,
        workStartHour, workEndHour,
      }).catch(error => {
        console.error('Error guardando configuración empresarial en Supabase:', error);
        setToast({ message: 'No se pudo guardar la configuración en Supabase.', type: 'error' });
      });
    }, 250);
    return () => {
      if (businessSettingsSaveTimerRef.current) window.clearTimeout(businessSettingsSaveTimerRef.current);
    };
  }, [savedObras, savedLugares, savedSitios, savedTelefonos, savedCategorias, workStartHour, workEndHour]);

  useEffect(() => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const expiredIds = deletedPeople
      .filter(item => new Date(item.fechaEliminacion).getTime() < cutoff)
      .map(item => item.person.id);
    if (!expiredIds.length) return;
    void Promise.all(expiredIds.map(id => deleteDocument('trash', id))).catch(error => {
      console.error('Error purgando papelera caducada en Supabase:', error);
    });
  }, [deletedPeople]);
"""
if marker not in s: raise SystemExit('No se encontró marcador horario')
s = s.replace(marker, marker + block, 1)

p.write_text(s)
