import type { VisitPoint } from './visitMinutes';

export type WritingMode = 'written' | 'dictated';
export type WritingInput = { mode: WritingMode; text: string; title: string };
export type WritingPoint = { title: string; description: string };
export type WritingProposal = { points: WritingPoint[]; warnings: string[] };
export const WRITING_INPUT_LIMIT = 12000;
export const writingError = (message: string, status = 400, code = 'VISIT_WRITING_INVALID') => Object.assign(new Error(message), { status, code });
export function writingInput(value: any): WritingInput {
  if (!value || !['written', 'dictated'].includes(value.mode) || typeof value.text !== 'string' || !value.text.trim() || value.text.length > WRITING_INPUT_LIMIT || typeof value.title !== 'string' || value.title.length > 200) {
    throw writingError('Introduce un texto de hasta 12.000 caracteres y un título de hasta 200.');
  }
  return { mode: value.mode, text: value.text.trim(), title: value.title.trim() };
}
const numbers = (text: string) => [...new Set(text.match(/\d+(?:[.,:/-]\d+)*/g) || [])].sort().join('|');
export function writingProposal(value: any, input: WritingInput, checkFidelity = true): WritingProposal {
  if (!value || Object.keys(value).some(k => !['points','warnings'].includes(k)) || !Array.isArray(value.points) || !value.points.length || value.points.length > (input.mode === 'written' ? 1 : 30) || !Array.isArray(value.warnings) || value.warnings.length > 10) throw writingError('La IA no devolvió una propuesta válida. Tu texto sigue disponible.', 502);
  const points = value.points.map((p: any) => {
    if (!p || Object.keys(p).some(k => !['title','description'].includes(k)) || typeof p.title !== 'string' || p.title.length > 200 || typeof p.description !== 'string' || !p.description.trim() || p.description.length > 20000) throw writingError('La propuesta contiene un asunto inválido. Conserva y revisa el original.', 502);
    return { title: p.title.trim(), description: p.description.trim() };
  });
  if (value.warnings.some((w: unknown) => typeof w !== 'string' || !w.trim() || w.length > 500) || JSON.stringify(value).length > 40000) throw writingError('La propuesta supera los límites permitidos.', 502);
  const output = points.map((p: WritingPoint) => p.title + '\n' + p.description).join('\n');
  if (checkFidelity && numbers(input.title + '\n' + input.text) !== numbers(output)) throw writingError('La propuesta cambia cifras del original. No se ha aplicado; revisa el texto o inténtalo de nuevo.', 502);
  const warnings = [...value.warnings];
  for (const marker of ['no', 'pendiente de comprobar', 'se propone']) {
    const pattern = new RegExp('\\b' + marker + '\\b', 'gi');
    if (checkFidelity && (input.text.match(pattern) || []).length > (output.match(pattern) || []).length) throw writingError('La propuesta omite una negación o reserva. No se ha aplicado.', 502);
  }
  return { points, warnings };
}
export const pointSource = (p: Pick<VisitPoint, 'title' | 'description'>) => JSON.stringify([p.title, p.description]);
export function applyWritingPoints(current: VisitPoint[], proposal: WritingPoint[], source?: { id: string; snapshot: string }): VisitPoint[] {
  if (source) {
    const point = current.find(p => p.id === source.id);
    if (!point || pointSource(point) !== source.snapshot) throw writingError('El asunto ha cambiado. Conservamos tus cambios; descarta esta propuesta y solicita otra.');
    if (proposal.length !== 1) throw writingError('La mejora escrita debe contener un solo asunto.');
    return current.map(p => p.id === source.id ? { ...p, ...proposal[0] } : p);
  }
  if (current.length + proposal.length > 100) throw writingError('El acta admite un máximo de cien asuntos.');
  const existing = current.length === 1 && !current[0].title.trim() && !current[0].description.trim() && !current[0].attachmentIds.length ? [] : current;
  return [...existing, ...proposal.map(p => ({ ...p, id: crypto.randomUUID(), attachmentIds: [] }))];
}
export function mergeWritingPoints(points: VisitPoint[], index: number): VisitPoint[] {
  if (index < 1 || index >= points.length) return points;
  const previous = points[index - 1], current = points[index];
  const description = [previous.description, current.title, current.description].filter(Boolean).join('\n\n');
  if (description.length > 20000) throw writingError('Los asuntos unidos superarían el límite de texto. Conservamos ambos.');
  return points.flatMap((p,i) => i === index ? [] : i === index - 1 ? [{...p, description, attachmentIds:[...new Set([...p.attachmentIds,...current.attachmentIds])]}] : [p]);
}
