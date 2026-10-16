/** These documents must never request the foreman's independent signature. */
export const FOREMAN_SIGNATURE_EXCLUDED_TYPES = ['inicio', 'control_presencia', 'contrato', 'prorroga'] as const;
export function allowsForemanSignature(documentType: unknown): boolean {
  return typeof documentType === 'string' && documentType.length > 0 &&
    !(FOREMAN_SIGNATURE_EXCLUDED_TYPES as readonly string[]).includes(documentType);
}
export function enabledForemanTemplate(document: { documentType: string; details?: Record<string, any> }) {
  return allowsForemanSignature(document.documentType) && document.details?.foremanSignatureTemplate?.enabled
    ? document.details.foremanSignatureTemplate : undefined;
}
