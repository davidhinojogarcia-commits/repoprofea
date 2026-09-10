from pathlib import Path


def replace_arrow_function(text: str, name: str, replacement: str) -> str:
    marker = f"export const {name}"
    start = text.find(marker)
    if start < 0:
        raise SystemExit(f"No se encontró {name}")
    arrow = text.find('=>', start)
    brace = text.find('{', arrow)
    if arrow < 0 or brace < 0:
        raise SystemExit(f"No se encontró cuerpo de {name}")
    i = brace
    depth = 0
    quote = None
    escape = False
    line_comment = False
    block_comment = False
    while i < len(text):
        ch = text[i]
        nxt = text[i+1] if i + 1 < len(text) else ''
        if line_comment:
            if ch == '\n': line_comment = False
        elif block_comment:
            if ch == '*' and nxt == '/':
                block_comment = False; i += 1
        elif quote:
            if escape:
                escape = False
            elif ch == '\\':
                escape = True
            elif ch == quote:
                quote = None
        else:
            if ch == '/' and nxt == '/':
                line_comment = True; i += 1
            elif ch == '/' and nxt == '*':
                block_comment = True; i += 1
            elif ch in "'\"`":
                quote = ch
            elif ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    end = i + 1
                    while end < len(text) and text[end].isspace() and text[end] != '\n': end += 1
                    if end < len(text) and text[end] == ';': end += 1
                    return text[:start] + replacement.rstrip() + text[end:]
        i += 1
    raise SystemExit(f"No se pudo cerrar {name}")

p = Path('src/lib/subcontratasDefaults.ts')
s = p.read_text()
anchor = "import { renderPdfLogo, getStoredPdfConfig, formatDate } from './exportUtils';"
imp = "import { loadSubcontratasPreferences, saveSubcontratasPreferences } from '../services/subcontratasPreferencesService';"
if imp not in s:
    s = s.replace(anchor, anchor + "\n" + imp, 1)

key_anchor = "export const CHECKLIST_TEMPLATE_STORAGE_KEY = 'profea_subcontratas_checklist_template';"
if 'let checklistTemplateCache:' not in s:
    s = s.replace(key_anchor, key_anchor + "\nlet checklistTemplateCache: SubcontrataDocItem[] = DEFAULT_SUBCONTRATA_CHECKLIST.map(item => ({ ...item }));", 1)

default_block = """export const DEFAULT_REPORTE_TECNICO_CONFIG: ReporteTecnicoConfig = {
  tecnicoNombre: 'David Hinojo García',
  coordinadorNombre: 'David Hinojo García',
  empresaCoordinacion: 'Área de Cooperación - Excma. Diputación Provincial de Cádiz',
  supervisorNombre: 'David Hinojo García'
};"""
cache_block = default_block + """

let reporteTecnicoConfigCache: ReporteTecnicoConfig = { ...DEFAULT_REPORTE_TECNICO_CONFIG };
let obrasRecursosPreventivosCache: Record<string, ObraRecursoPreventivo> = {};
let subcontratasPreferencesHydrated = false;

export const hydrateStoredSubcontratasPreferences = async (): Promise<void> => {
  if (subcontratasPreferencesHydrated) return;
  const remote = await loadSubcontratasPreferences();
  let effective = remote;

  // Migración única desde las claves históricas del navegador. Supabase queda como
  // única fuente de verdad; las claves locales se eliminan solo tras persistir con éxito.
  const hasRemote = Boolean(remote.checklistTemplate || remote.reporteTecnicoConfig || remote.obrasRecursosPreventivos);
  if (!hasRemote && typeof window !== 'undefined') {
    const legacy: any = {};
    try {
      const checklist = localStorage.getItem(CHECKLIST_TEMPLATE_STORAGE_KEY);
      const report = localStorage.getItem(REPORTE_TECNICO_CONFIG_STORAGE_KEY);
      const recursos = localStorage.getItem(OBRAS_RECURSOS_PREVENTIVOS_STORAGE_KEY);
      if (checklist) legacy.checklistTemplate = JSON.parse(checklist);
      if (report) legacy.reporteTecnicoConfig = JSON.parse(report);
      if (recursos) legacy.obrasRecursosPreventivos = JSON.parse(recursos);
    } catch (error) {
      console.warn('No se pudieron leer preferencias locales antiguas de subcontratas:', error);
    }
    if (Object.keys(legacy).length) effective = await saveSubcontratasPreferences(legacy);
  }

  if (Array.isArray(effective.checklistTemplate) && effective.checklistTemplate.length) {
    checklistTemplateCache = effective.checklistTemplate.map((item: any) => ({ ...item, estado: item.estado || 'pendiente' }));
  }
  reporteTecnicoConfigCache = {
    ...DEFAULT_REPORTE_TECNICO_CONFIG,
    ...(effective.reporteTecnicoConfig || {}),
  };
  obrasRecursosPreventivosCache = effective.obrasRecursosPreventivos && typeof effective.obrasRecursosPreventivos === 'object'
    ? { ...effective.obrasRecursosPreventivos }
    : {};

  subcontratasPreferencesHydrated = true;
  if (typeof window !== 'undefined') {
    [CHECKLIST_TEMPLATE_STORAGE_KEY, REPORTE_TECNICO_CONFIG_STORAGE_KEY, OBRAS_RECURSOS_PREVENTIVOS_STORAGE_KEY]
      .forEach(key => localStorage.removeItem(key));
    window.dispatchEvent(new CustomEvent('profea_reporte_tecnico_config_changed', { detail: reporteTecnicoConfigCache }));
    window.dispatchEvent(new CustomEvent('profea_obras_recursos_changed', { detail: obrasRecursosPreventivosCache }));
  }
};"""
if 'let reporteTecnicoConfigCache:' not in s:
    if default_block not in s: raise SystemExit('No se encontró DEFAULT_REPORTE_TECNICO_CONFIG')
    s = s.replace(default_block, cache_block, 1)

