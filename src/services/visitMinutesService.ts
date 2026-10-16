import { supabase } from '../lib/supabase';
export async function visitRequest<T = any>(body: Record<string, unknown>, options: {
  public?: boolean;
  signal?: AbortSignal;
} = {}): Promise<T> {
  let token = '';
  if (!options.public) {
    const {
      data,
      error
    } = await supabase.auth.getSession();
    if (error) throw error;
    token = data.session?.access_token || '';
    if (!token) throw new Error('Inicia sesión para trabajar con las actas.');
  }
  const response = await fetch('/api/visit-minutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? {
        Authorization: `Bearer ${token}`
      } : {})
    },
    body: JSON.stringify(body),
    signal: options.signal || AbortSignal.timeout(65000),
    cache: 'no-store',
    referrerPolicy: 'no-referrer'
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) throw Object.assign(new Error(result?.message || 'No se pudo completar la operación. Actualiza antes de reintentar si no se confirmó el guardado.'), {
    status: response.status,
    code: result?.code
  });
  return result;
}
export function downloadVisitFile(file: {
  base64: string;
  filename: string;
}) {
  const bytes = Uint8Array.from(atob(file.base64), c => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], {
    type: 'application/pdf'
  }));
  const a = document.createElement('a');
  a.href = url;
  a.download = file.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}
export const readVisitAttachment = (file: File): Promise<string> => new Promise((resolve, reject) => {
  if (file.size > 1400000) return reject(new Error('Cada anexo debe ocupar menos de 1,4 MB.'));
  const reader = new FileReader();
  reader.onerror = () => reject(new Error('No se pudo leer el anexo.'));
  reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
  reader.readAsDataURL(file);
});
