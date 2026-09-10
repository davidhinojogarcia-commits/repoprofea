import fs from 'node:fs/promises';
import path from 'node:path';

type ApiRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => unknown;
};

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://oanurwzoymkmwmxoyzqi.supabase.co';
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
const MIGRATION_VERSION = 2;

async function sb(pathname: string, token: string, init: RequestInit = {}) {
  if (!SUPABASE_KEY) throw new Error('Supabase publishable key is not configured');
  const response = await fetch(`${SUPABASE_URL}${pathname}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new Error(data?.message || data?.msg || data?.error || `Supabase ${response.status}`);
  return data;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const rawAuthorization = req.headers.authorization;
  const authorization = Array.isArray(rawAuthorization) ? rawAuthorization[0] : String(rawAuthorization || '');
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const user = await sb('/auth/v1/user', token, { method: 'GET' });
    const profile = (await sb(
      `/rest/v1/profiles?select=id,role,active&id=eq.${encodeURIComponent(user.id)}&limit=1`,
      token,
      { method: 'GET' },
    ))?.[0];

    if (!profile || profile.active !== true || profile.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }

    const settingsRows = await sb(
      `/rest/v1/user_settings?select=settings&user_id=eq.${encodeURIComponent(user.id)}&limit=1`,
      token,
      { method: 'GET' },
    );
    const currentSettings = settingsRows?.[0]?.settings || {};
    if (Number(currentSettings.legacyMigrationVersion || 0) >= MIGRATION_VERSION) {
      return res.status(200).json({ migrated: false, reason: 'already-migrated' });
    }

    const workers = JSON.parse(
      await fs.readFile(path.join(process.cwd(), 'data', 'initial_workers.json'), 'utf8'),
    );
    if (!Array.isArray(workers)) throw new Error('Legacy worker source is invalid');

    // Partial-safe migration: never overwrite a worker that is already present in Supabase.
    // This lets interrupted migrations resume without destroying edits made after an earlier import.
    const existingRows = await sb(
      `/rest/v1/workers?select=id&owner_id=eq.${encodeURIComponent(user.id)}&limit=10000`,
      token,
      { method: 'GET' },
    );
    const existingIds = new Set((existingRows || []).map((row: any) => Number(row.id)));

    const now = new Date().toISOString();
    let imported = 0;
    let skipped = 0;

    for (let i = 0; i < workers.length; i += 50) {
      const rows = workers
        .slice(i, i + 50)
        .filter((worker: any) => worker && worker.id != null)
        .filter((worker: any) => {
          const exists = existingIds.has(Number(worker.id));
          if (exists) skipped += 1;
          return !exists;
        })
        .map((worker: any) => ({
          owner_id: user.id,
          id: Number(worker.id),
          data: worker,
          created_by: user.id,
          created_at: worker.fechaRegistro || now,
          updated_by: user.id,
          updated_at: worker._lastUpdated || worker.fechaRegistro || now,
        }));

      if (rows.length) {
        await sb(
          '/rest/v1/workers?on_conflict=owner_id,id',
          token,
          {
            method: 'POST',
            headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
            body: JSON.stringify(rows),
          },
        );
        imported += rows.length;
        rows.forEach((row: any) => existingIds.add(Number(row.id)));
      }
    }

    const legacySettings = JSON.parse(
      await fs.readFile(path.join(process.cwd(), 'data', 'initial_settings.json'), 'utf8'),
    );
    const mergedSettings = {
      ...legacySettings,
      ...currentSettings,
      legacyMigrationVersion: MIGRATION_VERSION,
      legacyMigrationAt: now,
    };

    await sb(
      '/rest/v1/user_settings?on_conflict=user_id',
      token,
      {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({
          user_id: user.id,
          settings: mergedSettings,
          updated_by: user.id,
          updated_at: now,
        }),
      },
    );

    return res.status(200).json({
      migrated: true,
      workersImported: imported,
      workersAlreadyPresent: skipped,
      sourceWorkers: workers.length,
      migrationVersion: MIGRATION_VERSION,
    });
  } catch (error: any) {
    console.error('legacy migration', error);
    return res.status(500).json({ error: error?.message || 'Migration failed' });
  }
}
