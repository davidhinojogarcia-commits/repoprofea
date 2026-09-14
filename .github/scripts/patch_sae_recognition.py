from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'Expected target not found in {path}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')

# SAE: resolve every hired worker against the configured work catalogue and store only CODE + TYPE.
replace_once(
    'components/SaeSection.tsx',
    "import { SAE_RESULT_CODES, SaeCandidate, SaeNeed, SaeReport, createSaeNeed, createSaeReport, deleteSaeNeed, listSaeCandidates, listSaeNeeds, listSaeReports, monthNumber, updateSaeCandidate, updateSaeNeed } from '../src/services/saeService';",
    "import { SAE_RESULT_CODES, SaeCandidate, SaeNeed, SaeReport, createSaeNeed, createSaeReport, deleteSaeNeed, listSaeCandidates, listSaeNeeds, listSaeReports, monthNumber, updateSaeCandidate, updateSaeNeed } from '../src/services/saeService';\nimport { loadAppBusinessSettings } from '../src/services/appSettingsService';"
)

replace_once(
    'components/SaeSection.tsx',
    "const norm=(v:string)=>String(v||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').replace(/\\s+/g,' ').trim().toLowerCase();",
    """const norm=(v:string)=>String(v||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').replace(/\\s+/g,' ').trim().toLowerCase();
const workIdentity=(value:string)=>{const raw=norm(value).replace(/[._\\-/:]+/g,' ');const code=raw.match(/\\b(\\d{5})\\b/)?.[1]||'';const compact=raw.replace(/\\s+/g,'');const type=compact.includes('gr')?'GR':compact.includes('ee')?'EE':'';return code&&type?`${code} ${type}`:'';};
const normalizeSaeCategory=(value:string)=>{const n=norm(value);if(/\\bpeon(?:es)?\\b/.test(n))return 'Peón';return String(value||'').trim();};"""
)

old_register = """  const registerWorker=async(candidate:SaeCandidate)=>{if(!candidate.quincena)return onToast('Asigne primero una quincena.','error');const previous=people.find(p=>norm(p.apellidosNombre)===norm(candidate.normalizedName));const workerId=Date.now()+Math.floor(Math.random()*900000);const worker={id:workerId,fechaRegistro:new Date().toISOString(),supervisorResponsable:previous?.supervisorResponsable||'',numOferta:candidate.offerNumber,obra:candidate.obra||selectedNeed?.obra||'',categoria:candidate.categoria||'',quincena:candidate.quincena,apellidosNombre:candidate.normalizedName,dni:previous?.dni||'',fechaNacimiento:previous?.fechaNacimiento||'',periodoInicio:'',periodoFin:'',telefono:previous?.telefono||'',calzado:previous?.calzado||'',formacion:previous?.formacion||'No',lugarFormacion:previous?.lugarFormacion||'',citaDia:'',citaHora:'',sitioReconocimiento:'',documentacionCompleta:'No',observaciones:`Contratación SAE · Oferta ${candidate.offerNumber} · Orden ${candidate.orderNumber}.`,necesitaReconocimiento:previous?.necesitaReconocimiento||'No',sincronizadoEnNube:true};try{await createDocument('trabajadores',workerId,worker as any);await patchCandidate(candidate,{estado:'Contratado',resultCode:'2001',linkedWorkerId:workerId});onToast('Trabajador registrado y contratación SAE confirmada (2001).','success');}catch(e:any){onToast(e.message||'No se pudo registrar al trabajador.','error');}};"""
new_register = """  const registerWorker=async(candidate:SaeCandidate)=>{
    if(!candidate.quincena)return onToast('Asigne primero una quincena.','error');
    const previous=people.find(p=>norm(p.apellidosNombre)===norm(candidate.normalizedName));
    const workerId=Date.now()+Math.floor(Math.random()*900000);
    try{
      const settings=await loadAppBusinessSettings();
      const detectedIdentity=workIdentity(selectedNeed?.codigoObra||candidate.codigoObra||candidate.obra||selectedNeed?.obra||'');
      const configuredMatch=(settings.savedObras||[]).find(obra=>workIdentity(obra)===detectedIdentity);
      const canonicalWork=workIdentity(configuredMatch||'')||detectedIdentity;
      if(!canonicalWork){
        throw new Error('No se ha podido asociar el candidato a una obra configurada con código y tipo (por ejemplo 11002 GR). Revise Configuración → Obras.');
      }
      const sourceCategory=candidate.categoria||selectedNeed?.categorias?.[0]?.categoria||'';
      const canonicalCategory=normalizeSaeCategory(sourceCategory);
      const worker={id:workerId,fechaRegistro:new Date().toISOString(),supervisorResponsable:previous?.supervisorResponsable||'',numOferta:candidate.offerNumber,obra:canonicalWork,categoria:canonicalCategory,quincena:candidate.quincena,apellidosNombre:candidate.normalizedName,dni:previous?.dni||'',fechaNacimiento:previous?.fechaNacimiento||'',periodoInicio:'',periodoFin:'',telefono:previous?.telefono||'',calzado:previous?.calzado||'',formacion:previous?.formacion||'No',lugarFormacion:previous?.lugarFormacion||'',citaDia:'',citaHora:'',sitioReconocimiento:'',documentacionCompleta:'No',observaciones:`Contratación SAE · Oferta ${candidate.offerNumber} · Orden ${candidate.orderNumber}. Obra normalizada: ${canonicalWork}.`,necesitaReconocimiento:previous?.necesitaReconocimiento||'No',sincronizadoEnNube:true};
      await createDocument('trabajadores',workerId,worker as any);
      await patchCandidate(candidate,{estado:'Contratado',resultCode:'2001',linkedWorkerId:workerId});
      onToast(`Trabajador registrado en ${canonicalWork}${canonicalCategory?` como ${canonicalCategory}`:''} y contratación SAE confirmada (2001).`,'success');
    }catch(e:any){onToast(e.message||'No se pudo registrar al trabajador.','error');}
  };"""
