/**
 * API Server for AI Chat, EPD Mapping, and Ökobaudat Integration
 * Express server that handles AI requests and proxies Ökobaudat API calls
 */

import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.API_PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ============ Ökobaudat API Configuration ============
const OEKOBAUDAT_BASE_URL = 'https://oekobaudat.de/OEKOBAU.DAT/resource';
const DATASTOCK_UUID = 'cd2bda71-760b-4fcc-8a0b-3877c10000a8';

// EN 15804 compliance UUIDs
const EN_15804_COMPLIANCE = {
  A1: 'b00f9ec0-7874-11e3-981f-0800200c9a66',
  A2: 'c0016b33-8cf7-415c-ac6e-deba0d21440d',
} as const;

// GWP indicator UUIDs
const GWP_INDICATOR_UUIDS = [
  '77e416eb-a363-4258-a04e-171d843a6460', // GWP-total
  'd86b9e8b-6555-11e3-9701-0800200c9a66', // GWP-fossil
  '6a37f984-a4b3-4d53-8a9b-d29a83f8c5e8', // Climate change - total
];

// Material category types
type MaterialCategory = 'CONCRETE' | 'STEEL' | 'WOOD' | 'GLASS' | 'INSULATION' | 'MASONRY' | 'ALUMINUM' | 'GYPSUM' | 'PLASTIC' | 'MEMBRANE' | 'OTHER';
type DeclaredUnit = 'm3' | 'm2' | 'kg' | 'piece' | 'ton' | 'm';

interface EPD {
  id: string;
  name: string;
  manufacturer: string;
  category: MaterialCategory;
  subcategory?: string;
  impacts: {
    gwp: number;
    odp?: number;
    ap?: number;
    ep?: number;
  };
  declaredUnit: {
    value: number;
    unit: DeclaredUnit;
  };
  validUntil: string;
  pcr: string;
  programOperator: string;
  plantLocation?: string;
  keywords: string[];
  dataQuality?: 'specific' | 'average' | 'generic';
}

