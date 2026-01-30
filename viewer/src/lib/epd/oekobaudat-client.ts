/**
 * Ökobaudat API Client
 * Connects to the German Federal EPD database (https://www.oekobaudat.de/)
 *
 * API Documentation: https://www.oekobaudat.de/anleitungen/softwareentwickler.html
 * Data Format: ILCD+EPD (International Life Cycle Data system)
 */

import type { EPD, MaterialCategory, DeclaredUnit, EnvironmentalImpacts } from './types';

// API Constants
const OEKOBAUDAT_BASE_URL = 'https://oekobaudat.de/OEKOBAU.DAT/resource';
const DATASTOCK_UUID = 'cd2bda71-760b-4fcc-8a0b-3877c10000a8';

// EN 15804 compliance UUIDs
export const EN_15804_COMPLIANCE = {
  A1: 'b00f9ec0-7874-11e3-981f-0800200c9a66', // EN 15804+A1
  A2: 'c0016b33-8cf7-415c-ac6e-deba0d21440d', // EN 15804+A2 (current standard)
} as const;

// GWP indicator UUIDs in ILCD format
const GWP_INDICATOR_UUIDS = [
  '77e416eb-a363-4258-a04e-171d843a6460', // GWP-total
  'd86b9e8b-6555-11e3-9701-0800200c9a66', // GWP-fossil
  '6a37f984-a4b3-4d53-8a9b-d29a83f8c5e8', // Climate change - total
];

// ODP indicator UUID
const ODP_INDICATOR_UUID = 'a6435d9f-6555-11e3-9701-0800200c9a66';

// AP indicator UUID
const AP_INDICATOR_UUID = 'b4274add-93c7-11e3-b0e7-0800200c9a66';

// EP indicator UUID
const EP_INDICATOR_UUID = 'f58827d0-b407-4ec6-be75-8b69efb98a0f';

/**
 * ILCD Process Dataset structure (simplified)
 */
export interface ILCDProcess {
  uuid: string;
  name: string;
  classifications?: Array<{
    name: string;
    classId?: string;
  }>;
  referenceFlowProperty?: {
    name: string;
    uuid: string;
  };
  time?: {
    referenceYear?: number;
    validUntil?: number;
  };
  geography?: {
    location?: string;
  };
  technology?: {
    technologyDescriptionAndIncludedProcesses?: string;
  };
  lciaResults?: Array<{
    indicator: {
      uuid: string;
      name: string;
    };
    amount: number;
    unit?: string;
  }>;
  exchanges?: Array<{
    flow: {
      uuid: string;
      name: string;
    };
    direction: 'INPUT' | 'OUTPUT';
    amount: number;
    unit?: string;
    isReferenceFlow?: boolean;
  }>;
  compliance?: Array<{
    system: {
      uuid: string;
      name: string;
    };
  }>;
  dataSetInformation?: {
    UUID?: string;
    name?: {
      baseName?: string;
    };
    classificationInformation?: {
      classification?: Array<{
        class?: Array<{
          value?: string;
          classId?: string;
        }>;
      }>;
    };
  };
  publicationAndOwnership?: {
    dataSetOwner?: {
      shortDescription?: string;
    };
  };
}

/**
 * API Response structure
 */
export interface OekobaudatResponse {
  data?: ILCDProcess[];
  processes?: ILCDProcess[];
  totalCount?: number;
  pageSize?: number;
  pageIndex?: number;
}

/**
 * Search parameters for Ökobaudat API
 */
export interface OekobaudatSearchParams {
  /** Text search query */
  search?: string;
  /** Filter by EN 15804 compliance (A1 or A2) */
  compliance?: 'A1' | 'A2';
  /** Page size (default 100) */
  pageSize?: number;
  /** Page index (0-based) */
  startIndex?: number;
  /** Filter by category/classification */
  category?: string;
}

/**
 * In-memory cache for EPD data
 */
interface CacheEntry {
  data: EPD[];
  timestamp: number;
  query?: string;
}

const cache: Map<string, CacheEntry> = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Get cache key for a query
 */
function getCacheKey(params: OekobaudatSearchParams): string {
  return JSON.stringify(params);
}

/**
 * Check if cache entry is valid
 */
function isCacheValid(entry: CacheEntry): boolean {
  return Date.now() - entry.timestamp < CACHE_TTL_MS;
}

/**
 * Map ILCD classification to our MaterialCategory
 */