replace_once('components/SaeSection.tsx', old_register, new_register)

# Worksite Documentation: Configuración → Obras is the sole catalogue of works.
replace_once(
    'components/WorksiteDocumentationPortal.tsx',
    "import { getDocuments } from '../src/services/databaseService';",
    "import { getDocuments } from '../src/services/databaseService';\nimport { loadAppBusinessSettings } from '../src/services/appSettingsService';"
)

replace_once(
    'components/WorksiteDocumentationPortal.tsx',
    "const normalize = (value: string) => safe(value).toLocaleLowerCase('es').replace(/\\s+/g, ' ');",
    """const normalize = (value: string) => safe(value).toLocaleLowerCase('es').replace(/\\s+/g, ' ');
const workIdentity = (value: string): string => {
  const raw = normalize(value).replace(/[._\\-/:]+/g, ' ');
  const code = raw.match(/\\b(\\d{5})\\b/)?.[1] || '';
  const compact = raw.replace(/\\s+/g, '');
  const type = compact.includes('gr') ? 'GR' : compact.includes('ee') ? 'EE' : '';
  return code && type ? `${code} ${type}` : '';
};
const sameWork = (left: string, right: string) => {
  const a = workIdentity(left); const b = workIdentity(right);
  return a && b ? a === b : normalize(left) === normalize(right);
};"""
)

replace_once(
    'components/WorksiteDocumentationPortal.tsx',
    "  const [workRows, setWorkRows] = useState<WorkRow[]>([]);",
    "  const [workRows, setWorkRows] = useState<WorkRow[]>([]);\n  const [configuredWorks, setConfiguredWorks] = useState<string[]>([]);"
)

replace_once(
    'components/WorksiteDocumentationPortal.tsx',
    """      const [people, obras] = await Promise.all([
        getDocuments<Person>('trabajadores'),
        supabase.query('obras', { query: 'select=id,nombre,empresa,cif,recurso_preventivo&order=nombre.asc' }),
      ]);
      setWorkers(people || []);
      setWorkRows((obras || []) as WorkRow[]);""",
    """      const [people, obras, settings] = await Promise.all([
        getDocuments<Person>('trabajadores'),
        supabase.query('obras', { query: 'select=id,nombre,empresa,cif,recurso_preventivo&order=nombre.asc' }),
        loadAppBusinessSettings(),
      ]);
      setWorkers(people || []);
      setWorkRows((obras || []) as WorkRow[]);
      setConfiguredWorks((settings.savedObras || []).map(safe).filter(Boolean));"""
)

replace_once(
    'components/WorksiteDocumentationPortal.tsx',
    """  const workNames = useMemo<string[]>(() => {
    const names = new Set<string>();
    workers.forEach(person => { if (safe(person.obra)) names.add(safe(person.obra)); });
    workRows.forEach(row => { if (safe(row.nombre)) names.add(safe(row.nombre)); });
    return Array.from(names).sort((a, b) => a.localeCompare(b, 'es'));
  }, [workers, workRows]);""",
    """  const workNames = useMemo<string[]>(() => {
    return Array.from(new Set(configuredWorks.map(work => workIdentity(work) || safe(work)).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
  }, [configuredWorks]);"""
)

replace_once(
    'components/WorksiteDocumentationPortal.tsx',
    """  const selectedWorkWorkers = useMemo(
    () => workers.filter(person => normalize(person.obra) === normalize(selectedWork)),
    [workers, selectedWork],
  );""",
    """  const selectedWorkWorkers = useMemo(
    () => workers.filter(person => sameWork(person.obra || '', selectedWork)),
    [workers, selectedWork],
  );"""
)

replace_once(
    'components/WorksiteDocumentationPortal.tsx',
    "    const row = workRows.find(item => normalize(item.nombre) === normalize(selectedWork));",
    "    const row = workRows.find(item => sameWork(item.nombre, selectedWork));"
)

# There is a second row lookup in saveWorkConfig.
replace_once(
    'components/WorksiteDocumentationPortal.tsx',
    "      const row = workRows.find(item => normalize(item.nombre) === normalize(selectedWork));",
    "      const row = workRows.find(item => sameWork(item.nombre, selectedWork));"
)

replace_once(
    'components/WorksiteDocumentationPortal.tsx',
    "                  const count = workers.filter(p => normalize(p.obra) === normalize(work)).length;",
    "                  const count = workers.filter(p => sameWork(p.obra || '', work)).length;"
)

replace_once(
    'components/WorksiteDocumentationPortal.tsx',
    "                {!workNames.length && <div className=\"p-4 text-sm text-slate-500\">No hay obras con trabajadores registrados.</div>}",
    "                {!workNames.length && <div className=\"p-4 text-sm text-slate-500\">No hay obras registradas en Configuración → Obras.</div>}"
)

replace_once(
    'components/WorksiteDocumentationPortal.tsx',
    "                <p className=\"text-sm text-blue-100 mt-1\">Documentos preventivos y de control rellenados automáticamente por obra y periodo.</p>",
    "                <p className=\"text-sm text-blue-100 mt-1\">Documentos preventivos y de control por obra y periodo. El catálogo de obras se gestiona exclusivamente desde Configuración → Obras.</p>"
)
