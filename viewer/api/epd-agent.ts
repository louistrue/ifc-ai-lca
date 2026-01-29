/**
 * Vercel Serverless Function for EPD Agent
 * Handles intelligent EPD matching using LLM with tool calling
 *
 * The agent can:
 * - Query building elements from IFC data
 * - Search and compare EPDs from the database
 * - Propose EPD mappings with detailed reasoning
 */

export const config = {
  runtime: 'edge',
  maxDuration: 60, // Allow longer execution for agent loops
};

// ============ Types ============

interface MaterialInfo {
  id: string;
  name: string;
  category: string;
  elementIds: number[];
  totalVolume?: number;
  totalArea?: number;
  properties?: Record<string, unknown>;
}

interface CurrentMatch {
  epdId: string;
  epdName: string;
  confidence: number;
  gwp: number;
  calculatedGWP: number;
}

interface EPDProposal {
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

interface AgentRequest {
  message: string;
  materials: MaterialInfo[];
  currentMatches: Record<string, CurrentMatch>;
  buildingInfo?: {
    name?: string;
    storeys?: string[];
    totalElements?: number;
  };
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

// ============ Tool Definitions ============

const toolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'query_building_elements',
      description: 'Query building elements from the loaded IFC model. Returns a summary of elements grouped by type and material.',
      parameters: {
        type: 'object',
        properties: {
          element_type: {
            type: 'string',
            enum: ['wall', 'slab', 'column', 'beam', 'window', 'door', 'roof', 'stair', 'railing', 'all'],
            description: 'Type of element to query. Use "all" to get a summary of all elements.',
          },
          include_properties: {
            type: 'boolean',
            description: 'Whether to include detailed properties for each element group.',
          },
        },
        required: ['element_type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_material_details',
      description: 'Get detailed information about a specific material in the building, including its current EPD match.',
      parameters: {
        type: 'object',
        properties: {
          material_id: {
            type: 'string',
            description: 'The material ID.',
          },
        },
        required: ['material_id'],
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
          category: {
            type: 'string',
            enum: ['CONCRETE', 'STEEL', 'WOOD', 'GLASS', 'INSULATION', 'MASONRY', 'ALUMINUM', 'GYPSUM', 'PLASTIC', 'MEMBRANE'],
            description: 'Material category to search in.',
          },
          gwp_max: { type: 'number', description: 'Maximum GWP in kg CO₂e per declared unit.' },
          fire_rating_min: { type: 'string', description: 'Minimum fire rating required (e.g., "REI 60").' },
          strength_class: { type: 'string', description: 'Strength class like "C30/37".' },
          use_case: {
            type: 'string',
            enum: ['structural', 'facade', 'interior', 'foundation', 'thermal-insulation', 'fire-protection', 'sustainable'],
          },
          suitable_for: {
            type: 'string',
            enum: ['wall', 'slab', 'column', 'beam', 'roof', 'window', 'facade', 'ceiling'],
          },
          keywords: { type: 'array', items: { type: 'string' } },
          recycled_content_min: { type: 'number' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_epd_details',
      description: 'Get full details for a specific EPD including all impacts and technical properties.',
      parameters: {
        type: 'object',
        properties: {
          epd_id: { type: 'string', description: 'The EPD ID.' },
        },
        required: ['epd_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'compare_epds',
      description: 'Compare multiple EPDs side by side.',
      parameters: {
        type: 'object',
        properties: {
          epd_ids: { type: 'array', items: { type: 'string' }, description: 'EPD IDs to compare (2-4).' },
        },
        required: ['epd_ids'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_epd_mapping',
      description: 'Propose a new EPD mapping for a material. Creates a proposal for the user to accept/reject.',
      parameters: {
        type: 'object',
        properties: {
          material_id: { type: 'string' },
          proposed_epd_id: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 100 },
          reasoning: { type: 'string', description: 'Detailed explanation.' },
          key_benefits: { type: 'array', items: { type: 'string' } },
        },
        required: ['material_id', 'proposed_epd_id', 'confidence', 'reasoning'],
      },
    },
  },
];

// ============ Mock EPD Data (subset for serverless) ============

const mockEPDs: Record<string, {
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
  'mock-steel-003': { id: 'mock-steel-003', name: 'Reinforcing Steel (Rebar)', category: 'STEEL', gwp: 0.76, unit: 'kg', recycled_content: 85, use_cases: ['reinforcement'], suitable_for: ['slab', 'wall', 'beam'] },
  'mock-wood-001': { id: 'mock-wood-001', name: 'Cross-Laminated Timber (CLT)', category: 'WOOD', gwp: -680, unit: 'm3', fire_rating: 'REI 60', use_cases: ['structural', 'sustainable'], suitable_for: ['wall', 'slab', 'roof'] },
  'mock-wood-002': { id: 'mock-wood-002', name: 'Glulam Beam GL24h', category: 'WOOD', gwp: -720, unit: 'm3', fire_rating: 'R 60', use_cases: ['structural'], suitable_for: ['beam', 'column'] },
  'mock-insulation-001': { id: 'mock-insulation-001', name: 'Mineral Wool (Stone Wool)', category: 'INSULATION', gwp: 1.12, unit: 'kg', fire_rating: 'A1', recycled_content: 25, use_cases: ['thermal-insulation', 'fire-protection'], suitable_for: ['wall', 'roof'] },
  'mock-insulation-003': { id: 'mock-insulation-003', name: 'Wood Fiber Insulation', category: 'INSULATION', gwp: -0.85, unit: 'kg', use_cases: ['thermal-insulation', 'sustainable'], suitable_for: ['wall', 'roof'] },
  'mock-glass-001': { id: 'mock-glass-001', name: 'Triple Glazing Unit (Argon)', category: 'GLASS', gwp: 32, unit: 'm2', recycled_content: 20, use_cases: ['glazing', 'energy-efficient'], suitable_for: ['window', 'facade'] },
  'mock-gypsum-001': { id: 'mock-gypsum-001', name: 'Gypsum Board (Standard)', category: 'GYPSUM', gwp: 2.8, unit: 'm2', fire_rating: 'EI 30', recycled_content: 25, use_cases: ['interior', 'partition'], suitable_for: ['wall', 'ceiling'] },
  'mock-gypsum-002': { id: 'mock-gypsum-002', name: 'Fire-Rated Gypsum Board (F)', category: 'GYPSUM', gwp: 3.5, unit: 'm2', fire_rating: 'EI 60', recycled_content: 20, use_cases: ['interior', 'fire-protection'], suitable_for: ['wall', 'ceiling'] },
  'mock-aluminum-001': { id: 'mock-aluminum-001', name: 'Aluminum Profile (Primary)', category: 'ALUMINUM', gwp: 8.5, unit: 'kg', recycled_content: 30, use_cases: ['facade', 'window-frame'], suitable_for: ['window', 'facade'] },
  'mock-aluminum-002': { id: 'mock-aluminum-002', name: 'Recycled Aluminum Profile', category: 'ALUMINUM', gwp: 2.1, unit: 'kg', recycled_content: 75, use_cases: ['facade', 'sustainable'], suitable_for: ['window', 'facade'] },
  'mock-masonry-001': { id: 'mock-masonry-001', name: 'Clay Brick (Facing)', category: 'MASONRY', gwp: 0.21, unit: 'kg', fire_rating: 'REI 90', use_cases: ['facade', 'masonry'], suitable_for: ['wall', 'facade'] },
};

// ============ Tool Handlers ============

function handleQueryElements(args: { element_type: string }, materials: MaterialInfo[], matches: Record<string, CurrentMatch>): string {
  if (materials.length === 0) return 'No materials extracted from IFC model.';

  let output = '=== Building Materials ===\n\n';

  const byCategory: Record<string, MaterialInfo[]> = {};
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

function handleSearchEPD(args: { category?: string; gwp_max?: number; fire_rating_min?: string; use_case?: string; suitable_for?: string; recycled_content_min?: number }): string {
  const results = Object.values(mockEPDs).filter(epd => {
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

function handleGetEPD(args: { epd_id: string }): string {
  const epd = mockEPDs[args.epd_id];
  if (!epd) return `EPD "${args.epd_id}" not found.`;

  return `=== ${epd.name} ===
ID: ${epd.id}
Category: ${epd.category}
GWP: ${epd.gwp} kg CO₂e/${epd.unit}
${epd.fire_rating ? `Fire Rating: ${epd.fire_rating}` : ''}
${epd.recycled_content ? `Recycled Content: ${epd.recycled_content}%` : ''}
Use Cases: ${epd.use_cases.join(', ')}
Suitable For: ${epd.suitable_for.join(', ')}`;
}

function handleCompare(args: { epd_ids: string[] }): string {
  const epds = args.epd_ids.map(id => mockEPDs[id]).filter(Boolean);
  if (epds.length < 2) return 'Need at least 2 valid EPDs to compare.';

  let output = '=== EPD Comparison ===\n\n';
  output += 'Property'.padEnd(25) + epds.map(e => e.name.substring(0, 20)).join(' | ') + '\n';
  output += '-'.repeat(25 + epds.length * 23) + '\n';
  output += 'GWP (kg CO₂e)'.padEnd(25) + epds.map(e => String(e.gwp).padEnd(20)).join(' | ') + '\n';
  output += 'Unit'.padEnd(25) + epds.map(e => e.unit.padEnd(20)).join(' | ') + '\n';
  output += 'Fire Rating'.padEnd(25) + epds.map(e => (e.fire_rating || 'N/A').padEnd(20)).join(' | ') + '\n';
  output += 'Recycled %'.padEnd(25) + epds.map(e => String(e.recycled_content || 0).padEnd(20)).join(' | ') + '\n';

  const lowest = epds.reduce((min, e) => e.gwp < min.gwp ? e : min);
  output += `\n💡 Lowest GWP: ${lowest.name} (${lowest.gwp} kg CO₂e/${lowest.unit})`;

  return output;
}

function handleProposal(
  args: { material_id: string; proposed_epd_id: string; confidence: number; reasoning: string; key_benefits?: string[] },
  materials: MaterialInfo[],
  matches: Record<string, CurrentMatch>
): { result: string; proposal?: EPDProposal } {
  const material = materials.find(m => m.id === args.material_id);
  if (!material) return { result: `Material "${args.material_id}" not found.` };

  const epd = mockEPDs[args.proposed_epd_id];
  if (!epd) return { result: `EPD "${args.proposed_epd_id}" not found.` };

  const currentMatch = matches[args.material_id];
  const quantity = material.totalVolume || material.totalArea || 1;
  const proposedGWP = epd.gwp * quantity;
  const currentGWP = currentMatch?.calculatedGWP || 0;
  const gwpDiff = proposedGWP - currentGWP;
  const gwpDiffPercent = currentGWP > 0 ? (gwpDiff / currentGWP) * 100 : 0;

  const proposal: EPDProposal = {
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

function executeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  materials: MaterialInfo[],
  matches: Record<string, CurrentMatch>
): { result: string; proposal?: EPDProposal } {
  switch (toolName) {
    case 'query_building_elements':
      return { result: handleQueryElements(args as { element_type: string }, materials, matches) };
    case 'get_material_details': {
      const mat = materials.find(m => m.id === (args as { material_id: string }).material_id);
      if (!mat) return { result: `Material not found.` };
      const match = matches[mat.id];
      return { result: `${mat.name} (${mat.category})\nElements: ${mat.elementIds.length}\n${mat.totalVolume ? `Volume: ${mat.totalVolume.toFixed(2)} m³\n` : ''}${match ? `Current EPD: ${match.epdName}\nGWP: ${match.calculatedGWP.toFixed(0)} kg CO₂e` : 'No EPD matched'}` };
    }
    case 'search_epd_database':
      return { result: handleSearchEPD(args as { category?: string }) };
    case 'get_epd_details':
      return { result: handleGetEPD(args as { epd_id: string }) };
    case 'compare_epds':
      return { result: handleCompare(args as { epd_ids: string[] }) };
    case 'propose_epd_mapping':
      return handleProposal(args as { material_id: string; proposed_epd_id: string; confidence: number; reasoning: string }, materials, matches);
    default:
      return { result: `Unknown tool: ${toolName}` };
  }
}

// ============ System Prompt ============

const systemPrompt = `You are an expert EPD (Environmental Product Declaration) matching agent for building Life Cycle Assessment.

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

When the user asks to "match EPDs" or "find better EPDs":
1. First query_building_elements to see all materials
2. For each material, search_epd_database with appropriate criteria
3. Compare top options if needed
4. Create propose_epd_mapping for your recommendations

Be concise but thorough. Focus on actionable recommendations.`;

// ============ Main Handler ============

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'API key not configured' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body: AgentRequest = await req.json();
    const { message, materials, currentMatches, buildingInfo, conversationHistory = [] } = body;

    // Build context summary for system prompt
    let contextSummary = '';
    if (materials.length > 0) {
      contextSummary = `\n\nCurrent building has ${materials.length} materials:\n`;
      contextSummary += materials.map(m =>
        `- ${m.name} (${m.category}): ${m.elementIds.length} elements${m.totalVolume ? `, ${m.totalVolume.toFixed(1)} m³` : ''}`
      ).join('\n');
    }

    const messages: Array<{ role: string; content: string; tool_call_id?: string; tool_calls?: ToolCall[] }> = [
      { role: 'system', content: systemPrompt + contextSummary },
      ...conversationHistory,
      { role: 'user', content: message },
    ];

    const proposals: EPDProposal[] = [];
    const toolResults: Array<{ tool: string; result: string }> = [];

    // Agent loop - max 5 iterations
    for (let i = 0; i < 5; i++) {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages,
          tools: toolDefinitions,
          tool_choice: 'auto',
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        return new Response(JSON.stringify({ error: 'OpenAI API error', details: error }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const data = await response.json() as {
        choices: Array<{
          message: {
            role: string;
            content: string | null;
            tool_calls?: ToolCall[];
          };
          finish_reason: string;
        }>;
      };

      const choice = data.choices[0];
      const assistantMessage = choice.message;

      // Add assistant message to history
      messages.push(assistantMessage as { role: string; content: string; tool_calls?: ToolCall[] });

      // Check if we need to execute tools
      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        for (const toolCall of assistantMessage.tool_calls) {
          const toolName = toolCall.function.name;
          const toolArgs = JSON.parse(toolCall.function.arguments);

          console.log(`[Agent] Executing tool: ${toolName}`, toolArgs);

          const { result, proposal } = executeToolCall(toolName, toolArgs, materials, currentMatches);

          if (proposal) {
            proposals.push(proposal);
          }

          toolResults.push({ tool: toolName, result });

          // Add tool result to messages
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: result,
          });
        }
      } else {
        // No more tool calls, we have the final response
        return new Response(JSON.stringify({
          response: assistantMessage.content,
          proposals,
          toolResults,
          conversationHistory: messages.slice(1), // Exclude system prompt
        }), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }
    }

    // Max iterations reached
    return new Response(JSON.stringify({
      response: 'I\'ve analyzed the building and created my recommendations. Please review the proposals above.',
      proposals,
      toolResults,
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('[Agent] Error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', details: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