function mapToMaterialCategory(classifications: Array<{ name: string; classId?: string }> | undefined): MaterialCategory {
  if (!classifications || classifications.length === 0) {
    return 'OTHER';
  }

  const classNames = classifications.map(c => c.name.toLowerCase()).join(' ');

  // Map based on German and English classification names
  if (classNames.includes('beton') || classNames.includes('concrete') || classNames.includes('zement')) {
    return 'CONCRETE';
  }
  if (classNames.includes('stahl') || classNames.includes('steel') || classNames.includes('eisen')) {
    return 'STEEL';
  }
  if (classNames.includes('holz') || classNames.includes('wood') || classNames.includes('timber') || classNames.includes('lumber')) {
    return 'WOOD';
  }
  if (classNames.includes('glas') || classNames.includes('glass')) {
    return 'GLASS';
  }
  if (classNames.includes('dämmstoff') || classNames.includes('insulation') || classNames.includes('isolier')) {
    return 'INSULATION';
  }
  if (classNames.includes('mauerwerk') || classNames.includes('masonry') || classNames.includes('ziegel') || classNames.includes('brick')) {
    return 'MASONRY';
  }
  if (classNames.includes('aluminium') || classNames.includes('aluminum')) {
    return 'ALUMINUM';
  }
  if (classNames.includes('gips') || classNames.includes('gypsum') || classNames.includes('putz')) {
    return 'GYPSUM';
  }
  if (classNames.includes('kunststoff') || classNames.includes('plastic') || classNames.includes('polymer')) {
    return 'PLASTIC';
  }
  if (classNames.includes('membran') || classNames.includes('membrane') || classNames.includes('abdichtung') || classNames.includes('dach')) {
    return 'MEMBRANE';
  }

  return 'OTHER';
}

/**
 * Map ILCD unit to our DeclaredUnit
 */
function mapToDeclaredUnit(unit: string | undefined): DeclaredUnit {
  if (!unit) return 'kg';

  const unitLower = unit.toLowerCase();

  if (unitLower.includes('m3') || unitLower.includes('m³') || unitLower === 'cubic metre') {
    return 'm3';
  }
  if (unitLower.includes('m2') || unitLower.includes('m²') || unitLower === 'square metre') {
    return 'm2';
  }
  if (unitLower === 'kg' || unitLower === 'kilogram') {
    return 'kg';
  }
  if (unitLower === 't' || unitLower === 'ton' || unitLower === 'tonne') {
    return 'ton';
  }
  if (unitLower === 'm' || unitLower === 'metre' || unitLower === 'meter') {
    return 'm';
  }
  if (unitLower.includes('piece') || unitLower.includes('stück') || unitLower.includes('unit')) {
    return 'piece';
  }

  return 'kg'; // Default
}

/**
 * Extract GWP value from LCIA results
 */
function extractGWP(process: ILCDProcess): number {
  if (!process.lciaResults) return 0;

  for (const result of process.lciaResults) {
    if (GWP_INDICATOR_UUIDS.includes(result.indicator.uuid) ||
        result.indicator.name.toLowerCase().includes('gwp') ||
        result.indicator.name.toLowerCase().includes('climate change') ||
        result.indicator.name.toLowerCase().includes('treibhausgas')) {
      return result.amount || 0;
    }
  }

  return 0;
}

/**
 * Extract environmental impacts from LCIA results
 */
function extractImpacts(process: ILCDProcess): EnvironmentalImpacts {
  const impacts: EnvironmentalImpacts = { gwp: 0 };

  if (!process.lciaResults) return impacts;

  for (const result of process.lciaResults) {
    const uuid = result.indicator.uuid;
    const name = result.indicator.name.toLowerCase();

    // GWP
    if (GWP_INDICATOR_UUIDS.includes(uuid) || name.includes('gwp') || name.includes('climate')) {
      impacts.gwp = result.amount || 0;
    }
    // ODP
    else if (uuid === ODP_INDICATOR_UUID || name.includes('ozone') || name.includes('odp')) {
      impacts.odp = result.amount || 0;
    }
    // AP
    else if (uuid === AP_INDICATOR_UUID || name.includes('acidification') || name.includes('ap')) {
      impacts.ap = result.amount || 0;
    }
    // EP
    else if (uuid === EP_INDICATOR_UUID || name.includes('eutrophication') || name.includes('ep')) {
      impacts.ep = result.amount || 0;
    }
  }

  return impacts;
}

/**
 * Extract keywords from process name and classifications
 */
function extractKeywords(process: ILCDProcess): string[] {
  const keywords = new Set<string>();

  // Add words from name
  const name = process.name || '';
  const words = name.toLowerCase().split(/[\s,;/()-]+/).filter(w => w.length > 2);
  words.forEach(w => keywords.add(w));

  // Add classification names
  process.classifications?.forEach(c => {
    const classWords = c.name.toLowerCase().split(/[\s,;/()-]+/).filter(w => w.length > 2);
    classWords.forEach(w => keywords.add(w));
  });

  return Array.from(keywords);
}

/**
 * Get declared unit from reference flow
 */
