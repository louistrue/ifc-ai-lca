/**
 * LCA (Life Cycle Assessment) State Slice
 * Manages EPD matching results and LCA calculations
 */

import type { StateCreator } from 'zustand';
import type { ExtractedMaterial, EPDMatch, LCAResults, MaterialCategory } from '../../lib/epd/types';
import { matchAllMaterials, detectCategory, findBestMatch } from '../../lib/epd/matcher';

export interface LCASlice {
  // Extracted materials from IFC
  extractedMaterials: ExtractedMaterial[];

  // LCA Results
  lcaResults: LCAResults | null;

  // UI State
  selectedMaterialId: string | null;
  highlightedMaterialElements: number[];

  // Actions
  setExtractedMaterials: (materials: ExtractedMaterial[]) => void;
  runEPDMatching: () => void;
  selectMaterial: (materialId: string | null) => void;
  clearLCAResults: () => void;

  // Helpers
  getMaterialById: (id: string) => ExtractedMaterial | undefined;
  getMatchByMaterialId: (id: string) => EPDMatch | undefined;
}

export const createLCASlice: StateCreator<LCASlice, [], [], LCASlice> = (set, get) => ({
  // Initial state
  extractedMaterials: [],
  lcaResults: null,
  selectedMaterialId: null,
  highlightedMaterialElements: [],

  // Actions
  setExtractedMaterials: (materials) => {
    set({ extractedMaterials: materials });
  },

  runEPDMatching: () => {
    const { extractedMaterials } = get();
    if (extractedMaterials.length === 0) {
      return;
    }

    const results = matchAllMaterials(extractedMaterials);
    set({ lcaResults: results });
  },

  selectMaterial: (materialId) => {
    const { extractedMaterials } = get();
    const material = materialId ? extractedMaterials.find(m => m.id === materialId) : null;

    set({
      selectedMaterialId: materialId,
      highlightedMaterialElements: material?.elementIds || [],
    });
  },

  clearLCAResults: () => {
    set({
      extractedMaterials: [],
      lcaResults: null,
      selectedMaterialId: null,
      highlightedMaterialElements: [],
    });
  },

  // Helpers
  getMaterialById: (id) => {
    return get().extractedMaterials.find(m => m.id === id);
  },

  getMatchByMaterialId: (id) => {
    const { lcaResults } = get();
    return lcaResults?.matches.find(m => m.material.id === id);
  },
});

/**
 * Extract materials from IFC data store
 * This aggregates materials by name and calculates totals
 */
