/**
 * Vercel Serverless Function for AI Chat
 * Handles chat requests using direct OpenAI API for reliability
 */

export const config = {
  runtime: 'edge',
};

// System prompt for LCA analysis
const systemPrompt = `You are an expert Life Cycle Assessment (LCA) assistant for buildings.
You help users understand the environmental impact of their building materials by analyzing
IFC models and matching them with Environmental Product Declarations (EPDs).

Key behaviors:
- Explain GWP (Global Warming Potential) in simple terms
- Highlight materials with highest impact
- Suggest lower-carbon alternatives when asked
- Be precise with numbers and units (kg CO₂e, m³, etc.)
- Keep responses concise but informative
- When discussing materials, mention their matched EPD confidence level
- Negative GWP values indicate carbon-storing materials (like wood)
- Note if AI-powered EPD matching was used (higher accuracy) vs algorithmic matching

You will receive context about the building's materials, their quantities, matched EPDs,
and calculated environmental impacts. Use this context to provide accurate, specific advice.`;

interface Material {
  name: string;
  category: string;
  gwp: number;
  confidence: number;
  epd: string;
  quantity: number;
  unit: string;
  elementCount: number;
  matchReason?: string;
  alternatives?: { name: string; gwp: number }[];
}

interface LCAContext {
  totalGWP?: number;
  matchedCount?: number;
  unmatchedCount?: number;
  matchingMethod?: 'llm' | 'algorithmic' | 'none';
  materials?: Material[];
  byCategory?: Record<string, number>;
}

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { messages, context, stream = true } = await req.json() as {
      messages: { role: 'user' | 'assistant'; content: string }[];
      context: LCAContext | null;
      stream?: boolean;
    };

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'API key not configured. Set OPENAI_API_KEY environment variable.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Build context message
    let contextMessage = '';
    if (context) {
      const matchingInfo = context.matchingMethod === 'llm'
        ? '(AI-powered matching with GPT-4o-mini)'
        : context.matchingMethod === 'algorithmic'
        ? '(algorithmic keyword matching)'
        : '';

      contextMessage = `
Current Building Analysis ${matchingInfo}:
- Total GWP: ${context.totalGWP?.toFixed(0) || 0} kg CO₂e
- Matched materials: ${context.matchedCount || 0}
- Unmatched materials: ${context.unmatchedCount || 0}

Materials breakdown:
${context.materials?.map((m) =>
  `- ${m.name} (${m.category}): ${m.gwp?.toFixed(0) || 0} kg CO₂e, ${m.quantity?.toFixed(2) || 0} ${m.unit}, ${m.confidence}% confidence match to "${m.epd}", ${m.elementCount} elements${m.matchReason ? ` [${m.matchReason}]` : ''}${m.alternatives?.length ? `, alternatives: ${m.alternatives.map(a => `${a.name} (${a.gwp} kg CO₂e)`).join(', ')}` : ''}`
).join('\n') || 'No materials extracted yet.'}

By category:
${Object.entries(context.byCategory || {}).map(([cat, gwp]) => `- ${cat}: ${(gwp as number).toFixed(0)} kg CO₂e`).join('\n') || 'No category data.'}
`;
    }

    // Prepare messages for OpenAI
    const allMessages = [
      { role: 'system', content: systemPrompt + '\n\n' + contextMessage },
      ...messages,
    ];

    // Use direct OpenAI API (streaming or non-streaming based on request)
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: allMessages,
        stream: stream,
      }),
    });

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text();
      console.error('OpenAI API error:', errorText);
      return new Response(
        JSON.stringify({ error: 'AI service error', details: errorText }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Non-streaming response
    if (!stream) {
      const data = await openaiResponse.json() as {
        choices: Array<{ message: { content: string } }>;
      };
      const content = data.choices?.[0]?.message?.content || '';
      return new Response(
        JSON.stringify({ content }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Streaming response - Transform OpenAI stream to Vercel AI SDK format
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const transformStream = new TransformStream({
      async transform(chunk, controller) {
        const text = decoder.decode(chunk);
        const lines = text.split('\n').filter(line => line.trim() !== '');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              continue;
            }
            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                controller.enqueue(encoder.encode(`0:${JSON.stringify(content)}\n`));
              }
            } catch {
              // Skip parse errors
            }
          }
        }
      },
    });

    return new Response(
      openaiResponse.body?.pipeThrough(transformStream),
      {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      }
    );
  } catch (error) {
    console.error('Chat API error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: String(error) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
