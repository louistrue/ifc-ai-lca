/**
 * EPD Database with Ökobaudat Integration
 *
 * This module provides EPD data from two sources:
 * 1. Ökobaudat API (German Federal EPD Database) - Real data
 * 2. Fallback mock data - Used when API is unavailable
 *
 * @see https://www.oekobaudat.de/
 */

import type { EPD, MaterialCategory } from './types';
import { fetchFromOekobaudat, searchOekobaudatEPDs } from './oekobaudat-client';

// ============ API State ============

/** Whether Ökobaudat API is available */
let oekobaudatAvailable: boolean | null = null;

/** Cached EPDs from Ökobaudat */
let cachedOekobaudatEPDs: EPD[] = [];

/** Last time we checked API availability */
let lastApiCheck = 0;

const API_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes

// ============ API Functions ============

/**
 * Check if Ökobaudat API is available
 */
export async function checkOekobaudatAvailability(): Promise<boolean> {
  // Don't check too frequently
  if (oekobaudatAvailable !== null && Date.now() - lastApiCheck < API_CHECK_INTERVAL) {
    return oekobaudatAvailable;
  }

  try {
    const epds = await fetchFromOekobaudat({ pageSize: 1 });
    oekobaudatAvailable = epds.length > 0;
    lastApiCheck = Date.now();
    return oekobaudatAvailable;
  } catch {
    oekobaudatAvailable = false;
    lastApiCheck = Date.now();
    return false;
  }
}

/**
 * Load EPDs from Ökobaudat for common building material categories
 */
export async function loadOekobaudatEPDs(): Promise<EPD[]> {
  if (cachedOekobaudatEPDs.length > 0) {
    return cachedOekobaudatEPDs;
  }

  const isAvailable = await checkOekobaudatAvailability();
  if (!isAvailable) {
    return fallbackEPDDatabase;
  }

  try {
    // Load EPDs for diverse construction material categories (German terms for better API results)
    // Expanded search to get 100-150+ real EPDs covering common building materials
    const searchTerms = [
      // Concrete varieties
      'Beton', // Generic concrete
      'Transportbeton', // Ready-mix concrete
      'Betonfertigteil', // Precast concrete
      'Stahlbeton', // Reinforced concrete
      // Steel varieties
      'Stahl', // Generic steel
      'Baustahl', // Structural steel
      'Bewehrungsstahl', // Rebar
      'Stahlprofil', // Steel sections
      // Wood varieties
      'Holz', // Generic wood
      'Brettschichtholz', // Glulam
      'Brettsperrholz', // CLT
      'Schnittholz', // Sawn timber
      'Spanplatte', // Chipboard/particleboard
      // Insulation varieties
      'Dämmstoff', // Generic insulation
      'Mineralwolle', // Mineral wool
      'Steinwolle', // Stone wool
      'Glaswolle', // Glass wool
      'EPS', // Expanded polystyrene
      'XPS', // Extruded polystyrene
      // Other construction materials
      'Glas', // Glass
      'Fenster', // Windows
      'Aluminium', // Aluminum
      'Gips', // Gypsum
      'Gipskarton', // Gypsum board
      'Ziegel', // Brick
      'Mauerwerk', // Masonry
      'Putz', // Plaster/render
      'Estrich', // Screed
      'Fliese', // Tiles
      'Dach', // Roofing
      'Abdichtung', // Waterproofing/membranes
      'Farbe', // Paint/coatings
    ];

    const allEPDs: EPD[] = [];
    const seenIds = new Set<string>();

    for (const term of searchTerms) {
      try {
        const epds = await fetchFromOekobaudat({
          search: term,
          compliance: 'A2',
          pageSize: 15, // 15 per term × 36 terms = up to 540, but deduplication gives ~100-200
        });

        for (const epd of epds) {
          if (!seenIds.has(epd.id)) {
            seenIds.add(epd.id);
            allEPDs.push(epd);
          }
        }
      } catch (err) {
        console.warn(`[EPD Database] Failed to load EPDs for "${term}":`, err);
      }
    }

    cachedOekobaudatEPDs = allEPDs;
    return allEPDs;
  } catch (err) {
    console.error('[EPD Database] Failed to load from Ökobaudat:', err);
    return fallbackEPDDatabase;
  }
}

