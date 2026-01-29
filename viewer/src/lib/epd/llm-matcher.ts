/**
 * LLM-based EPD Matching
 * Uses a fast LLM (GPT-4o-mini) to match building materials to EPDs
 * Falls back to algorithmic matching if LLM is unavailable
 */

import type { EPD, ExtractedMaterial, EPDMatch, LCAResults, MaterialCategory } from './types';
import { epdDatabase, getEPDById } from './database';
import { matchAllMaterials as algorithmicMatch, findBestMatch } from './matcher';

/** API endpoint for EPD mapping */
const API_ENDPOINT = import.meta.env.DEV
  ? 'http://localhost:3001/api/epd-mapping'
  : '/api/epd-mapping';

/** LLM mapping result from API */
interface LLMMapping {
  materialName: string;
  epdId: string;
  confidence: number;
  reasoning: string;
}

/** API response */
interface EPDMappingResponse {
  mappings: LLMMapping[];
  model: string;
}

/**
 * Prepare EPD database summary for LLM
 */
function prepareEPDSummary(): Array<{
  id: string;
  name: string;
  category: string;
  subcategory?: string;
  keywords: string[];
  gwp: number;
  unit: string;
}> {
  return epdDatabase.map(epd => ({
    id: epd.id,
    name: epd.name,
    category: epd.category,
    subcategory: epd.subcategory,
    keywords: epd.keywords,
    gwp: epd.impacts.gwp,
    unit: epd.declaredUnit.unit,
  }));
}

/**
 * Call LLM API to get material-to-EPD mappings
 */
async function callLLMMapping(materials: ExtractedMaterial[]): Promise<LLMMapping[] | null> {
  try {
    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        materials: materials.map(m => ({
          id: m.id,
          name: m.name,
          category: m.category,
          totalVolume: m.totalVolume,
          totalArea: m.totalArea,
          totalWeight: m.totalWeight,
          properties: m.properties,
        })),
        epdDatabase: prepareEPDSummary(),
      }),
    });

    if (!response.ok) {
      console.warn('[LLM-Matcher] API returned error:', response.status);
      return null;
    }

    const data = await response.json() as EPDMappingResponse;
    console.log(`[LLM-Matcher] Got ${data.mappings.length} mappings from ${data.model}`);
    return data.mappings;
  } catch (error) {
    console.warn('[LLM-Matcher] API call failed:', error);
    return null;
  }
}

/**
 * Calculate GWP for a material based on its quantity and matched EPD
 */
function calculateGWP(
  material: ExtractedMaterial,
  epd: EPD
): { quantity: number; unit: typeof epd.declaredUnit.unit; gwp: number } {
  const declaredUnit = epd.declaredUnit.unit;
  let quantity = 0;

  switch (declaredUnit) {
    case 'm3':
      quantity = material.totalVolume || 0;
      break;
    case 'm2':
      quantity = material.totalArea || 0;
      break;
    case 'kg':
    case 'ton':
      quantity = material.totalWeight || 0;
      if (declaredUnit === 'ton') {
        quantity = quantity / 1000;
      }
      break;
    case 'm':
      quantity = material.totalLength || 0;
      break;
    case 'piece':
      quantity = material.elementIds.length;
      break;
  }

  // If we don't have the right quantity type, estimate
  if (quantity === 0) {
    if (material.totalVolume && (declaredUnit === 'kg' || declaredUnit === 'ton')) {
      const density = getCategoryDensity(material.category);
      quantity = material.totalVolume * density;
      if (declaredUnit === 'ton') {
        quantity = quantity / 1000;
      }
    } else if (material.totalArea && declaredUnit === 'm3') {
      quantity = material.totalArea * 0.2; // Assume 200mm average thickness
    }
  }

  const gwpPerUnit = epd.impacts.gwp / epd.declaredUnit.value;
  const totalGWP = quantity * gwpPerUnit;

  return { quantity, unit: declaredUnit, gwp: totalGWP };
}

/**
 * Get typical density for a material category (kg/m³)
 */
function getCategoryDensity(category: MaterialCategory): number {
  const densities: Record<MaterialCategory, number> = {
    CONCRETE: 2400,
    STEEL: 7850,
    WOOD: 500,
    GLASS: 2500,
    INSULATION: 50,
    MASONRY: 1800,
    ALUMINUM: 2700,
    GYPSUM: 800,
    PLASTIC: 1200,
    MEMBRANE: 1100,
    OTHER: 1500,
  };
  return densities[category];
}

/**
 * Get lower-impact alternatives for an EPD
 */
