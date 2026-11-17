// Log diagnostics, never provider payloads, documents, names, signatures or credentials.
export function reportOperationalError(event: string, error: unknown, level: 'warn' | 'error' = 'error') {
  let status = NaN, upstreamStatus = NaN, code = '', name = 'Error', sanitizationFailed = false;
  try {
    const value = error as { status?: unknown; upstreamStatus?: unknown; code?: unknown; name?: unknown } | null;
    status = Number(value?.status);
    upstreamStatus = Number(value?.upstreamStatus);
    code = String(value?.code || '');
    name = String(value?.name || 'Error');
  } catch { sanitizationFailed = true; }
  console[level](event, {
    correlationId: globalThis.crypto?.randomUUID?.(),
    status: Number.isInteger(status) && status >= 400 && status < 600 ? status : undefined,
    upstreamStatus: Number.isInteger(upstreamStatus) && upstreamStatus >= 400 && upstreamStatus < 600 ? upstreamStatus : undefined,
    code: /^(?:GMAIL_[A-Z_]{1,80}|VISIT_[A-Z_]{1,80}|AUTH_[A-Z_]{1,80}|PGRST\d{1,5}|HTTP_[45]\d{2}|PT[45]\d{2}|(?:22|23|40|42|55)[0-9A-Z]{3}|P0001|UPSTREAM_NETWORK|UPSTREAM_HTTP|CONFIG_MISSING|INTERNAL)$/.test(code) ? code : undefined,
    errorType: ['TypeError', 'AbortError', 'TimeoutError', 'AuthApiError', 'AuthRetryableFetchError', 'Error'].includes(name) ? name : 'Error',
    ...(sanitizationFailed ? { sanitizationFailed: true } : {}),
  });
}