/**
 * Search EPDs - tries Ökobaudat first, falls back to local
 */
export async function searchEPDsOnline(query: string): Promise<EPD[]> {
  const isAvailable = await checkOekobaudatAvailability();

  if (isAvailable) {
    try {
      const results = await searchOekobaudatEPDs(query);
      if (results.length > 0) {
        return results;
      }
    } catch (err) {
      console.warn('[EPD Database] Online search failed:', err);
    }
  }

  // Fall back to local search
  return searchEPDs(query);
}

/**
 * Get all available EPDs (Ökobaudat + fallback)
 */
export async function getAllEPDs(): Promise<EPD[]> {
  const oekobaudatEPDs = await loadOekobaudatEPDs();

  if (oekobaudatEPDs.length > 0) {
    // Merge with fallback, preferring Ökobaudat data
    const merged = [...oekobaudatEPDs];
    const oekobaudatCategories = new Set(oekobaudatEPDs.map(e => e.category));

    // Add fallback EPDs for categories not covered by Ökobaudat
    for (const epd of fallbackEPDDatabase) {
      if (!oekobaudatCategories.has(epd.category)) {
        merged.push(epd);
      }
    }

    return merged;
  }

  return fallbackEPDDatabase;
}

/**
 * Get the current EPD database (sync version for compatibility)
 * Returns cached Ökobaudat data or fallback
 */
export function getEPDDatabase(): EPD[] {
  if (cachedOekobaudatEPDs.length > 0) {
    return cachedOekobaudatEPDs;
  }
  return fallbackEPDDatabase;
}

/**
 * Get EPDs by category with Ökobaudat integration
 */
export async function getEPDsByCategoryOnline(category: MaterialCategory): Promise<EPD[]> {
  const allEPDs = await getAllEPDs();
  return allEPDs.filter(epd => epd.category === category);
}

// ============ Backward Compatibility ============

/**
 * Legacy: Direct access to EPD database (returns fallback + cached Ökobaudat)
 * @deprecated Use getAllEPDs() for full Ökobaudat integration
 */
export const epdDatabase: EPD[] = new Proxy([] as EPD[], {
  get(target, prop) {
    // Return cached Ökobaudat data or fallback
    const data = cachedOekobaudatEPDs.length > 0 ? cachedOekobaudatEPDs : fallbackEPDDatabase;

    if (prop === 'length') return data.length;
    if (typeof prop === 'string' && !isNaN(Number(prop))) {
      return data[Number(prop)];
    }
    if (prop === Symbol.iterator) {
      return data[Symbol.iterator].bind(data);
    }
    if (typeof prop === 'string' && typeof (data as unknown as Record<string, unknown>)[prop] === 'function') {
      return (data as unknown as Record<string, (...args: unknown[]) => unknown>)[prop].bind(data);
    }
    return Reflect.get(data, prop);
  },
});

// ============ Fallback EPD Database ============
// Used when Ökobaudat API is unavailable

