export type DocumentFortnight = '1Q' | '2Q' | 'unknown';

export const documentFortnightLabel = (key: DocumentFortnight) =>
  key === '1Q' ? '1ª quincena · 1–15' : key === '2Q' ? '2ª quincena · 16–fin de mes' : 'Sin quincena';

// The imported period takes precedence over the date used when preparing the document.
export function foremanDocumentPeriod(workDate: string, periodKey?: string | null) {
  const period = String(periodKey || '').match(/^(\d{4}-(?:0[1-9]|1[0-2]))(?:-([12]Q))?$/i);
  const date = String(workDate || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  const validDate = date && new Date(Date.UTC(+date[1], +date[2] - 1, +date[3])).toISOString().slice(0, 10) === date[0].slice(0, 10);
  const dateMonth = validDate ? `${date[1]}-${date[2]}` : '';
  const month = period?.[1] || dateMonth || 'Sin fecha';
  const fortnight: DocumentFortnight = period?.[2]
    ? period[2].toUpperCase() as DocumentFortnight
    : validDate && dateMonth === month ? (+date[3] <= 15 ? '1Q' : '2Q') : 'unknown';
  return { month, fortnight };
}