export function extractMaterialsFromIFC(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ifcDataStore: any | null,
  geometryMeshes?: { expressId: number; ifcType?: string }[]
): ExtractedMaterial[] {
  if (!ifcDataStore) return [];

  const materialMap = new Map<string, ExtractedMaterial>();

  // Get all entities with geometry (from meshes)
  const entityIds = geometryMeshes?.map(m => m.expressId) || [];

  // Try to extract materials from properties
  // Handle different possible data structures from ifc-lite
  if (ifcDataStore.properties && typeof ifcDataStore.properties[Symbol.iterator] === 'function') {
    try {
      for (const [entityId, propSets] of ifcDataStore.properties) {
        if (!propSets || typeof propSets[Symbol.iterator] !== 'function') continue;

        // Look for material-related property sets
        for (const [psetName, props] of propSets) {
          if (!props) continue;

          // Handle both Map and Object formats
          const getProp = (key: string) => {
            if (props instanceof Map) return props.get(key);
            if (typeof props === 'object') return (props as Record<string, unknown>)[key];
            return undefined;
          };

          // Check for material name in properties
          const materialName = getProp('Material') as string ||
                              getProp('MaterialName') as string ||
                              getProp('material') as string;

          if (materialName && typeof materialName === 'string') {
            const propsMap = props instanceof Map ? props : new Map(Object.entries(props || {}));
            const q = getQuantitiesForEntity(entityId);
            addOrUpdateMaterial(materialMap, materialName, entityId, propsMap, q);
          }
        }
      }
    } catch (err) {
      console.warn('[LCA] Failed to extract materials from properties:', err);
    }
  }

  // Helper to safely get quantities for an entity
  const getQuantitiesForEntity = (entityId: number): { volume: number; area: number; weight: number } => {
    let volume = 0;
    let area = 0;
    let weight = 0;

    try {
      if (!ifcDataStore.quantities) return { volume, area, weight };

      // Handle both Map and Object access
      let qsets: unknown;
      if (ifcDataStore.quantities instanceof Map) {
        qsets = ifcDataStore.quantities.get(entityId);
      } else if (typeof ifcDataStore.quantities === 'object') {
        qsets = (ifcDataStore.quantities as Record<number, unknown>)[entityId];
      }

      if (!qsets) return { volume, area, weight };

      // Iterate through quantity sets
      const iterateQsets = qsets instanceof Map ? qsets : (typeof qsets === 'object' ? Object.entries(qsets) : []);
      for (const entry of iterateQsets) {
        const quantities = entry instanceof Array ? entry[1] : entry;
        if (!quantities) continue;

        const iterateQuantities = quantities instanceof Map ? quantities : (typeof quantities === 'object' ? Object.entries(quantities) : []);
        for (const qEntry of iterateQuantities) {
          const [qName, qValue] = qEntry instanceof Array ? qEntry : [qEntry, null];
          if (!qValue || typeof qValue !== 'object') continue;

          const lowerName = String(qName).toLowerCase();
          const value = (qValue as { value?: number }).value || 0;

          if (lowerName.includes('volume') || lowerName.includes('netvolume')) {
            volume += value;
          }
          if (lowerName.includes('area') || lowerName.includes('netarea')) {
            area += value;
          }
          if (lowerName.includes('weight') || lowerName.includes('mass')) {
            weight += value;
          }
        }
      }
    } catch (err) {
      console.warn('[LCA] Failed to get quantities for entity:', entityId, err);
    }

    return { volume, area, weight };
  };

  // If no materials found from properties, try to infer from IFC types
  if (materialMap.size === 0 && geometryMeshes) {
    // Group by IFC type as fallback
    const typeGroups = new Map<string, number[]>();

    for (const mesh of geometryMeshes) {
      const ifcType = mesh.ifcType || 'Unknown';
      const existing = typeGroups.get(ifcType) || [];
      existing.push(mesh.expressId);
      typeGroups.set(ifcType, existing);
    }

    // Create pseudo-materials from types
    for (const [ifcType, ids] of typeGroups) {
      const materialName = inferMaterialFromType(ifcType);
      const category = detectCategory(materialName);

      // Get quantities if available
      let totalVolume = 0;
      let totalArea = 0;

      for (const entityId of ids) {
        const q = getQuantitiesForEntity(entityId);
        totalVolume += q.volume;
        totalArea += q.area;
      }

      const material: ExtractedMaterial = {
        id: `mat-${ifcType.toLowerCase()}`,
        name: materialName,
        category,
        elementIds: ids,
        totalVolume: totalVolume > 0 ? totalVolume : undefined,
        totalArea: totalArea > 0 ? totalArea : undefined,
        properties: { ifcType },
      };

      materialMap.set(material.id, material);
    }
  }

  return Array.from(materialMap.values());
}

function addOrUpdateMaterial(
  materialMap: Map<string, ExtractedMaterial>,
  name: string,
  entityId: number,
  props: Map<string, unknown>,
  quantities: { volume: number; area: number; weight: number }
): void {
  const id = `mat-${name.toLowerCase().replace(/\s+/g, '-')}`;
  const existing = materialMap.get(id);

  const { volume, area, weight } = quantities;

  if (existing) {
    existing.elementIds.push(entityId);
    if (volume > 0) existing.totalVolume = (existing.totalVolume || 0) + volume;
    if (area > 0) existing.totalArea = (existing.totalArea || 0) + area;
    if (weight > 0) existing.totalWeight = (existing.totalWeight || 0) + weight;
  } else {
    const category = detectCategory(name, Object.fromEntries(props));
    materialMap.set(id, {
      id,
      name,
      category,
      elementIds: [entityId],
      totalVolume: volume > 0 ? volume : undefined,
      totalArea: area > 0 ? area : undefined,
      totalWeight: weight > 0 ? weight : undefined,
      properties: Object.fromEntries(props),
    });
  }
}

function inferMaterialFromType(ifcType: string): string {
  const typeMap: Record<string, string> = {
    IFCWALL: 'Concrete Wall',
    IFCWALLSTANDARDCASE: 'Concrete Wall',
    IFCSLAB: 'Concrete Slab',
    IFCCOLUMN: 'Concrete Column',
    IFCBEAM: 'Steel Beam',
    IFCWINDOW: 'Glass Window',
    IFCDOOR: 'Wood Door',
    IFCROOF: 'Roof Assembly',
    IFCSTAIR: 'Concrete Stair',
    IFCRAILING: 'Steel Railing',
    IFCCURTAINWALL: 'Aluminum Curtain Wall',
    IFCPLATE: 'Steel Plate',
    IFCMEMBER: 'Steel Member',
    IFCFOOTING: 'Concrete Footing',
    IFCPILE: 'Concrete Pile',
    IFCCOVERING: 'Gypsum Board',
  };

  // Remove "Ifc" prefix and check
  const normalizedType = ifcType.toUpperCase();
  return typeMap[normalizedType] || `${ifcType.replace(/^Ifc/i, '')} Material`;
}
