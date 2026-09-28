export type AppDialogKind = 'info' | 'success' | 'warning' | 'error' | 'confirm' | 'prompt';

export type AppDialogOptions = {
  kind?: AppDialogKind;
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  defaultValue?: string;
  placeholder?: string;
};

export type AppDialogRequest = AppDialogOptions & {
  id: string;
  resolve: (value: boolean | string | null) => void;
};

export const APP_DIALOG_EVENT = 'profea:dialog';

const dispatchDialog = (options: AppDialogOptions) =>
  new Promise<boolean | string | null>((resolve) => {
    if (typeof window === 'undefined') {
      resolve(options.kind === 'confirm' ? false : options.kind === 'prompt' ? null : true);
      return;
    }
    const request: AppDialogRequest = {
      ...options,
      id: `dialog-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      resolve,
    };
    window.dispatchEvent(new CustomEvent<AppDialogRequest>(APP_DIALOG_EVENT, { detail: request }));
  });

export async function appAlert(
  message: string,
  options: Omit<AppDialogOptions, 'message' | 'kind'> & { kind?: Exclude<AppDialogKind, 'confirm' | 'prompt'> } = {},
) {
  await dispatchDialog({
    kind: options.kind || 'info',
    title: options.title,
    message,
    confirmLabel: options.confirmLabel || 'Aceptar',
  });
}

export async function appConfirm(
  message: string,
  options: Omit<AppDialogOptions, 'message' | 'kind' | 'defaultValue' | 'placeholder'> = {},
) {
  const result = await dispatchDialog({
    kind: 'confirm',
    title: options.title || 'Confirmar acción',
    message,
    confirmLabel: options.confirmLabel || 'Confirmar',
    cancelLabel: options.cancelLabel || 'Cancelar',
  });
  return result === true;
}

export async function appPrompt(
  message: string,
  options: Omit<AppDialogOptions, 'message' | 'kind'> = {},
) {
  const result = await dispatchDialog({
    kind: 'prompt',
    title: options.title || 'Introduce la información',
    message,
    confirmLabel: options.confirmLabel || 'Continuar',
    cancelLabel: options.cancelLabel || 'Cancelar',
    defaultValue: options.defaultValue || '',
    placeholder: options.placeholder || '',
  });
  return typeof result === 'string' ? result : null;
}

let installed = false;

export function installAppDialogRuntime() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  // Sustituye los avisos informativos heredados por el sistema visual de la app.
  // Confirmaciones y entradas de texto usan appConfirm/appPrompt porque necesitan
  // resolución asíncrona sin bloquear el hilo principal del navegador.
  window.alert = (message?: any) => {
    void appAlert(String(message ?? ''), { kind: 'info' });
  };
}
