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
const MIGRATION_VERSION = 3;

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

    // Migración reanudable: se importan únicamente IDs que todavía no existen para
    // el administrador actual. El RPC escribe directamente en public.trabajadores,
    // completa columnas tipadas y mantiene Supabase como única fuente de verdad.
    const existingRows = await sb(
      `/rest/v1/trabajadores?select=id&owner_id=eq.${encodeURIComponent(user.id)}&limit=10000`,
      token,
      { method: 'GET' },
    );
    const existingIds = new Set((existingRows || []).map((row: any) => Number(row.id)));

    const now = new Date().toISOString();
    let imported = 0;
    let skipped = 0;

    for (let i = 0; i < workers.length; i += 50) {
      const missingWorkers = workers
        .slice(i, i + 50)
        .filter((worker: any) => worker && worker.id != null)
        .filter((worker: any) => {
          const exists = existingIds.has(Number(worker.id));
          if (exists) skipped += 1;
          return !exists;
        });

      if (missingWorkers.length) {
        const importedBatch = await sb(
          '/rest/v1/rpc/import_workers_atomic',
          token,
          {
            method: 'POST',
            body: JSON.stringify({ p_workers: missingWorkers }),
          },
        );
        imported += Number(importedBatch || missingWorkers.length);
        missingWorkers.forEach((worker: any) => existingIds.add(Number(worker.id)));
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
