/**
 * LCA (Life Cycle Assessment) State Slice
 * Manages EPD matching results and LCA calculations
 */

import type { StateCreator } from 'zustand';
import type { ExtractedMaterial, EPDMatch, LCAResults, MaterialCategory } from '../../lib/epd/types';
import { matchAllMaterials, detectCategory, findBestMatch } from '../../lib/epd/matcher';
import { matchAllMaterialsWithLLM, checkLLMAvailability } from '../../lib/epd/llm-matcher';

export interface LCASlice {
  // Extracted materials from IFC
  extractedMaterials: ExtractedMaterial[];

  // LCA Results
  lcaResults: LCAResults | null;

  // UI State
  selectedMaterialId: string | null;
  highlightedMaterialElements: number[];
  isMatchingInProgress: boolean;
  matchingMethod: 'none' | 'algorithmic' | 'llm';
  llmAvailable: boolean;

  // Actions
  setExtractedMaterials: (materials: ExtractedMaterial[]) => void;
  runEPDMatching: () => void;
  runLLMEPDMatching: () => Promise<void>;
  selectMaterial: (materialId: string | null) => void;
  clearLCAResults: () => void;
  checkLLMStatus: () => Promise<void>;

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
  isMatchingInProgress: false,
  matchingMethod: 'none',
  llmAvailable: false,

  // Actions
  setExtractedMaterials: (materials) => {
    set({ extractedMaterials: materials });
  },

  runEPDMatching: () => {
    const { extractedMaterials } = get();
    if (extractedMaterials.length === 0) {
      return;
    }

    set({ isMatchingInProgress: true });
    const results = matchAllMaterials(extractedMaterials);
    set({ lcaResults: results, isMatchingInProgress: false, matchingMethod: 'algorithmic' });
  },

