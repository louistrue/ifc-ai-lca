/**
 * Vercel Serverless Function for EPD Agent
 * Handles intelligent EPD matching using LLM with tool calling
 *
 * The agent has full access to model context including:
 * - Project info (element counts, spatial structure)
 * - Materials with element type breakdowns
 * - Quantities (volume, area, weight) per material
 * - Element properties and spatial locations
 * - Current EPD mappings with GWP values
 *
 * Tools enable the agent to:
 * - Query and filter model data intelligently
 * - Search EPD database with technical criteria
 * - Propose EPD mappings with detailed reasoning
 */

export const config = {
  runtime: 'edge',
  maxDuration: 60,
};

// ============ Types ============

interface MaterialSummary {
  id: string;
  name: string;
  category: string;
  totalVolume: number;
  totalArea: number;
  totalWeight: number | null;
  elementCount: number;
  elementTypes: Record<string, number>;
  commonProperties?: {
    thicknesses?: number[];
    fireRatings?: string[];
    strengthClasses?: string[];
  };
  currentEpd?: {
    id: string;
    name: string;
    gwp: number;
    confidence: number;
    calculatedGwp: number;
  };
}

interface StoreySummary {
  id: number;
  name: string;
  elevation: number;
  elementCount: number;
  materialBreakdown: Record<string, number>;
}

interface ModelSummary {
  project: {
    name: string;
    elementCount: number;
    buildingCount: number;
    storeyCount: number;
    totalVolume: number;
  };
  materials: MaterialSummary[];
  storeys: StoreySummary[];
  lca?: {
    totalGwp: number;
    gwpByCategory: Record<string, number>;
  };
}

interface ElementDetail {
  id: number;
  type: string;
  name: string;
  description?: string;
  volume?: number;
  area?: number;
  weight?: number;
  storeyId?: number;
  storeyName?: string;
  properties: Record<string, string | number | boolean>;
}