function getDeclaredUnit(process: ILCDProcess): { value: number; unit: DeclaredUnit } {
  // Try to get from reference flow
  const refExchange = process.exchanges?.find(e => e.isReferenceFlow);
  if (refExchange) {
    return {
      value: refExchange.amount || 1,
      unit: mapToDeclaredUnit(refExchange.unit),
    };
  }

  // Fallback to reference flow property
  if (process.referenceFlowProperty) {
    return {
      value: 1,
      unit: mapToDeclaredUnit(process.referenceFlowProperty.name),
    };
  }

  return { value: 1, unit: 'kg' };
}

/**
 * Transform ILCD process to our EPD format
 */
export function transformILCDToEPD(process: ILCDProcess): EPD {
  const declaredUnit = getDeclaredUnit(process);

  return {
    id: `oekobaudat-${process.uuid}`,
    name: process.name,
    manufacturer: process.publicationAndOwnership?.dataSetOwner?.shortDescription || 'Ökobaudat',
    category: mapToMaterialCategory(process.classifications),
    subcategory: process.classifications?.[0]?.name,
    impacts: extractImpacts(process),
    declaredUnit,
    validUntil: process.time?.validUntil?.toString() || '2030-12-31',
    pcr: 'EN 15804+A2',
    programOperator: 'BMWSB/IBU',
    plantLocation: process.geography?.location || 'Germany',
    keywords: extractKeywords(process),
    dataQuality: 'average', // Ökobaudat provides representative data
  };
}

/**
 * Build API URL with parameters
 */
function buildApiUrl(params: OekobaudatSearchParams): string {
  const url = new URL(`${OEKOBAUDAT_BASE_URL}/datastocks/${DATASTOCK_UUID}/processes`);

  url.searchParams.set('format', 'json');
  url.searchParams.set('search', 'true');

  if (params.compliance) {
    url.searchParams.set('compliance', EN_15804_COMPLIANCE[params.compliance]);
  }

  if (params.search) {
    url.searchParams.set('name', params.search);
  }

  if (params.pageSize) {
    url.searchParams.set('pageSize', params.pageSize.toString());
  }

  if (params.startIndex !== undefined) {
    url.searchParams.set('startIndex', params.startIndex.toString());
  }

  return url.toString();
}

/**
 * Fetch EPDs from Ökobaudat API via backend proxy
 */
export async function fetchFromOekobaudat(params: OekobaudatSearchParams = {}): Promise<EPD[]> {
  // Check cache first
  const cacheKey = getCacheKey(params);
  const cached = cache.get(cacheKey);
  if (cached && isCacheValid(cached)) {
    return cached.data;
  }

  // Use backend proxy to avoid CORS issues
  const apiEndpoint = import.meta.env.DEV
    ? 'http://localhost:3001/api/oekobaudat'
    : '/api/oekobaudat';

  try {
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json() as { epds: EPD[]; totalCount: number };

    // Cache results
    cache.set(cacheKey, {
      data: data.epds,
      timestamp: Date.now(),
      query: params.search,
    });

    return data.epds;
  } catch (error) {
    console.error('[Ökobaudat] API error:', error);
    throw error;
  }
}

/**
 * Search EPDs by material name/keywords
 */
export async function searchOekobaudatEPDs(query: string): Promise<EPD[]> {
  return fetchFromOekobaudat({
    search: query,
    compliance: 'A2', // Use current standard
    pageSize: 50,
  });
}

/**
 * Get all EPDs for a specific material category
 */
export async function getOekobaudatByCategory(category: MaterialCategory): Promise<EPD[]> {
  // Map our categories to German search terms for better results
  const categorySearchTerms: Record<MaterialCategory, string> = {
    CONCRETE: 'Beton',
    STEEL: 'Stahl',
    WOOD: 'Holz',
    GLASS: 'Glas',
    INSULATION: 'Dämmstoff',
    MASONRY: 'Mauerwerk',
    ALUMINUM: 'Aluminium',
    GYPSUM: 'Gips',
    PLASTIC: 'Kunststoff',
    MEMBRANE: 'Dach Abdichtung',
    OTHER: '',
  };

  const searchTerm = categorySearchTerms[category];
  if (!searchTerm) return [];

  const epds = await fetchFromOekobaudat({
    search: searchTerm,
    compliance: 'A2',
    pageSize: 100,
  });

  // Filter to ensure correct category mapping
  return epds.filter(epd => epd.category === category);
}

/**
 * Clear the EPD cache
 */
export function clearOekobaudatCache(): void {
  cache.clear();
}

/**
 * Get cache statistics
 */
export function getCacheStats(): { entries: number; oldestEntry: number | null } {
  let oldest: number | null = null;

  cache.forEach(entry => {
    if (oldest === null || entry.timestamp < oldest) {
      oldest = entry.timestamp;
    }
  });

  return {
    entries: cache.size,
    oldestEntry: oldest,
  };
}
