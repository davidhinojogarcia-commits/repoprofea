// Log diagnostics, never provider payloads, documents, names, signatures or credentials.
export function reportOperationalError(event: string, error: unknown, level: 'warn' | 'error' = 'error') {
  const value = error as { status?: unknown; code?: unknown; name?: unknown } | null;
  const status = Number(value?.status);
  const code = String(value?.code || '');
  console[level](event, {
    correlationId: globalThis.crypto?.randomUUID?.(),
    status: Number.isInteger(status) && status >= 400 && status < 600 ? status : undefined,
    code: /^(?:GMAIL_[A-Z_]+|PGRST\d+|HTTP_\d+)$/.test(code) ? code : undefined,
    errorType: ['TypeError', 'AbortError', 'Error'].includes(String(value?.name)) ? value?.name : 'Error',
  });
}
