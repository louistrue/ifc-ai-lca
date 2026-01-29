/**
 * EPD (Environmental Product Declaration) Types
 * Based on openEPD format for construction materials
 */

export type MaterialCategory =
  | 'CONCRETE'
  | 'STEEL'
  | 'WOOD'
  | 'GLASS'
  | 'INSULATION'
  | 'MASONRY'
  | 'ALUMINUM'
  | 'GYPSUM'
  | 'PLASTIC'
  | 'MEMBRANE'
  | 'OTHER';

export type DeclaredUnit = 'm3' | 'm2' | 'kg' | 'piece' | 'ton' | 'm';

export interface EnvironmentalImpacts {
  /** Global Warming Potential (kg CO2e) - A1-A3 stages */
  gwp: number;
  /** Ozone Depletion Potential (kg CFC-11e) */
  odp?: number;
  /** Acidification Potential (kg SO2e) */
  ap?: number;
  /** Eutrophication Potential (kg PO4e) */
  ep?: number;
  /** Photochemical Ozone Creation Potential (kg C2H4e) */
  pocp?: number;
}

export interface EPD {
  id: string;
  name: string;
  manufacturer: string;
  category: MaterialCategory;
  subcategory?: string;

  /** Environmental impacts per declared unit */
  impacts: EnvironmentalImpacts;

  /** Declared unit for the EPD */
  declaredUnit: {
    value: number;
    unit: DeclaredUnit;
  };

  /** EPD validity date */
  validUntil: string;

  /** Product Category Rule */
  pcr: string;

  /** EPD program operator */
  programOperator: string;

  /** Manufacturing plant location */
  plantLocation?: string;

  /** Keywords for matching */
  keywords: string[];

  /** Technical specifications */
  specifications?: Record<string, string | number>;

  /** Data source/quality indicator */
  dataQuality?: 'specific' | 'average' | 'generic';
}

export interface ExtractedMaterial {
  id: string;
  name: string;
  category: MaterialCategory;
  /** Element IDs using this material */
  elementIds: number[];
  /** Total volume in m³ */
  totalVolume?: number;
  /** Total area in m² */
  totalArea?: number;
  /** Total length in m */
  totalLength?: number;
  /** Total weight in kg */
  totalWeight?: number;
  /** IFC properties */
  properties: Record<string, unknown>;
}

export interface EPDMatch {
  material: ExtractedMaterial;
  epd: EPD;
  /** Match confidence 0-100 */
  confidence: number;
  /** Reason for the match */
  matchReason: string;
  /** Calculated GWP for total quantity */
  calculatedGWP: number;
  /** Unit used for calculation */
  calculatedUnit: DeclaredUnit;
  /** Quantity used in calculation */
  quantity: number;
  /** Alternative lower-impact EPDs */
  alternatives?: EPD[];
}

export interface LCAResults {
  /** Total GWP in kg CO2e */
  totalGWP: number;
  /** Breakdown by material */
  byMaterial: Map<string, number>;
  /** Breakdown by category */
  byCategory: Map<MaterialCategory, number>;
  /** All EPD matches */
  matches: EPDMatch[];
  /** Materials without matches */
  unmatchedMaterials: ExtractedMaterial[];
}