// Simple in-memory cache for Ökobaudat responses
const oekobaudatCache = new Map<string, { data: EPD[]; timestamp: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

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

// Chat endpoint - uses direct OpenAI API (streaming or non-streaming)
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, context, stream = true } = req.body as {
      messages: { role: 'user' | 'assistant'; content: string }[];
      stream?: boolean;
      context: {
        totalGWP?: number;
        matchedCount?: number;
        unmatchedCount?: number;
        matchingMethod?: 'llm' | 'algorithmic' | 'none';
        materials?: Array<{
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
        }>;
        byCategory?: Record<string, number>;
      } | null;
    };

    if (!process.env.OPENAI_API_KEY) {
      res.status(401).json({ error: 'API key not configured. Set OPENAI_API_KEY environment variable.' });
      return;
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
${context.materials?.map((m) => `- ${m.name} (${m.category}): ${m.gwp?.toFixed(0) || 0} kg CO₂e, ${m.quantity?.toFixed(2) || 0} ${m.unit}, ${m.confidence}% confidence match to "${m.epd}", ${m.elementCount} elements${m.matchReason ? ` [${m.matchReason}]` : ''}${m.alternatives?.length ? `, alternatives: ${m.alternatives.map(a => `${a.name} (${a.gwp} kg CO₂e)`).join(', ')}` : ''}`).join('\n') || 'No materials extracted yet.'}

By category:
${Object.entries(context.byCategory || {}).map(([cat, gwp]) => `- ${cat}: ${(gwp as number).toFixed(0)} kg CO₂e`).join('\n') || 'No category data.'}
`;
    }

    // Prepare messages with system prompt and context
    const allMessages = [
      { role: 'system' as const, content: systemPrompt + '\n\n' + contextMessage },
      ...messages,
    ];

    // Use direct OpenAI API (streaming or non-streaming based on request)
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
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
      res.status(500).json({ error: 'AI service error', details: errorText });
      return;
    }

    // Non-streaming response
    if (!stream) {
      const data = await openaiResponse.json() as {
        choices: Array<{ message: { content: string } }>;
      };
      const content = data.choices?.[0]?.message?.content || '';
      res.json({ content });
      return;
    }

    // Streaming response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reader = openaiResponse.body?.getReader();
    if (!reader) {
      res.status(500).json({ error: 'No response body from OpenAI' });
      return;
    }

    const decoder = new TextDecoder();

    const processStream = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            res.end();
            return;
          }

          const text = decoder.decode(value);
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
                  res.write(`0:${JSON.stringify(content)}\n`);
                }
              } catch {
                // Skip parse errors
              }
            }
          }
        }
      } catch (err) {
        console.error('Stream error:', err);
        res.end();
      }
    };

    processStream();
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

// ============ Ökobaudat API Proxy ============

/**
 * Map ILCD classification to MaterialCategory
 */
function mapToMaterialCategory(classifications: Array<{ class?: Array<{ value?: string }> }> | undefined, name: string): MaterialCategory {
  const classNames = classifications?.flatMap(c => c.class?.map(cl => cl.value?.toLowerCase() || '') || []).join(' ') || '';
  const nameLower = name.toLowerCase();
  const combined = `${classNames} ${nameLower}`;

  if (combined.includes('beton') || combined.includes('concrete') || combined.includes('zement') || combined.includes('cement')) {
    return 'CONCRETE';
  }
  if (combined.includes('stahl') || combined.includes('steel') || combined.includes('eisen') || combined.includes('iron')) {
    return 'STEEL';
  }
  if (combined.includes('holz') || combined.includes('wood') || combined.includes('timber') || combined.includes('lumber') || combined.includes('clt') || combined.includes('glulam')) {
    return 'WOOD';
  }
  if (combined.includes('glas') || combined.includes('glass') || combined.includes('verglasung') || combined.includes('glazing')) {
    return 'GLASS';
  }
  if (combined.includes('dämmstoff') || combined.includes('insulation') || combined.includes('isolier') || combined.includes('eps') || combined.includes('xps') || combined.includes('mineralwolle')) {
    return 'INSULATION';
  }
  if (combined.includes('mauerwerk') || combined.includes('masonry') || combined.includes('ziegel') || combined.includes('brick') || combined.includes('block')) {
    return 'MASONRY';
  }
  if (combined.includes('aluminium') || combined.includes('aluminum')) {
    return 'ALUMINUM';
  }
  if (combined.includes('gips') || combined.includes('gypsum') || combined.includes('putz') || combined.includes('plaster') || combined.includes('trockenbau')) {
    return 'GYPSUM';
  }
  if (combined.includes('kunststoff') || combined.includes('plastic') || combined.includes('polymer') || combined.includes('pvc') || combined.includes('pe ')) {
    return 'PLASTIC';
  }
  if (combined.includes('membran') || combined.includes('membrane') || combined.includes('abdichtung') || combined.includes('dach') || combined.includes('bitumen') || combined.includes('folie')) {
    return 'MEMBRANE';
  }

  return 'OTHER';
}

/**
 * Map unit string to DeclaredUnit
 */
function mapToDeclaredUnit(unit: string | undefined): DeclaredUnit {
  if (!unit) return 'kg';
  const unitLower = unit.toLowerCase();

  if (unitLower.includes('m3') || unitLower.includes('m³') || unitLower === 'cubic metre') return 'm3';
  if (unitLower.includes('m2') || unitLower.includes('m²') || unitLower === 'square metre') return 'm2';
  if (unitLower === 'kg' || unitLower === 'kilogram') return 'kg';
  if (unitLower === 't' || unitLower === 'ton' || unitLower === 'tonne') return 'ton';
  if (unitLower === 'm' || unitLower === 'metre' || unitLower === 'meter') return 'm';
  if (unitLower.includes('piece') || unitLower.includes('stück') || unitLower.includes('unit')) return 'piece';

  return 'kg';
}

/**
 * Extract keywords from name
 */
function extractKeywords(name: string): string[] {
  return name.toLowerCase()
    .split(/[\s,;/()[\]-]+/)
    .filter(w => w.length > 2)
    .slice(0, 15);
}

/**
 * Transform ILCD/soda4LCA response to EPD format
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function transformOekobaudatResponse(processes: any[]): EPD[] {
  return processes.map(proc => {
    // Handle both detailed and list view response formats
    const uuid = proc.uuid || proc.dataSetInformation?.UUID || '';
    const name = proc.name || proc.dataSetInformation?.name?.baseName || 'Unknown';

    // Extract GWP from LCIA results if available
    let gwp = 0;
    if (proc.LCIAResults) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gwpResult = proc.LCIAResults.find((r: any) =>
        GWP_INDICATOR_UUIDS.includes(r.referenceToLCIAMethodDataSet?.['@refObjectId'] || '') ||
        (r.referenceToLCIAMethodDataSet?.shortDescription || '').toLowerCase().includes('gwp') ||
        (r.referenceToLCIAMethodDataSet?.shortDescription || '').toLowerCase().includes('climate')
      );
      if (gwpResult) {
        gwp = parseFloat(gwpResult.meanAmount) || 0;
      }
    }

    // Get declared unit
    let declaredUnitStr = 'kg';
    let declaredUnitValue = 1;
    if (proc.quantitativeReference?.referenceToReferenceFlow) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const refFlow = proc.exchanges?.exchange?.find((e: any) =>
        e['@dataSetInternalID'] === proc.quantitativeReference.referenceToReferenceFlow
      );
      if (refFlow) {
        declaredUnitStr = refFlow.referenceToFlowDataSet?.shortDescription || 'kg';
        declaredUnitValue = parseFloat(refFlow.meanAmount) || 1;
      }
    }

    const classifications = proc.dataSetInformation?.classificationInformation?.classification;

    return {
      id: `oekobaudat-${uuid}`,
      name,
      manufacturer: proc.dataSetInformation?.dataSetOwner?.shortDescription || 'Ökobaudat',
      category: mapToMaterialCategory(classifications, name),
      subcategory: classifications?.[0]?.class?.[0]?.value,
      impacts: {
        gwp,
        odp: 0,
        ap: 0,
        ep: 0,
      },
      declaredUnit: {
        value: declaredUnitValue,
        unit: mapToDeclaredUnit(declaredUnitStr),
      },
      validUntil: proc.time?.dataSetValidUntil || '2030-12-31',
      pcr: 'EN 15804+A2',
      programOperator: 'BMWSB/IBU',
      plantLocation: proc.geography?.locationOfOperationSupplyOrProduction?.['@location'] || 'Germany',
      keywords: extractKeywords(name),
      dataQuality: 'average' as const,
    };
  });
}

// Ökobaudat proxy endpoint
app.post('/api/oekobaudat', async (req, res) => {
  try {
    const { search, compliance = 'A2', pageSize = 100, startIndex = 0 } = req.body as {
      search?: string;
      compliance?: 'A1' | 'A2';
      pageSize?: number;
      startIndex?: number;
    };

    // Build cache key
    const cacheKey = JSON.stringify({ search, compliance, pageSize, startIndex });

    // Check cache
    const cached = oekobaudatCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      console.log('[Ökobaudat Proxy] Returning cached data');
      res.json({ epds: cached.data, totalCount: cached.data.length, cached: true });
      return;
    }

    // Build Ökobaudat API URL
    const url = new URL(`${OEKOBAUDAT_BASE_URL}/datastocks/${DATASTOCK_UUID}/processes`);
    url.searchParams.set('format', 'json');
    url.searchParams.set('search', 'true');
    url.searchParams.set('compliance', EN_15804_COMPLIANCE[compliance]);
    url.searchParams.set('pageSize', pageSize.toString());
    url.searchParams.set('startIndex', startIndex.toString());

    if (search) {
      url.searchParams.set('name', search);
    }

    console.log(`[Ökobaudat Proxy] Fetching: ${url.toString()}`);

    const response = await fetch(url.toString(), {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Ökobaudat Proxy] API error:', response.status, errorText);
      res.status(response.status).json({ error: 'Ökobaudat API error', details: errorText });
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await response.json() as any;

    // Handle different response formats from soda4LCA
    const processes = data.data || data.processes || data.dataSet || (Array.isArray(data) ? data : []);

    if (!processes || processes.length === 0) {
      console.log('[Ökobaudat Proxy] No processes found');
      res.json({ epds: [], totalCount: 0, cached: false });
      return;
    }

    // Transform to EPD format
    const epds = transformOekobaudatResponse(processes);
    console.log(`[Ökobaudat Proxy] Transformed ${epds.length} EPDs`);

    // Cache results
    oekobaudatCache.set(cacheKey, { data: epds, timestamp: Date.now() });

    res.json({
      epds,
      totalCount: data.totalCount || epds.length,
      cached: false,
    });
  } catch (error) {
    console.error('[Ökobaudat Proxy] Error:', error);
    res.status(500).json({ error: 'Internal server error', details: String(error) });
  }
});

// Ökobaudat single process detail endpoint
app.get('/api/oekobaudat/:uuid', async (req, res) => {
  try {
    const { uuid } = req.params;

    const url = `${OEKOBAUDAT_BASE_URL}/processes/${uuid}?format=json`;
    console.log(`[Ökobaudat Proxy] Fetching process: ${url}`);

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      res.status(response.status).json({ error: 'Process not found' });
      return;
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('[Ökobaudat Proxy] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============ EPD Agent Endpoint ============

interface AgentMaterialInfo {
  id: string;
  name: string;
  category: string;
  elementIds: number[];
  totalVolume?: number;
  totalArea?: number;
  properties?: Record<string, unknown>;
}

interface AgentCurrentMatch {
  epdId: string;
  epdName: string;
  confidence: number;
  gwp: number;
  calculatedGWP: number;
}

interface AgentEPDProposal {
  id: string;
  material_id: string;
  material_name: string;
  current_epd_id?: string;
  current_epd_name?: string;
  current_gwp?: number;
  proposed_epd_id: string;
  proposed_epd_name: string;
  proposed_gwp: number;
  gwp_difference: number;
  gwp_difference_percent: number;
  confidence: number;
  reasoning: string;
  key_benefits: string[];
  status: 'pending' | 'accepted' | 'rejected';
}

// Mock EPD database for agent (subset)
const agentMockEPDs: Record<string, {
  id: string;
  name: string;
  category: string;
  gwp: number;
  unit: string;
  fire_rating?: string;
  recycled_content?: number;
  use_cases: string[];
  suitable_for: string[];
}> = {
  'mock-concrete-001': { id: 'mock-concrete-001', name: 'Ready-Mix Concrete C30/37', category: 'CONCRETE', gwp: 285, unit: 'm3', fire_rating: 'REI 120', recycled_content: 5, use_cases: ['structural'], suitable_for: ['wall', 'slab', 'column'] },
  'mock-concrete-002': { id: 'mock-concrete-002', name: 'Low-Carbon Concrete C30/37 (CEM III)', category: 'CONCRETE', gwp: 165, unit: 'm3', fire_rating: 'REI 120', recycled_content: 35, use_cases: ['structural', 'sustainable'], suitable_for: ['wall', 'slab', 'column'] },
  'mock-concrete-003': { id: 'mock-concrete-003', name: 'High-Strength Concrete C50/60', category: 'CONCRETE', gwp: 380, unit: 'm3', fire_rating: 'REI 120', recycled_content: 3, use_cases: ['structural', 'high-rise'], suitable_for: ['column', 'beam'] },
  'mock-steel-001': { id: 'mock-steel-001', name: 'Structural Steel S355', category: 'STEEL', gwp: 1.85, unit: 'kg', recycled_content: 25, use_cases: ['structural'], suitable_for: ['beam', 'column'] },
  'mock-steel-002': { id: 'mock-steel-002', name: 'Recycled Steel S355 (EAF)', category: 'STEEL', gwp: 0.65, unit: 'kg', recycled_content: 95, use_cases: ['structural', 'sustainable'], suitable_for: ['beam', 'column'] },
  'mock-wood-001': { id: 'mock-wood-001', name: 'Cross-Laminated Timber (CLT)', category: 'WOOD', gwp: -680, unit: 'm3', fire_rating: 'REI 60', use_cases: ['structural', 'sustainable'], suitable_for: ['wall', 'slab', 'roof'] },
  'mock-wood-002': { id: 'mock-wood-002', name: 'Glulam Beam GL24h', category: 'WOOD', gwp: -720, unit: 'm3', fire_rating: 'R 60', use_cases: ['structural'], suitable_for: ['beam', 'column'] },
  'mock-insulation-001': { id: 'mock-insulation-001', name: 'Mineral Wool (Stone Wool)', category: 'INSULATION', gwp: 1.12, unit: 'kg', fire_rating: 'A1', recycled_content: 25, use_cases: ['thermal-insulation', 'fire-protection'], suitable_for: ['wall', 'roof'] },
  'mock-insulation-003': { id: 'mock-insulation-003', name: 'Wood Fiber Insulation', category: 'INSULATION', gwp: -0.85, unit: 'kg', use_cases: ['thermal-insulation', 'sustainable'], suitable_for: ['wall', 'roof'] },
  'mock-glass-001': { id: 'mock-glass-001', name: 'Triple Glazing Unit (Argon)', category: 'GLASS', gwp: 32, unit: 'm2', recycled_content: 20, use_cases: ['glazing', 'energy-efficient'], suitable_for: ['window', 'facade'] },
  'mock-gypsum-001': { id: 'mock-gypsum-001', name: 'Gypsum Board (Standard)', category: 'GYPSUM', gwp: 2.8, unit: 'm2', fire_rating: 'EI 30', recycled_content: 25, use_cases: ['interior', 'partition'], suitable_for: ['wall', 'ceiling'] },
  'mock-aluminum-002': { id: 'mock-aluminum-002', name: 'Recycled Aluminum Profile', category: 'ALUMINUM', gwp: 2.1, unit: 'kg', recycled_content: 75, use_cases: ['facade', 'sustainable'], suitable_for: ['window', 'facade'] },
};

// Agent tool definitions
const agentToolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'query_building_elements',
      description: 'Query building elements from the loaded IFC model. Returns a summary of elements grouped by type and material.',
      parameters: {
        type: 'object',
        properties: {
          element_type: { type: 'string', enum: ['wall', 'slab', 'column', 'beam', 'window', 'door', 'roof', 'stair', 'railing', 'all'] },
          include_properties: { type: 'boolean' },
        },
        required: ['element_type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_epd_database',
      description: 'Search the EPD database with specific criteria. Returns matching EPDs sorted by relevance.',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: ['CONCRETE', 'STEEL', 'WOOD', 'GLASS', 'INSULATION', 'MASONRY', 'ALUMINUM', 'GYPSUM', 'PLASTIC', 'MEMBRANE'] },
          gwp_max: { type: 'number' },
          use_case: { type: 'string', enum: ['structural', 'facade', 'interior', 'foundation', 'thermal-insulation', 'fire-protection', 'sustainable'] },
          suitable_for: { type: 'string', enum: ['wall', 'slab', 'column', 'beam', 'roof', 'window', 'facade', 'ceiling'] },
          recycled_content_min: { type: 'number' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_epd_details',
      description: 'Get full details for a specific EPD.',
      parameters: {
        type: 'object',
        properties: { epd_id: { type: 'string' } },
        required: ['epd_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_epd_mapping',
      description: 'Propose a new EPD mapping for a material.',
      parameters: {
        type: 'object',
        properties: {
          material_id: { type: 'string' },
          proposed_epd_id: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 100 },
          reasoning: { type: 'string' },
          key_benefits: { type: 'array', items: { type: 'string' } },
        },
        required: ['material_id', 'proposed_epd_id', 'confidence', 'reasoning'],
      },
    },
  },
];

// Agent tool handlers
function handleAgentQueryElements(materials: AgentMaterialInfo[], matches: Record<string, AgentCurrentMatch>): string {
  if (materials.length === 0) return 'No materials extracted from IFC model.';

  let output = '=== Building Materials ===\n\n';
  const byCategory: Record<string, AgentMaterialInfo[]> = {};
  materials.forEach(m => {
    const cat = m.category || 'OTHER';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(m);
  });

  for (const [category, mats] of Object.entries(byCategory)) {
    output += `📦 ${category}:\n`;
    for (const mat of mats) {
      const match = matches[mat.id];
      output += `  • ${mat.name} (${mat.id})\n`;
      output += `    Elements: ${mat.elementIds.length}`;
      if (mat.totalVolume) output += ` | Volume: ${mat.totalVolume.toFixed(2)} m³`;
      output += '\n';
      if (match) {
        output += `    Current EPD: ${match.epdName} (${match.confidence}% conf)\n`;
        output += `    GWP: ${match.calculatedGWP.toFixed(0)} kg CO₂e\n`;
      }
    }
    output += '\n';
  }
  return output;
}

function handleAgentSearchEPD(args: { category?: string; gwp_max?: number; use_case?: string; suitable_for?: string; recycled_content_min?: number }): string {
  const results = Object.values(agentMockEPDs).filter(epd => {
    if (args.category && epd.category !== args.category) return false;
    if (args.gwp_max && epd.gwp > args.gwp_max) return false;
    if (args.use_case && !epd.use_cases.includes(args.use_case)) return false;
    if (args.suitable_for && !epd.suitable_for.includes(args.suitable_for)) return false;
    if (args.recycled_content_min && (epd.recycled_content || 0) < args.recycled_content_min) return false;
    return true;
  }).sort((a, b) => a.gwp - b.gwp);

  if (results.length === 0) return 'No EPDs found matching criteria.';

  return results.map((epd, i) =>
    `${i + 1}. [${epd.id}] ${epd.name}\n   GWP: ${epd.gwp} kg CO₂e/${epd.unit}${epd.fire_rating ? ` | Fire: ${epd.fire_rating}` : ''}${epd.recycled_content ? ` | Recycled: ${epd.recycled_content}%` : ''}`
  ).join('\n\n');
}

function handleAgentProposal(
  args: { material_id: string; proposed_epd_id: string; confidence: number; reasoning: string; key_benefits?: string[] },
  materials: AgentMaterialInfo[],
  matches: Record<string, AgentCurrentMatch>
): { result: string; proposal?: AgentEPDProposal } {
  const material = materials.find(m => m.id === args.material_id);
  if (!material) return { result: `Material "${args.material_id}" not found.` };

  const epd = agentMockEPDs[args.proposed_epd_id];
  if (!epd) return { result: `EPD "${args.proposed_epd_id}" not found.` };

  const currentMatch = matches[args.material_id];
  const quantity = material.totalVolume || material.totalArea || 1;
  const proposedGWP = epd.gwp * quantity;
  const currentGWP = currentMatch?.calculatedGWP || 0;
  const gwpDiff = proposedGWP - currentGWP;
  const gwpDiffPercent = currentGWP > 0 ? (gwpDiff / currentGWP) * 100 : 0;

  const proposal: AgentEPDProposal = {
    id: `proposal-${Date.now()}`,
    material_id: args.material_id,
    material_name: material.name,
    current_epd_id: currentMatch?.epdId,
    current_epd_name: currentMatch?.epdName,
    current_gwp: currentGWP,
    proposed_epd_id: args.proposed_epd_id,
    proposed_epd_name: epd.name,
    proposed_gwp: proposedGWP,
    gwp_difference: gwpDiff,
    gwp_difference_percent: gwpDiffPercent,
    confidence: args.confidence,
    reasoning: args.reasoning,
    key_benefits: args.key_benefits || [],
    status: 'pending',
  };

  return {
    result: `✅ Proposal created for "${material.name}"\nProposed: ${epd.name}\nGWP change: ${gwpDiff >= 0 ? '+' : ''}${gwpDiff.toFixed(0)} kg CO₂e (${gwpDiffPercent >= 0 ? '+' : ''}${gwpDiffPercent.toFixed(1)}%)`,
    proposal,
  };
}

// EPD Agent endpoint
app.post('/api/epd-agent', async (req, res) => {
  try {
    const { message, materials, currentMatches, conversationHistory = [] } = req.body as {
      message: string;
      materials: AgentMaterialInfo[];
      currentMatches: Record<string, AgentCurrentMatch>;
      conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
    };

    if (!process.env.OPENAI_API_KEY) {
      res.status(401).json({ error: 'API key not configured' });
      return;
    }

    // Build context summary
    let contextSummary = '';
    if (materials && materials.length > 0) {
      contextSummary = `\n\nCurrent building has ${materials.length} materials:\n`;
      contextSummary += materials.map(m =>
        `- ${m.name} (${m.category}): ${m.elementIds.length} elements${m.totalVolume ? `, ${m.totalVolume.toFixed(1)} m³` : ''}`
      ).join('\n');
    }

    const agentSystemPrompt = `You are an expert EPD (Environmental Product Declaration) matching agent for building Life Cycle Assessment.

Your role is to help users find the most appropriate EPDs for their building materials by:
1. Understanding the building's materials and their properties
2. Searching the EPD database with specific technical criteria
3. Comparing options and recommending the best matches
4. Creating proposals for improved EPD mappings

IMPORTANT GUIDELINES:
- Always start by querying the building elements to understand what materials exist
- Consider technical requirements like fire rating, strength class, etc.
- Prioritize lower GWP options when they meet technical requirements
- Explain your reasoning clearly when making proposals
- Create proposals using propose_epd_mapping for each recommended change

Be concise but thorough. Focus on actionable recommendations.`;

    const messages: Array<{ role: string; content: string; tool_call_id?: string; tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }> }> = [
      { role: 'system', content: agentSystemPrompt + contextSummary },
      ...conversationHistory.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: message },
    ];

    const proposals: AgentEPDProposal[] = [];
    const toolResults: Array<{ tool: string; result: string }> = [];

    // Agent loop - max 5 iterations
    for (let i = 0; i < 5; i++) {
      const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages,
          tools: agentToolDefinitions,
          tool_choice: 'auto',
        }),
      });

      if (!openaiResponse.ok) {
        const error = await openaiResponse.text();
        console.error('[EPD Agent] OpenAI error:', error);
        res.status(500).json({ error: 'OpenAI API error', details: error });
        return;
      }

      const data = await openaiResponse.json() as {
        choices: Array<{
          message: {
            role: string;
            content: string | null;
            tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
          };
          finish_reason: string;
        }>;
      };

      const choice = data.choices[0];
      const assistantMessage = choice.message;

      messages.push(assistantMessage as typeof messages[0]);

      // Execute tool calls if any
      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        for (const toolCall of assistantMessage.tool_calls) {
          const toolName = toolCall.function.name;
          const toolArgs = JSON.parse(toolCall.function.arguments);

          console.log(`[EPD Agent] Executing tool: ${toolName}`, toolArgs);

          let result: string;
          let proposal: AgentEPDProposal | undefined;

          switch (toolName) {
            case 'query_building_elements':
              result = handleAgentQueryElements(materials, currentMatches);
              break;
            case 'search_epd_database':
              result = handleAgentSearchEPD(toolArgs);
              break;
            case 'get_epd_details': {
              const epd = agentMockEPDs[toolArgs.epd_id];
              result = epd
                ? `=== ${epd.name} ===\nID: ${epd.id}\nCategory: ${epd.category}\nGWP: ${epd.gwp} kg CO₂e/${epd.unit}\n${epd.fire_rating ? `Fire Rating: ${epd.fire_rating}\n` : ''}${epd.recycled_content ? `Recycled: ${epd.recycled_content}%\n` : ''}Use Cases: ${epd.use_cases.join(', ')}`
                : 'EPD not found.';
              break;
            }
            case 'propose_epd_mapping': {
              const proposalResult = handleAgentProposal(toolArgs, materials, currentMatches);
              result = proposalResult.result;
              proposal = proposalResult.proposal;
              break;
            }
            default:
              result = `Unknown tool: ${toolName}`;
          }

          if (proposal) {
            proposals.push(proposal);
          }

          toolResults.push({ tool: toolName, result });

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: result,
          });
        }
      } else {
        // No more tool calls - return final response
        res.json({
          response: assistantMessage.content,
          proposals,
          toolResults,
        });
        return;
      }
    }

    // Max iterations reached
    res.json({
      response: 'I\'ve analyzed the building and created my recommendations. Please review the proposals above.',
      proposals,
      toolResults,
    });
  } catch (error) {
    console.error('[EPD Agent] Error:', error);
    res.status(500).json({ error: 'Internal server error', details: String(error) });
  }
});

// Health check
app.get('/api/health', (_, res) => {
  res.json({
    status: 'ok',
    hasApiKey: !!process.env.OPENAI_API_KEY,
    oekobaudatCacheEntries: oekobaudatCache.size,
  });
});

app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
  console.log('✅ Ökobaudat API proxy enabled');
  console.log('✅ EPD Agent endpoint enabled');
  if (!process.env.OPENAI_API_KEY) {
    console.warn('⚠️  OPENAI_API_KEY not set - chat will not work');
  }
});
