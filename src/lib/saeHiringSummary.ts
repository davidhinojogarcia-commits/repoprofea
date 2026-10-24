import type { SaeCandidate, SaeNeed, SaeReport } from '../services/saeService';

const normalize = (value: string) => String(value || '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
export type HiringPeriod = '1ª Quincena' | '2ª Quincena' | 'Mensual' | 'Periodo por confirmar';
const isPeon = (value: string) => /\bpeon(?:es)?\b/.test(normalize(value));
const explicitPeriod = (value: string): HiringPeriod | null => {
  const text = normalize(value);
  if (/\b1[ªaºo.]?\s*quincena/.test(text)) return '1ª Quincena';
  if (/\b2[ªaºo.]?\s*quincena/.test(text)) return '2ª Quincena';
  return /\bmensual\b/.test(text) ? 'Mensual' : null;
};
const categoryKey = (value: string) => {
  if (isPeon(value)) return 'peon';
  return normalize(value).replace(/\b[12][ªaºo.]?\s*quincena\b|\bmensual\b|\bpendiente\b/g, '')
    .replace(/\bcn\s*\d+\b/g, '').replace(/\boficial(?:es)?\s*1[ªaºo.]?/g, 'oficial')
    .replace(/[^a-z0-9]+/g, ' ').trim();
};
const categoryMatches = (a: string, b: string) => {
  const ca = normalize(a).match(/\bcn\s*(\d+)/)?.[1];
  const cb = normalize(b).match(/\bcn\s*(\d+)/)?.[1];
  if (ca && cb && ca !== cb) return false;
  const ka = categoryKey(a), kb = categoryKey(b);
  if (!ka || !kb) return false;
  return ka === kb || (` ${ka} `).includes(` ${kb} `) || (` ${kb} `).includes(` ${ka} `);
};
const identity = (candidate: SaeCandidate) => {
  const name = normalize(candidate.normalizedName || `${candidate.apellidos || ''} ${candidate.nombre || ''}`.trim() || candidate.fullNameOriginal)
    .replace(/[^a-z0-9]+/g, ' ').trim();
  return name || (candidate.linkedWorkerId ? `worker:${candidate.linkedWorkerId}` : candidate.id);
};
const unique = (candidates: SaeCandidate[]) => new Set(candidates.map(identity)).size;
export const isSaeHiring = (candidate: SaeCandidate) => candidate.resultCode === '2001'
  || (!candidate.resultCode && candidate.estado === 'Contratado');
export type SaeHiringRow = {
  id: string; category: string; period: HiringPeriod; planned: number | null;
  candidates: number; hiring: number; registered: number; remaining: number | null;
  excess: number; reportHiring: number; reportCandidates: number; reportRelevant: boolean;
};

/** Every vacancy belongs to one category/period. Reports contribute to that shared target. */
export function buildSaeHiringSummary(need: SaeNeed, reports: SaeReport[], candidates: SaeCandidate[], selectedReportId = '') {
  const reportById = new Map(reports.filter(r => r.needId === need.id).map(r => [r.id, r]));
  const rows: (SaeHiringRow & { members: SaeCandidate[] })[] = [];
  for (const req of need.categorias) {
    const period = explicitPeriod(req.categoria) || (isPeon(req.categoria) ? 'Periodo por confirmar' : 'Mensual');
    const existing = rows.find(row => row.period === period && categoryKey(row.category) === categoryKey(req.categoria)
      && normalize(row.category).match(/\bcn\s*(\d+)/)?.[1] === normalize(req.categoria).match(/\bcn\s*(\d+)/)?.[1]);
    // Pending quantities imported as zero are unknown, not a completed zero-vacancy plan.
    const planned = /\bpendiente\b/.test(normalize(req.categoria)) ? null : Math.max(0, Number(req.cantidad) || 0);
    if (existing) existing.planned = existing.planned === null || planned === null ? null : existing.planned + planned;
    else rows.push({ id: req.id, category: req.categoria, period, planned, members: [], candidates: 0,
      hiring: 0, registered: 0, remaining: null, excess: 0, reportHiring: 0, reportCandidates: 0, reportRelevant: false });
  }
  for (const candidate of candidates) {
    if (candidate.needId !== need.id || !reportById.has(candidate.reportId)) continue;
    const report = reportById.get(candidate.reportId)!;
    const category = candidate.categoria || report.categoria;
    const period = explicitPeriod(candidate.quincena) || explicitPeriod(report.quincena)
      || (category && !isPeon(category) ? 'Mensual' : 'Periodo por confirmar');
    const matches = rows.filter(row => row.period === period && categoryMatches(row.category, category));
    const exact = matches.filter(row => categoryKey(row.category) === categoryKey(category));
    let row = exact.length === 1 ? exact[0] : matches.length === 1 ? matches[0] : undefined;
    if (!row) {
      const label = category || 'Categoría por confirmar';
      row = rows.find(r => r.planned === null && r.period === period && r.category === label);
      if (!row) {
        row = { id: `unplanned:${period}:${label}`, category: label, period, planned: null, members: [],
          candidates: 0, hiring: 0, registered: 0, remaining: null, excess: 0, reportHiring: 0, reportCandidates: 0, reportRelevant: false };
        rows.push(row);
      }
    }
    row.members.push(candidate);
  }
  const selectedReport = reportById.get(selectedReportId);
  return rows.map(({ members, ...row }) => {
    const hiring = members.filter(isSaeHiring);
    const selected = members.filter(c => c.reportId === selectedReportId);
    const selectedPeriod = selectedReport && (explicitPeriod(selectedReport.quincena)
      || (selectedReport.categoria && !isPeon(selectedReport.categoria) ? 'Mensual' : 'Periodo por confirmar'));
    return { ...row, candidates: unique(members), hiring: unique(hiring),
      registered: unique(hiring.filter(c => Boolean(c.linkedWorkerId) || c.estado === 'Contratado')),
      remaining: row.planned === null ? null : Math.max(0, row.planned - unique(hiring)),
      excess: row.planned === null ? 0 : Math.max(0, unique(hiring) - row.planned),
      reportHiring: unique(selected.filter(isSaeHiring)), reportCandidates: unique(selected),
      reportRelevant: selected.length > 0 || Boolean(selectedReport && row.period === selectedPeriod && categoryMatches(row.category, selectedReport.categoria)),
    };
  }).sort((a, b) => ['1ª Quincena', '2ª Quincena', 'Mensual', 'Periodo por confirmar'].indexOf(a.period)
    - ['1ª Quincena', '2ª Quincena', 'Mensual', 'Periodo por confirmar'].indexOf(b.period));
}
