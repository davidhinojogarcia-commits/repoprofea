import { supabase } from '../lib/supabase';

export type AnnualHiringPeriod = {
  month: number;
  monthName: string;
  startDate: string;
  endDate: string;
  source: 'imported' | 'manual';
  updatedAt: string;
};

export type AnnualHiringPeriodsRecord = {
  id: string;
  obra: string;
  codigoObra?: string;
  year: number;
  periods: AnnualHiringPeriod[];
  sourceFileName?: string;
  sourceKind?: string;
  importedAt: string;
};

const safe = (v: unknown) => String(v ?? '').trim();
const normalizeRecord = (value: any): AnnualHiringPeriodsRecord | null => {
  const obra = safe(value?.obra);
  const year = Number(value?.year);
  if (!obra || !Number.isFinite(year)) return null;
  const periods = Array.isArray(value?.periods)
    ? value.periods.map((p: any) => ({
        month: Number(p?.month),
        monthName: safe(p?.monthName),
        startDate: safe(p?.startDate),
        endDate: safe(p?.endDate),
        source: p?.source === 'manual' ? 'manual' as const : 'imported' as const,
        updatedAt: safe(p?.updatedAt) || new Date().toISOString(),
      })).filter((p: AnnualHiringPeriod) => p.month >= 1 && p.month <= 12)
    : [];
  return {
    id: safe(value?.id) || `${year}-${obra}`,
    obra,
    codigoObra: safe(value?.codigoObra),
    year,
    periods,
    sourceFileName: safe(value?.sourceFileName),
    sourceKind: safe(value?.sourceKind),
    importedAt: safe(value?.importedAt) || new Date().toISOString(),
  };
};

async function requireUser() {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('No hay una sesión autenticada.');
  return data.user;
}

export async function listAnnualHiringPeriods(): Promise<AnnualHiringPeriodsRecord[]> {
  const user = await requireUser();
  const rows = await supabase.query('user_settings', {
    query: `user_id=eq.${encodeURIComponent(user.id)}&select=settings&limit=1`,
  });
  const raw = rows?.[0]?.settings?.annualHiringPeriods;
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeRecord).filter(Boolean) as AnnualHiringPeriodsRecord[];
}

export async function saveAnnualHiringPeriods(record: AnnualHiringPeriodsRecord): Promise<void> {
  const existing = await listAnnualHiringPeriods();
  const key = `${record.year}|${record.codigoObra || record.obra}`.toLowerCase();
  const next = [
    ...existing.filter((item) => `${item.year}|${item.codigoObra || item.obra}`.toLowerCase() !== key),
    record,
  ];
  await supabase.rpc('patch_user_settings', {
    p_patch: { annualHiringPeriods: next },
  });
  window.dispatchEvent(new CustomEvent('profea:annual-hiring-periods-updated', { detail: { record } }));
}

export async function updateAnnualHiringPeriod(
  recordId: string,
  month: number,
  patch: Partial<Pick<AnnualHiringPeriod, 'startDate' | 'endDate'>>,
): Promise<void> {
  const all = await listAnnualHiringPeriods();
  const target = all.find((r) => r.id === recordId);
  if (!target) throw new Error('No se ha encontrado el calendario anual de contratación.');
  target.periods = target.periods.map((p) => p.month === month ? {
    ...p,
    ...patch,
    source: 'manual',
    updatedAt: new Date().toISOString(),
  } : p);
  target.importedAt = new Date().toISOString();
  await saveAnnualHiringPeriods(target);
}
