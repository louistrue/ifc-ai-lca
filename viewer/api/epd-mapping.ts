/**
 * Vercel Serverless Function for LLM-based EPD Mapping
 * Uses fast LLM (GPT-4o-mini) to match building materials to EPDs
 */

export const config = {
  runtime: 'edge',
};

interface Material {
  id: string;
  name: string;
  category: string;
  totalVolume?: number;
  totalArea?: number;
  totalWeight?: number;
  properties?: Record<string, unknown>;
}

interface EPDSummary {
  id: string;
  name: string;
  category: string;
  subcategory?: string;
  keywords: string[];
  gwp: number;
  unit: string;
}

interface EPDMapping {
  materialName: string;
  epdId: string;
  confidence: number;
  reasoning: string;
}

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { materials, epdDatabase } = await req.json() as {
      materials: Material[];
      epdDatabase: EPDSummary[];
    };

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'API key not configured. Set OPENAI_API_KEY environment variable.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!materials || materials.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No materials provided' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
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

Respond with a JSON object containing a "mappings" array. For each material, provide:
- materialName: the original material name
- epdId: the best matching EPD ID from the database
- confidence: 0-100 score (100 = perfect match, 50 = reasonable guess, <30 = poor match)
- reasoning: brief explanation (max 20 words)

Example format:
{"mappings": [
  {"materialName": "Concrete Wall", "epdId": "epd-concrete-001", "confidence": 85, "reasoning": "Direct match to ready-mix concrete"}
]}

IMPORTANT:
- Only use EPD IDs that exist in the database above
- If no good match exists, use the closest category match with lower confidence
- Be precise - "CLT Panel" should match CLT-specific EPD, not generic wood`;

    // Use OpenAI for fast inference
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are an EPD matching expert. Respond only with valid JSON.' },
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
      return new Response(
        JSON.stringify({ error: 'LLM API error', details: errorText }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const openaiData = await openaiResponse.json() as {
      choices: Array<{ message: { content: string } }>;
    };
    const content = openaiData.choices[0]?.message?.content || '{"mappings": []}';

    // Parse the JSON response
    let mappings: EPDMapping[];

    try {
      const parsed = JSON.parse(content);
      mappings = Array.isArray(parsed) ? parsed : parsed.mappings || [];
    } catch (parseError) {
      console.error('Failed to parse LLM response:', content);
      return new Response(
        JSON.stringify({ error: 'Failed to parse LLM response' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ mappings, model: 'gpt-4o-mini' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('EPD Mapping API error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
