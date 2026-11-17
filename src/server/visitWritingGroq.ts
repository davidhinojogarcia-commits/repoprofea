import { writingError, type WritingInput } from '../lib/visitWriting.js';

export const visitGroqReady = () => !!process.env.GROQ_API_KEY?.trim();
export const visitGroqModel = () => process.env.VISIT_WRITING_GROQ_MODEL?.trim() || 'openai/gpt-oss-20b';

export async function generateVisitWritingGroq(input: WritingInput, instruction: string): Promise<unknown> {
  if (!visitGroqReady()) throw writingError('El servidor no dispone de una credencial de IA. Tu texto se conserva.', 503, 'VISIT_WRITING_NOT_CONFIGURED');
  let status = 0;
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(25000),
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY!.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: visitGroqModel(), stream: false, max_completion_tokens: 7000, reasoning_effort: 'low',
        messages: [{ role: 'system', content: instruction }, { role: 'user', content: JSON.stringify({ mode: input.mode, title: input.title, text: input.text }) }],
        response_format: { type: 'json_schema', json_schema: { name: 'visit_writing', strict: true, schema: {
          type: 'object', additionalProperties: false, required: ['points', 'warnings'], properties: {
            points: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'description'], properties: { title: { type: 'string' }, description: { type: 'string' } } } },
            warnings: { type: 'array', items: { type: 'string' } }
          }
        } } }
      })
    });
    status = response.status;
    // Never read or log provider error bodies, which can contain private data.
    if (!response.ok) { await response.body?.cancel(); throw new Error('Provider'); }
    const data = await response.json();
    const choice = data?.choices?.[0], content = choice?.message?.content;
    if (choice?.finish_reason !== 'stop' || typeof content !== 'string' || content.length > 40000) throw new Error('Incomplete');
    return JSON.parse(content);
  } catch {
    if (status === 401 || status === 403) throw writingError('La credencial de IA no permite generar propuestas. Tu texto se conserva.', 503, 'VISIT_WRITING_AUTH_REQUIRED');
    if (status === 402) throw writingError('La cuenta de IA no permite esta solicitud. Revisa el plan gratuito; tu texto se conserva.', 503, 'VISIT_WRITING_QUOTA');
    if (status === 429) throw writingError('Se ha alcanzado el límite temporal de IA. Espera y vuelve a intentarlo; tu texto se conserva.', 429, 'VISIT_WRITING_RATE_LIMIT');
    throw writingError('La IA no pudo completar la propuesta. El original se conserva; puedes continuar manualmente.', 502, 'VISIT_WRITING_PROVIDER_FAILED');
  }
}