interface ElementIndex {
  id: number;
  type: string;
  name: string;
  materialId: string | null;
  storeyId: number | null;
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
  modelContext: ModelSummary;
  elementIndex?: ElementIndex[];
  elementDetails?: Record<string, ElementDetail[]>; // Pre-fetched details keyed by materialId
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
      name: 'get_model_overview',
      description: 'Get a comprehensive overview of the building model including project info, material summary, and spatial structure.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_material_details',
      description: 'Get detailed information about a specific material including element types, quantities, properties, and current EPD match.',
      parameters: {
        type: 'object',
        properties: {
          material_id: {
            type: 'string',
            description: 'The material ID to get details for.',
          },
        },
        required: ['material_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_elements_for_material',
      description: 'Get detailed element information for a specific material, including individual element properties, quantities, and spatial locations.',
      parameters: {
        type: 'object',
        properties: {
          material_id: {
            type: 'string',
            description: 'The material ID.',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of elements to return (default 20).',
          },
        },
        required: ['material_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_spatial_breakdown',
      description: 'Get materials and elements grouped by building storey for spatial analysis.',
      parameters: {
        type: 'object',
        properties: {
          storey_name: {
            type: 'string',
            description: 'Optional: filter to a specific storey by name (partial match).',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_high_impact_elements',
      description: 'Get the elements with highest environmental impact (GWP contribution), useful for identifying optimization priorities.',
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Maximum number of elements to return (default 10).',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_epd_database',
      description: 'Search the EPD database with specific criteria. Returns matching EPDs sorted by GWP (lowest first).',
      parameters: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: ['CONCRETE', 'STEEL', 'WOOD', 'GLASS', 'INSULATION', 'MASONRY', 'ALUMINUM', 'GYPSUM', 'PLASTIC', 'MEMBRANE'],
            description: 'Material category to search in.',
          },
          gwp_max: {
            type: 'number',
            description: 'Maximum GWP in kg CO₂e per declared unit.',
          },
          keywords: {
            type: 'array',
            items: { type: 'string' },
            description: 'Keywords to match in EPD name/description.',
          },
          use_case: {
            type: 'string',
            enum: ['structural', 'facade', 'interior', 'foundation', 'thermal-insulation', 'fire-protection', 'sustainable'],
            description: 'Intended use case.',
          },
          suitable_for: {
            type: 'string',
            enum: ['wall', 'slab', 'column', 'beam', 'roof', 'window', 'facade', 'ceiling'],
            description: 'Element type the EPD should be suitable for.',
          },
          recycled_content_min: {
            type: 'number',
            description: 'Minimum recycled content percentage.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_epd_details',
      description: 'Get full details for a specific EPD including all environmental impacts and technical properties.',
      parameters: {
        type: 'object',
        properties: {
          epd_id: {
            type: 'string',
            description: 'The EPD ID.',
          },
        },
        required: ['epd_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'compare_epds',
      description: 'Compare multiple EPDs side by side to help select the best option.',
      parameters: {
        type: 'object',
        properties: {
          epd_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'EPD IDs to compare (2-4 EPDs).',
          },
        },
        required: ['epd_ids'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_epd_mapping',
      description: 'Propose a new EPD mapping for a material. Creates a proposal for the user to accept or reject.',
      parameters: {
        type: 'object',
        properties: {
          material_id: {
            type: 'string',
            description: 'The material ID to map.',
          },
          proposed_epd_id: {
            type: 'string',
            description: 'The EPD ID to propose.',
          },
          confidence: {
            type: 'number',
            minimum: 0,
            maximum: 100,
            description: 'Confidence level (0-100) based on technical match quality.',
          },
          reasoning: {
            type: 'string',
            description: 'Detailed explanation of why this EPD is appropriate, referencing element types, properties, and use cases.',
          },
          key_benefits: {
            type: 'array',
            items: { type: 'string' },
            description: 'Key benefits of this EPD choice (e.g., "42% lower GWP", "Matches fire rating requirement").',
          },
        },
        required: ['material_id', 'proposed_epd_id', 'confidence', 'reasoning'],
      },
    },
  },
];

// ============ Mock EPD Database ============

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
  keywords: string[];
}> = {
  'epd-concrete-001': { id: 'epd-concrete-001', name: 'Ready-Mix Concrete C30/37', category: 'CONCRETE', gwp: 285, unit: 'm3', fire_rating: 'REI 120', recycled_content: 5, use_cases: ['structural'], suitable_for: ['wall', 'slab', 'column'], keywords: ['concrete', 'c30', 'standard'] },
  'epd-concrete-002': { id: 'epd-concrete-002', name: 'Low-Carbon Concrete C30/37 (CEM III)', category: 'CONCRETE', gwp: 165, unit: 'm3', fire_rating: 'REI 120', recycled_content: 35, use_cases: ['structural', 'sustainable'], suitable_for: ['wall', 'slab', 'column'], keywords: ['concrete', 'c30', 'low-carbon', 'cem3', 'sustainable'] },
  'epd-concrete-003': { id: 'epd-concrete-003', name: 'High-Strength Concrete C50/60', category: 'CONCRETE', gwp: 380, unit: 'm3', fire_rating: 'REI 120', recycled_content: 3, use_cases: ['structural'], suitable_for: ['column', 'beam'], keywords: ['concrete', 'c50', 'high-strength'] },
  'epd-concrete-004': { id: 'epd-concrete-004', name: 'Recycite ECO Concrete C25/30', category: 'CONCRETE', gwp: 145, unit: 'm3', fire_rating: 'REI 90', recycled_content: 50, use_cases: ['structural', 'sustainable'], suitable_for: ['wall', 'slab'], keywords: ['concrete', 'recycled', 'eco', 'sustainable'] },
  'epd-steel-001': { id: 'epd-steel-001', name: 'Structural Steel S355 (BF-BOF)', category: 'STEEL', gwp: 1.85, unit: 'kg', recycled_content: 25, use_cases: ['structural'], suitable_for: ['beam', 'column'], keywords: ['steel', 's355', 'structural'] },
  'epd-steel-002': { id: 'epd-steel-002', name: 'Recycled Steel S355 (EAF)', category: 'STEEL', gwp: 0.65, unit: 'kg', recycled_content: 95, use_cases: ['structural', 'sustainable'], suitable_for: ['beam', 'column'], keywords: ['steel', 's355', 'recycled', 'eaf', 'sustainable'] },
  'epd-steel-003': { id: 'epd-steel-003', name: 'Reinforcing Steel (Rebar)', category: 'STEEL', gwp: 0.76, unit: 'kg', recycled_content: 85, use_cases: ['reinforcement'], suitable_for: ['slab', 'wall', 'beam'], keywords: ['steel', 'rebar', 'reinforcement'] },
  'epd-wood-001': { id: 'epd-wood-001', name: 'Cross-Laminated Timber (CLT)', category: 'WOOD', gwp: -680, unit: 'm3', fire_rating: 'REI 60', use_cases: ['structural', 'sustainable'], suitable_for: ['wall', 'slab', 'roof'], keywords: ['wood', 'clt', 'timber', 'mass-timber', 'sustainable'] },
  'epd-wood-002': { id: 'epd-wood-002', name: 'Glulam Beam GL24h', category: 'WOOD', gwp: -720, unit: 'm3', fire_rating: 'R 60', use_cases: ['structural'], suitable_for: ['beam', 'column'], keywords: ['wood', 'glulam', 'beam', 'timber'] },
  'epd-wood-003': { id: 'epd-wood-003', name: 'Softwood Lumber (FSC)', category: 'WOOD', gwp: -450, unit: 'm3', use_cases: ['framing', 'sustainable'], suitable_for: ['wall', 'roof'], keywords: ['wood', 'lumber', 'softwood', 'fsc'] },
  'epd-insulation-001': { id: 'epd-insulation-001', name: 'Mineral Wool (Stone Wool)', category: 'INSULATION', gwp: 1.12, unit: 'kg', fire_rating: 'A1', recycled_content: 25, use_cases: ['thermal-insulation', 'fire-protection'], suitable_for: ['wall', 'roof'], keywords: ['insulation', 'mineral', 'wool', 'stone', 'fire-resistant'] },
  'epd-insulation-002': { id: 'epd-insulation-002', name: 'EPS Insulation Board', category: 'INSULATION', gwp: 3.4, unit: 'kg', use_cases: ['thermal-insulation'], suitable_for: ['wall', 'roof', 'slab'], keywords: ['insulation', 'eps', 'polystyrene', 'foam'] },
  'epd-insulation-003': { id: 'epd-insulation-003', name: 'Wood Fiber Insulation', category: 'INSULATION', gwp: -0.85, unit: 'kg', use_cases: ['thermal-insulation', 'sustainable'], suitable_for: ['wall', 'roof'], keywords: ['insulation', 'wood', 'fiber', 'natural', 'sustainable'] },
  'epd-glass-001': { id: 'epd-glass-001', name: 'Triple Glazing Unit (Argon)', category: 'GLASS', gwp: 32, unit: 'm2', recycled_content: 20, use_cases: ['glazing'], suitable_for: ['window', 'facade'], keywords: ['glass', 'triple', 'glazing', 'argon'] },
  'epd-glass-002': { id: 'epd-glass-002', name: 'Double Glazing Low-E', category: 'GLASS', gwp: 24, unit: 'm2', recycled_content: 15, use_cases: ['glazing'], suitable_for: ['window', 'facade'], keywords: ['glass', 'double', 'low-e', 'glazing'] },
  'epd-gypsum-001': { id: 'epd-gypsum-001', name: 'Gypsum Board (Standard)', category: 'GYPSUM', gwp: 2.8, unit: 'm2', fire_rating: 'EI 30', recycled_content: 25, use_cases: ['interior'], suitable_for: ['wall', 'ceiling'], keywords: ['gypsum', 'drywall', 'plasterboard'] },
  'epd-gypsum-002': { id: 'epd-gypsum-002', name: 'Fire-Rated Gypsum Board (F)', category: 'GYPSUM', gwp: 3.5, unit: 'm2', fire_rating: 'EI 60', recycled_content: 20, use_cases: ['interior', 'fire-protection'], suitable_for: ['wall', 'ceiling'], keywords: ['gypsum', 'fire-rated', 'fireproof'] },
  'epd-aluminum-001': { id: 'epd-aluminum-001', name: 'Aluminum Profile (Primary)', category: 'ALUMINUM', gwp: 8.5, unit: 'kg', recycled_content: 30, use_cases: ['facade'], suitable_for: ['window', 'facade'], keywords: ['aluminum', 'profile', 'facade'] },
  'epd-aluminum-002': { id: 'epd-aluminum-002', name: 'Recycled Aluminum Profile', category: 'ALUMINUM', gwp: 2.1, unit: 'kg', recycled_content: 75, use_cases: ['facade', 'sustainable'], suitable_for: ['window', 'facade'], keywords: ['aluminum', 'recycled', 'sustainable'] },
  'epd-masonry-001': { id: 'epd-masonry-001', name: 'Clay Brick (Facing)', category: 'MASONRY', gwp: 0.21, unit: 'kg', fire_rating: 'REI 90', use_cases: ['facade'], suitable_for: ['wall', 'facade'], keywords: ['brick', 'clay', 'masonry', 'facing'] },
  'epd-masonry-002': { id: 'epd-masonry-002', name: 'Concrete Block (CMU)', category: 'MASONRY', gwp: 0.12, unit: 'kg', fire_rating: 'REI 120', use_cases: ['structural', 'facade'], suitable_for: ['wall'], keywords: ['block', 'cmu', 'concrete', 'masonry'] },
};

// ============ Tool Handlers ============

function handleGetModelOverview(context: ModelSummary): string {
  const { project, materials, storeys, lca } = context;

  let output = `=== MODEL OVERVIEW ===\n\n`;
  output += `📊 PROJECT: ${project.name}\n`;
  output += `   Elements: ${project.elementCount.toLocaleString()}\n`;
  output += `   Buildings: ${project.buildingCount} | Storeys: ${project.storeyCount}\n`;
  output += `   Total Volume: ${project.totalVolume.toFixed(1)} m³\n\n`;

  if (lca) {
    output += `🌍 CURRENT LCA RESULTS:\n`;
    output += `   Total GWP: ${lca.totalGwp.toLocaleString()} kg CO₂e\n`;
    output += `   By Category:\n`;
    for (const [cat, gwp] of Object.entries(lca.gwpByCategory).sort((a, b) => b[1] - a[1])) {
      output += `     • ${cat}: ${gwp.toLocaleString()} kg CO₂e\n`;
    }
    output += '\n';
  }

  output += `📦 MATERIALS (${materials.length}):\n`;
  for (const mat of materials.sort((a, b) => (b.currentEpd?.calculatedGwp || 0) - (a.currentEpd?.calculatedGwp || 0))) {
    output += `\n   ${mat.name} [${mat.id}]\n`;
    output += `     Category: ${mat.category}\n`;
    output += `     Elements: ${mat.elementCount}`;
    if (mat.totalVolume > 0) output += ` | Volume: ${mat.totalVolume.toFixed(2)} m³`;
    if (mat.totalArea > 0) output += ` | Area: ${mat.totalArea.toFixed(2)} m²`;
    output += '\n';

    // Element type breakdown
    const types = Object.entries(mat.elementTypes);
    if (types.length > 0) {
      output += `     Used in: ${types.map(([t, c]) => `${t} (${c})`).join(', ')}\n`;
    }

    if (mat.currentEpd) {
      output += `     Current EPD: ${mat.currentEpd.name} (${mat.currentEpd.confidence}% conf)\n`;
      output += `     GWP: ${mat.currentEpd.calculatedGwp.toLocaleString()} kg CO₂e\n`;
    } else {
      output += `     ⚠️ No EPD matched\n`;
    }
  }

  if (storeys.length > 0) {
    output += `\n🏢 SPATIAL STRUCTURE:\n`;
    for (const storey of storeys) {
      output += `   ${storey.name} (elev: ${storey.elevation}m): ${storey.elementCount} elements\n`;
    }
  }

  return output;
}

function handleGetMaterialDetails(
  args: { material_id: string },
  context: ModelSummary,
  elementDetails?: Record<string, ElementDetail[]>
): string {
  const mat = context.materials.find(m => m.id === args.material_id);
  if (!mat) return `Material "${args.material_id}" not found. Available materials: ${context.materials.map(m => m.id).join(', ')}`;

  let output = `=== ${mat.name} ===\n\n`;
  output += `ID: ${mat.id}\n`;
  output += `Category: ${mat.category}\n\n`;

  output += `📏 QUANTITIES:\n`;
  output += `   Elements: ${mat.elementCount}\n`;
  if (mat.totalVolume > 0) output += `   Total Volume: ${mat.totalVolume.toFixed(3)} m³\n`;
  if (mat.totalArea > 0) output += `   Total Area: ${mat.totalArea.toFixed(2)} m²\n`;
  if (mat.totalWeight) output += `   Total Weight: ${mat.totalWeight.toFixed(1)} kg\n`;

  output += `\n🧱 ELEMENT TYPES:\n`;
  for (const [type, count] of Object.entries(mat.elementTypes)) {
    output += `   • ${type}: ${count} elements\n`;
  }

  if (mat.commonProperties) {
    output += `\n📋 COMMON PROPERTIES:\n`;
    if (mat.commonProperties.thicknesses?.length) {
      output += `   Thicknesses: ${mat.commonProperties.thicknesses.map(t => `${t}mm`).join(', ')}\n`;
    }
    if (mat.commonProperties.fireRatings?.length) {
      output += `   Fire Ratings: ${mat.commonProperties.fireRatings.join(', ')}\n`;
    }
    if (mat.commonProperties.strengthClasses?.length) {
      output += `   Strength Classes: ${mat.commonProperties.strengthClasses.join(', ')}\n`;
    }
  }

  if (mat.currentEpd) {
    output += `\n🏷️ CURRENT EPD:\n`;
    output += `   Name: ${mat.currentEpd.name}\n`;
    output += `   ID: ${mat.currentEpd.id}\n`;
    output += `   GWP: ${mat.currentEpd.gwp} kg CO₂e/unit\n`;
    output += `   Confidence: ${mat.currentEpd.confidence}%\n`;
    output += `   Calculated GWP: ${mat.currentEpd.calculatedGwp.toLocaleString()} kg CO₂e\n`;
  } else {
    output += `\n⚠️ NO EPD MATCHED - Needs mapping!\n`;
  }

  // Include sample elements if available
  const elements = elementDetails?.[mat.id];
  if (elements && elements.length > 0) {
    output += `\n📍 SAMPLE ELEMENTS (${Math.min(elements.length, 5)} of ${mat.elementCount}):\n`;
    for (const elem of elements.slice(0, 5)) {
      output += `   • ${elem.name} (${elem.type})`;
      if (elem.storeyName) output += ` @ ${elem.storeyName}`;
      if (elem.volume) output += ` | ${elem.volume.toFixed(3)} m³`;
      output += '\n';
      // Show key properties
      const props = Object.entries(elem.properties).slice(0, 3);
      if (props.length > 0) {
        output += `     Properties: ${props.map(([k, v]) => `${k}=${v}`).join(', ')}\n`;
      }
    }
  }

  return output;
}

function handleGetElementsForMaterial(
  args: { material_id: string; limit?: number },
  context: ModelSummary,
  elementDetails?: Record<string, ElementDetail[]>
): string {
  const mat = context.materials.find(m => m.id === args.material_id);
  if (!mat) return `Material "${args.material_id}" not found.`;

  const limit = args.limit || 20;
  const elements = elementDetails?.[mat.id] || [];

  if (elements.length === 0) {
    return `No element details available for "${mat.name}". Material has ${mat.elementCount} elements of types: ${Object.keys(mat.elementTypes).join(', ')}`;
  }

  let output = `=== ELEMENTS FOR ${mat.name} ===\n`;
  output += `Showing ${Math.min(elements.length, limit)} of ${mat.elementCount} elements\n\n`;

  for (const elem of elements.slice(0, limit)) {
    output += `[${elem.id}] ${elem.name}\n`;
    output += `  Type: ${elem.type}\n`;
    if (elem.storeyName) output += `  Location: ${elem.storeyName}\n`;
    if (elem.volume) output += `  Volume: ${elem.volume.toFixed(4)} m³\n`;
    if (elem.area) output += `  Area: ${elem.area.toFixed(2)} m²\n`;

    const props = Object.entries(elem.properties);
    if (props.length > 0) {
      output += `  Properties:\n`;
      for (const [key, value] of props.slice(0, 8)) {
        output += `    • ${key}: ${value}\n`;
      }
    }
    output += '\n';
  }

  return output;
}

function handleGetSpatialBreakdown(
  args: { storey_name?: string },
  context: ModelSummary
): string {
  let storeys = context.storeys;

  if (args.storey_name) {
    const query = args.storey_name.toLowerCase();
    storeys = storeys.filter(s => s.name.toLowerCase().includes(query));
  }

  if (storeys.length === 0) {
    return `No storeys found${args.storey_name ? ` matching "${args.storey_name}"` : ''}. Available storeys: ${context.storeys.map(s => s.name).join(', ')}`;
  }

  let output = `=== SPATIAL BREAKDOWN ===\n\n`;

  for (const storey of storeys) {
    output += `🏢 ${storey.name}\n`;
    output += `   Elevation: ${storey.elevation}m\n`;
    output += `   Total Elements: ${storey.elementCount}\n`;
    output += `   Materials:\n`;

    for (const [matName, count] of Object.entries(storey.materialBreakdown).sort((a, b) => b[1] - a[1])) {
      output += `     • ${matName}: ${count} elements\n`;
    }
    output += '\n';
  }

  return output;
}

function handleGetHighImpactElements(
  args: { limit?: number },
  context: ModelSummary
): string {
  const limit = args.limit || 10;

  // Calculate impact per material
  const impacts = context.materials
    .filter(m => m.currentEpd)
    .map(m => ({
      material: m,
      gwpPerElement: m.currentEpd!.calculatedGwp / m.elementCount,
      totalGwp: m.currentEpd!.calculatedGwp,
    }))
    .sort((a, b) => b.totalGwp - a.totalGwp);

  let output = `=== HIGH IMPACT ANALYSIS ===\n\n`;

  if (impacts.length === 0) {
    return 'No materials with EPD matches found for impact analysis.';
  }

  output += `📊 MATERIALS BY TOTAL GWP IMPACT:\n\n`;

  for (const item of impacts.slice(0, limit)) {
    const mat = item.material;
    const pct = context.lca ? ((item.totalGwp / context.lca.totalGwp) * 100).toFixed(1) : '?';

    output += `${mat.name}\n`;
    output += `  Total GWP: ${item.totalGwp.toLocaleString()} kg CO₂e (${pct}% of total)\n`;
    output += `  Elements: ${mat.elementCount} | Volume: ${mat.totalVolume.toFixed(2)} m³\n`;
    output += `  Current EPD: ${mat.currentEpd!.name}\n`;
    output += `  EPD GWP: ${mat.currentEpd!.gwp} kg CO₂e/unit\n`;
    output += '\n';
  }

  output += `💡 OPTIMIZATION TIP: Focus on the top materials for maximum carbon reduction.\n`;

  return output;
}

function handleSearchEPD(args: {
  category?: string;
  gwp_max?: number;
  keywords?: string[];
  use_case?: string;
  suitable_for?: string;
  recycled_content_min?: number;
}): string {
  let results = Object.values(mockEPDs);

  // Apply filters
  if (args.category) {
    results = results.filter(e => e.category === args.category);
  }
  if (args.gwp_max !== undefined) {
    results = results.filter(e => e.gwp <= args.gwp_max!);
  }
  if (args.use_case) {
    results = results.filter(e => e.use_cases.includes(args.use_case!));
  }
  if (args.suitable_for) {
    results = results.filter(e => e.suitable_for.includes(args.suitable_for!));
  }
  if (args.recycled_content_min !== undefined) {
    results = results.filter(e => (e.recycled_content || 0) >= args.recycled_content_min!);
  }
  if (args.keywords && args.keywords.length > 0) {
    const lowerKeywords = args.keywords.map(k => k.toLowerCase());
    results = results.filter(e =>
      lowerKeywords.some(kw =>
        e.keywords.some(ek => ek.includes(kw)) ||
        e.name.toLowerCase().includes(kw)
      )
    );
  }

  // Sort by GWP (lowest first)
  results.sort((a, b) => a.gwp - b.gwp);

  if (results.length === 0) {
    return 'No EPDs found matching the criteria. Try broadening your search.';
  }

  let output = `=== EPD SEARCH RESULTS (${results.length}) ===\n\n`;

  for (const epd of results) {
    output += `[${epd.id}] ${epd.name}\n`;
    output += `  GWP: ${epd.gwp} kg CO₂e/${epd.unit}\n`;
    output += `  Category: ${epd.category}\n`;
    if (epd.fire_rating) output += `  Fire Rating: ${epd.fire_rating}\n`;
    if (epd.recycled_content) output += `  Recycled Content: ${epd.recycled_content}%\n`;
    output += `  Suitable for: ${epd.suitable_for.join(', ')}\n`;
    output += '\n';
  }

  return output;
}

function handleGetEPD(args: { epd_id: string }): string {
  const epd = mockEPDs[args.epd_id];
  if (!epd) return `EPD "${args.epd_id}" not found. Try searching with search_epd_database.`;

  return `=== ${epd.name} ===
ID: ${epd.id}
Category: ${epd.category}

ENVIRONMENTAL IMPACT:
  GWP (A1-A3): ${epd.gwp} kg CO₂e/${epd.unit}

TECHNICAL PROPERTIES:
${epd.fire_rating ? `  Fire Rating: ${epd.fire_rating}` : '  Fire Rating: Not specified'}
${epd.recycled_content ? `  Recycled Content: ${epd.recycled_content}%` : '  Recycled Content: Not specified'}

USE CASES: ${epd.use_cases.join(', ')}
SUITABLE FOR: ${epd.suitable_for.join(', ')}
KEYWORDS: ${epd.keywords.join(', ')}`;
}

function handleCompare(args: { epd_ids: string[] }): string {
  const epds = args.epd_ids.map(id => mockEPDs[id]).filter(Boolean);
  if (epds.length < 2) return 'Need at least 2 valid EPD IDs to compare.';

  let output = '=== EPD COMPARISON ===\n\n';

  // Header
  output += 'Property'.padEnd(22);
  for (const epd of epds) {
    output += epd.name.substring(0, 25).padEnd(28);
  }
  output += '\n' + '-'.repeat(22 + epds.length * 28) + '\n';

  // GWP
  output += 'GWP (kg CO₂e)'.padEnd(22);
  for (const epd of epds) {
    output += `${epd.gwp} /${epd.unit}`.padEnd(28);
  }
  output += '\n';

  // Fire Rating
  output += 'Fire Rating'.padEnd(22);
  for (const epd of epds) {
    output += (epd.fire_rating || '-').padEnd(28);
  }
  output += '\n';

  // Recycled Content
  output += 'Recycled %'.padEnd(22);
  for (const epd of epds) {
    output += `${epd.recycled_content || 0}%`.padEnd(28);
  }
  output += '\n';

  // Suitable For
  output += 'Suitable For'.padEnd(22);
  for (const epd of epds) {
    output += epd.suitable_for.slice(0, 3).join(', ').padEnd(28);
  }
  output += '\n\n';

  // Recommendation
  const lowest = epds.reduce((min, e) => e.gwp < min.gwp ? e : min);
  const highest = epds.reduce((max, e) => e.gwp > max.gwp ? e : max);
  const savings = ((highest.gwp - lowest.gwp) / highest.gwp * 100).toFixed(0);

  output += `💡 LOWEST GWP: ${lowest.name} (${lowest.gwp} kg CO₂e/${lowest.unit})\n`;
  output += `   Potential reduction: ${savings}% compared to highest option\n`;

  return output;
}

function handleProposal(
  args: { material_id: string; proposed_epd_id: string; confidence: number; reasoning: string; key_benefits?: string[] },
  context: ModelSummary
): { result: string; proposal?: EPDProposal } {
  const mat = context.materials.find(m => m.id === args.material_id);
  if (!mat) return { result: `Material "${args.material_id}" not found.` };

  const epd = mockEPDs[args.proposed_epd_id];
  if (!epd) return { result: `EPD "${args.proposed_epd_id}" not found.` };

  // Calculate GWP based on unit
  let quantity = mat.totalVolume;
  if (epd.unit === 'kg') {
    quantity = mat.totalWeight || mat.totalVolume * 2400; // Default density for concrete
  } else if (epd.unit === 'm2') {
    quantity = mat.totalArea;
  }

  const proposedGWP = epd.gwp * quantity;
  const currentGWP = mat.currentEpd?.calculatedGwp || 0;
  const gwpDiff = proposedGWP - currentGWP;
  const gwpDiffPercent = currentGWP > 0 ? (gwpDiff / currentGWP) * 100 : 0;

  const proposal: EPDProposal = {
    id: `proposal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    material_id: args.material_id,
    material_name: mat.name,
    current_epd_id: mat.currentEpd?.id,
    current_epd_name: mat.currentEpd?.name,
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

  const emoji = gwpDiff < 0 ? '✅' : gwpDiff > 0 ? '⚠️' : '➡️';
  const direction = gwpDiff < 0 ? 'reduction' : gwpDiff > 0 ? 'increase' : 'no change';

  return {
    result: `${emoji} PROPOSAL CREATED\n\nMaterial: ${mat.name}\nProposed EPD: ${epd.name}\nGWP Change: ${gwpDiff >= 0 ? '+' : ''}${gwpDiff.toFixed(0)} kg CO₂e (${gwpDiffPercent >= 0 ? '+' : ''}${gwpDiffPercent.toFixed(1)}% ${direction})\n\nThe proposal has been created for user review.`,
    proposal,
  };
}

function executeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  context: ModelSummary,
  elementDetails?: Record<string, ElementDetail[]>
): { result: string; proposal?: EPDProposal } {
  switch (toolName) {
    case 'get_model_overview':
      return { result: handleGetModelOverview(context) };
    case 'get_material_details':
      return { result: handleGetMaterialDetails(args as { material_id: string }, context, elementDetails) };
    case 'get_elements_for_material':
      return { result: handleGetElementsForMaterial(args as { material_id: string; limit?: number }, context, elementDetails) };
    case 'get_spatial_breakdown':
      return { result: handleGetSpatialBreakdown(args as { storey_name?: string }, context) };
    case 'get_high_impact_elements':
      return { result: handleGetHighImpactElements(args as { limit?: number }, context) };
    case 'search_epd_database':
      return { result: handleSearchEPD(args as { category?: string; gwp_max?: number }) };
    case 'get_epd_details':
      return { result: handleGetEPD(args as { epd_id: string }) };
    case 'compare_epds':
      return { result: handleCompare(args as { epd_ids: string[] }) };
    case 'propose_epd_mapping':
      return handleProposal(
        args as { material_id: string; proposed_epd_id: string; confidence: number; reasoning: string; key_benefits?: string[] },
        context
      );
    default:
      return { result: `Unknown tool: ${toolName}` };
  }
}

// ============ System Prompt ============

const systemPrompt = `You are an expert EPD (Environmental Product Declaration) matching agent for building Life Cycle Assessment (LCA).

You have FULL ACCESS to the building model data through your tools:
- Project information (element counts, spatial structure, total volumes)
- All materials with quantities, element types, and properties
- Current EPD mappings with GWP values
- Spatial breakdown by building storey
- Individual element details when needed

YOUR ROLE:
1. Analyze the building model to understand materials and their usage
2. Identify opportunities for carbon reduction through better EPD choices
3. Search the EPD database with appropriate technical criteria
4. Propose EPD mappings with detailed, context-aware reasoning

WORKFLOW FOR EPD OPTIMIZATION:
1. Start with get_model_overview to understand the building
2. Use get_high_impact_elements to prioritize materials by GWP contribution
3. For each priority material, use get_material_details to understand usage context
4. Search for better EPDs with search_epd_database using appropriate filters
5. Compare options with compare_epds
6. Create proposals with propose_epd_mapping, explaining why the EPD fits

IMPORTANT GUIDELINES:
- Always consider ELEMENT TYPES when selecting EPDs (e.g., structural concrete for slabs/columns)
- Check if materials are used in walls, slabs, beams, etc. to select appropriate EPDs
- Consider fire ratings and structural requirements mentioned in properties
- Prioritize lower GWP options that still meet technical requirements
- Explain your reasoning clearly, referencing specific element types and quantities
- Create concrete proposals for the user to accept/reject

Be thorough but efficient. Focus on actionable recommendations that reduce carbon.`;

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
    const { message, modelContext, elementDetails, conversationHistory = [] } = body;

    // Build context summary for system prompt
    let contextSummary = '\n\n--- CURRENT MODEL ---\n';
    contextSummary += `Project: ${modelContext.project.name}\n`;
    contextSummary += `Elements: ${modelContext.project.elementCount} | Volume: ${modelContext.project.totalVolume.toFixed(1)} m³\n`;
    contextSummary += `Materials: ${modelContext.materials.length}\n`;

    if (modelContext.lca) {
      contextSummary += `Total GWP: ${modelContext.lca.totalGwp.toLocaleString()} kg CO₂e\n`;
    }

    contextSummary += '\nMaterials summary:\n';
    for (const mat of modelContext.materials.slice(0, 10)) {
      contextSummary += `- ${mat.name}: ${mat.elementCount} elements, ${mat.totalVolume.toFixed(1)} m³`;
      if (mat.currentEpd) {
        contextSummary += ` → ${mat.currentEpd.name} (${mat.currentEpd.calculatedGwp.toFixed(0)} kg CO₂e)`;
      } else {
        contextSummary += ' → NO EPD';
      }
      contextSummary += '\n';
    }

    const messages: Array<{ role: string; content: string; tool_call_id?: string; tool_calls?: ToolCall[] }> = [
      { role: 'system', content: systemPrompt + contextSummary },
      ...conversationHistory,
      { role: 'user', content: message },
    ];

    const proposals: EPDProposal[] = [];
    const toolResults: Array<{ tool: string; result: string }> = [];

    // Agent loop - max 8 iterations for thorough analysis
    for (let i = 0; i < 8; i++) {
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

      messages.push(assistantMessage as { role: string; content: string; tool_calls?: ToolCall[] });

      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        for (const toolCall of assistantMessage.tool_calls) {
          const toolName = toolCall.function.name;
          const toolArgs = JSON.parse(toolCall.function.arguments);

          console.log(`[Agent] Tool: ${toolName}`, toolArgs);

          const { result, proposal } = executeToolCall(toolName, toolArgs, modelContext, elementDetails);

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
        return new Response(JSON.stringify({
          response: assistantMessage.content,
          proposals,
          toolResults,
          conversationHistory: messages.slice(1),
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
      response: 'I\'ve completed my analysis and created recommendations. Please review the proposals above.',
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
