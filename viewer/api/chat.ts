/**
 * Vercel Serverless Function for AI Chat
 * Handles chat requests using Vercel AI SDK
 */

import { streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

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
  alternatives?: { name: string; gwp: number }[];
}

interface LCAContext {
  totalGWP?: number;
  matchedCount?: number;
  unmatchedCount?: number;
  materials?: Material[];
  byCategory?: Record<string, number>;
}

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { messages, context } = await req.json() as {
      messages: { role: 'user' | 'assistant'; content: string }[];
      context: LCAContext | null;
    };

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'API key not configured. Set OPENAI_API_KEY environment variable.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const openai = createOpenAI({ apiKey });

    // Build context message
    let contextMessage = '';
    if (context) {
      contextMessage = `
Current Building Analysis:
- Total GWP: ${context.totalGWP?.toFixed(0) || 0} kg CO₂e
- Matched materials: ${context.matchedCount || 0}
- Unmatched materials: ${context.unmatchedCount || 0}

Materials breakdown:
${context.materials?.map((m) =>
  `- ${m.name} (${m.category}): ${m.gwp?.toFixed(0) || 0} kg CO₂e, ${m.quantity?.toFixed(2) || 0} ${m.unit}, ${m.confidence}% confidence match to "${m.epd}", ${m.elementCount} elements${m.alternatives?.length ? `, alternatives: ${m.alternatives.map(a => `${a.name} (${a.gwp} kg CO₂e)`).join(', ')}` : ''}`
).join('\n') || 'No materials extracted yet.'}

By category:
${Object.entries(context.byCategory || {}).map(([cat, gwp]) => `- ${cat}: ${(gwp as number).toFixed(0)} kg CO₂e`).join('\n') || 'No category data.'}
`;
    }

    // Prepare messages with system prompt and context
    const allMessages = [
      { role: 'system' as const, content: systemPrompt + '\n\n' + contextMessage },
      ...messages,
    ];

    // Stream the response
    const result = streamText({
      model: openai('gpt-4o-mini'),
      messages: allMessages,
    });

    // Return streaming response
    return result.toDataStreamResponse();
  } catch (error) {
    console.error('Chat API error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
