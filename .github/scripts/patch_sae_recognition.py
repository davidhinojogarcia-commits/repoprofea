from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'Expected target not found in {path}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')

# 1) Generate a per-appointment token before sharing the WhatsApp message.
replace_once(
    'components/ReconocimientosMedicosSection.tsx',
    "import { shareMedicalAppointmentByWhatsApp } from '../src/lib/shareMedicalAppointment';",
    "import { shareMedicalAppointmentByWhatsApp } from '../src/lib/shareMedicalAppointment';\nimport { prepareMedicalAppointmentConfirmation } from '../src/lib/medicalAppointmentConfirmation';"
)

replace_once(
    'components/ReconocimientosMedicosSection.tsx',
    """    try {\n      const result = await shareMedicalAppointmentByWhatsApp(person, reminder);\n      if (result === 'shared') {""",
    """    try {\n      const prepared = await prepareMedicalAppointmentConfirmation(person);\n      onUpdatePeople(people.map(p => p.id === person.id ? prepared.updatedPerson : p));\n      const result = await shareMedicalAppointmentByWhatsApp(prepared.updatedPerson, reminder, prepared.links);\n      if (result === 'shared') {"""
)

# 2) Add links to the WhatsApp text while preserving PDF sharing.
replace_once(
    'src/lib/shareMedicalAppointment.ts',
    "export const buildMedicalAppointmentWhatsAppText = (person: Person, reminder = false): string => {",
    "export type MedicalConfirmationLinks = { confirm: string; decline: string };\n\nexport const buildMedicalAppointmentWhatsAppText = (person: Person, reminder = false, confirmationLinks?: MedicalConfirmationLinks): string => {"
)

replace_once(
    'src/lib/shareMedicalAppointment.ts',
    """  lines.push('', 'Se adjunta la citación oficial con todos los datos e instrucciones para el reconocimiento médico.');\n  lines.push('Por favor, confirma respondiendo CONFIRMO. Si no puedes asistir, responde NO PUEDO ASISTIR.');\n  return lines.join('\\n');""",
    """  lines.push('', 'Se adjunta la citación oficial con todos los datos e instrucciones para el reconocimiento médico.');\n  if (confirmationLinks) {\n    lines.push('', 'CONFIRMACIÓN DE ASISTENCIA');\n    lines.push(`✅ Confirmar asistencia: ${confirmationLinks.confirm}`);\n    lines.push(`❌ No puedo asistir: ${confirmationLinks.decline}`);\n    lines.push('La respuesta quedará registrada automáticamente en GestionProfea.');\n  } else {\n    lines.push('Por favor, confirma respondiendo CONFIRMO. Si no puedes asistir, responde NO PUEDO ASISTIR.');\n  }\n  return lines.join('\\n');"""
)

replace_once(
    'src/lib/shareMedicalAppointment.ts',
    "export const shareMedicalAppointmentByWhatsApp = async (person: Person, reminder = false): Promise<'shared' | 'opened' | 'cancelled'> => {",
    "export const shareMedicalAppointmentByWhatsApp = async (person: Person, reminder = false, confirmationLinks?: MedicalConfirmationLinks): Promise<'shared' | 'opened' | 'cancelled'> => {"
)

replace_once(
    'src/lib/shareMedicalAppointment.ts',
    "  const text = buildMedicalAppointmentWhatsAppText(person, reminder);",
    "  const text = buildMedicalAppointmentWhatsAppText(person, reminder, confirmationLinks);"
)

# 3) Token preparation helper. Token hash is stored with the worker; raw token only goes into the worker's link.
Path('src/lib/medicalAppointmentConfirmation.ts').write_text(r'''import type { Person } from '../../types';
import { updateDocument } from '../services/databaseService';
import type { MedicalConfirmationLinks } from './shareMedicalAppointment';

const bytesToBase64Url = (bytes: Uint8Array) => {
  let binary = '';
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
};

const tokenExpiry = (appointmentDay: string) => {
  const match = String(appointmentDay || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const expiry = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 23, 59, 59, 999);
    expiry.setDate(expiry.getDate() + 2);
    if (expiry.getTime() > Date.now()) return expiry.toISOString();
  }
  const fallback = new Date();
  fallback.setDate(fallback.getDate() + 30);
  return fallback.toISOString();
};

export const prepareMedicalAppointmentConfirmation = async (person: Person): Promise<{
  updatedPerson: Person;
  links: MedicalConfirmationLinks;
}> => {
  if (!person.citaDia || !person.citaHora) throw new Error('La cita debe tener fecha y hora antes de generar la confirmación.');

  const random = new Uint8Array(32);
  crypto.getRandomValues(random);
  const token = bytesToBase64Url(random);
  const tokenHash = await sha256Hex(token);
  const updatedPerson = {
    ...person,
    confirmacionCitaEstado: 'pendiente',
    confirmacionCitaFecha: '',
    confirmacionCitaTokenHash: tokenHash,
    confirmacionCitaTokenExpira: tokenExpiry(person.citaDia),
    confirmacionCitaTokenDia: person.citaDia,
    confirmacionCitaTokenHora: person.citaHora,
    confirmacionCitaOrigen: 'pendiente_respuesta_trabajador',
  } as Person & Record<string, any>;

  await updateDocument('trabajadores', person.id, updatedPerson as any);

  const base = `${window.location.origin}/?confirmacion_reconocimiento=1&token=${encodeURIComponent(token)}`;
  return {
    updatedPerson,
    links: {
      confirm: `${base}&respuesta=confirmada`,
      decline: `${base}&respuesta=no_puede_asistir`,
    },
  };
};
''', encoding='utf-8')

