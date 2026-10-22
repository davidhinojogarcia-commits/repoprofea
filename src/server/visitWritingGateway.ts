import { writingError, type WritingInput, type WritingProposal } from '../lib/visitWriting.js';
import { getVercelOidcTokenSync } from '@vercel/oidc';

// The deployed project authenticates with its short-lived Vercel OIDC identity.
// A Gateway key is optional for explicitly configured local/non-Vercel runtimes.
export function visitGatewayReady() {
  if (process.env.AI_GATEWAY_API_KEY?.trim()) return true;
  // On deployed functions OIDC can arrive through the trusted request context.
  // The synchronous accessor neither refreshes credentials nor calls a provider.
  try { return !!getVercelOidcTokenSync()?.trim(); } catch { return false; }
}
export const visitGatewayModel = () => process.env.VISIT_WRITING_GATEWAY_MODEL?.trim() || 'openai/gpt-5.4-mini';

export async function generateVisitWritingGateway(input: WritingInput, instruction: string): Promise<unknown> {
  if (!visitGatewayReady()) throw writingError('El servidor no dispone de una credencial de IA. Debe activarse la autenticación de Vercel; tu texto se conserva.', 503, 'VISIT_WRITING_NOT_CONFIGURED');
  try {
    const { createGateway, generateText, Output, jsonSchema } = await import('ai');
    const gateway = createGateway({ apiKey: process.env.AI_GATEWAY_API_KEY?.trim() || undefined });
    const schema = jsonSchema<WritingProposal>({
      type: 'object', additionalProperties: false, required: ['points', 'warnings'],
      properties: {
        points: { type: 'array', minItems: 1, maxItems: input.mode === 'written' ? 1 : 30, items: {
          type: 'object', additionalProperties: false, required: ['title', 'description'], properties: {
            title: { type: 'string', maxLength: 200 }, description: { type: 'string', minLength: 1, maxLength: 20000 }
          }
        } },
        warnings: { type: 'array', maxItems: 10, items: { type: 'string', minLength: 1, maxLength: 500 } }
      }
    });
    const result = await generateText({
      model: gateway(visitGatewayModel()), system: instruction, prompt: JSON.stringify(input),
      output: Output.object({ schema }), maxOutputTokens: 7000, maxRetries: 0,
      reasoning: 'none', abortSignal: AbortSignal.timeout(25000),
      // Never relax retention or fall back to the direct Gemini integration.
      providerOptions: { gateway: { zeroDataRetention: true, only: ['openai', 'azure'] } }
    });
    if (result.finishReason !== 'stop' || JSON.stringify(result.output).length > 40000) throw new Error('Incomplete');
    return result.output;
  } catch (error: unknown) {
    // Return only fixed messages/codes; SDK errors can contain text and credentials.
    const status = error && typeof error === 'object' && 'statusCode' in error ? Number(error.statusCode) : 0;
    if (status === 402) throw writingError('El servicio de IA no tiene saldo disponible o ha alcanzado su límite de gasto. Tu texto se conserva.', 503, 'VISIT_WRITING_QUOTA');
    const name = error instanceof Error ? error.name : '';
    if (status === 401 || status === 403 || name === 'GatewayAuthenticationError' || name === 'GatewayError') throw writingError('La cuenta de IA necesita activar o revisar su autorización en Vercel. Tu texto se conserva.', 503, 'VISIT_WRITING_AUTH_REQUIRED');
    if (status === 429) throw writingError('El servicio de IA está ocupado. Espera un minuto; tu texto se conserva.', 429, 'VISIT_WRITING_RATE_LIMIT');
    throw writingError('La IA no pudo completar la propuesta. El original se conserva; puedes continuar manualmente.', 502, 'VISIT_WRITING_PROVIDER_FAILED');
  }
}