const fallbackEPDDatabase: EPD[] = [
  // ============ CONCRETE ============
  {
    id: 'epd-concrete-001',
    name: 'Ready-Mix Concrete C30/37',
    manufacturer: 'Industry Average',
    category: 'CONCRETE',
    subcategory: 'Ready Mix',
    impacts: {
      gwp: 240,
      odp: 0.000012,
      ap: 0.65,
      ep: 0.085,
    },
    declaredUnit: { value: 1, unit: 'm3' },
    validUntil: '2028-12-31',
    pcr: 'EN 16757',
    programOperator: 'IBU',
    plantLocation: 'Europe',
    keywords: ['concrete', 'ready mix', 'C30', 'C37', 'structural', 'reinforced'],
    specifications: {
      strength: '30-37 MPa',
      density: '2400 kg/m³',
    },
    dataQuality: 'average',
  },
  {
    id: 'epd-concrete-002',
    name: 'Low-Carbon Concrete (CEM III)',
    manufacturer: 'Holcim ECOPact',
    category: 'CONCRETE',
    subcategory: 'Ready Mix',
    impacts: {
      gwp: 150,
      odp: 0.000008,
      ap: 0.45,
      ep: 0.065,
    },
    declaredUnit: { value: 1, unit: 'm3' },
    validUntil: '2027-06-30',
    pcr: 'EN 16757',
    programOperator: 'EPD International',
    plantLocation: 'Switzerland',
    keywords: ['concrete', 'low carbon', 'CEM III', 'slag', 'eco', 'sustainable'],
    specifications: {
      strength: '30 MPa',
      density: '2350 kg/m³',
      cementType: 'CEM III/B',
    },
    dataQuality: 'specific',
  },
  {
    id: 'epd-concrete-003',
    name: 'Precast Concrete Elements',
    manufacturer: 'Industry Average',
    category: 'CONCRETE',
    subcategory: 'Precast',
    impacts: {
      gwp: 280,
      odp: 0.000015,
      ap: 0.75,
      ep: 0.095,
    },
    declaredUnit: { value: 1, unit: 'm3' },
    validUntil: '2027-12-31',
    pcr: 'EN 16757',
    programOperator: 'IBU',
    keywords: ['concrete', 'precast', 'prefab', 'element', 'panel'],
    dataQuality: 'average',
  },

  // ============ STEEL ============
  {
    id: 'epd-steel-001',
    name: 'Structural Steel Sections (Hot Rolled)',
    manufacturer: 'ArcelorMittal',
    category: 'STEEL',
    subcategory: 'Structural',
    impacts: {
      gwp: 1.85,
      odp: 0.0000001,
      ap: 0.0045,
      ep: 0.00035,
    },
    declaredUnit: { value: 1, unit: 'kg' },
    validUntil: '2027-09-30',
    pcr: 'EN 15804+A2',
    programOperator: 'IBU',
    plantLocation: 'Luxembourg',
    keywords: ['steel', 'structural', 'hot rolled', 'I-beam', 'H-beam', 'HEA', 'HEB', 'IPE'],
    specifications: {
      grade: 'S355',
      recycledContent: '25%',
    },
    dataQuality: 'specific',
  },
  {
    id: 'epd-steel-002',
    name: 'Reinforcing Steel (Rebar)',
    manufacturer: 'Industry Average',
    category: 'STEEL',
    subcategory: 'Reinforcement',
    impacts: {
      gwp: 0.76,
      odp: 0.00000008,
      ap: 0.0028,
      ep: 0.00022,
    },
    declaredUnit: { value: 1, unit: 'kg' },
    validUntil: '2028-03-31',
    pcr: 'EN 15804+A2',
    programOperator: 'EPD International',
    keywords: ['steel', 'rebar', 'reinforcement', 'reinforcing', 'bar'],
    specifications: {
      grade: 'B500B',
      recycledContent: '97%',
    },
    dataQuality: 'average',
  },
  {
    id: 'epd-steel-003',
    name: 'Cold-Formed Steel Studs',
    manufacturer: 'Voestalpine',
    category: 'STEEL',
    subcategory: 'Light Gauge',
    impacts: {
      gwp: 2.15,
      odp: 0.00000012,
      ap: 0.0052,
      ep: 0.00042,
    },
    declaredUnit: { value: 1, unit: 'kg' },
    validUntil: '2027-12-31',
    pcr: 'EN 15804+A2',
    programOperator: 'IBU',
    keywords: ['steel', 'stud', 'cold formed', 'light gauge', 'framing', 'drywall'],
    dataQuality: 'specific',
  },

  // ============ WOOD ============
  {
    id: 'epd-wood-001',
    name: 'Cross-Laminated Timber (CLT)',
    manufacturer: 'Stora Enso',
    category: 'WOOD',
    subcategory: 'Engineered',
    impacts: {
      gwp: -680,
      odp: 0.000002,
      ap: 0.85,
      ep: 0.12,
    },
    declaredUnit: { value: 1, unit: 'm3' },
    validUntil: '2027-08-31',
    pcr: 'EN 16485',
    programOperator: 'EPD International',
    plantLocation: 'Austria',
    keywords: ['wood', 'CLT', 'cross laminated', 'timber', 'mass timber', 'panel'],
    specifications: {
      species: 'Spruce',
      density: '470 kg/m³',
    },
    dataQuality: 'specific',
  },
  {
    id: 'epd-wood-002',
    name: 'Glulam Beams',
    manufacturer: 'Industry Average',
    category: 'WOOD',
    subcategory: 'Engineered',
    impacts: {
      gwp: -580,
      odp: 0.0000018,
      ap: 0.72,
      ep: 0.095,
    },
    declaredUnit: { value: 1, unit: 'm3' },
    validUntil: '2028-01-31',
    pcr: 'EN 16485',
    programOperator: 'IBU',
    keywords: ['wood', 'glulam', 'beam', 'laminated', 'structural'],
    specifications: {
      species: 'Spruce/Pine',
      strengthClass: 'GL24h',
    },
    dataQuality: 'average',
  },
  {
    id: 'epd-wood-003',
    name: 'Softwood Lumber',
    manufacturer: 'Industry Average',
    category: 'WOOD',
    subcategory: 'Sawn',
    impacts: {
      gwp: -750,
      odp: 0.0000008,
      ap: 0.35,
      ep: 0.055,
    },
    declaredUnit: { value: 1, unit: 'm3' },
    validUntil: '2028-06-30',
    pcr: 'EN 16485',
    programOperator: 'EPD Norway',
    keywords: ['wood', 'lumber', 'timber', 'softwood', 'pine', 'spruce', 'stud'],
    dataQuality: 'average',
  },

  // ============ INSULATION ============
  {
    id: 'epd-insulation-001',
    name: 'Stone Wool Insulation',
    manufacturer: 'ROCKWOOL',
    category: 'INSULATION',
    subcategory: 'Mineral Wool',
    impacts: {
      gwp: 1.12,
      odp: 0.0000002,
      ap: 0.0065,
      ep: 0.00085,
    },
    declaredUnit: { value: 1, unit: 'kg' },
    validUntil: '2027-05-31',
    pcr: 'EN 15804+A2',
    programOperator: 'EPD International',
    plantLocation: 'Denmark',
    keywords: ['insulation', 'stone wool', 'mineral wool', 'rockwool', 'thermal'],
    specifications: {
      thermalConductivity: '0.035 W/mK',
      density: '30-200 kg/m³',
    },
    dataQuality: 'specific',
  },
  {
    id: 'epd-insulation-002',
    name: 'EPS Insulation',
    manufacturer: 'Industry Average',
    category: 'INSULATION',
    subcategory: 'Foam',
    impacts: {
      gwp: 3.45,
      odp: 0.0000001,
      ap: 0.012,
      ep: 0.0012,
    },
    declaredUnit: { value: 1, unit: 'kg' },
    validUntil: '2027-11-30',
    pcr: 'EN 15804+A2',
    programOperator: 'IBU',
    keywords: ['insulation', 'EPS', 'polystyrene', 'foam', 'expanded'],
    specifications: {
      thermalConductivity: '0.032-0.038 W/mK',
      density: '15-30 kg/m³',
    },
    dataQuality: 'average',
  },
  {
    id: 'epd-insulation-003',
    name: 'XPS Insulation',
    manufacturer: 'Owens Corning',
    category: 'INSULATION',
    subcategory: 'Foam',
    impacts: {
      gwp: 4.25,
      odp: 0.00000015,
      ap: 0.015,
      ep: 0.0015,
    },
    declaredUnit: { value: 1, unit: 'kg' },
    validUntil: '2027-09-30',
    pcr: 'EN 15804+A2',
    programOperator: 'UL Environment',
    keywords: ['insulation', 'XPS', 'extruded', 'polystyrene', 'foam', 'foundation'],
    specifications: {
      thermalConductivity: '0.029-0.036 W/mK',
      density: '25-45 kg/m³',
    },
    dataQuality: 'specific',
  },

  // ============ GLASS ============
  {
    id: 'epd-glass-001',
    name: 'Double Glazing Unit',
    manufacturer: 'Industry Average',
    category: 'GLASS',
    subcategory: 'IGU',
    impacts: {
      gwp: 28.5,
      odp: 0.0000025,
      ap: 0.085,
      ep: 0.012,
    },
    declaredUnit: { value: 1, unit: 'm2' },
    validUntil: '2027-12-31',
    pcr: 'EN 15804+A2',
    programOperator: 'IBU',
    keywords: ['glass', 'double glazing', 'IGU', 'window', 'facade'],
    specifications: {
      uValue: '1.1 W/m²K',
      composition: '4-16-4',
    },
    dataQuality: 'average',
  },
  {
    id: 'epd-glass-002',
    name: 'Triple Glazing Unit (Low-E)',
    manufacturer: 'Saint-Gobain',
    category: 'GLASS',
    subcategory: 'IGU',
    impacts: {
      gwp: 42.0,
      odp: 0.0000035,
      ap: 0.12,
      ep: 0.018,
    },
    declaredUnit: { value: 1, unit: 'm2' },
    validUntil: '2028-03-31',
    pcr: 'EN 15804+A2',
    programOperator: 'EPD International',
    keywords: ['glass', 'triple glazing', 'IGU', 'low-e', 'window', 'passive house'],
    specifications: {
      uValue: '0.5 W/m²K',
      composition: '4-14-4-14-4',
    },
    dataQuality: 'specific',
  },

  // ============ GYPSUM ============
  {
    id: 'epd-gypsum-001',
    name: 'Gypsum Plasterboard',
    manufacturer: 'Knauf',
    category: 'GYPSUM',
    subcategory: 'Board',
    impacts: {
      gwp: 2.85,
      odp: 0.00000008,
      ap: 0.012,
      ep: 0.0018,
    },
    declaredUnit: { value: 1, unit: 'm2' },
    validUntil: '2027-10-31',
    pcr: 'EN 15804+A2',
    programOperator: 'IBU',
    plantLocation: 'Germany',
    keywords: ['gypsum', 'plasterboard', 'drywall', 'gyprock', 'wallboard'],
    specifications: {
      thickness: '12.5 mm',
      density: '680 kg/m³',
    },
    dataQuality: 'specific',
  },

  // ============ ALUMINUM ============
  {
    id: 'epd-aluminum-001',
    name: 'Aluminum Extrusions (Primary)',
    manufacturer: 'Industry Average',
    category: 'ALUMINUM',
    subcategory: 'Extrusion',
    impacts: {
      gwp: 12.5,
      odp: 0.0000008,
      ap: 0.065,
      ep: 0.0055,
    },
    declaredUnit: { value: 1, unit: 'kg' },
    validUntil: '2027-12-31',
    pcr: 'EN 15804+A2',
    programOperator: 'EPD International',
    keywords: ['aluminum', 'aluminium', 'extrusion', 'profile', 'window frame', 'curtain wall'],
    specifications: {
      alloy: '6063-T6',
      recycledContent: '35%',
    },
    dataQuality: 'average',
  },
  {
    id: 'epd-aluminum-002',
    name: 'Recycled Aluminum Extrusions',
    manufacturer: 'Hydro',
    category: 'ALUMINUM',
    subcategory: 'Extrusion',
    impacts: {
      gwp: 2.8,
      odp: 0.0000002,
      ap: 0.018,
      ep: 0.0015,
    },
    declaredUnit: { value: 1, unit: 'kg' },
    validUntil: '2028-06-30',
    pcr: 'EN 15804+A2',
    programOperator: 'EPD Norway',
    plantLocation: 'Norway',
    keywords: ['aluminum', 'aluminium', 'recycled', 'low carbon', 'hydro', 'circal'],
    specifications: {
      alloy: '6063-T6',
      recycledContent: '75%',
    },
    dataQuality: 'specific',
  },

  // ============ MASONRY ============
  {
    id: 'epd-masonry-001',
    name: 'Clay Brick',
    manufacturer: 'Industry Average',
    category: 'MASONRY',
    subcategory: 'Brick',
    impacts: {
      gwp: 0.21,
      odp: 0.00000001,
      ap: 0.00085,
      ep: 0.00012,
    },
    declaredUnit: { value: 1, unit: 'kg' },
    validUntil: '2028-01-31',
    pcr: 'EN 15804+A2',
    programOperator: 'IBU',
    keywords: ['brick', 'clay', 'masonry', 'facing', 'wall'],
    specifications: {
      density: '1800-2000 kg/m³',
      type: 'Facing brick',
    },
    dataQuality: 'average',
  },
  {
    id: 'epd-masonry-002',
    name: 'Concrete Block (CMU)',
    manufacturer: 'Industry Average',
    category: 'MASONRY',
    subcategory: 'Block',
    impacts: {
      gwp: 0.085,
      odp: 0.000000005,
      ap: 0.00035,
      ep: 0.00005,
    },
    declaredUnit: { value: 1, unit: 'kg' },
    validUntil: '2027-08-31',
    pcr: 'EN 15804+A2',
    programOperator: 'EPD International',
    keywords: ['block', 'concrete', 'CMU', 'masonry', 'hollow'],
    specifications: {
      density: '1400-2000 kg/m³',
      type: 'Hollow block',
    },
    dataQuality: 'average',
  },

  // ============ MEMBRANE ============
  {
    id: 'epd-membrane-001',
    name: 'Bituminous Roofing Membrane',
    manufacturer: 'Industry Average',
    category: 'MEMBRANE',
    subcategory: 'Roofing',
    impacts: {
      gwp: 2.15,
      odp: 0.0000001,
      ap: 0.0085,
      ep: 0.0012,
    },
    declaredUnit: { value: 1, unit: 'm2' },
    validUntil: '2027-11-30',
    pcr: 'EN 15804+A2',
    programOperator: 'IBU',
    keywords: ['membrane', 'bitumen', 'roofing', 'waterproofing', 'felt'],
    specifications: {
      thickness: '4-5 mm',
      type: 'SBS modified',
    },
    dataQuality: 'average',
  },
];