s = replace_arrow_function(s, 'getStoredChecklistTemplate', """export const getStoredChecklistTemplate = (): SubcontrataDocItem[] =>
  checklistTemplateCache.map(item => ({ ...item }));""")
s = replace_arrow_function(s, 'saveStoredChecklistTemplate', """export const saveStoredChecklistTemplate = (template: SubcontrataDocItem[]): void => {
  checklistTemplateCache = template.map(item => ({ ...item, estado: item.estado || 'pendiente' }));
  void saveSubcontratasPreferences({ checklistTemplate: checklistTemplateCache }).catch(error =>
    console.warn('Error guardando plantilla de subcontratas en Supabase:', error)
  );
};""")
s = replace_arrow_function(s, 'resetStoredChecklistTemplate', """export const resetStoredChecklistTemplate = (): SubcontrataDocItem[] => {
  checklistTemplateCache = DEFAULT_SUBCONTRATA_CHECKLIST.map(item => ({ ...item }));
  void saveSubcontratasPreferences({ checklistTemplate: checklistTemplateCache }).catch(error =>
    console.warn('Error restableciendo plantilla de subcontratas en Supabase:', error)
  );
  return checklistTemplateCache.map(item => ({ ...item }));
};""")
s = replace_arrow_function(s, 'getStoredReporteTecnicoConfig', """export const getStoredReporteTecnicoConfig = (): ReporteTecnicoConfig => ({ ...reporteTecnicoConfigCache });""")
s = replace_arrow_function(s, 'saveStoredReporteTecnicoConfig', """export const saveStoredReporteTecnicoConfig = (config: Partial<ReporteTecnicoConfig>): ReporteTecnicoConfig => {
  reporteTecnicoConfigCache = { ...reporteTecnicoConfigCache, ...config };
  void saveSubcontratasPreferences({ reporteTecnicoConfig: reporteTecnicoConfigCache }).catch(error =>
    console.warn('Error guardando configuración de informe en Supabase:', error)
  );
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('profea_reporte_tecnico_config_changed', { detail: reporteTecnicoConfigCache }));
  }
  return { ...reporteTecnicoConfigCache };
};""")
s = replace_arrow_function(s, 'getStoredObrasRecursosPreventivos', """export const getStoredObrasRecursosPreventivos = (): Record<string, ObraRecursoPreventivo> => ({ ...obrasRecursosPreventivosCache });""")
s = replace_arrow_function(s, 'saveStoredObraRecursoPreventivo', """export const saveStoredObraRecursoPreventivo = (
  obra: string,
  recursoPreventivoNombre: string,
  recursoPreventivoCategoria: string = 'Encargado de Obra'
): void => {
  if (!obra || !obra.trim()) return;
  obrasRecursosPreventivosCache = {
    ...obrasRecursosPreventivosCache,
    [obra.trim()]: {
      recursoPreventivoNombre: recursoPreventivoNombre.trim(),
      recursoPreventivoCategoria: recursoPreventivoCategoria.trim() || 'Encargado de Obra'
    }
  };
  void saveSubcontratasPreferences({ obrasRecursosPreventivos: obrasRecursosPreventivosCache }).catch(error =>
    console.warn('Error guardando recurso preventivo en Supabase:', error)
  );
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('profea_obras_recursos_changed', { detail: obrasRecursosPreventivosCache }));
};""")
s = replace_arrow_function(s, 'deleteStoredObraRecursoPreventivo', """export const deleteStoredObraRecursoPreventivo = (obra: string): void => {
  if (!(obra in obrasRecursosPreventivosCache)) return;
  const next = { ...obrasRecursosPreventivosCache };
  delete next[obra];
  obrasRecursosPreventivosCache = next;
  void saveSubcontratasPreferences({ obrasRecursosPreventivos: next }).catch(error =>
    console.warn('Error eliminando recurso preventivo en Supabase:', error)
  );
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('profea_obras_recursos_changed', { detail: next }));
};""")
s = replace_arrow_function(s, 'updateStoredObraNameInRecursos', """export const updateStoredObraNameInRecursos = (oldName: string, newName: string): void => {
  if (!obrasRecursosPreventivosCache[oldName] || !newName.trim()) return;
  const next = { ...obrasRecursosPreventivosCache, [newName.trim()]: obrasRecursosPreventivosCache[oldName] };
  delete next[oldName];
  obrasRecursosPreventivosCache = next;
  void saveSubcontratasPreferences({ obrasRecursosPreventivos: next }).catch(error =>
    console.warn('Error renombrando recurso preventivo en Supabase:', error)
  );
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('profea_obras_recursos_changed', { detail: next }));
};""")

