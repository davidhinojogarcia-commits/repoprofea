import { extractMandatoryWorksiteLabel } from './mandatoryWorksiteDetection';

export type WorksiteCandidate = { nombre: string; codigo?: string | null };
export type EmploymentWorksiteProposal = {
  suggestedObra: string;
  detectedCodes: string[];
  reason: 'code' | 'label' | 'ambiguous' | 'unknown-code' | 'unreadable';
  status: 'pending';
};
const normalize = (value: unknown) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const fullCodes = (text: string) => [...normalize(text).matchAll(/\b(\d{4,6})\s*(GR|EE)\b/g)].map(match => match[1] + match[2]);
export function proposeEmploymentWorksite(text: string, catalog: WorksiteCandidate[]): EmploymentWorksiteProposal {
  const codes = fullCodes(text);
  // Read the complete labelled token, including unknown suffixes. Never let an
  // optional suffix backtrack into a valid numeric prefix (11002ER -> 11002).
  // Preserve line breaks so a genuinely bare code cannot consume the next field.
  const labelledText = String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9\n]+/g, ' ');
  for (const match of labelledText.matchAll(/\bCODIGO (?:DE )?OBRA\s+([A-Z0-9]+)(?:[ \t]+([A-Z0-9]+))?/g)) {
    codes.push(match[1] + (match[2] || ''));
  }
  const detectedCodes = [...new Set(codes)];
  const result = (reason: EmploymentWorksiteProposal['reason'], suggestedObra = ''): EmploymentWorksiteProposal => ({ suggestedObra, detectedCodes, reason, status: 'pending' });
  const works = catalog.filter(work => String(work.nombre || '').trim());
  if (detectedCodes.length) {
    const matches = detectedCodes.map(code => works.filter(work => {
      const own = [...fullCodes(work.nombre), ...fullCodes(String(work.codigo || ''))];
      const explicit = normalize(work.codigo).replace(/ /g, '');
      if (/^\d{4,6}$/.test(explicit)) own.push(explicit);
      return own.some(candidate => candidate === code || (/^\d+$/.test(code) && candidate.replace(/(?:GR|EE)$/, '') === code) || (/^\d+$/.test(candidate) && code.replace(/(?:GR|EE)$/, '') === candidate));
    }));
    const unique = [...new Set(matches.flat().map(work => work.nombre))];
    if (matches.every(group => group.length === 1) && unique.length === 1) return result('code', unique[0]);
    return result(matches.some(group => group.length > 1) || unique.length > 1 ? 'ambiguous' : 'unknown-code');
  }
  const label = normalize(extractMandatoryWorksiteLabel(text));
  const matches = label ? works.filter(work => normalize(work.nombre) === label) : [];
  return matches.length === 1 ? result('label', matches[0].nombre) : result(matches.length > 1 ? 'ambiguous' : 'unreadable');
}