  runLLMEPDMatching: async () => {
    const { extractedMaterials } = get();
    if (extractedMaterials.length === 0) {
      return;
    }

    set({ isMatchingInProgress: true, matchingMethod: 'none' });

    try {
      console.log('[LCA] Running LLM-based EPD matching...');
      const results = await matchAllMaterialsWithLLM(extractedMaterials, true);

      // Determine which method was actually used
      const usedLLM = results.matches.some(m => m.matchReason.startsWith('LLM:'));
      const method = usedLLM ? 'llm' : 'algorithmic';

      console.log(`[LCA] Matching complete using ${method} method`);
      set({ lcaResults: results, isMatchingInProgress: false, matchingMethod: method });
    } catch (error) {
      console.error('[LCA] LLM matching failed:', error);
      // Fall back to algorithmic
      const results = matchAllMaterials(extractedMaterials);
      set({ lcaResults: results, isMatchingInProgress: false, matchingMethod: 'algorithmic' });
    }
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
      matchingMethod: 'none',
    });
  },

  checkLLMStatus: async () => {
    const available = await checkLLMAvailability();
    set({ llmAvailable: available });
    console.log(`[LCA] LLM availability: ${available}`);
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
  geometryMeshes?: { expressId: number; ifcType?: string; volume?: number }[]
): ExtractedMaterial[] {
  if (!ifcDataStore) return [];

  console.log('[LCA] Extracting materials from IFC data store');
  console.log('[LCA] Data store keys:', Object.keys(ifcDataStore));
  console.log('[LCA] Has quantities:', !!ifcDataStore.quantities);
  console.log('[LCA] Quantities type:', ifcDataStore.quantities?.constructor?.name);
  console.log('[LCA] Has getForEntity:', typeof ifcDataStore.quantities?.getForEntity);
  console.log('[LCA] Geometry meshes count:', geometryMeshes?.length);

  const materialMap = new Map<string, ExtractedMaterial>();

  // Helper to safely get quantities for an entity
  const getQuantitiesForEntity = (entityId: number): { volume: number; area: number; weight: number } => {
    let volume = 0;
    let area = 0;
    let weight = 0;

    try {
      // Method 1: ifc-lite getForEntity method (server-converted data)
      if (ifcDataStore.quantities && typeof ifcDataStore.quantities.getForEntity === 'function') {
        const qsets = ifcDataStore.quantities.getForEntity(entityId);
        if (Array.isArray(qsets) && qsets.length > 0) {
          for (const qset of qsets) {
            const quantities = qset.quantities || [];
            for (const qty of quantities) {
              const lowerName = (qty.name || qty.quantity_name || '').toLowerCase();
              const value = qty.value ?? qty.quantity_value ?? 0;

              if (lowerName.includes('volume') || lowerName.includes('netvolume')) {
                volume += value;
              }
              if (lowerName.includes('area') || lowerName.includes('netarea') || lowerName.includes('sidearea')) {
                area += value;
              }
              if (lowerName.includes('weight') || lowerName.includes('mass')) {
                weight += value;
              }
            }
          }
        }
      }
    } catch (err) {
      // Silently fail for individual entities
    }

    return { volume, area, weight };
  };

  // Try to extract materials from properties
  if (ifcDataStore.properties && typeof ifcDataStore.properties[Symbol.iterator] === 'function') {
    try {
      for (const [entityId, propSets] of ifcDataStore.properties) {
        if (!propSets || typeof propSets[Symbol.iterator] !== 'function') continue;

        for (const [, props] of propSets) {
          if (!props) continue;

          const getProp = (key: string) => {
            if (props instanceof Map) return props.get(key);
            if (typeof props === 'object') return (props as Record<string, unknown>)[key];
            return undefined;
          };

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

  // If no materials found from properties, try to infer from IFC types
  if (materialMap.size === 0 && geometryMeshes) {
    console.log('[LCA] No materials found from properties, inferring from IFC types');

    // Group by IFC type as fallback
    const typeGroups = new Map<string, number[]>();

    for (const mesh of geometryMeshes) {
      const ifcType = mesh.ifcType || 'Unknown';
      const existing = typeGroups.get(ifcType) || [];
      existing.push(mesh.expressId);
      typeGroups.set(ifcType, existing);
    }

    console.log('[LCA] Found IFC types:', Array.from(typeGroups.keys()));

    // Create pseudo-materials from types
    for (const [ifcType, ids] of typeGroups) {
      const materialName = inferMaterialFromType(ifcType);
      const category = detectCategory(materialName);

      // Get quantities if available
      let totalVolume = 0;
      let totalArea = 0;
      let quantitiesFound = false;

      for (const entityId of ids) {
        const q = getQuantitiesForEntity(entityId);
        if (q.volume > 0 || q.area > 0) {
          quantitiesFound = true;
        }
        totalVolume += q.volume;
        totalArea += q.area;
      }

      // If no quantities found, estimate based on typical values per element
      if (!quantitiesFound) {
        const typicalVolumes: Record<string, number> = {
          IFCWALL: 2.5,          // ~2.5 m³ per wall element (typical wall section)
          IFCWALLSTANDARDCASE: 2.5,
          IFCSLAB: 0.5,          // ~0.5 m³ per slab element
          IFCCOLUMN: 0.8,        // ~0.8 m³ per column
          IFCBEAM: 0.3,          // ~0.3 m³ per beam
          IFCFOOTING: 1.5,       // ~1.5 m³ per footing
          IFCPILE: 2.0,          // ~2.0 m³ per pile
          IFCSTAIR: 1.0,         // ~1.0 m³ per stair
          IFCROOF: 0.4,          // ~0.4 m³ per roof element
          IFCWINDOW: 0.05,       // ~0.05 m³ per window (frame + glass)
          IFCDOOR: 0.1,          // ~0.1 m³ per door
          IFCCOVERING: 0.02,     // ~0.02 m³ per covering (thin)
          IFCCURTAINWALL: 0.1,   // ~0.1 m³ per curtain wall panel
          IFCRAILING: 0.05,      // ~0.05 m³ per railing
          IFCMEMBER: 0.15,       // ~0.15 m³ per member
          IFCPLATE: 0.02,        // ~0.02 m³ per plate
        };

        const normalizedType = ifcType.toUpperCase();
        const volumePerElement = typicalVolumes[normalizedType] || 0.5;
        totalVolume = ids.length * volumePerElement;
        console.log(`[LCA] Estimated ${ifcType}: ${ids.length} elements × ${volumePerElement} m³ = ${totalVolume.toFixed(1)} m³`);
      } else {
        console.log(`[LCA] Found quantities for ${ifcType}: ${totalVolume.toFixed(2)} m³, ${totalArea.toFixed(2)} m²`);
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

  console.log('[LCA] Extracted materials:', materialMap.size);
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
