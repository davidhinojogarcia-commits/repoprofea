import React, { Suspense, lazy, useEffect, useState } from 'react';

const AnnualHiringPeriodsPanel = lazy(() => import('./AnnualHiringPeriodsPanel').then(module => ({ default: module.AnnualHiringPeriodsPanel })));
const UiWorkflowEnhancements = lazy(() => import('./UiWorkflowEnhancements').then(module => ({ default: module.UiWorkflowEnhancements })));
const ExportRenunciationEnhancer = lazy(() => import('./ExportRenunciationEnhancer').then(module => ({ default: module.ExportRenunciationEnhancer })));
const AdministrativeDataAssignmentBridge = lazy(() => import('./AdministrativeDataAssignmentBridge').then(module => ({ default: module.AdministrativeDataAssignmentBridge })));
const DirectoryAdministrativeExportBridge = lazy(() => import('./DirectoryAdministrativeExportBridge').then(module => ({ default: module.DirectoryAdministrativeExportBridge })));
const CompleteBackupDownloadBridge = lazy(() => import('./CompleteBackupDownloadBridge').then(module => ({ default: module.CompleteBackupDownloadBridge })));
const PrlTrainingScheduleBridge = lazy(() => import('./PrlTrainingScheduleBridge').then(module => ({ default: module.PrlTrainingScheduleBridge })));
const SaeRenunciationBridge = lazy(() => import('./SaeRenunciationBridge').then(module => ({ default: module.SaeRenunciationBridge })));
const PdfRuntimeInitializer = lazy(() => import('./PdfRuntimeInitializer'));

export function DeferredAppEnhancements() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let timeoutId: number | undefined;
    let idleId: number | undefined;
    const enable = () => setReady(true);
    const runtime = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    if (runtime.requestIdleCallback) {
      idleId = runtime.requestIdleCallback(enable, { timeout: 1400 });
    } else {
      timeoutId = window.setTimeout(enable, 500);
    }

    return () => {
      if (idleId !== undefined) runtime.cancelIdleCallback?.(idleId);
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    void import('../src/lib/worksiteAdditionalDocumentsLegalBodies').catch(error =>
      console.warn('No se pudieron cargar las definiciones legales de documentos:', error),
    );
    void import('../src/lib/subcontratasDefaults')
      .then(module => module.hydrateStoredSubcontratasPreferences())
      .catch(error => console.warn('No se pudieron precargar preferencias de subcontratas:', error));
  }, [ready]);

  if (!ready) return null;

  return (
    <Suspense fallback={null}>
      <PdfRuntimeInitializer />
      <AnnualHiringPeriodsPanel />
      <UiWorkflowEnhancements />
      <ExportRenunciationEnhancer />
      <AdministrativeDataAssignmentBridge />
      <DirectoryAdministrativeExportBridge />
      <CompleteBackupDownloadBridge />
      <PrlTrainingScheduleBridge />
      <SaeRenunciationBridge />
    </Suspense>
  );
}
