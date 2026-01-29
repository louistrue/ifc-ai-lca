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

// EPD Mapping endpoint - uses fast LLM to match materials to EPDs
app.post('/api/epd-mapping', async (req, res) => {
  try {
    const { materials, epdDatabase } = req.body as {
      materials: Array<{
        id: string;
        name: string;
        category: string;
        totalVolume?: number;
        totalArea?: number;
        totalWeight?: number;
        properties?: Record<string, unknown>;
      }>;
      epdDatabase: Array<{
        id: string;
        name: string;
        category: string;
        subcategory?: string;
        keywords: string[];
        gwp: number;
        unit: string;
      }>;
    };

    if (!process.env.OPENAI_API_KEY) {
      res.status(401).json({ error: 'API key not configured. Set OPENAI_API_KEY environment variable.' });
      return;
    }

    if (!materials || materials.length === 0) {
      res.status(400).json({ error: 'No materials provided' });
      return;
    }

    // Build EPD summary for LLM context
    const epdSummary = epdDatabase.map(epd =>
      `- ${epd.id}: "${epd.name}" (${epd.category}${epd.subcategory ? '/' + epd.subcategory : ''}) - GWP: ${epd.gwp} kg CO₂e/${epd.unit}, keywords: [${epd.keywords.join(', ')}]`
    ).join('\n');

    // Build materials list
    const materialsList = materials.map(m =>
      `- "${m.name}" (detected category: ${m.category}, volume: ${m.totalVolume?.toFixed(2) || 'N/A'} m³, area: ${m.totalArea?.toFixed(2) || 'N/A'} m²)`
    ).join('\n');

    const mappingPrompt = `You are an expert in construction materials and Environmental Product Declarations (EPDs).

Match each material to the most appropriate EPD from the database. Consider:
1. Material type and composition
2. Category alignment (CONCRETE, STEEL, WOOD, GLASS, INSULATION, MASONRY, ALUMINUM, GYPSUM, PLASTIC, MEMBRANE)
3. Subcategory specificity (e.g., "Ready Mix" vs "Precast" for concrete)
4. Keywords and technical specifications

EPD Database:
${epdSummary}

Materials to match:
${materialsList}

Respond with a JSON array of mappings. For each material, provide:
- materialName: the original material name
- epdId: the best matching EPD ID from the database
- confidence: 0-100 score (100 = perfect match, 50 = reasonable guess, <30 = poor match)
- reasoning: brief explanation (max 20 words)

Example format:
[
  {"materialName": "Concrete Wall", "epdId": "epd-concrete-001", "confidence": 85, "reasoning": "Direct match to ready-mix concrete"}
]

IMPORTANT:
- Only use EPD IDs that exist in the database above
- If no good match exists, use the closest category match with lower confidence
- Be precise - "CLT Panel" should match CLT-specific EPD, not generic wood`;

    // Use OpenAI for fast inference
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are an EPD matching expert. Respond only with valid JSON arrays.' },
          { role: 'user', content: mappingPrompt }
        ],
        temperature: 0.1,
        max_tokens: 2000,
        response_format: { type: 'json_object' }
      }),
    });

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text();
      console.error('OpenAI API error:', errorText);
      res.status(500).json({ error: 'LLM API error', details: errorText });
      return;
    }

    const openaiData = await openaiResponse.json() as {
      choices: Array<{ message: { content: string } }>;
    };
    const content = openaiData.choices[0]?.message?.content || '[]';

    // Parse the JSON response
    let mappings: Array<{
      materialName: string;
      epdId: string;
      confidence: number;
      reasoning: string;
    }>;

    try {
      const parsed = JSON.parse(content);
      mappings = Array.isArray(parsed) ? parsed : parsed.mappings || [];
    } catch (parseError) {
      console.error('Failed to parse LLM response:', content);
      res.status(500).json({ error: 'Failed to parse LLM response' });
      return;
    }

    res.json({ mappings, model: 'gpt-4o-mini' });
  } catch (error) {
    console.error('EPD Mapping API error:', error);
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
