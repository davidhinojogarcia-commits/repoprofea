import { defaultGeneratedForemanTemplate, type ForemanSignatureTemplate } from './foremanSignatureTemplate';
/** These documents must never request the foreman's independent signature. */
export const FOREMAN_SIGNATURE_EXCLUDED_TYPES = ['inicio', 'control_presencia', 'contrato', 'prorroga'] as const;
export function allowsForemanSignature(documentType: unknown): boolean {
  return typeof documentType === 'string' && documentType.length > 0 &&
    !(FOREMAN_SIGNATURE_EXCLUDED_TYPES as readonly string[]).includes(documentType);
}
export function enabledForemanTemplate(document: { documentType: string; details?: Record<string, any> }) {
  return effectiveForemanTemplate(document.documentType,document.details?.foremanSignatureTemplate,
    document.details?.originalPdfMode==='overlay');
}
/** Native models already have a known foreman cell. Missing configuration must
 * never hide the signing panel; an explicit supervisor override still wins.
 * Imported originals require their own verified box, never a guessed position.
 */
export function effectiveForemanTemplate(documentType:string,configured?:ForemanSignatureTemplate|null,original=false):ForemanSignatureTemplate|undefined {
  if(!allowsForemanSignature(documentType))return undefined;
  if(configured)return configured.enabled?configured:undefined;
  if(original||!['epis','formacion','maquinaria','autorizacion_uso_maquinaria','control_horario'].includes(documentType))return undefined;
  return {...defaultGeneratedForemanTemplate(documentType+':modelo-institucional'),enabled:true,required:true};
}
