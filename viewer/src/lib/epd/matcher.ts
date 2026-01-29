/**
 * EPD Matching Algorithm
 * Matches extracted IFC materials to EPDs based on name, category, and keywords
 */

import type { EPD, ExtractedMaterial, EPDMatch, MaterialCategory, LCAResults } from './types';
import { epdDatabase } from './database';

/** Keywords that indicate material categories */
const categoryKeywords: Record<MaterialCategory, string[]> = {
  CONCRETE: ['concrete', 'beton', 'c20', 'c25', 'c30', 'c35', 'c40', 'c45', 'c50', 'ready mix', 'precast'],
  STEEL: ['steel', 'stahl', 'metal', 'rebar', 'reinforcement', 'structural steel', 'stainless'],
  WOOD: ['wood', 'holz', 'timber', 'lumber', 'clt', 'glulam', 'plywood', 'osb', 'mdf', 'pine', 'spruce', 'oak'],
  GLASS: ['glass', 'glas', 'glazing', 'window', 'igt', 'igu', 'double', 'triple'],
  INSULATION: ['insulation', 'dämmung', 'wool', 'eps', 'xps', 'pur', 'pir', 'foam', 'thermal'],
  MASONRY: ['brick', 'block', 'masonry', 'cmu', 'clay', 'stone', 'ziegel'],
  ALUMINUM: ['aluminum', 'aluminium', 'alu'],
  GYPSUM: ['gypsum', 'gips', 'plasterboard', 'drywall', 'gyprock'],
  PLASTIC: ['plastic', 'pvc', 'pe', 'pp', 'polymer'],
  MEMBRANE: ['membrane', 'bitumen', 'roofing', 'waterproof', 'vapor barrier'],
  OTHER: [],
};

/**
 * Detect material category from name and properties
 */
export function detectCategory(materialName: string, properties?: Record<string, unknown>): MaterialCategory {
  const lowerName = materialName.toLowerCase();

  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    if (keywords.some(keyword => lowerName.includes(keyword))) {
      return category as MaterialCategory;
    }
  }

  // Check properties if available
  if (properties) {
    const propsString = JSON.stringify(properties).toLowerCase();
    for (const [category, keywords] of Object.entries(categoryKeywords)) {
      if (keywords.some(keyword => propsString.includes(keyword))) {
        return category as MaterialCategory;
      }
    }
  }

  return 'OTHER';
}

/**
 * Calculate match score between a material and an EPD
 * Returns a score from 0-100
 */
function calculateMatchScore(material: ExtractedMaterial, epd: EPD): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const materialNameLower = material.name.toLowerCase();
  const epdNameLower = epd.name.toLowerCase();

  // Category match (25 points)
  if (material.category === epd.category) {
    score += 25;
    reasons.push(`Category match: ${epd.category}`);
  }

  // Name similarity (up to 30 points)
  const nameWords = materialNameLower.split(/[\s\-_\/]+/);
  const epdWords = epdNameLower.split(/[\s\-_\/]+/);
  const matchingWords = nameWords.filter(word =>
    word.length > 2 && epdWords.some(epdWord => epdWord.includes(word) || word.includes(epdWord))
  );
  const nameSimilarity = matchingWords.length / Math.max(nameWords.length, 1);
  const nameScore = Math.min(30, Math.round(nameSimilarity * 30));
  if (nameScore > 0) {
    score += nameScore;
    reasons.push(`Name similarity: ${matchingWords.join(', ')}`);
  }

  // Keyword matches (up to 25 points)
  const matchingKeywords = epd.keywords.filter(keyword =>
    materialNameLower.includes(keyword.toLowerCase())
  );
  const keywordScore = Math.min(25, matchingKeywords.length * 8);
  if (keywordScore > 0) {
    score += keywordScore;
    reasons.push(`Keywords: ${matchingKeywords.join(', ')}`);
  }

  // Data quality bonus (up to 10 points)
  if (epd.dataQuality === 'specific') {
    score += 10;
    reasons.push('Manufacturer-specific EPD');
  } else if (epd.dataQuality === 'average') {
    score += 5;
    reasons.push('Industry average EPD');
  }

  // Subcategory bonus (10 points)
  if (epd.subcategory) {
    const subcategoryLower = epd.subcategory.toLowerCase();
    if (materialNameLower.includes(subcategoryLower) || subcategoryLower.split(' ').some(w => materialNameLower.includes(w))) {
      score += 10;
      reasons.push(`Subcategory: ${epd.subcategory}`);
    }
  }

  return { score: Math.min(100, score), reasons };
}

