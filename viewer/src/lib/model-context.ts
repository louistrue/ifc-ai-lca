/**
 * Model Context Builder for EPD Agent
 * Extracts rich IFC model data in a structured, size-controlled format
 * for intelligent EPD matching with full model object context.
 *
 * OPTIMIZED FOR LARGE MODELS:
 * - Compact summaries with aggregated data
 * - Size limits on element details
 * - Sampling for very large models
 * - Prioritizes high-impact materials
 */

import type { FederatedModel } from '../store/types';
import type { ExtractedMaterial, LCAResults } from './epd/types';
import type { SpatialHierarchy, SpatialNode } from '@ifc-lite/data';
import { IfcTypeEnum } from '@ifc-lite/data';

// ============================================================================
// Configuration - Size Limits for Large Models
// ============================================================================

/** Maximum materials to include in summary (rest are aggregated) */
export const MAX_MATERIALS_IN_SUMMARY = 50;

/** Maximum storeys to include in summary */
export const MAX_STOREYS_IN_SUMMARY = 20;

/** Maximum element types to track per material */
export const MAX_ELEMENT_TYPES_PER_MATERIAL = 10;

/** Maximum elements to return in detail queries */
export const MAX_ELEMENTS_PER_QUERY = 50;

/** Maximum properties to include per element */
export const MAX_PROPERTIES_PER_ELEMENT = 20;

/** Element count threshold for "large model" optimizations */
export const LARGE_MODEL_THRESHOLD = 10000;

// ============================================================================
// Types
// ============================================================================

/** Compact model summary always sent to agent */
export interface ModelSummary {
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

/** Material summary with element type breakdown */
export interface MaterialSummary {
  id: string;
  name: string;
  category: string;

  // Aggregated quantities
  totalVolume: number;
  totalArea: number;
  totalWeight: number | null;
  elementCount: number;

  // Element type breakdown (critical for EPD selection)
  elementTypes: Record<string, number>;

  // Key properties aggregated
  commonProperties?: {
    thicknesses?: number[];
    fireRatings?: string[];
    strengthClasses?: string[];
  };

  // Current EPD mapping
  currentEpd?: {
    id: string;
    name: string;
    gwp: number;
    confidence: number;
    calculatedGwp: number;
  };
}

/** Storey summary for spatial context */
export interface StoreySummary {
  id: number;
  name: string;
  elevation: number;
  elementCount: number;
  materialBreakdown: Record<string, number>;
}

/** Detailed element information (on-demand via tools) */
export interface ElementDetail {
  id: number;
  type: string;
  name: string;
  description?: string;

  // Quantities
  volume?: number;
  area?: number;
  weight?: number;

  // Spatial context
  storeyId?: number;
  storeyName?: string;

  // Key properties (flattened)
  properties: Record<string, string | number | boolean>;
}

/** Full element data for specific queries */
export interface ElementFullData {
  id: number;
  type: string;
  name: string;
  description?: string;

  // All property sets
  propertySets: Array<{
    name: string;
    properties: Record<string, unknown>;
  }>;

  // All quantity sets
  quantitySets: Array<{
    name: string;
    quantities: Record<string, number>;
  }>;

  // Spatial context
  containedIn?: {
    storeyId: number;
    storeyName: string;
  };

  // Material
  materialName?: string;
}

/** Complete model context for agent */
export interface ModelContext {
  // Tier 1: Always sent
  summary: ModelSummary;

  // Tier 2: Element index for queries (compact)
  elementIndex: Array<{
    id: number;
    type: string;
    name: string;
    materialId: string | null;
    storeyId: number | null;
  }>;