// ============ Helper Functions ============

/**
 * Get EPD by ID (checks both cached Ökobaudat and fallback)
 */
export function getEPDById(id: string): EPD | undefined {
  // Check cached Ökobaudat first
  if (cachedOekobaudatEPDs.length > 0) {
    const found = cachedOekobaudatEPDs.find(epd => epd.id === id);
    if (found) return found;
  }
  // Fall back to local database
  return fallbackEPDDatabase.find(epd => epd.id === id);
}

/**
 * Get EPD by ID - async version that checks online
 */
export async function getEPDByIdOnline(id: string): Promise<EPD | undefined> {
  // First try local/cached
  const local = getEPDById(id);
  if (local) return local;

  // If it's an Ökobaudat ID, try to fetch it
  if (id.startsWith('oekobaudat-')) {
    const uuid = id.replace('oekobaudat-', '');
    try {
      const apiEndpoint = typeof window !== 'undefined' && import.meta.env.DEV
        ? `http://localhost:3001/api/oekobaudat/${uuid}`
        : `/api/oekobaudat/${uuid}`;

      const response = await fetch(apiEndpoint);
      if (response.ok) {
        // Would need to transform the single process response
        // For now, just search in the loaded data
        await loadOekobaudatEPDs();
        return cachedOekobaudatEPDs.find(epd => epd.id === id);
      }
    } catch {
      // Fall through to undefined
    }
  }

  return undefined;
}

