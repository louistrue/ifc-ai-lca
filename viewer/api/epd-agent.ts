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
  // Element type breakdown with quantities (critical for EPD selection)
  // e.g., { "IfcSlab": { count: 5, volume: 120.5 }, "IfcWall": { count: 3, volume: 45.2 } }
  elementTypes: Record<string, { count: number; volume: number }>;
  // Spatial grouping for material granularity
  spatialBreakdown?: {
    belowGround: { count: number; volume: number };
    aboveGround: { count: number; volume: number };
    byStorey: Record<string, { count: number; volume: number }>;
  };
  // Usage context hints for EPD selection
  usageContext?: {
    isStructural: boolean;
    isExterior: boolean;
    isFoundation: boolean;
    primaryUse: string;
  };
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

/** EPD data passed from frontend (simplified for API payload) */
interface EPDSimplified {
  id: string;
  name: string;
  category: string;
  subcategory?: string;
  gwp: number;
  unit: string;
  manufacturer?: string;
  keywords?: string[];
  plantLocation?: string;
  dataQuality?: string;
}

interface AgentRequest {
  message: string;
  modelContext: ModelSummary;
  elementIndex?: ElementIndex[];
  elementDetails?: Record<string, ElementDetail[]>; // Pre-fetched details keyed by materialId
  epdDatabase?: EPDSimplified[]; // Real EPDs from Ökobaudat passed from frontend
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
  {
    type: 'function',
    function: {
      name: 'suggest_material_split',
      description: 'Analyze a material\'s spatial distribution and suggest splitting it into sub-materials for more accurate EPD matching. For example, concrete below ground vs above ground may need different EPDs due to different exposure conditions and requirements.',
      parameters: {
        type: 'object',
        properties: {
          material_id: {
            type: 'string',
            description: 'The material ID to analyze for potential splitting.',
          },
          split_criteria: {
            type: 'string',
            enum: ['elevation', 'storey', 'element_type', 'usage'],
            description: 'How to split the material: elevation (below/above ground), storey (by floor level), element_type (by IFC type), or usage (structural/facade/interior).',
          },
        },
        required: ['material_id', 'split_criteria'],
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

    // Element type breakdown with volumes
    const types = Object.entries(mat.elementTypes);
    if (types.length > 0) {
      output += `     Used in: ${types.map(([t, data]) => `${t} (${data.count}, ${data.volume.toFixed(1)}m³)`).join(', ')}\n`;
    }

    // Usage context
    if (mat.usageContext) {
      const ctx = mat.usageContext;
      const tags: string[] = [];
      if (ctx.isStructural) tags.push('STRUCTURAL');
      if (ctx.isExterior) tags.push('EXTERIOR');
      if (ctx.isFoundation) tags.push('FOUNDATION');
      if (tags.length > 0 || ctx.primaryUse !== 'general') {
        output += `     Usage: ${ctx.primaryUse}${tags.length > 0 ? ` [${tags.join(', ')}]` : ''}\n`;
      }
    }

    // Spatial breakdown (key for material splitting decisions)
    if (mat.spatialBreakdown) {
      const { belowGround, aboveGround } = mat.spatialBreakdown;
      if (belowGround.count > 0 && aboveGround.count > 0) {
        output += `     ⚡ SPLIT OPPORTUNITY: Below ground (${belowGround.count} el, ${belowGround.volume.toFixed(1)}m³) vs Above ground (${aboveGround.count} el, ${aboveGround.volume.toFixed(1)}m³)\n`;
      } else if (belowGround.count > 0) {
        output += `     Location: Below ground (${belowGround.count} el, ${belowGround.volume.toFixed(1)}m³)\n`;
      } else if (aboveGround.count > 0) {
        output += `     Location: Above ground (${aboveGround.count} el, ${aboveGround.volume.toFixed(1)}m³)\n`;
      }
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
  for (const [type, data] of Object.entries(mat.elementTypes)) {
    output += `   • ${type}: ${data.count} elements (${data.volume.toFixed(2)} m³)\n`;
  }

  // Usage context
  if (mat.usageContext) {
    output += `\n🎯 USAGE CONTEXT:\n`;
    output += `   Primary Use: ${mat.usageContext.primaryUse}\n`;
    output += `   Structural: ${mat.usageContext.isStructural ? 'Yes' : 'No'}\n`;
    output += `   Exterior/Facade: ${mat.usageContext.isExterior ? 'Yes' : 'No'}\n`;
    output += `   Foundation: ${mat.usageContext.isFoundation ? 'Yes' : 'No'}\n`;
  }

  // Spatial breakdown (critical for EPD granularity)
  if (mat.spatialBreakdown) {
    output += `\n📍 SPATIAL BREAKDOWN:\n`;
    const { belowGround, aboveGround, byStorey } = mat.spatialBreakdown;

    output += `   Below Ground: ${belowGround.count} elements (${belowGround.volume.toFixed(2)} m³)\n`;
    output += `   Above Ground: ${aboveGround.count} elements (${aboveGround.volume.toFixed(2)} m³)\n`;

    if (Object.keys(byStorey).length > 0) {
      output += `   By Storey:\n`;
      for (const [storeyName, data] of Object.entries(byStorey).sort((a, b) => b[1].volume - a[1].volume)) {
        output += `     • ${storeyName}: ${data.count} elements (${data.volume.toFixed(2)} m³)\n`;
      }
    }

    // Highlight split opportunities
    if (belowGround.count > 0 && aboveGround.count > 0) {
      const belowPct = ((belowGround.volume / mat.totalVolume) * 100).toFixed(0);
      const abovePct = ((aboveGround.volume / mat.totalVolume) * 100).toFixed(0);
      output += `\n   ⚡ SPLIT RECOMMENDATION:\n`;
      output += `   This material spans both below and above ground.\n`;
      output += `   Below ground: ${belowPct}% of volume - may need waterproofing/durability EPD\n`;
      output += `   Above ground: ${abovePct}% of volume - standard EPD may be appropriate\n`;
      output += `   Use suggest_material_split tool to analyze splitting options.\n`;
    }
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

/**
 * Calculate relevance score for an EPD based on search criteria
 */
function calculateRelevanceScore(
  epd: EPDSimplified,
  args: { category?: string; keywords?: string[]; gwp_max?: number }
): number {
  let score = 0;
  const nameLower = epd.name.toLowerCase();
  const keywordsLower = (epd.keywords || []).map(k => k.toLowerCase());

  // Category match (highest weight)
  if (args.category) {
    if (epd.category === args.category) {
      score += 100;
    } else {
      // Partial match for related categories
      const relatedCategories: Record<string, string[]> = {
        CONCRETE: ['MASONRY'],
        STEEL: ['ALUMINUM'],
        WOOD: ['INSULATION'],
        INSULATION: ['PLASTIC', 'MEMBRANE'],
      };
      if (relatedCategories[args.category]?.includes(epd.category)) {
        score += 30;
      }
    }
  }

  // Keyword matching (medium weight)
  if (args.keywords && args.keywords.length > 0) {
    for (const kw of args.keywords) {
      const kwLower = kw.toLowerCase();
      if (nameLower.includes(kwLower)) {
        score += 25;
      }
      if (keywordsLower.some(ek => ek.includes(kwLower))) {
        score += 15;
      }
      if ((epd.subcategory || '').toLowerCase().includes(kwLower)) {
        score += 10;
      }
    }
  }

  // Eco-friendly indicators bonus
  if (nameLower.includes('recyc') || nameLower.includes('sekundär')) score += 20;
  if (nameLower.includes('low carbon') || nameLower.includes('co2-reduziert')) score += 20;
  if (nameLower.includes('öko') || nameLower.includes('eco') || nameLower.includes('grün')) score += 15;
  if (nameLower.includes('cem iii') || nameLower.includes('hochofen')) score += 15;

  // GWP efficiency bonus (lower is better, but avoid 0)
  if (epd.gwp > 0 && args.gwp_max !== undefined) {
    const gwpRatio = epd.gwp / args.gwp_max;
    if (gwpRatio < 0.5) score += 30;
    else if (gwpRatio < 0.8) score += 15;
  }

  // Wood gets bonus for negative GWP (carbon storage)
  if (epd.category === 'WOOD' && epd.gwp < 0) {
    score += 25;
  }

  return score;
}

function handleSearchEPD(args: {
  category?: string;
  gwp_max?: number;
  keywords?: string[];
  use_case?: string;
  suitable_for?: string;
  recycled_content_min?: number;
}, epdDatabase?: EPDSimplified[]): string {
  // Use passed EPD database if available, otherwise fall back to mock
  let allEpds: EPDSimplified[] = epdDatabase && epdDatabase.length > 0
    ? [...epdDatabase]
    : Object.values(mockEPDs).map(e => ({
        id: e.id,
        name: e.name,
        category: e.category,
        gwp: e.gwp,
        unit: e.unit,
        keywords: e.keywords,
      }));

  // Calculate relevance scores and filter
  const scoredResults = allEpds.map(epd => ({
    epd,
    score: calculateRelevanceScore(epd, args),
  }));

  // Filter: require minimum relevance or category match
  let results = scoredResults
    .filter(r => r.score >= 10 || (args.category && r.epd.category === args.category))
    .sort((a, b) => {
      // Primary: sort by score descending
      if (b.score !== a.score) return b.score - a.score;
      // Secondary: sort by GWP ascending (lower is better)
      return a.epd.gwp - b.epd.gwp;
    });

  // Apply GWP max filter (soft filter - prioritize under limit but show some over)
  if (args.gwp_max !== undefined) {
    const underLimit = results.filter(r => r.epd.gwp <= args.gwp_max!);
    const overLimit = results.filter(r => r.epd.gwp > args.gwp_max!).slice(0, 3);
    results = [...underLimit, ...overLimit];
  }

  // Limit results for readability
  const displayResults = results.slice(0, 15);

  if (displayResults.length === 0) {
    // Fallback: show any EPDs in the category
    const categoryMatches = allEpds
      .filter(e => !args.category || e.category === args.category)
      .sort((a, b) => a.gwp - b.gwp)
      .slice(0, 10);

    if (categoryMatches.length > 0) {
      let output = `=== EPD SEARCH RESULTS (showing all ${args.category || 'all'} EPDs) ===\n`;
      output += `Note: No exact matches found. Showing ${categoryMatches.length} EPDs in category.\n\n`;

      for (const epd of categoryMatches) {
        output += `[${epd.id}] ${epd.name}\n`;
        output += `  GWP: ${epd.gwp.toFixed(2)} kg CO₂e/${epd.unit}\n`;
        output += `  Category: ${epd.category}`;
        if (epd.subcategory) output += ` / ${epd.subcategory}`;
        output += '\n\n';
      }
      return output;
    }

    return `No EPDs found matching the criteria. Database has ${epdDatabase?.length || 0} EPDs. Try broadening your search or using different keywords.`;
  }

  let output = `=== EPD SEARCH RESULTS (${displayResults.length} matches, sorted by relevance) ===\n\n`;

  for (const { epd, score } of displayResults) {
    output += `[${epd.id}] ${epd.name}\n`;
    output += `  GWP: ${epd.gwp.toFixed(2)} kg CO₂e/${epd.unit}`;
    if (args.gwp_max && epd.gwp < args.gwp_max) {
      const savings = ((args.gwp_max - epd.gwp) / args.gwp_max * 100).toFixed(0);
      output += ` (${savings}% lower than target)`;
    }
    output += '\n';
    output += `  Category: ${epd.category}`;
    if (epd.subcategory) output += ` / ${epd.subcategory}`;
    output += ` | Relevance: ${score}\n`;
    if (epd.manufacturer) output += `  Source: ${epd.manufacturer}\n`;
    output += '\n';
  }

  if (results.length > 15) {
    output += `\n... and ${results.length - 15} more results.\n`;
  }

  // Add helpful suggestions
  output += `\n💡 TIP: Use 'get_epd_details' with an EPD ID to see full details before proposing.\n`;

  return output;
}

function handleGetEPD(args: { epd_id: string }, epdDatabase?: EPDSimplified[]): string {
  // Try to find in passed database first
  const dbEpd = epdDatabase?.find(e => e.id === args.epd_id);
  if (dbEpd) {
    return `=== ${dbEpd.name} ===
ID: ${dbEpd.id}
Category: ${dbEpd.category}${dbEpd.subcategory ? ` / ${dbEpd.subcategory}` : ''}

ENVIRONMENTAL IMPACT:
  GWP (A1-A3): ${dbEpd.gwp.toFixed(2)} kg CO₂e/${dbEpd.unit}

SOURCE: ${dbEpd.manufacturer || 'Ökobaudat'}
LOCATION: ${dbEpd.plantLocation || 'Germany'}
DATA QUALITY: ${dbEpd.dataQuality || 'average'}
KEYWORDS: ${(dbEpd.keywords || []).join(', ') || 'N/A'}`;
  }

  // Fall back to mock database
  const epd = mockEPDs[args.epd_id];
  if (!epd) return `EPD "${args.epd_id}" not found in database (${epdDatabase?.length || 0} EPDs available). Try searching with search_epd_database.`;

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

function handleCompare(args: { epd_ids: string[] }, epdDatabase?: EPDSimplified[]): string {
  // Try to find EPDs in passed database first
  const epds: Array<{ id: string; name: string; category: string; gwp: number; unit: string; fire_rating?: string; recycled_content?: number; suitable_for: string[] }> = [];

  for (const id of args.epd_ids) {
    const dbEpd = epdDatabase?.find(e => e.id === id);
    if (dbEpd) {
      epds.push({
        id: dbEpd.id,
        name: dbEpd.name,
        category: dbEpd.category,
        gwp: dbEpd.gwp,
        unit: dbEpd.unit,
        suitable_for: [],
      });
    } else {
      const mockEpd = mockEPDs[id];
      if (mockEpd) {
        epds.push(mockEpd);
      }
    }
  }

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
  context: ModelSummary,
  epdDatabase?: EPDSimplified[]
): { result: string; proposal?: EPDProposal } {
  const mat = context.materials.find(m => m.id === args.material_id);
  if (!mat) return { result: `Material "${args.material_id}" not found.` };

  // Try to find EPD in passed database first
  const dbEpd = epdDatabase?.find(e => e.id === args.proposed_epd_id);
  const mockEpd = mockEPDs[args.proposed_epd_id];

  const epd = dbEpd || mockEpd;
  if (!epd) return { result: `EPD "${args.proposed_epd_id}" not found in database (${epdDatabase?.length || 0} EPDs available).` };

  const epdGwp = 'gwp' in epd ? epd.gwp : 0;
  const epdUnit = 'unit' in epd ? epd.unit : 'kg';
  const epdName = epd.name;

  // Calculate GWP based on unit
  let quantity = mat.totalVolume;
  if (epdUnit === 'kg') {
    quantity = mat.totalWeight || mat.totalVolume * 2400; // Default density for concrete
  } else if (epdUnit === 'm2') {
    quantity = mat.totalArea;
  }

  const proposedGWP = epdGwp * quantity;
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
    proposed_epd_name: epdName,
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
    result: `${emoji} PROPOSAL CREATED\n\nMaterial: ${mat.name}\nProposed EPD: ${epdName}\nGWP Change: ${gwpDiff >= 0 ? '+' : ''}${gwpDiff.toFixed(0)} kg CO₂e (${gwpDiffPercent >= 0 ? '+' : ''}${gwpDiffPercent.toFixed(1)}% ${direction})\n\nThe proposal has been created for user review.`,
    proposal,
  };
}

interface MaterialSplitSuggestion {
  originalMaterialId: string;
  originalMaterialName: string;
  splitCriteria: string;
  suggestedSplits: Array<{
    name: string;
    description: string;
    elementCount: number;
    volume: number;
    volumePercent: number;
    recommendedEpdCriteria: string;
  }>;
  rationale: string;
}

function handleSuggestMaterialSplit(
  args: { material_id: string; split_criteria: 'elevation' | 'storey' | 'element_type' | 'usage' },
  context: ModelSummary
): { result: string; splitSuggestion?: MaterialSplitSuggestion } {
  const mat = context.materials.find(m => m.id === args.material_id);
  if (!mat) return { result: `Material "${args.material_id}" not found. Available materials: ${context.materials.map(m => m.id).join(', ')}` };

  const suggestedSplits: MaterialSplitSuggestion['suggestedSplits'] = [];
  let rationale = '';

  switch (args.split_criteria) {
    case 'elevation': {
      if (!mat.spatialBreakdown) {
        return { result: `No spatial data available for "${mat.name}". Cannot analyze elevation-based splitting.` };
      }

      const { belowGround, aboveGround } = mat.spatialBreakdown;

      if (belowGround.count === 0 || aboveGround.count === 0) {
        return { result: `Material "${mat.name}" is entirely ${belowGround.count > 0 ? 'below' : 'above'} ground. No split needed based on elevation.` };
      }

      const belowPct = (belowGround.volume / mat.totalVolume) * 100;
      const abovePct = (aboveGround.volume / mat.totalVolume) * 100;

      suggestedSplits.push({
        name: `${mat.name} - Below Ground`,
        description: 'Foundation, basement, and underground elements',
        elementCount: belowGround.count,
        volume: belowGround.volume,
        volumePercent: belowPct,
        recommendedEpdCriteria: 'Search for EPDs suitable for foundation/underground use - consider waterproofing requirements, sulfate resistance, higher durability class',
      });

      suggestedSplits.push({
        name: `${mat.name} - Above Ground`,
        description: 'Superstructure elements above grade',
        elementCount: aboveGround.count,
        volume: aboveGround.volume,
        volumePercent: abovePct,
        recommendedEpdCriteria: 'Standard EPD appropriate for building superstructure - consider fire rating, exposure class XC1-XC3',
      });

      rationale = `Splitting ${mat.name} by elevation is recommended because underground concrete often requires:
- Higher durability (XA exposure classes for sulfate attack)
- Waterproofing additives
- Different strength requirements
This results in different EPD characteristics. Below ground: ${belowPct.toFixed(1)}% of volume, Above ground: ${abovePct.toFixed(1)}% of volume.`;
      break;
    }

    case 'storey': {
      if (!mat.spatialBreakdown?.byStorey || Object.keys(mat.spatialBreakdown.byStorey).length === 0) {
        return { result: `No storey data available for "${mat.name}". Cannot analyze storey-based splitting.` };
      }

      const storeyData = Object.entries(mat.spatialBreakdown.byStorey)
        .sort((a, b) => b[1].volume - a[1].volume);

      for (const [storeyName, data] of storeyData) {
        const pct = (data.volume / mat.totalVolume) * 100;
        suggestedSplits.push({
          name: `${mat.name} - ${storeyName}`,
          description: `Elements on ${storeyName}`,
          elementCount: data.count,
          volume: data.volume,
          volumePercent: pct,
          recommendedEpdCriteria: `Consider storey-specific requirements (fire rating varies by floor, structural loads decrease with height)`,
        });
      }

      rationale = `Splitting ${mat.name} by storey allows for floor-specific EPD matching based on:
- Varying fire rating requirements per floor
- Different structural loads (higher at lower levels)
- Potential for different concrete grades per floor`;
      break;
    }

    case 'element_type': {
      const typeData = Object.entries(mat.elementTypes)
        .sort((a, b) => b[1].volume - a[1].volume);

      if (typeData.length <= 1) {
        return { result: `Material "${mat.name}" is only used in ${typeData[0]?.[0] || 'one element type'}. No split needed based on element type.` };
      }

      for (const [typeName, data] of typeData) {
        const pct = (data.volume / mat.totalVolume) * 100;
        let epdCriteria = 'Standard EPD for this element type';

        // Element-type specific recommendations
        if (typeName.includes('Slab')) {
          epdCriteria = 'Floor slab concrete - consider flat slab or post-tensioned EPDs if applicable';
        } else if (typeName.includes('Column')) {
          epdCriteria = 'Column concrete - typically higher strength (C40+), may need specific high-strength EPDs';
        } else if (typeName.includes('Wall')) {
          epdCriteria = 'Wall concrete - consider if load-bearing vs partition, fire rating requirements';
        } else if (typeName.includes('Beam')) {
          epdCriteria = 'Beam concrete - structural grade, check reinforcement ratio for embodied carbon';
        } else if (typeName.includes('Footing') || typeName.includes('Pile')) {
          epdCriteria = 'Foundation concrete - high durability, sulfate resistant if applicable';
        }

        suggestedSplits.push({
          name: `${mat.name} - ${typeName.replace('Ifc', '')}s`,
          description: `All ${typeName.replace('Ifc', '')} elements`,
          elementCount: data.count,
          volume: data.volume,
          volumePercent: pct,
          recommendedEpdCriteria: epdCriteria,
        });
      }

      rationale = `Splitting ${mat.name} by element type allows matching EPDs to specific structural requirements:
- Columns often need higher strength concrete
- Slabs may use different mixes (lightweight, post-tensioned)
- Foundation elements need durability-focused EPDs`;
      break;
    }

    case 'usage': {
      if (!mat.usageContext) {
        return { result: `No usage context available for "${mat.name}". Cannot analyze usage-based splitting.` };
      }

      const { isStructural, isExterior, isFoundation, primaryUse } = mat.usageContext;

      // Group by usage patterns
      if (isFoundation) {
        suggestedSplits.push({
          name: `${mat.name} - Foundation`,
          description: 'Foundation and below-grade structural elements',
          elementCount: Math.round(mat.elementCount * 0.2), // Estimate
          volume: mat.totalVolume * 0.2,
          volumePercent: 20,
          recommendedEpdCriteria: 'Foundation-grade concrete with durability requirements (XA class)',
        });
      }

      if (isStructural && !isFoundation) {
        suggestedSplits.push({
          name: `${mat.name} - Structural`,
          description: 'Load-bearing superstructure elements',
          elementCount: Math.round(mat.elementCount * 0.6),
          volume: mat.totalVolume * 0.6,
          volumePercent: 60,
          recommendedEpdCriteria: 'Structural concrete meeting fire and strength requirements',
        });
      }

      if (isExterior) {
        suggestedSplits.push({
          name: `${mat.name} - Exterior`,
          description: 'Facade and exposed elements',
          elementCount: Math.round(mat.elementCount * 0.2),
          volume: mat.totalVolume * 0.2,
          volumePercent: 20,
          recommendedEpdCriteria: 'Exterior-grade with weather resistance (XF, XD exposure classes)',
        });
      }

      if (suggestedSplits.length === 0) {
        suggestedSplits.push({
          name: mat.name,
          description: `General use: ${primaryUse}`,
          elementCount: mat.elementCount,
          volume: mat.totalVolume,
          volumePercent: 100,
          recommendedEpdCriteria: 'Standard EPD appropriate for the primary use case',
        });
        rationale = `Material "${mat.name}" has a uniform usage context (${primaryUse}). No usage-based split recommended.`;
      } else {
        rationale = `Splitting ${mat.name} by usage context allows for performance-optimized EPD selection:
- Foundation: durability-focused EPDs
- Structural: strength and fire rating focused
- Exterior: weather resistance focused`;
      }
      break;
    }
  }

  const splitSuggestion: MaterialSplitSuggestion = {
    originalMaterialId: mat.id,
    originalMaterialName: mat.name,
    splitCriteria: args.split_criteria,
    suggestedSplits,
    rationale,
  };

  // Build output
  let output = `=== MATERIAL SPLIT ANALYSIS ===\n\n`;
  output += `Material: ${mat.name}\n`;
  output += `Split Criteria: ${args.split_criteria}\n`;
  output += `Total Volume: ${mat.totalVolume.toFixed(2)} m³\n\n`;

  output += `📊 SUGGESTED SPLITS:\n\n`;
  for (const split of suggestedSplits) {
    output += `${split.name}\n`;
    output += `  Description: ${split.description}\n`;
    output += `  Elements: ${split.elementCount} | Volume: ${split.volume.toFixed(2)} m³ (${split.volumePercent.toFixed(1)}%)\n`;
    output += `  EPD Criteria: ${split.recommendedEpdCriteria}\n\n`;
  }

  output += `💡 RATIONALE:\n${rationale}\n\n`;

  output += `⚡ NEXT STEPS:\n`;
  output += `1. Use search_epd_database with criteria from each split\n`;
  output += `2. Create separate propose_epd_mapping for each sub-material\n`;
  output += `3. Note: Actual material splitting in the model requires user action\n`;

  return { result: output, splitSuggestion };
}

function executeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  context: ModelSummary,
  elementDetails?: Record<string, ElementDetail[]>,
  epdDatabase?: EPDSimplified[]
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
      return { result: handleSearchEPD(args as { category?: string; gwp_max?: number }, epdDatabase) };
    case 'get_epd_details':
      return { result: handleGetEPD(args as { epd_id: string }, epdDatabase) };
    case 'compare_epds':
      return { result: handleCompare(args as { epd_ids: string[] }, epdDatabase) };
    case 'propose_epd_mapping':
      return handleProposal(
        args as { material_id: string; proposed_epd_id: string; confidence: number; reasoning: string; key_benefits?: string[] },
        context,
        epdDatabase
      );
    case 'suggest_material_split':
      return handleSuggestMaterialSplit(
        args as { material_id: string; split_criteria: 'elevation' | 'storey' | 'element_type' | 'usage' },
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
- All materials with quantities, element types (with volumes), and properties
- SPATIAL BREAKDOWN: Materials show above/below ground distribution and per-storey volumes
- USAGE CONTEXT: Materials tagged as structural, exterior, foundation with primary use
- Current EPD mappings with GWP values
- Individual element details when needed

YOUR ROLE:
1. Analyze the building model to understand materials and their usage context
2. Identify opportunities for carbon reduction through better EPD choices
3. CRITICAL: Check for materials that span different contexts (e.g., concrete both below and above ground)
4. Suggest material splits when a single EPD cannot accurately represent varied usage
5. Propose EPD mappings with detailed, context-aware reasoning

MATERIAL GRANULARITY - KEY CONCEPT:
The same material (e.g., "Concrete C30/37") may need DIFFERENT EPDs based on:
- ELEVATION: Below-ground concrete needs durability/waterproofing EPDs; above-ground is standard
- ELEMENT TYPE: Column concrete (high-strength) vs slab concrete (standard) vs foundation (durable)
- USAGE: Structural vs facade vs interior applications have different requirements

Look for "⚡ SPLIT OPPORTUNITY" flags in model overview - these indicate materials that span multiple contexts.

WORKFLOW FOR EPD OPTIMIZATION:
1. Start with get_model_overview to understand the building and identify split opportunities
2. Use get_high_impact_elements to prioritize materials by GWP contribution
3. For each priority material:
   a. Check spatialBreakdown and usageContext in the overview
   b. If material spans multiple contexts (below+above ground, multiple element types), use suggest_material_split
   c. Use get_material_details for full breakdown
4. Search for appropriate EPDs with search_epd_database using context-specific filters
5. Compare options with compare_epds
6. Create proposals with propose_epd_mapping, specifying which portion of the material if split

IMPORTANT GUIDELINES:
- ALWAYS check spatial breakdown before proposing an EPD - one EPD may not fit all uses
- Use suggest_material_split(material_id, "elevation") for materials spanning above/below ground
- Use suggest_material_split(material_id, "element_type") for materials used in diverse element types
- Consider fire ratings and structural requirements mentioned in properties
- Prioritize lower GWP options that still meet technical requirements
- Explain your reasoning clearly, referencing specific element types, locations, and quantities
- When a split is recommended, create separate proposals for each sub-material context

Be thorough but efficient. Focus on actionable recommendations that reduce carbon while maintaining technical accuracy.`;

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
  if (!apiKey || apiKey.trim() === '') {
    return new Response(JSON.stringify({
      error: 'OpenAI API key not configured',
      details: 'Please add OPENAI_API_KEY to your Vercel environment variables at: Project Settings → Environment Variables'
    }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  try {
    const body: AgentRequest = await req.json();
    const { message, modelContext, elementDetails, epdDatabase, conversationHistory = [] } = body;

    // Build context summary for system prompt
    let contextSummary = '\n\n--- CURRENT MODEL ---\n';
    contextSummary += `Project: ${modelContext.project.name}\n`;
    contextSummary += `Elements: ${modelContext.project.elementCount} | Volume: ${modelContext.project.totalVolume.toFixed(1)} m³\n`;
    contextSummary += `Materials: ${modelContext.materials.length}\n`;

    if (modelContext.lca) {
      contextSummary += `Total GWP: ${modelContext.lca.totalGwp.toLocaleString()} kg CO₂e\n`;
    }

    // Add EPD database info
    contextSummary += `EPD Database: ${epdDatabase?.length || 0} EPDs from Ökobaudat\n`;

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
        const errorText = await response.text();
        return new Response(JSON.stringify({
          error: 'OpenAI API error',
          details: errorText,
          status: response.status,
          hint: response.status === 401 ? 'Check your OPENAI_API_KEY is valid' :
                response.status === 429 ? 'Rate limited - try again later' :
                'OpenAI service issue'
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
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

          const { result, proposal } = executeToolCall(toolName, toolArgs, modelContext, elementDetails, epdDatabase);

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
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({
      error: 'Agent error',
      details: errorMessage,
      hint: errorMessage.includes('JSON') ? 'Request body parsing failed' :
            errorMessage.includes('fetch') ? 'Network error calling OpenAI' :
            'Internal processing error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
