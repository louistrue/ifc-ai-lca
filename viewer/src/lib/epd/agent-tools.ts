/**
 * LLM Agent Tools for EPD Matching
 *
 * Provides tool definitions and handlers for the LLM agent to:
 * - Query building elements from IFC data
 * - Search and compare EPDs
 * - Propose EPD mappings
 */

import type { MaterialCategory } from './types';
import {
  mockEPDDatabase,
  formatEPDForLLM,
  formatSearchResultsForLLM,
  formatComparisonForLLM,
  type EPDSearchCriteria,
  type MockEPD,
} from './mock-epd-database';

// ============ Tool Definitions for OpenAI Function Calling ============

export const agentToolDefinitions = [
  {
    type: 'function' as const,
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
    type: 'function' as const,
    function: {
      name: 'get_material_details',
      description: 'Get detailed information about a specific material in the building, including its current EPD match and all available properties.',
      parameters: {
        type: 'object',
        properties: {
          material_id: {
            type: 'string',
            description: 'The material ID (e.g., "mat-concrete-wall").',
          },
        },
        required: ['material_id'],
      },
    },
  },
  {
    type: 'function' as const,
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
          gwp_max: {
            type: 'number',
            description: 'Maximum GWP in kg CO₂e per declared unit.',
          },
          fire_rating_min: {
            type: 'string',
            description: 'Minimum fire rating required (e.g., "REI 60", "EI 30").',
          },
          strength_class: {
            type: 'string',
            description: 'For concrete: strength class like "C30/37", "C40/50".',
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
          keywords: {
            type: 'array',
            items: { type: 'string' },
            description: 'Keywords to search for in EPD name/description.',
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
    type: 'function' as const,
    function: {
      name: 'get_epd_details',
      description: 'Get full details for a specific EPD including all environmental impacts and technical properties.',
      parameters: {
        type: 'object',
        properties: {
          epd_id: {
            type: 'string',
            description: 'The EPD ID (e.g., "mock-concrete-002").',
          },
        },
        required: ['epd_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'compare_epds',
      description: 'Compare multiple EPDs side by side, showing GWP, fire rating, recycled content, and other properties.',
      parameters: {
        type: 'object',
        properties: {
          epd_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of EPD IDs to compare (2-4 EPDs).',
          },
        },
        required: ['epd_ids'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_epd_alternatives',
      description: 'Get alternative EPDs for a given EPD, typically with lower GWP.',
      parameters: {
        type: 'object',
        properties: {
          epd_id: {
            type: 'string',
            description: 'The EPD ID to find alternatives for.',
          },
          prefer_lower_gwp: {
            type: 'boolean',
            description: 'Whether to sort alternatives by lowest GWP first (default: true).',
          },
        },
        required: ['epd_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'propose_epd_mapping',
      description: 'Propose a new EPD mapping for a material. This creates a proposal that the user can accept or reject.',
      parameters: {
        type: 'object',
        properties: {
          material_id: {
            type: 'string',
            description: 'The material ID to propose a mapping for.',
          },
          proposed_epd_id: {
            type: 'string',
            description: 'The EPD ID being proposed.',
          },
          confidence: {
            type: 'number',
            minimum: 0,
            maximum: 100,
            description: 'Confidence score for this mapping (0-100).',
          },
          reasoning: {
            type: 'string',
            description: 'Detailed explanation of why this EPD is a good match.',
          },
          key_benefits: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of key benefits of this EPD choice.',
          },
        },
        required: ['material_id', 'proposed_epd_id', 'confidence', 'reasoning'],
      },
    },
  },
];

// ============ Tool Context Interface ============

export interface AgentToolContext {
  // IFC data
  extractedMaterials: Array<{
    id: string;
    name: string;
    category: MaterialCategory;
    elementIds: number[];
    totalVolume?: number;
    totalArea?: number;
    properties?: Record<string, unknown>;
  }>;

  // Current EPD matches
  currentMatches: Map<string, {
    epdId: string;
    epdName: string;
    confidence: number;
    gwp: number;
    calculatedGWP: number;
  }>;

  // Building context
  buildingInfo?: {
    name?: string;
    storeys?: string[];
    totalElements?: number;
  };
}

// ============ Tool Handlers ============

export function handleQueryBuildingElements(
  args: { element_type: string; include_properties?: boolean },
  context: AgentToolContext
): string {
  const { element_type, include_properties } = args;
  const { extractedMaterials, buildingInfo } = context;

  if (extractedMaterials.length === 0) {
    return 'No materials have been extracted from the IFC model yet. Please load an IFC file first.';
  }

  // Build summary
  let output = '=== Building Element Summary ===\n\n';

  if (buildingInfo) {
    output += `Building: ${buildingInfo.name || 'Unnamed'}\n`;
    if (buildingInfo.storeys) output += `Storeys: ${buildingInfo.storeys.join(', ')}\n`;
    output += `Total elements: ${buildingInfo.totalElements || 'Unknown'}\n\n`;
  }

  // Group materials by category
  const byCategory = new Map<MaterialCategory, typeof extractedMaterials>();
  for (const mat of extractedMaterials) {
    const list = byCategory.get(mat.category) || [];
    list.push(mat);
    byCategory.set(mat.category, list);
  }

  // Filter by element type if specified
  const filterType = element_type.toLowerCase();
  const categoryFilter = new Map<string, MaterialCategory[]>([
    ['wall', ['CONCRETE', 'MASONRY', 'GYPSUM', 'WOOD']],
    ['slab', ['CONCRETE', 'WOOD']],
    ['column', ['CONCRETE', 'STEEL', 'WOOD']],
    ['beam', ['STEEL', 'CONCRETE', 'WOOD']],
    ['window', ['GLASS', 'ALUMINUM']],
    ['door', ['WOOD', 'STEEL', 'ALUMINUM']],
    ['roof', ['CONCRETE', 'WOOD', 'MEMBRANE']],
    ['all', Array.from(byCategory.keys())],
  ]);

  const relevantCategories = categoryFilter.get(filterType) || Array.from(byCategory.keys());

  output += `Materials (${filterType === 'all' ? 'all types' : `relevant to ${filterType}`}):\n\n`;

  let totalElements = 0;
  let totalVolume = 0;

  for (const [category, materials] of byCategory) {
    if (!relevantCategories.includes(category)) continue;

    output += `📦 ${category}:\n`;

    for (const mat of materials) {
      const match = context.currentMatches.get(mat.id);
      const elementCount = mat.elementIds.length;
      totalElements += elementCount;

      output += `  • ${mat.name}\n`;
      output += `    Elements: ${elementCount}`;

      if (mat.totalVolume) {
        output += ` | Volume: ${mat.totalVolume.toFixed(2)} m³`;
        totalVolume += mat.totalVolume;
      }
      if (mat.totalArea) {
        output += ` | Area: ${mat.totalArea.toFixed(1)} m²`;
      }

      output += '\n';

      if (match) {
        output += `    Current EPD: ${match.epdName} (${match.confidence}% confidence)\n`;
        output += `    Calculated GWP: ${match.calculatedGWP.toFixed(0)} kg CO₂e\n`;
      } else {
        output += `    Current EPD: Not matched\n`;
      }

      if (include_properties && mat.properties) {
        const propStr = Object.entries(mat.properties)
          .filter(([, v]) => v !== undefined && v !== null)
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ');
        if (propStr) {
          output += `    Properties: ${propStr}\n`;
        }
      }

      output += '\n';
    }
  }

  output += `\n--- Summary ---\n`;
  output += `Total materials: ${extractedMaterials.length}\n`;
  output += `Total elements: ${totalElements}\n`;
  if (totalVolume > 0) output += `Total volume: ${totalVolume.toFixed(2)} m³\n`;

  return output;
}

export function handleGetMaterialDetails(
  args: { material_id: string },
  context: AgentToolContext
): string {
  const material = context.extractedMaterials.find(m => m.id === args.material_id);

  if (!material) {
    return `Material with ID "${args.material_id}" not found. Available materials: ${context.extractedMaterials.map(m => m.id).join(', ')}`;
  }

  const match = context.currentMatches.get(material.id);

  let output = `=== Material Details: ${material.name} ===\n\n`;
  output += `ID: ${material.id}\n`;
  output += `Category: ${material.category}\n`;
  output += `Elements: ${material.elementIds.length}\n`;

  if (material.totalVolume) output += `Total Volume: ${material.totalVolume.toFixed(2)} m³\n`;
  if (material.totalArea) output += `Total Area: ${material.totalArea.toFixed(1)} m²\n`;

  if (material.properties && Object.keys(material.properties).length > 0) {
    output += `\nProperties:\n`;
    for (const [key, value] of Object.entries(material.properties)) {
      if (value !== undefined && value !== null) {
        output += `  ${key}: ${value}\n`;
      }
    }
  }

  output += '\n--- Current EPD Match ---\n';
  if (match) {
    output += `EPD: ${match.epdName}\n`;
    output += `EPD ID: ${match.epdId}\n`;
    output += `Confidence: ${match.confidence}%\n`;
    output += `GWP per unit: ${match.gwp} kg CO₂e\n`;
    output += `Calculated GWP: ${match.calculatedGWP.toFixed(0)} kg CO₂e\n`;
  } else {
    output += 'No EPD currently matched.\n';
  }

  return output;
}

export function handleSearchEPDDatabase(args: EPDSearchCriteria): string {
  const results = mockEPDDatabase.searchEPDs(args);
  return formatSearchResultsForLLM(results);
}

export function handleGetEPDDetails(args: { epd_id: string }): string {
  const epd = mockEPDDatabase.getEPD(args.epd_id);

  if (!epd) {
    return `EPD with ID "${args.epd_id}" not found in database.`;
  }

  let output = `=== EPD Details: ${epd.name} ===\n\n`;
  output += `ID: ${epd.id}\n`;
  output += `Manufacturer: ${epd.manufacturer}\n`;
  output += `Category: ${epd.category} / ${epd.subcategory}\n`;
  output += `Declared Unit: ${epd.declared_unit.value} ${epd.declared_unit.unit}\n`;
  output += `Region: ${epd.region}\n`;
  output += `Verification: ${epd.verification}\n`;
  output += `Valid Until: ${epd.valid_until}\n`;

  output += '\n--- Environmental Impacts ---\n';
  output += `GWP A1-A3 (Production): ${epd.impacts.gwp_a1_a3} kg CO₂e\n`;
  if (epd.impacts.gwp_a4) output += `GWP A4 (Transport): ${epd.impacts.gwp_a4} kg CO₂e\n`;
  if (epd.impacts.gwp_c1_c4) output += `GWP C1-C4 (End of life): ${epd.impacts.gwp_c1_c4} kg CO₂e\n`;
  if (epd.impacts.gwp_d) output += `GWP D (Recycling benefits): ${epd.impacts.gwp_d} kg CO₂e\n`;
  if (epd.impacts.gwp_total) output += `GWP Total: ${epd.impacts.gwp_total} kg CO₂e\n`;

  output += '\n--- Technical Properties ---\n';
  const props = epd.properties;
  if (props.density) output += `Density: ${props.density} kg/m³\n`;
  if (props.compressive_strength) output += `Compressive Strength: ${props.compressive_strength}\n`;
  if (props.fire_rating) output += `Fire Rating: ${props.fire_rating}\n`;
  if (props.fire_class) output += `Fire Class: ${props.fire_class}\n`;
  if (props.thermal_conductivity) output += `Thermal Conductivity: ${props.thermal_conductivity} W/(m·K)\n`;
  if (props.recycled_content) output += `Recycled Content: ${props.recycled_content}%\n`;
  if (props.biogenic_carbon) output += `Biogenic Carbon: ${props.biogenic_carbon} kg CO₂\n`;

  output += '\n--- Applicability ---\n';
  output += `Use Cases: ${epd.use_cases.join(', ')}\n`;
  output += `Suitable For: ${epd.suitable_for.join(', ')}\n`;

  output += `\nDescription: ${epd.description}\n`;

  return output;
}

export function handleCompareEPDs(args: { epd_ids: string[] }): string {
  if (args.epd_ids.length < 2) {
    return 'Please provide at least 2 EPD IDs to compare.';
  }

  const comparison = mockEPDDatabase.compareEPDs(args.epd_ids);

  if (!comparison) {
    return 'Could not compare EPDs. Please check that all IDs are valid.';
  }

  return formatComparisonForLLM(comparison);
}

export function handleGetEPDAlternatives(args: { epd_id: string; prefer_lower_gwp?: boolean }): string {
  const alternatives = mockEPDDatabase.getAlternatives(args.epd_id, args.prefer_lower_gwp ?? true);

  if (alternatives.length === 0) {
    return `No alternatives found for EPD "${args.epd_id}".`;
  }

  let output = `=== Alternatives for ${args.epd_id} ===\n\n`;

  for (const alt of alternatives) {
    output += formatEPDForLLM(alt) + '\n\n';
  }

  return output;
}

export interface EPDProposal {
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
  created_at: number;
}

export function handleProposeEPDMapping(
  args: {
    material_id: string;
    proposed_epd_id: string;
    confidence: number;
    reasoning: string;
    key_benefits?: string[];
  },
  context: AgentToolContext
): { success: boolean; proposal?: EPDProposal; error?: string } {
  const material = context.extractedMaterials.find(m => m.id === args.material_id);
  if (!material) {
    return { success: false, error: `Material "${args.material_id}" not found.` };
  }

  const proposedEPD = mockEPDDatabase.getEPD(args.proposed_epd_id);
  if (!proposedEPD) {
    return { success: false, error: `EPD "${args.proposed_epd_id}" not found in database.` };
  }

  const currentMatch = context.currentMatches.get(args.material_id);

  // Calculate GWP difference
  const currentGWP = currentMatch?.calculatedGWP || 0;
  const quantity = material.totalVolume || material.totalArea || 1;

  // Determine unit conversion factor
  let proposedGWPTotal = proposedEPD.impacts.gwp_a1_a3 * quantity;

  const gwpDiff = proposedGWPTotal - currentGWP;
  const gwpDiffPercent = currentGWP > 0 ? (gwpDiff / currentGWP) * 100 : 0;

  const proposal: EPDProposal = {
    id: `proposal-${Date.now()}`,
    material_id: args.material_id,
    material_name: material.name,
    current_epd_id: currentMatch?.epdId,
    current_epd_name: currentMatch?.epdName,
    current_gwp: currentGWP,
    proposed_epd_id: args.proposed_epd_id,
    proposed_epd_name: proposedEPD.name,
    proposed_gwp: proposedGWPTotal,
    gwp_difference: gwpDiff,
    gwp_difference_percent: gwpDiffPercent,
    confidence: args.confidence,
    reasoning: args.reasoning,
    key_benefits: args.key_benefits || [],
    status: 'pending',
    created_at: Date.now(),
  };

  return { success: true, proposal };
}

// ============ Tool Execution Router ============

export function executeAgentTool(
  toolName: string,
  args: unknown,
  context: AgentToolContext
): { result: string; proposal?: EPDProposal } {
  switch (toolName) {
    case 'query_building_elements':
      return { result: handleQueryBuildingElements(args as { element_type: string; include_properties?: boolean }, context) };

    case 'get_material_details':
      return { result: handleGetMaterialDetails(args as { material_id: string }, context) };

    case 'search_epd_database':
      return { result: handleSearchEPDDatabase(args as EPDSearchCriteria) };

    case 'get_epd_details':
      return { result: handleGetEPDDetails(args as { epd_id: string }) };

    case 'compare_epds':
      return { result: handleCompareEPDs(args as { epd_ids: string[] }) };

    case 'get_epd_alternatives':
      return { result: handleGetEPDAlternatives(args as { epd_id: string; prefer_lower_gwp?: boolean }) };

    case 'propose_epd_mapping': {
      const result = handleProposeEPDMapping(
        args as {
          material_id: string;
          proposed_epd_id: string;
          confidence: number;
          reasoning: string;
          key_benefits?: string[];
        },
        context
      );
      if (result.success && result.proposal) {
        return {
          result: `✅ EPD mapping proposal created for "${result.proposal.material_name}":\n` +
            `  Proposed: ${result.proposal.proposed_epd_name}\n` +
            `  GWP change: ${result.proposal.gwp_difference >= 0 ? '+' : ''}${result.proposal.gwp_difference.toFixed(0)} kg CO₂e ` +
            `(${result.proposal.gwp_difference_percent >= 0 ? '+' : ''}${result.proposal.gwp_difference_percent.toFixed(1)}%)\n` +
            `  Confidence: ${result.proposal.confidence}%`,
          proposal: result.proposal,
        };
      } else {
        return { result: `❌ Failed to create proposal: ${result.error}` };
      }
    }

    default:
      return { result: `Unknown tool: ${toolName}` };
  }
}
