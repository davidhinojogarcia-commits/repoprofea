import { reportOperationalError } from '../src/lib/operationalLog';
import React, { useEffect } from 'react';
import { buildSupabaseSystemBackup } from '../src/services/backupExportService';
import { compressToGzip, isCompressionSupported } from '../src/lib/compression';

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const buttonKind = (target: EventTarget | null): 'gzip' | 'json' | null => {
  const button = target instanceof Element ? target.closest('button') : null;
  if (!button) return null;
  const text = String(button.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (text.includes('exportación completa') && text.includes('json.gz')) return 'gzip';
  if (text.includes('json plano') && text.includes('.json')) return 'json';
  return null;
};

export const CompleteBackupDownloadBridge: React.FC = () => {
  useEffect(() => {
    let busy = false;
    const onClickCapture = (event: MouseEvent) => {
      const kind = buttonKind(event.target);
      if (!kind) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (busy) return;
      busy = true;
      void (async () => {
        try {
          const backup = await buildSupabaseSystemBackup();
          const json = kind === 'json' ? JSON.stringify(backup, null, 2) : JSON.stringify(backup);
          const now = new Date();
          const date = now.toISOString().slice(0, 10);
          const time = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
          if (kind === 'gzip' && isCompressionSupported()) {
            const blob = await compressToGzip(json);
            downloadBlob(blob, `copia_completa_profea_${date}_${time}.json.gz`);
          } else {
            downloadBlob(new Blob([json], { type: 'application/json' }), `copia_completa_profea_${date}_${time}.json`);
          }
          window.dispatchEvent(new CustomEvent('profea:toast', { detail: { message: 'Copia completa v4 generada correctamente.', type: 'success' } }));
        } catch (error: any) {
          reportOperationalError('Copia completa PROFEA:', error);
          window.alert(error?.message || 'No se pudo generar la copia de seguridad completa.');
        } finally {
          busy = false;
        }
      })();
    };
    document.addEventListener('click', onClickCapture, true);
    return () => document.removeEventListener('click', onClickCapture, true);
  }, []);
  return null;
};
