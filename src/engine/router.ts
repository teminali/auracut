import { ContextEnvelope } from '../types/context';

const GROQ_KEY = process.env.GROQ_API_KEY || '';
const ROUTER_MODEL = 'qwen/qwen3.8-27b';

export type RouteDecision = 'helper' | 'heavy';

export async function routeIntent(prompt: string, context?: ContextEnvelope): Promise<{ route: RouteDecision; reason: string; error?: string }> {
  try {
    const payload = {
      model: ROUTER_MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a routing agent for a video editor Copilot. Analyze the user request. If it is a simple editing task (cutting, muting, basic text, basic colors), output {"route":"helper", "reason":"..."}. If it is a complex task (writing scripts, deep analysis, complex expressions, multi-step logic), output {"route":"heavy", "reason":"..."}. Output JSON only.',
        },
        {
          role: 'user',
          content: prompt,
        }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.0,
      max_tokens: 100,
    };

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Groq returned ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('No content from Groq');

    const parsed = JSON.parse(content);
    return {
      route: parsed.route === 'heavy' ? 'heavy' : 'helper',
      reason: parsed.reason || '',
    };
  } catch (err) {
    console.error('Routing failed, falling back to heavy model', err);
    // Fail-safe: if Groq fails, fallback to heavy
    return { route: 'heavy', reason: 'Fallback due to helper error', error: (err as Error).message };
  }
}
