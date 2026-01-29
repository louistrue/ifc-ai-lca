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
  if (ifcDataStore.properties) {
    for (const [entityId, propSets] of ifcDataStore.properties) {
      // Look for material-related property sets
      for (const [psetName, props] of propSets) {
        // Check for material name in properties
        const materialName = props.get('Material') as string ||
                            props.get('MaterialName') as string ||
                            props.get('material') as string;

        if (materialName && typeof materialName === 'string') {
          addOrUpdateMaterial(materialMap, materialName, entityId, props, ifcDataStore.quantities?.get(entityId));
        }
      }
    }
  }

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
        const qsets = ifcDataStore.quantities?.get(entityId);
        if (qsets) {
          for (const [, quantities] of qsets) {
            for (const [qName, qValue] of quantities) {
              if (qName.toLowerCase().includes('volume') || qName.toLowerCase().includes('netvolume')) {
                totalVolume += qValue.value || 0;
              }
              if (qName.toLowerCase().includes('area') || qName.toLowerCase().includes('netarea')) {
                totalArea += qValue.value || 0;
              }
            }
          }
        }
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
  quantities?: Map<string, Map<string, { value: number; type: string }>>
): void {
  const id = `mat-${name.toLowerCase().replace(/\s+/g, '-')}`;
  const existing = materialMap.get(id);

  // Extract quantities
  let volume = 0;
  let area = 0;
  let weight = 0;

  if (quantities) {
    for (const [, qmap] of quantities) {
      for (const [qName, qValue] of qmap) {
        const lowerName = qName.toLowerCase();
        if (lowerName.includes('volume') || lowerName.includes('netvolume')) {
          volume += qValue.value || 0;
        }
        if (lowerName.includes('area') || lowerName.includes('netarea')) {
          area += qValue.value || 0;
        }
        if (lowerName.includes('weight') || lowerName.includes('mass')) {
          weight += qValue.value || 0;
        }
      }
    }
  }

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