# Add a full-map setter for restore/import flows.
needle = "export const updateStoredObraNameInRecursos"
pos = s.find(needle)
if pos < 0: raise SystemExit('No se encontró punto para replaceStoredObrasRecursosPreventivos')
# Insert before update function if not present.
if 'replaceStoredObrasRecursosPreventivos' not in s:
    s = s[:pos] + """export const replaceStoredObrasRecursosPreventivos = (value: Record<string, ObraRecursoPreventivo>): void => {
  obrasRecursosPreventivosCache = value && typeof value === 'object' ? { ...value } : {};
  void saveSubcontratasPreferences({ obrasRecursosPreventivos: obrasRecursosPreventivosCache }).catch(error =>
    console.warn('Error reemplazando recursos preventivos en Supabase:', error)
  );
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('profea_obras_recursos_changed', { detail: obrasRecursosPreventivosCache }));
};

""" + s[pos:]

p.write_text(s)

# AuthGate hydrates the in-memory compatibility cache from Supabase after login.
p = Path('components/AuthGate.tsx')
s = p.read_text()
anchor = "import { authErrorMessage, getCurrentRole, signInWithEmail, signOutUser, subscribeToAuth, type AppRole } from '../src/lib/authService';"
imp = "import { hydrateStoredSubcontratasPreferences } from '../src/lib/subcontratasDefaults';"
if imp not in s:
    s = s.replace(anchor, anchor + "\n" + imp, 1)
old = """        const currentRole = await getCurrentRole();
        setRole(currentRole);"""
new = """        const currentRole = await getCurrentRole();
        if (currentRole) {
          await hydrateStoredSubcontratasPreferences().catch(error =>
            console.warn('No se pudieron precargar preferencias de subcontratas:', error)
          );
        }
        setRole(currentRole);"""
if old not in s: raise SystemExit('No se encontró validación de rol en AuthGate')
s = s.replace(old, new, 1)
p.write_text(s)

# Configuracion no debe escribir directamente recursos preventivos en localStorage.
p = Path('components/Configuracion.tsx')
s = p.read_text()
s = s.replace("  deleteStoredObraRecursoPreventivo,\n  ObraRecursoPreventivo", "  deleteStoredObraRecursoPreventivo,\n  replaceStoredObrasRecursosPreventivos,\n  ObraRecursoPreventivo", 1)
old = """      if (backupConfig.obrasRecursosPreventivos) {
        try {
          localStorage.setItem('profea_obras_recursos_preventivos', JSON.stringify(backupConfig.obrasRecursosPreventivos));
          setObrasRecursos(backupConfig.obrasRecursosPreventivos);
        } catch {}
      }"""
new = """      if (backupConfig.obrasRecursosPreventivos) {
        replaceStoredObrasRecursosPreventivos(backupConfig.obrasRecursosPreventivos);
        setObrasRecursos(backupConfig.obrasRecursosPreventivos);
      }"""
if old not in s: raise SystemExit('No se encontró restore local de recursos preventivos')
s = s.replace(old, new, 1)
p.write_text(s)
