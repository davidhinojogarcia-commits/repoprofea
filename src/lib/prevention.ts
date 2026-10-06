export const PREVENTION_CATEGORIES = ['Calor e hidratación', 'Lluvia y tormentas', 'Viento', 'Excavaciones', 'Trabajo en altura', 'Maquinaria', 'Accesos y señalización', 'Otros'] as const;
export const PREVENTION_CHECKS = [
  { id: 'task', label: 'Tarea y medidas preventivas revisadas con el equipo' },
  { id: 'weather', label: 'Condiciones meteorológicas y avisos revisados' },
  { id: 'water', label: 'Agua, sombra y pausas previstas cuando proceda' },
  { id: 'access', label: 'Accesos, señalización y zona de trabajo comprobados' },
  { id: 'equipment', label: 'Equipos y protecciones comprobados' },
  { id: 'specific', label: 'Riesgos específicos de la tarea comprobados' },
] as const;
export type PreventionCheckAnswer = 'yes' | 'no' | 'na';
export type PreventionChecks = Record<string, PreventionCheckAnswer>;
export type PreventionStatus = 'pending' | 'in_progress' | 'closed';
export const PREVENTION_STATUS_LABELS: Record<PreventionStatus, string> = { pending: 'Pendiente', in_progress: 'En seguimiento', closed: 'Cerrada' };
export interface PreventionRecord {
  id: string; obra: string; kind: 'incident' | 'precheck'; work_date: string;
  category: string; severity: 'low' | 'medium' | 'high'; title: string;
  task: string; description: string; measures: string; responsible: string;
  deadline: string | null; checks: PreventionChecks; photo?: string | null; has_photo?: boolean;
  status: PreventionStatus; actor: string; created_at: string; updated_at: string;
  resolved_at: string | null;
}
export interface PreventionDraft {
  obra: string; kind: 'incident' | 'precheck'; work_date: string;
  category: string; severity: 'low' | 'medium' | 'high'; title: string;
  task: string; description: string; measures: string; responsible: string;
  deadline: string; checks: PreventionChecks; photo: string | null;
}
export const preventionToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());
export function validatePreventionDraft(draft: PreventionDraft) {
  if (!draft.obra.trim() || !draft.task.trim() || !draft.title.trim()) throw new Error('Indica la obra, la tarea y el título.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.work_date)) throw new Error('Indica la fecha.');
  if (draft.work_date > preventionToday()) throw new Error('La fecha del registro no puede ser futura.');
  if (!PREVENTION_CATEGORIES.includes(draft.category as any)) throw new Error('Selecciona una categoría.');
  if (draft.kind === 'incident' && !draft.description.trim()) throw new Error('Describe la incidencia o situación peligrosa.');
  if (draft.kind === 'precheck') {
    if (PREVENTION_CHECKS.some(c => !['yes', 'no', 'na'].includes(draft.checks[c.id]))) throw new Error('Responde a todas las comprobaciones.');
    if (Object.values(draft.checks).includes('no') && (!draft.description.trim() || !draft.measures.trim() || !draft.responsible.trim())) {
      throw new Error('Hay comprobaciones pendientes: describe el riesgo, las medidas y el responsable.');
    }
  }
}
export function filterPreventionRecords(records: PreventionRecord[], obra: string, status: string, from: string, to: string) {
  return records.filter(r => (!obra || r.obra === obra) && (!status || r.status === status) && (!from || r.work_date >= from) && (!to || r.work_date <= to));
}
export function preventionSummary(records: PreventionRecord[], today = preventionToday()) {
  const incidents = records.filter(r => r.kind === 'incident');
  return {
    incidents: incidents.length,
    pending: records.filter(r => r.status !== 'closed').length,
    high: records.filter(r => r.status !== 'closed' && r.severity === 'high').length,
    overdue: records.filter(r => r.status !== 'closed' && r.deadline && r.deadline < today).length,
    prechecks: records.filter(r => r.kind === 'precheck').length,
    byWork: [...new Set(records.map(r => r.obra))].sort().map(obra => ({ obra, incidents: incidents.filter(r => r.obra === obra).length, pending: records.filter(r => r.obra === obra && r.status !== 'closed').length })),
  };
}