# 4) Public worker-facing confirmation page. It never exposes worker data.
Path('components/MedicalAppointmentConfirmationPortal.tsx').write_text(r'''import React, { useMemo, useState } from 'react';
import { CheckCircle2, HeartPulse, Loader2, XCircle } from 'lucide-react';

type ResponseStatus = 'confirmada' | 'no_puede_asistir';

export const MedicalAppointmentConfirmationPortal: React.FC = () => {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const token = params.get('token') || '';
  const requested = params.get('respuesta') === 'no_puede_asistir' ? 'no_puede_asistir' : 'confirmada';
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<'idle' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const submit = async (status: ResponseStatus) => {
    if (!token) {
      setResult('error');
      setMessage('El enlace de confirmación no es válido.');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch('/api/confirm-medical-appointment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, status }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) throw new Error(data?.message || 'No se pudo registrar la respuesta.');
      setResult('success');
      setMessage(status === 'confirmada'
        ? 'Tu asistencia al reconocimiento médico ha quedado confirmada correctamente.'
        : 'Hemos registrado que no puedes asistir. La persona responsable podrá gestionar una nueva cita.');
    } catch (error: any) {
      setResult('error');
      setMessage(error?.message || 'No se pudo registrar la respuesta. El enlace puede haber caducado o la cita puede haber cambiado.');
    } finally {
      setBusy(false);
    }
  };

  const isConfirm = requested === 'confirmada';
  return <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center px-4 py-8">
    <div className="w-full max-w-md rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl p-6 sm:p-8 text-center">
      <div className="mx-auto w-14 h-14 rounded-2xl bg-blue-50 dark:bg-blue-950/40 flex items-center justify-center text-[#00548E] dark:text-blue-300">
        <HeartPulse className="w-7 h-7" />
      </div>
      <h1 className="mt-4 text-2xl font-black text-slate-900 dark:text-white">Reconocimiento médico PROFEA</h1>
      {result === 'idle' ? <>
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
          {isConfirm ? 'Confirma que asistirás a la cita indicada en el mensaje recibido.' : 'Indica que no puedes asistir a la cita indicada en el mensaje recibido.'}
        </p>
        <button type="button" disabled={busy} onClick={() => void submit(requested)} className={`mt-6 w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 font-bold text-white disabled:opacity-60 ${isConfirm ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'}`}>
          {busy ? <Loader2 className="w-5 h-5 animate-spin"/> : isConfirm ? <CheckCircle2 className="w-5 h-5"/> : <XCircle className="w-5 h-5"/>}
          {isConfirm ? 'Confirmar asistencia' : 'No puedo asistir'}
        </button>
      </> : <div className="mt-6">
        {result === 'success' ? <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-600"/> : <XCircle className="w-12 h-12 mx-auto text-red-600"/>}
        <p className="mt-3 text-sm font-semibold text-slate-700 dark:text-slate-200">{message}</p>
      </div>}
      <p className="mt-6 text-xs text-slate-400">Este enlace solo permite responder a la cita para la que fue generado.</p>
    </div>
  </div>;
};
''', encoding='utf-8')

# 5) Render confirmation page before AuthGate so workers do not need an account.
replace_once(
    'index.tsx',
    "import { WorksiteDocumentationPortal } from './components/WorksiteDocumentationPortal';",
    "import { WorksiteDocumentationPortal } from './components/WorksiteDocumentationPortal';\nimport { MedicalAppointmentConfirmationPortal } from './components/MedicalAppointmentConfirmationPortal';"
)

