/**
 * API Server for AI Chat
 * Simple Express server that handles chat requests using Vercel AI SDK
 */

import express from 'express';
import cors from 'cors';
import { streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

const app = express();
const PORT = process.env.API_PORT || 3001;

app.use(cors());
app.use(express.json());

// Create OpenAI provider - will use OPENAI_API_KEY from environment
const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

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

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, context } = req.body;

    if (!process.env.OPENAI_API_KEY) {
      res.status(401).json({ error: 'API key not configured. Set OPENAI_API_KEY environment variable.' });
      return;
    }

    // Build context message
    let contextMessage = '';
    if (context) {
      contextMessage = `
Current Building Analysis:
- Total GWP: ${context.totalGWP?.toFixed(0) || 0} kg CO₂e
- Matched materials: ${context.matchedCount || 0}
- Unmatched materials: ${context.unmatchedCount || 0}

Materials breakdown:
${context.materials?.map((m: {
  name: string;
  category: string;
  gwp: number;
  confidence: number;
  epd: string;
  quantity: number;
  unit: string;
  elementCount: number;
  alternatives?: { name: string; gwp: number }[];
}) => `- ${m.name} (${m.category}): ${m.gwp?.toFixed(0) || 0} kg CO₂e, ${m.quantity?.toFixed(2) || 0} ${m.unit}, ${m.confidence}% confidence match to "${m.epd}", ${m.elementCount} elements${m.alternatives?.length ? `, alternatives: ${m.alternatives.map(a => `${a.name} (${a.gwp} kg CO₂e)`).join(', ')}` : ''}`).join('\n') || 'No materials extracted yet.'}

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

    // Set headers for streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Stream chunks to client
    const stream = result.toDataStream();
    const reader = stream.getReader();

    const sendChunk = async () => {
      try {
        const { done, value } = await reader.read();
        if (done) {
          res.end();
          return;
        }
        res.write(new TextDecoder().decode(value));
        sendChunk();
      } catch (err) {
        console.error('Stream error:', err);
        res.end();
      }
    };

    sendChunk();
  } catch (error) {
    console.error('Chat API error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Health check
app.get('/api/health', (_, res) => {
  res.json({ status: 'ok', hasApiKey: !!process.env.OPENAI_API_KEY });
});

app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
  if (!process.env.OPENAI_API_KEY) {
    console.warn('⚠️  OPENAI_API_KEY not set - chat will not work');
  }
});