/**
 * Find best matching EPD for a material
 */
export function findBestMatch(material: ExtractedMaterial): EPDMatch | null {
  let bestMatch: { epd: EPD; score: number; reasons: string[] } | null = null;
  const alternatives: EPD[] = [];

  // First, filter by category for efficiency
  const categoryEPDs = epdDatabase.filter(epd => epd.category === material.category);
  const otherEPDs = epdDatabase.filter(epd => epd.category !== material.category);

  // Score all EPDs in the same category
  for (const epd of categoryEPDs) {
    const { score, reasons } = calculateMatchScore(material, epd);
    if (score >= 25) { // Minimum threshold
      if (!bestMatch || score > bestMatch.score) {
        if (bestMatch) {
          alternatives.push(bestMatch.epd);
        }
        bestMatch = { epd, score, reasons };
      } else {
        alternatives.push(epd);
      }
    }
  }

  // If no good match in category, try other categories
  if (!bestMatch || bestMatch.score < 50) {
    for (const epd of otherEPDs) {
      const { score, reasons } = calculateMatchScore(material, epd);
      if (score >= 40) { // Higher threshold for cross-category
        if (!bestMatch || score > bestMatch.score) {
          if (bestMatch) {
            alternatives.push(bestMatch.epd);
          }
          bestMatch = { epd, score, reasons };
        }
      }
    }
  }

  if (!bestMatch) {
    return null;
  }

  // Calculate GWP based on quantity
  const { quantity, unit, gwp } = calculateGWP(material, bestMatch.epd);

  // Sort alternatives by GWP (lower is better)
  const sortedAlternatives = alternatives
    .filter(alt => alt.category === bestMatch!.epd.category)
    .sort((a, b) => a.impacts.gwp - b.impacts.gwp)
    .slice(0, 3);

  return {
    material,
    epd: bestMatch.epd,
    confidence: bestMatch.score,
    matchReason: bestMatch.reasons.join('; '),
    calculatedGWP: gwp,
    calculatedUnit: unit,
    quantity,
    alternatives: sortedAlternatives,
  };
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
    // Rough estimation based on what we have
    if (material.totalVolume && (declaredUnit === 'kg' || declaredUnit === 'ton')) {
      // Estimate weight from volume using typical densities
      const density = getCategoryDensity(material.category);
      quantity = material.totalVolume * density;
      if (declaredUnit === 'ton') {
        quantity = quantity / 1000;
      }
    } else if (material.totalArea && declaredUnit === 'm3') {
      // Estimate volume from area with assumed thickness
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
 * Match all materials and calculate total LCA results
 */
export function matchAllMaterials(materials: ExtractedMaterial[]): LCAResults {
  const matches: EPDMatch[] = [];
  const unmatchedMaterials: ExtractedMaterial[] = [];
  const byMaterial = new Map<string, number>();
  const byCategory = new Map<MaterialCategory, number>();
  let totalGWP = 0;

  for (const material of materials) {
    const match = findBestMatch(material);

    if (match && match.confidence >= 30) {
      matches.push(match);
      totalGWP += match.calculatedGWP;
      byMaterial.set(material.id, match.calculatedGWP);

      const currentCategoryGWP = byCategory.get(material.category) || 0;
      byCategory.set(material.category, currentCategoryGWP + match.calculatedGWP);
    } else {
      unmatchedMaterials.push(material);
    }
  }

  return {
    totalGWP,
    byMaterial,
    byCategory,
    matches,
    unmatchedMaterials,
  };
}

/**
 * Get lower-impact alternatives for a matched EPD
 */
export function getAlternatives(currentEPD: EPD, maxResults = 3): EPD[] {
  return epdDatabase
    .filter(epd =>
      epd.id !== currentEPD.id &&
      epd.category === currentEPD.category &&
      epd.impacts.gwp < currentEPD.impacts.gwp
    )
    .sort((a, b) => a.impacts.gwp - b.impacts.gwp)
    .slice(0, maxResults);
}

/**
 * Compare multiple EPDs
 */
export function compareEPDs(epdIds: string[]): EPD[] {
  return epdIds
    .map(id => epdDatabase.find(epd => epd.id === id))
    .filter((epd): epd is EPD => epd !== undefined);
}