/**
 * Get EPDs by category (sync - uses cached data)
 */
export function getEPDsByCategory(category: string): EPD[] {
  const data = cachedOekobaudatEPDs.length > 0 ? cachedOekobaudatEPDs : fallbackEPDDatabase;
  return data.filter(epd => epd.category === category);
}

/**
 * Search EPDs locally (sync - uses cached data)
 */
export function searchEPDs(query: string): EPD[] {
  const lowerQuery = query.toLowerCase();
  const data = cachedOekobaudatEPDs.length > 0 ? cachedOekobaudatEPDs : fallbackEPDDatabase;

  return data.filter(epd =>
    epd.name.toLowerCase().includes(lowerQuery) ||
    epd.keywords.some(k => k.toLowerCase().includes(lowerQuery)) ||
    epd.category.toLowerCase().includes(lowerQuery) ||
    (epd.subcategory?.toLowerCase().includes(lowerQuery))
  );
}

/**
 * Get EPD data source info
 */
export function getEPDDataSourceInfo(): {
  source: 'oekobaudat' | 'fallback';
  count: number;
  lastUpdated: number | null;
} {
  if (cachedOekobaudatEPDs.length > 0) {
    return {
      source: 'oekobaudat',
      count: cachedOekobaudatEPDs.length,
      lastUpdated: lastApiCheck,
    };
  }
  return {
    source: 'fallback',
    count: fallbackEPDDatabase.length,
    lastUpdated: null,
  };
}
