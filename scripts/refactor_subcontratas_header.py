from pathlib import Path

path = Path('components/SubcontratasSection.tsx')
text = path.read_text()

text = text.replace(
"import { ChecklistConfigModal } from './ChecklistConfigModal';\n",
"import { ChecklistConfigModal } from './ChecklistConfigModal';\nimport { PageHeader } from './ui/PageHeader';\nimport { BUTTON_PRIMARY, BUTTON_SECONDARY } from '../constants';\n",
1,
)

start = text.index("      {/* Header Banner */}")
end = text.index("\n\n      {/* Visual Progress Bar Section for Each Obra */}", start)
new_header = r'''      <PageHeader
        eyebrow="Prevención y Coordinación de Actividades Empresariales"
        title="Control de Subcontratas de Obra (CAE)"
        description="Expediente documental por empresa, personal y maquinaria, con revisión asistida por IA y validación humana antes de aplicar cambios."
        icon={<HardHat className="h-5 w-5" />}
        actions={
          <>
            <button
              id="btn-reporte-consolidado-top"
              type="button"
              onClick={() => handleExportConsolidatedPDF()}
              className={`${BUTTON_SECONDARY} text-xs`}
              title="Exportar reporte técnico consolidado en PDF de la obra"
            >
              <Download className="w-4 h-4" />
              <span>Reporte Técnico PDF</span>
            </button>

            <button
              id="btn-firmas-reporte-top"
              type="button"
              onClick={() => setIsFirmasModalOpen(true)}
              className={`${BUTTON_SECONDARY} text-xs`}
              title="Configurar las firmas oficiales del reporte técnico"
            >
              <FileSignature className="w-4 h-4" />
              <span>Firmas</span>
            </button>

            <button
              id="btn-gestionar-obras-top"
              type="button"
              onClick={() => setIsManageObrasModalOpen(true)}
              className={`${BUTTON_SECONDARY} text-xs`}
              title="Gestionar catálogo de obras"
            >
              <Building2 className="w-4 h-4" />
              <span>Obras</span>
            </button>

            <button
              id="btn-configurar-checklist-top"
              type="button"
              onClick={() => setIsConfigModalOpen(true)}
              className={`${BUTTON_SECONDARY} text-xs`}
              title="Configurar la documentación obligatoria del checklist legal"
            >
              <SlidersHorizontal className="w-4 h-4" />
              <span>Checklist</span>
              <span className="ui-status ui-status--info !px-1.5 !py-1 text-[10px]">
                {checklistTemplate.filter(i => i.obligatorio).length}
              </span>
            </button>

            <button
              id="btn-nueva-subcontrata"
              type="button"
              onClick={() => setIsNewModalOpen(true)}
              className={`${BUTTON_PRIMARY} text-xs`}
            >
              <Plus className="w-4 h-4" />
              <span>Nueva Subcontrata</span>
            </button>
          </>
        }
      />'''
text = text[:start] + new_header + text[end:]

text = text.replace(
"<div id=\"progreso-cumplimiento-obras\" className=\"bg-white dark:bg-slate-900 rounded-xl shadow-xs border border-slate-200 dark:border-slate-800 p-5 space-y-4\">",
"<div id=\"progreso-cumplimiento-obras\" className=\"ui-surface p-5 space-y-4\">",
1,
)

path.write_text(text)
print('Subcontractor CAE header migrated to the shared institutional UI system.')
