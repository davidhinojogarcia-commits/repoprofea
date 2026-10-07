import { getSessionUser, supabase } from '../lib/supabase';

export type AnnualHiringMonth = {
  month: number;
  monthName: string;
  period1Start: string;
  period1End: string;
  period2Start: string;
  period2End: string;
  source: 'imported' | 'manual';
  updatedAt: string;
  warnings?: string[];
};

export type AnnualHiringPeriodsRecord = {
  id: string;
  year: number;
  months: AnnualHiringMonth[];
  sourceFileName?: string;
  sourceKind?: string;
  importedAt: string;
};

const safe = (v: unknown) => String(v ?? '').trim();

const normalizeRecord = (value: any): AnnualHiringPeriodsRecord | null => {
  const year = Number(value?.year);
  if (!Number.isFinite(year)) return null;

  let months: AnnualHiringMonth[] = [];
  if (Array.isArray(value?.months)) {
    months = value.months.map((m: any) => ({
      month: Number(m?.month),
      monthName: safe(m?.monthName),
      period1Start: safe(m?.period1Start),
      period1End: safe(m?.period1End),
      period2Start: safe(m?.period2Start),
      period2End: safe(m?.period2End),
      source: m?.source === 'manual' ? 'manual' as const : 'imported' as const,
      updatedAt: safe(m?.updatedAt) || new Date().toISOString(),
      warnings: Array.isArray(m?.warnings) ? m.warnings.map(safe).filter(Boolean) : [],
    })).filter((m: AnnualHiringMonth) => m.month >= 1 && m.month <= 12);
  } else if (Array.isArray(value?.periods)) {
    // Compatibilidad con la primera versión: el periodo único pasa a Periodo 1.
    months = value.periods.map((p: any) => ({
      month: Number(p?.month),
      monthName: safe(p?.monthName),
      period1Start: safe(p?.startDate),
      period1End: safe(p?.endDate),
      period2Start: '',
      period2End: '',
      source: p?.source === 'manual' ? 'manual' as const : 'imported' as const,
      updatedAt: safe(p?.updatedAt) || new Date().toISOString(),
      warnings: ['Registro importado con el formato anterior. Revise el Periodo 2.'],
    })).filter((m: AnnualHiringMonth) => m.month >= 1 && m.month <= 12);
  }

  return {
    id: safe(value?.id) || `annual-${year}`,
    year,
    months,
    sourceFileName: safe(value?.sourceFileName),
    sourceKind: safe(value?.sourceKind),
    importedAt: safe(value?.importedAt) || new Date().toISOString(),
  };
};

async function requireUser() {
  const user = await getSessionUser();
  if (!user) throw new Error('No hay una sesión autenticada.');
  return user;
}

export async function listAnnualHiringPeriods(): Promise<AnnualHiringPeriodsRecord[]> {
  const user = await requireUser();
  const rows = await supabase.query('user_settings', {
    query: `user_id=eq.${encodeURIComponent(user.id)}&select=periods:settings->annualHiringPeriods&limit=1`,
  });
  const raw = rows?.[0]?.periods;
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeRecord).filter(Boolean) as AnnualHiringPeriodsRecord[];
}

export async function saveAnnualHiringPeriods(record: AnnualHiringPeriodsRecord): Promise<void> {
  const existing = await listAnnualHiringPeriods();
  const next = [
    ...existing.filter((item) => item.year !== record.year),
    record,
  ];
  await supabase.rpc('patch_user_settings', {
    p_patch: { annualHiringPeriods: next },
  });
  window.dispatchEvent(new CustomEvent('profea:annual-hiring-periods-updated', { detail: { record } }));
}

export async function deleteAnnualHiringPeriods(year: number): Promise<void> {
  const existing = await listAnnualHiringPeriods();
  const next = existing.filter((item) => item.year !== year);
  await supabase.rpc('patch_user_settings', {
    p_patch: { annualHiringPeriods: next },
  });
  window.dispatchEvent(new CustomEvent('profea:annual-hiring-periods-updated', {
    detail: { year, deleted: true },
  }));
}

export async function updateAnnualHiringMonth(
  recordId: string,
  month: number,
  patch: Partial<Pick<AnnualHiringMonth, 'period1Start' | 'period1End' | 'period2Start' | 'period2End'>>,
): Promise<void> {
  const all = await listAnnualHiringPeriods();
  const target = all.find((r) => r.id === recordId);
  if (!target) throw new Error('No se ha encontrado la anualidad de contratación.');
  target.months = target.months.map((m) => m.month === month ? {
    ...m,
    ...patch,
    source: 'manual',
    updatedAt: new Date().toISOString(),
  } : m);
  target.importedAt = new Date().toISOString();
  await saveAnnualHiringPeriods(target);
}
