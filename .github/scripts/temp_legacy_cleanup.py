from pathlib import Path
import re

root = Path('.')

# 1) Remove obsolete Subcontratas localStorage helper block only when no consumers remain.
def consumers(symbol: str, exclude: set[str]) -> list[str]:
    hits=[]
    for p in root.rglob('*'):
        if not p.is_file() or p.suffix not in {'.ts','.tsx','.js','.jsx'}:
            continue
        rp=p.as_posix()
        if rp in exclude or '/node_modules/' in f'/{rp}/' or rp.startswith('node_modules/'):
            continue
        try: txt=p.read_text(errors='ignore')
        except Exception: continue
        if symbol in txt: hits.append(rp)
    return hits

symbols=[
 'getStoredChecklistTemplate','saveStoredChecklistTemplate','resetStoredChecklistTemplate',
 'getStoredReporteTecnicoConfig','saveStoredReporteTecnicoConfig',
 'getStoredObrasRecursosPreventivos','saveStoredObraRecursoPreventivo',
 'deleteStoredObraRecursoPreventivo','updateStoredObraNameInRecursos'
]
external={s:consumers(s, {'src/lib/subcontratasDefaults.ts','.github/scripts/temp_legacy_cleanup.py'}) for s in symbols}
remaining={k:v for k,v in external.items() if v}
if remaining:
    print('Subcontratas localStorage helpers still consumed:', remaining)
else:
    p=Path('src/lib/subcontratasDefaults.ts')
    s=p.read_text()
    start=s.find('// Local storage key for customized checklist requirements template')
    end=s.find('/**\n * Synchronizes an existing subcontrata checklist', start)
    if start == -1 or end == -1:
        raise SystemExit('Could not locate legacy Subcontratas localStorage block')
    # Preserve presets and default report config that sit inside the old block.
    presets_start=s.find('// Pre-defined frequent construction documents for quick addition', start)
    presets_end=s.find('/**\n * Retrieves the stored customized checklist template', presets_start)
    defaults_start=s.find('export const DEFAULT_REPORTE_TECNICO_CONFIG', start)
    defaults_end=s.find('/**\n * Retrieves the global technician', defaults_start)
    if min(presets_start,presets_end,defaults_start,defaults_end) == -1:
        raise SystemExit('Could not isolate constants from legacy block')
    preserved=s[presets_start:presets_end].rstrip()+'\n\n'+s[defaults_start:defaults_end].rstrip()+'\n\n'
    s=s[:start]+preserved+s[end:]
    p.write_text(s)
    print('Removed obsolete Subcontratas localStorage helper implementations.')

# 2) Report remaining runtime bridge consumers; remove bridge only when all are gone.
bridge_names=['isOffline','isSyncing','groupId','syncMode','currentEffectiveWorkspaceId','setIsOffline','executeDatabaseSync','handleSyncPendingToCloud']
app=Path('App.tsx').read_text()
used=[name for name in bridge_names if re.search(r'\b'+re.escape(name)+r'\b', app)]
print('Remaining App runtime bridge names:', used)
if not used:
    p=Path('index.tsx'); s=p.read_text()
    start=s.find('// Puente de arranque temporal')
    end=s.find('\n\nconst App = React.lazy', start)
    if start != -1 and end != -1:
        s=s[:start]+s[end+2:]
        p.write_text(s)
    d=Path('src/legacy-runtime-globals.d.ts')
    if d.exists(): d.unlink()
    print('Removed temporary runtime globals bridge.')