function getAlternatives(currentEPD: EPD): EPD[] {
  return epdDatabase
    .filter(epd =>
      epd.id !== currentEPD.id &&
      epd.category === currentEPD.category &&
      epd.impacts.gwp < currentEPD.impacts.gwp
    )
    .sort((a, b) => a.impacts.gwp - b.impacts.gwp)
    .slice(0, 3);
}

/**
 * Convert LLM mapping to EPDMatch
 */
function llmMappingToEPDMatch(
  material: ExtractedMaterial,
  mapping: LLMMapping
): EPDMatch | null {
  const epd = getEPDById(mapping.epdId);
  if (!epd) {
    console.warn(`[LLM-Matcher] EPD not found: ${mapping.epdId}`);
    return null;
  }

  const { quantity, unit, gwp } = calculateGWP(material, epd);

  return {
    material,
    epd,
    confidence: mapping.confidence,
    matchReason: `LLM: ${mapping.reasoning}`,
    calculatedGWP: gwp,
    calculatedUnit: unit,
    quantity,
    alternatives: getAlternatives(epd),
  };
}

/**
 * Match materials to EPDs using LLM with fallback to algorithmic matching
 * @param materials - List of extracted materials from IFC
 * @param useLLM - Whether to try LLM matching first (default: true)
 * @returns LCA results with matched and unmatched materials
 */
export async function matchAllMaterialsWithLLM(
  materials: ExtractedMaterial[],
  useLLM = true
): Promise<LCAResults> {
  if (materials.length === 0) {
    return {
      totalGWP: 0,
      byMaterial: new Map(),
      byCategory: new Map(),
      matches: [],
      unmatchedMaterials: [],
    };
  }

  // Try LLM matching first if enabled
  if (useLLM) {
    console.log('[LLM-Matcher] Attempting LLM-based EPD matching...');
    const llmMappings = await callLLMMapping(materials);

    if (llmMappings && llmMappings.length > 0) {
      console.log('[LLM-Matcher] Processing LLM mappings...');

      const matches: EPDMatch[] = [];
      const unmatchedMaterials: ExtractedMaterial[] = [];
      const byMaterial = new Map<string, number>();
      const byCategory = new Map<MaterialCategory, number>();
      let totalGWP = 0;

      // Create mapping lookup by material name (normalized)
      const mappingLookup = new Map<string, LLMMapping>();
      for (const mapping of llmMappings) {
        mappingLookup.set(mapping.materialName.toLowerCase(), mapping);
      }

      for (const material of materials) {
        // Look up LLM mapping
        const mapping = mappingLookup.get(material.name.toLowerCase());

        if (mapping && mapping.confidence >= 30) {
          const match = llmMappingToEPDMatch(material, mapping);

          if (match) {
            matches.push(match);
            totalGWP += match.calculatedGWP;
            byMaterial.set(material.id, match.calculatedGWP);

            const currentCategoryGWP = byCategory.get(material.category) || 0;
            byCategory.set(material.category, currentCategoryGWP + match.calculatedGWP);
            continue;
          }
        }

        // Fall back to algorithmic matching for this material
        console.log(`[LLM-Matcher] Falling back to algorithmic match for: ${material.name}`);
        const algoMatch = findBestMatch(material);

        if (algoMatch && algoMatch.confidence >= 30) {
          matches.push(algoMatch);
          totalGWP += algoMatch.calculatedGWP;
          byMaterial.set(material.id, algoMatch.calculatedGWP);

          const currentCategoryGWP = byCategory.get(material.category) || 0;
          byCategory.set(material.category, currentCategoryGWP + algoMatch.calculatedGWP);
        } else {
          unmatchedMaterials.push(material);
        }
      }

      console.log(`[LLM-Matcher] Results: ${matches.length} matched, ${unmatchedMaterials.length} unmatched`);

      return {
        totalGWP,
        byMaterial,
        byCategory,
        matches,
        unmatchedMaterials,
      };
    }

    console.log('[LLM-Matcher] LLM mapping failed, falling back to algorithmic matching');
  }

  // Fall back to purely algorithmic matching
  console.log('[LLM-Matcher] Using algorithmic matching');
  return algorithmicMatch(materials);
}

/**
 * Check if LLM EPD mapping API is available
 */
export async function checkLLMAvailability(): Promise<boolean> {
  try {
    const healthEndpoint = import.meta.env.DEV
      ? 'http://localhost:3001/api/health'
      : '/api/health';

    const response = await fetch(healthEndpoint);
    if (!response.ok) return false;

    const data = await response.json() as { hasApiKey?: boolean };
    return data.hasApiKey === true;
  } catch {
    return false;
  }
}