replace_once(
    'index.tsx',
    """ReactDOM.createRoot(rootElement).render(\n  <React.StrictMode>\n    <RootErrorBoundary>\n      <AuthGate>\n        <React.Suspense fallback={<div className=\"min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950\"><div className=\"text-sm text-slate-500\">Cargando aplicación…</div></div>}>\n          <App />\n          <WorksiteDocumentationPortal />\n          <AppToastHost />\n          <AppInstallPromo />\n        </React.Suspense>\n      </AuthGate>\n    </RootErrorBoundary>\n  </React.StrictMode>\n);""",
    """const isMedicalConfirmation = new URLSearchParams(window.location.search).get('confirmacion_reconocimiento') === '1';\n\nReactDOM.createRoot(rootElement).render(\n  <React.StrictMode>\n    <RootErrorBoundary>\n      {isMedicalConfirmation ? (\n        <MedicalAppointmentConfirmationPortal />\n      ) : (\n        <AuthGate>\n          <React.Suspense fallback={<div className=\"min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950\"><div className=\"text-sm text-slate-500\">Cargando aplicación…</div></div>}>\n            <App />\n            <WorksiteDocumentationPortal />\n            <AppToastHost />\n            <AppInstallPromo />\n          </React.Suspense>\n        </AuthGate>\n      )}\n    </RootErrorBoundary>\n  </React.StrictMode>\n);"""
)

# 6) Server-only endpoint. Requires SUPABASE_SERVICE_ROLE_KEY in Vercel; key is never sent to the browser.
Path('api/confirm-medical-appointment.ts').write_text(r'''import { createHash } from 'node:crypto';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://oanurwzoymkmwmxoyzqi.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';

const fail = (res: any, status: number, message: string) => res.status(status).json({ ok: false, message });

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return fail(res, 405, 'Método no permitido.');
  }
  if (!SERVICE_KEY) return fail(res, 503, 'La confirmación automática no está configurada en el servidor.');

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const token = String(body.token || '').trim();
    const status = String(body.status || '').trim().toLowerCase();
    if (token.length < 32) return fail(res, 400, 'El enlace de confirmación no es válido.');
    if (!['confirmada', 'no_puede_asistir'].includes(status)) return fail(res, 400, 'La respuesta no es válida.');

    const hash = createHash('sha256').update(token).digest('hex');
    const query = new URLSearchParams();
    query.set('select', 'owner_id,id,cita_dia,cita_hora,data');
    query.set('data->>confirmacionCitaTokenHash', `eq.${hash}`);
    query.set('limit', '1');

    const found = await fetch(`${SUPABASE_URL}/rest/v1/trabajadores?${query.toString()}`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (!found.ok) return fail(res, 500, 'No se pudo validar el enlace de confirmación.');
    const rows = await found.json();
    const worker = Array.isArray(rows) ? rows[0] : null;
    if (!worker) return fail(res, 404, 'El enlace de confirmación no es válido o ya no corresponde a una cita activa.');

    const data = worker.data && typeof worker.data === 'object' ? worker.data : {};
    const expires = Date.parse(String(data.confirmacionCitaTokenExpira || ''));
    if (!Number.isFinite(expires) || expires < Date.now()) return fail(res, 410, 'El enlace de confirmación ha caducado.');
    if (String(data.confirmacionCitaTokenDia || '') !== String(worker.cita_dia || '') || String(data.confirmacionCitaTokenHora || '') !== String(worker.cita_hora || '')) {
      return fail(res, 409, 'La cita ha cambiado desde que se envió este enlace. Utiliza el mensaje más reciente.');
    }

    const nextData = {
      ...data,
      confirmacionCitaEstado: status,
      confirmacionCitaFecha: new Date().toISOString(),
      confirmacionCitaOrigen: 'enlace_trabajador',
    };
    const patch = new URLSearchParams();
    patch.set('owner_id', `eq.${worker.owner_id}`);
    patch.set('id', `eq.${worker.id}`);
    const updated = await fetch(`${SUPABASE_URL}/rest/v1/trabajadores?${patch.toString()}`, {
      method: 'PATCH',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ data: nextData, updated_at: new Date().toISOString() }),
    });
    if (!updated.ok) return fail(res, 500, 'No se pudo registrar la respuesta de la cita.');

    return res.status(200).json({ ok: true, status });
  } catch (error) {
    console.error('[medical-confirmation-api]', error);
    return fail(res, 500, 'No se pudo registrar la respuesta.');
  }
}
''', encoding='utf-8')

# 7) Document required server-only env key without ever committing a secret.
env_path = Path('.env.example')
env = env_path.read_text(encoding='utf-8')
if 'SUPABASE_SERVICE_ROLE_KEY=' not in env:
    env += '\n# Solo servidor (Vercel Functions). Nunca usar VITE_ ni exponer al navegador.\nSUPABASE_SERVICE_ROLE_KEY=\n'
env_path.write_text(env, encoding='utf-8')