  // Full element data map (populated on-demand by tools)
  // In serverless, this is pre-populated for elements of interest
  elementData: Map<number, ElementFullData>;
}

// ============================================================================
// Builder Functions
// ============================================================================

/**
 * Build model summary from extracted materials and LCA results
 * This is the primary context sent to the agent with each request
 */
export function buildModelSummary(
  models: FederatedModel[],
  extractedMaterials: ExtractedMaterial[],
  lcaResults: LCAResults | null,
  spatialHierarchy?: SpatialHierarchy
): ModelSummary {
  // Calculate project-level stats
  let totalElements = 0;
  let totalVolume = 0;
  let buildingCount = 0;
  let storeyCount = 0;
  let projectName = 'Unnamed Project';

  for (const model of models) {
    const entities = model.ifcDataStore.entities;
    if (entities) {
      totalElements += entities.count;
    }

    // Get project name from first model
    if (projectName === 'Unnamed Project') {
      const projectIds = entities?.getByType?.(IfcTypeEnum.IfcProject);
      if (projectIds?.length > 0) {
        projectName = entities.getName(projectIds[0]) || model.name || 'Unnamed Project';
      }
    }
  }

  // Count buildings and storeys from spatial hierarchy
  if (spatialHierarchy?.project) {
    const countSpatial = (node: SpatialNode): { buildings: number; storeys: number } => {
      let buildings = 0;
      let storeys = 0;

      if (node.type === IfcTypeEnum.IfcBuilding) buildings++;
      if (node.type === IfcTypeEnum.IfcBuildingStorey) storeys++;

      for (const child of node.children) {
        const counts = countSpatial(child);
        buildings += counts.buildings;
        storeys += counts.storeys;
      }

      return { buildings, storeys };
    };

    const counts = countSpatial(spatialHierarchy.project);
    buildingCount = counts.buildings;
    storeyCount = counts.storeys;
  }

  // Build material summaries
  const materialSummaries: MaterialSummary[] = extractedMaterials.map(mat => {
    // Calculate element type breakdown
    const elementTypes: Record<string, number> = {};

    // Get current EPD match if exists
    let currentEpd: MaterialSummary['currentEpd'] | undefined;
    if (lcaResults) {
      const match = lcaResults.matches.find(m => m.material.id === mat.id);
      if (match) {
        currentEpd = {
          id: match.epd.id,
          name: match.epd.name,
          gwp: match.epd.impacts.gwp,
          confidence: match.confidence,
          calculatedGwp: match.calculatedGWP,
        };
      }
    }

    // Sum up volume
    totalVolume += mat.totalVolume || 0;

    // For element type breakdown, we need to look at each element
    // This requires access to the model's entity table
    for (const model of models) {
      const entities = model.ifcDataStore.entities;
      if (!entities) continue;

      for (const elementId of mat.elementIds) {
        // Convert global ID back to original if needed
        const originalId = elementId > model.idOffset && elementId <= model.idOffset + model.maxExpressId
          ? elementId - model.idOffset
          : elementId;

        const typeName = entities.getTypeName?.(originalId);
        if (typeName) {
          elementTypes[typeName] = (elementTypes[typeName] || 0) + 1;
        }
      }
    }

    return {
      id: mat.id,
      name: mat.name,
      category: mat.category,
      totalVolume: mat.totalVolume || 0,
      totalArea: mat.totalArea || 0,
      totalWeight: mat.totalWeight || null,
      elementCount: mat.elementIds.length,
      elementTypes,
      currentEpd,
    };
  });

  // Build storey summaries
  const storeySummaries: StoreySummary[] = [];
  if (spatialHierarchy) {
    for (const [storeyId, elementIds] of spatialHierarchy.byStorey) {
      // Find storey name
      let storeyName = `Storey #${storeyId}`;
      for (const model of models) {
        const name = model.ifcDataStore.entities?.getName?.(storeyId);
        if (name) {
          storeyName = name;
          break;
        }
      }

      // Calculate material breakdown for this storey
      const materialBreakdown: Record<string, number> = {};
      for (const elementId of elementIds) {
        // Find which material this element belongs to
        for (const mat of extractedMaterials) {
          if (mat.elementIds.includes(elementId)) {
            materialBreakdown[mat.name] = (materialBreakdown[mat.name] || 0) + 1;
            break;
          }
        }
      }

      storeySummaries.push({
        id: storeyId,
        name: storeyName,
        elevation: spatialHierarchy.storeyElevations.get(storeyId) || 0,
        elementCount: elementIds.length,
        materialBreakdown,
      });
    }

    // Sort by elevation
    storeySummaries.sort((a, b) => a.elevation - b.elevation);
  }

  // Build LCA summary
  let lcaSummary: ModelSummary['lca'] | undefined;
  if (lcaResults) {
    const gwpByCategory: Record<string, number> = {};
    for (const [cat, gwp] of lcaResults.byCategory) {
      gwpByCategory[cat] = gwp;
    }

    lcaSummary = {
      totalGwp: lcaResults.totalGWP,
      gwpByCategory,
    };
  }

  return {
    project: {
      name: projectName,
      elementCount: totalElements,
      buildingCount,
      storeyCount,
      totalVolume,
    },
    materials: materialSummaries,
    storeys: storeySummaries,
    lca: lcaSummary,
  };
}

/**
 * Build element index for large models
 * Compact array for agent to query specific elements
 */
export function buildElementIndex(
  models: FederatedModel[],
  extractedMaterials: ExtractedMaterial[],
  spatialHierarchy?: SpatialHierarchy,
  maxElements: number = 1000
): ModelContext['elementIndex'] {
  const index: ModelContext['elementIndex'] = [];

  // Create material lookup by element ID
  const elementToMaterial = new Map<number, string>();
  for (const mat of extractedMaterials) {
    for (const elementId of mat.elementIds) {
      elementToMaterial.set(elementId, mat.id);
    }
  }

  // Build index from all models
  for (const model of models) {
    const entities = model.ifcDataStore.entities;
    if (!entities) continue;

    // Iterate through entities
    for (let i = 0; i < Math.min(entities.count, maxElements); i++) {
      const expressId = entities.expressId[i];
      const globalId = expressId + model.idOffset;

      // Skip if not a product (has geometry)
      if (!entities.hasGeometry(expressId)) continue;

      const typeName = entities.getTypeName?.(expressId) || 'Unknown';
      const name = entities.getName(expressId) || `Element #${expressId}`;
      const materialId = elementToMaterial.get(globalId) || elementToMaterial.get(expressId) || null;
      const storeyId = spatialHierarchy?.elementToStorey.get(expressId) || null;

      index.push({
        id: globalId,
        type: typeName,
        name,
        materialId,
        storeyId,
      });
    }
  }

  return index;
}

/**
 * Get detailed element data for specific elements
 * Used by agent tools to get full properties
 */
export function getElementDetails(
  models: FederatedModel[],
  elementIds: number[],
  extractedMaterials: ExtractedMaterial[],
  spatialHierarchy?: SpatialHierarchy
): ElementDetail[] {
  const details: ElementDetail[] = [];

  // Create material lookup
  const elementToMaterial = new Map<number, ExtractedMaterial>();
  for (const mat of extractedMaterials) {
    for (const elementId of mat.elementIds) {
      elementToMaterial.set(elementId, mat);
    }
  }

  for (const elementId of elementIds) {
    for (const model of models) {
      const entities = model.ifcDataStore.entities;
      if (!entities) continue;

      // Convert global ID to original
      const originalId = elementId > model.idOffset && elementId <= model.idOffset + model.maxExpressId
        ? elementId - model.idOffset
        : elementId;

      const typeName = entities.getTypeName?.(originalId);
      if (!typeName) continue;

      const name = entities.getName(originalId) || `Element #${originalId}`;
      const description = entities.getDescription?.(originalId) || undefined;

      // Get quantities
      let volume: number | undefined;
      let area: number | undefined;
      let weight: number | undefined;

      const quantities = model.ifcDataStore.quantities;
      if (quantities?.getForEntity) {
        const qsets = quantities.getForEntity(originalId);
        if (Array.isArray(qsets)) {
          for (const qset of qsets) {
            for (const qty of qset.quantities || []) {
              const qname = (qty.name || '').toLowerCase();
              const value = qty.value ?? 0;

              if (qname.includes('volume')) volume = (volume || 0) + value;
              if (qname.includes('area')) area = (area || 0) + value;
              if (qname.includes('weight') || qname.includes('mass')) weight = (weight || 0) + value;
            }
          }
        }
      }

      // Get spatial context
      const storeyId = spatialHierarchy?.elementToStorey.get(originalId);
      let storeyName: string | undefined;
      if (storeyId) {
        storeyName = entities.getName(storeyId) || `Storey #${storeyId}`;
      }

      // Get key properties (flattened, with size limit)
      const properties: Record<string, string | number | boolean> = {};
      let propCount = 0;
      const props = model.ifcDataStore.properties;
      if (props?.getForEntity) {
        const psets = props.getForEntity(originalId);
        if (Array.isArray(psets)) {
          outer: for (const pset of psets) {
            for (const prop of pset.properties || []) {
              // Limit properties per element for large models
              if (propCount >= MAX_PROPERTIES_PER_ELEMENT) break outer;

              // Handle both property formats (name/value and property_name/property_value)
              const propAny = prop as unknown as Record<string, unknown>;
              const pname = (propAny.name || propAny.property_name) as string | undefined;
              const pvalue = propAny.value ?? propAny.property_value;

              if (pname && pvalue !== undefined && pvalue !== null) {
                // Only include scalar values
                if (typeof pvalue === 'string' || typeof pvalue === 'number' || typeof pvalue === 'boolean') {
                  properties[pname] = pvalue;
                  propCount++;
                }
              }
            }
          }
        }
      }

      details.push({
        id: elementId,
        type: typeName,
        name,
        description,
        volume,
        area,
        weight,
        storeyId,
        storeyName,
        properties,
      });

      break; // Found in this model, no need to check others
    }
  }

  return details;
}

/**
 * Get elements for a specific material with details
 * Used by agent tool: get_elements_for_material
 */
export function getElementsForMaterial(
  models: FederatedModel[],
  materialId: string,
  extractedMaterials: ExtractedMaterial[],
  spatialHierarchy?: SpatialHierarchy,
  limit: number = 50
): ElementDetail[] {
  const material = extractedMaterials.find(m => m.id === materialId);
  if (!material) return [];

  // Get elements, limited to avoid huge responses
  const elementIds = material.elementIds.slice(0, limit);
  return getElementDetails(models, elementIds, extractedMaterials, spatialHierarchy);
}

/**
 * Get elements grouped by storey
 * Used by agent tool: get_spatial_breakdown
 */
export function getElementsByStorey(
  models: FederatedModel[],
  extractedMaterials: ExtractedMaterial[],
  spatialHierarchy?: SpatialHierarchy,
  storeyName?: string
): Record<string, { elements: ElementDetail[]; materialBreakdown: Record<string, number> }> {
  const result: Record<string, { elements: ElementDetail[]; materialBreakdown: Record<string, number> }> = {};

  if (!spatialHierarchy) return result;

  for (const [storeyId, elementIds] of spatialHierarchy.byStorey) {
    // Find storey name
    let name = `Storey #${storeyId}`;
    for (const model of models) {
      const n = model.ifcDataStore.entities?.getName?.(storeyId);
      if (n) {
        name = n;
        break;
      }
    }

    // Filter by storey name if specified
    if (storeyName && !name.toLowerCase().includes(storeyName.toLowerCase())) {
      continue;
    }

    // Get element details (limited)
    const limitedIds = elementIds.slice(0, 20);
    const elements = getElementDetails(models, limitedIds, extractedMaterials, spatialHierarchy);

    // Calculate material breakdown
    const materialBreakdown: Record<string, number> = {};
    for (const elementId of elementIds) {
      for (const mat of extractedMaterials) {
        if (mat.elementIds.includes(elementId)) {
          materialBreakdown[mat.name] = (materialBreakdown[mat.name] || 0) + 1;
          break;
        }
      }
    }

    result[name] = { elements, materialBreakdown };
  }

  return result;
}

/**
 * Search elements by name/description
 * Used by agent tool: search_elements
 */
export function searchElements(
  models: FederatedModel[],
  query: string,
  extractedMaterials: ExtractedMaterial[],
  spatialHierarchy?: SpatialHierarchy,
  limit: number = 20
): ElementDetail[] {
  const results: ElementDetail[] = [];
  const lowerQuery = query.toLowerCase();

  for (const model of models) {
    const entities = model.ifcDataStore.entities;
    if (!entities) continue;

    for (let i = 0; i < entities.count && results.length < limit; i++) {
      const expressId = entities.expressId[i];

      // Skip if not a product
      if (!entities.hasGeometry(expressId)) continue;

      const name = entities.getName(expressId) || '';
      const description = entities.getDescription?.(expressId) || '';
      const typeName = entities.getTypeName?.(expressId) || '';

      // Match against name, description, or type
      if (
        name.toLowerCase().includes(lowerQuery) ||
        description.toLowerCase().includes(lowerQuery) ||
        typeName.toLowerCase().includes(lowerQuery)
      ) {
        const globalId = expressId + model.idOffset;
        const details = getElementDetails(models, [globalId], extractedMaterials, spatialHierarchy);
        if (details.length > 0) {
          results.push(details[0]);
        }
      }
    }
  }

  return results;
}

/**
 * Get high-impact elements (highest GWP contribution)
 * Used by agent tool: get_high_impact_elements
 */
export function getHighImpactElements(
  models: FederatedModel[],
  extractedMaterials: ExtractedMaterial[],
  lcaResults: LCAResults | null,
  spatialHierarchy?: SpatialHierarchy,
  limit: number = 20
): Array<ElementDetail & { estimatedGwp: number; materialName: string }> {
  if (!lcaResults) return [];

  // Calculate GWP per element based on material match
  const elementGwps: Array<{ elementId: number; gwp: number; materialId: string }> = [];

  for (const match of lcaResults.matches) {
    const material = match.material;
    const gwpPerElement = match.calculatedGWP / material.elementIds.length;

    for (const elementId of material.elementIds) {
      elementGwps.push({
        elementId,
        gwp: gwpPerElement,
        materialId: material.id,
      });
    }
  }

  // Sort by GWP descending
  elementGwps.sort((a, b) => b.gwp - a.gwp);

  // Get top elements with details
  const topElements = elementGwps.slice(0, limit);
  const details = getElementDetails(
    models,
    topElements.map(e => e.elementId),
    extractedMaterials,
    spatialHierarchy
  );

  // Merge with GWP and material info
  return details.map((detail, i) => {
    const material = extractedMaterials.find(m => m.id === topElements[i].materialId);
    return {
      ...detail,
      estimatedGwp: topElements[i].gwp,
      materialName: material?.name || 'Unknown',
    };
  });
}

// ============================================================================
// Large Model Helpers
// ============================================================================

/**
 * Estimate the JSON payload size for model context
 * Useful for debugging and optimization
 */
export function estimatePayloadSize(
  summary: ModelSummary,
  elementDetails?: Record<string, ElementDetail[]>
): { summaryKB: number; detailsKB: number; totalKB: number } {
  const summaryStr = JSON.stringify(summary);
  const detailsStr = elementDetails ? JSON.stringify(elementDetails) : '';

  const summaryKB = Math.round(summaryStr.length / 1024);
  const detailsKB = Math.round(detailsStr.length / 1024);

  return {
    summaryKB,
    detailsKB,
    totalKB: summaryKB + detailsKB,
  };
}

/**
 * Check if this is a "large model" that needs special handling
 */
export function isLargeModel(models: FederatedModel[]): boolean {
  let totalElements = 0;
  for (const model of models) {
    if (model.ifcDataStore.entities) {
      totalElements += model.ifcDataStore.entities.count;
    }
  }
  return totalElements > LARGE_MODEL_THRESHOLD;
}

/**
 * Get model statistics for logging/debugging
 */
export function getModelStats(models: FederatedModel[]): {
  totalElements: number;
  totalModels: number;
  isLarge: boolean;
} {
  let totalElements = 0;
  for (const model of models) {
    if (model.ifcDataStore.entities) {
      totalElements += model.ifcDataStore.entities.count;
    }
  }

  return {
    totalElements,
    totalModels: models.length,
    isLarge: totalElements > LARGE_MODEL_THRESHOLD,
  };
}
