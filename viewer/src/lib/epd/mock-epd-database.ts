/**
 * Mock EPD Database with Queryable Interface
 *
 * This provides a rich, searchable EPD database that the LLM agent can query
 * using specific criteria like fire rating, strength class, thermal properties, etc.
 *
 * Designed for demonstrating intelligent EPD selection workflows.
 */

import type { MaterialCategory, DeclaredUnit } from './types';

// ============ Enhanced EPD Types ============

export interface TechnicalProperties {
  // Structural
  density?: number;                    // kg/m³
  compressive_strength?: string;       // e.g., "C30/37", "C40/50"
  tensile_strength?: number;           // MPa
  yield_strength?: number;             // MPa (for steel)

  // Fire safety
  fire_rating?: string;                // e.g., "REI 90", "EI 60", "A1"
  fire_class?: string;                 // e.g., "A1", "A2-s1,d0", "B-s2,d0"

  // Thermal
  thermal_conductivity?: number;       // W/(m·K)
  thermal_resistance?: number;         // m²·K/W
  u_value?: number;                    // W/(m²·K)

  // Acoustic
  sound_reduction?: number;            // dB

  // Sustainability
  recycled_content?: number;           // percentage
  biogenic_carbon?: number;            // kg CO₂/unit (for wood products)
  recyclable?: boolean;

  // Physical
  thickness?: number;                  // mm
  width?: number;                      // mm
  length?: number;                     // mm
}

export interface EPDImpacts {
  // Production (A1-A3)
  gwp_a1_a3: number;
  odp_a1_a3?: number;
  ap_a1_a3?: number;
  ep_a1_a3?: number;

  // Transport (A4)
  gwp_a4?: number;

  // Construction (A5)
  gwp_a5?: number;

  // End of life (C1-C4)
  gwp_c1_c4?: number;

  // Benefits beyond system (D)
  gwp_d?: number;

  // Total (if available)
  gwp_total?: number;
}

export interface MockEPD {
  id: string;
  name: string;
  name_de?: string;                    // German name
  manufacturer: string;
  category: MaterialCategory;
  subcategory: string;

  impacts: EPDImpacts;
  properties: TechnicalProperties;

  declared_unit: {
    value: number;
    unit: DeclaredUnit;
  };

  // Applicability
  use_cases: string[];                 // ["structural", "facade", "interior", "foundation"]
  suitable_for: string[];              // ["wall", "slab", "column", "beam", "roof"]

  // Metadata
  valid_until: string;
  pcr: string;
  program_operator: string;
  region: string;
  verification: 'verified' | 'declaration' | 'generic';

  // For matching
  keywords: string[];
  description: string;
}

export interface EPDSearchCriteria {
  category?: MaterialCategory;
  subcategory?: string;

  // GWP filters
  gwp_max?: number;
  gwp_min?: number;

  // Technical requirements
  fire_rating_min?: string;            // e.g., "REI 60" means REI 60 or better
  strength_class?: string;             // e.g., "C30/37"
  thermal_conductivity_max?: number;
  recycled_content_min?: number;

  // Use case
  use_case?: string;
  suitable_for?: string;

  // Other
  manufacturer?: string;
  region?: string;
  keywords?: string[];

  // Pagination
  limit?: number;
  offset?: number;
}

export interface EPDSearchResult {
  epd: MockEPD;
  relevance_score: number;
  match_reasons: string[];
}

export interface EPDComparison {
  epds: MockEPD[];
  comparison: {
    property: string;
    values: (string | number | undefined)[];
    winner_index?: number;
    note?: string;
  }[];
  recommendation?: {
    epd_id: string;
    reason: string;
  };
}

// ============ Mock EPD Data ============

const mockEPDData: MockEPD[] = [
  // ============ CONCRETE ============
  {
    id: 'mock-concrete-001',
    name: 'Ready-Mix Concrete C30/37',
    name_de: 'Transportbeton C30/37',
    manufacturer: 'HeidelbergCement',
    category: 'CONCRETE',
    subcategory: 'Ready-mix',
    impacts: {
      gwp_a1_a3: 285,
      odp_a1_a3: 0.000012,
      ap_a1_a3: 0.65,
      ep_a1_a3: 0.085,
      gwp_a4: 15,
      gwp_c1_c4: 12,
      gwp_total: 312,
    },
    properties: {
      density: 2400,
      compressive_strength: 'C30/37',
      fire_rating: 'REI 120',
      fire_class: 'A1',
      thermal_conductivity: 2.1,
      recycled_content: 5,
    },
    declared_unit: { value: 1, unit: 'm3' },
    use_cases: ['structural', 'foundation', 'general'],
    suitable_for: ['wall', 'slab', 'column', 'beam', 'foundation'],
    valid_until: '2028-12-31',
    pcr: 'EN 15804+A2',
    program_operator: 'IBU',
    region: 'Germany',
    verification: 'verified',
    keywords: ['concrete', 'ready-mix', 'C30', 'C37', 'structural', 'beton'],
    description: 'Standard structural concrete for general construction applications.',
  },
  {
    id: 'mock-concrete-002',
    name: 'Low-Carbon Concrete C30/37 (CEM III)',
    name_de: 'Klimabeton C30/37 (CEM III)',
    manufacturer: 'Holcim ECOPact',
    category: 'CONCRETE',
    subcategory: 'Low-carbon',
    impacts: {
      gwp_a1_a3: 165,
      odp_a1_a3: 0.000008,
      ap_a1_a3: 0.45,
      ep_a1_a3: 0.065,
      gwp_a4: 15,
      gwp_c1_c4: 10,
      gwp_total: 190,
    },
    properties: {
      density: 2380,
      compressive_strength: 'C30/37',
      fire_rating: 'REI 120',
      fire_class: 'A1',
      thermal_conductivity: 2.0,
      recycled_content: 35,
    },
    declared_unit: { value: 1, unit: 'm3' },
    use_cases: ['structural', 'foundation', 'sustainable'],
    suitable_for: ['wall', 'slab', 'column', 'beam', 'foundation'],
    valid_until: '2028-06-30',
    pcr: 'EN 15804+A2',
    program_operator: 'IBU',
    region: 'Germany',
    verification: 'verified',
    keywords: ['concrete', 'low-carbon', 'green', 'sustainable', 'CEM III', 'slag', 'eco'],
    description: 'Low-carbon concrete using blast furnace slag cement, 42% lower GWP than standard.',
  },
  {
    id: 'mock-concrete-003',
    name: 'High-Strength Concrete C50/60',
    name_de: 'Hochfester Beton C50/60',
    manufacturer: 'BASF Master Builders',
    category: 'CONCRETE',
    subcategory: 'High-strength',
    impacts: {
      gwp_a1_a3: 380,
      odp_a1_a3: 0.000018,
      ap_a1_a3: 0.85,
      ep_a1_a3: 0.12,
      gwp_total: 420,
    },
    properties: {
      density: 2450,
      compressive_strength: 'C50/60',
      fire_rating: 'REI 120',
      fire_class: 'A1',
      thermal_conductivity: 2.3,
      recycled_content: 3,
    },
    declared_unit: { value: 1, unit: 'm3' },
    use_cases: ['structural', 'high-rise', 'heavy-load'],
    suitable_for: ['column', 'beam', 'slab'],
    valid_until: '2027-12-31',
    pcr: 'EN 15804+A2',
    program_operator: 'IBU',
    region: 'Germany',
    verification: 'verified',
    keywords: ['concrete', 'high-strength', 'C50', 'C60', 'structural', 'tower'],
    description: 'High-strength concrete for demanding structural applications.',
  },
  {
    id: 'mock-concrete-004',
    name: 'Precast Concrete Panel',
    name_de: 'Betonfertigteil Wandplatte',
    manufacturer: 'HOCHTIEF Prefab',
    category: 'CONCRETE',
    subcategory: 'Precast',
    impacts: {
      gwp_a1_a3: 310,
      odp_a1_a3: 0.000014,
      ap_a1_a3: 0.70,
      ep_a1_a3: 0.09,
      gwp_total: 340,
    },
    properties: {
      density: 2400,
      compressive_strength: 'C40/50',
      fire_rating: 'REI 90',
      fire_class: 'A1',
      thermal_conductivity: 2.1,
      thickness: 200,
    },
    declared_unit: { value: 1, unit: 'm2' },
    use_cases: ['facade', 'structural', 'prefab'],
    suitable_for: ['wall', 'facade'],
    valid_until: '2028-03-31',
    pcr: 'EN 15804+A2',
    program_operator: 'IBU',
    region: 'Germany',
    verification: 'verified',
    keywords: ['precast', 'panel', 'prefab', 'wall', 'facade', 'fertigteil'],
    description: 'Factory-produced concrete wall panels for rapid construction.',
  },

  // ============ STEEL ============
  {
    id: 'mock-steel-001',
    name: 'Structural Steel S355 (Hot-Rolled)',
    name_de: 'Baustahl S355 warmgewalzt',
    manufacturer: 'ArcelorMittal',
    category: 'STEEL',
    subcategory: 'Structural sections',
    impacts: {
      gwp_a1_a3: 1.85,
      odp_a1_a3: 0.00000012,
      ap_a1_a3: 0.0045,
      ep_a1_a3: 0.00065,
      gwp_d: -0.45,
      gwp_total: 1.40,
    },
    properties: {
      density: 7850,
      yield_strength: 355,
      fire_class: 'A1',
      recycled_content: 25,
      recyclable: true,
    },
    declared_unit: { value: 1, unit: 'kg' },
    use_cases: ['structural', 'primary-structure'],
    suitable_for: ['beam', 'column', 'truss'],
    valid_until: '2028-12-31',
    pcr: 'EN 15804+A2',
    program_operator: 'IBU',
    region: 'Europe',
    verification: 'verified',
    keywords: ['steel', 'structural', 'S355', 'hot-rolled', 'beam', 'column', 'stahl'],
    description: 'Standard structural steel for beams and columns.',
  },
  {
    id: 'mock-steel-002',
    name: 'Recycled Steel S355 (EAF)',
    name_de: 'Recycling-Stahl S355 (Elektrostahl)',
    manufacturer: 'Salzgitter Green Steel',
    category: 'STEEL',
    subcategory: 'Recycled structural',
    impacts: {
      gwp_a1_a3: 0.65,
      odp_a1_a3: 0.00000005,
      ap_a1_a3: 0.0025,
      ep_a1_a3: 0.00035,
      gwp_d: -0.50,
      gwp_total: 0.15,
    },
    properties: {
      density: 7850,
      yield_strength: 355,
      fire_class: 'A1',
      recycled_content: 95,
      recyclable: true,
    },
    declared_unit: { value: 1, unit: 'kg' },
    use_cases: ['structural', 'sustainable'],
    suitable_for: ['beam', 'column', 'truss'],
    valid_until: '2028-06-30',
    pcr: 'EN 15804+A2',
    program_operator: 'IBU',
    region: 'Germany',
    verification: 'verified',
    keywords: ['steel', 'recycled', 'green', 'EAF', 'electric-arc', 'sustainable', 'low-carbon'],
    description: 'Low-carbon steel from electric arc furnace with 95% recycled content.',
  },
  {
    id: 'mock-steel-003',
    name: 'Reinforcing Steel (Rebar)',
    name_de: 'Betonstahl B500',
    manufacturer: 'Industry Average',
    category: 'STEEL',
    subcategory: 'Reinforcement',
    impacts: {
      gwp_a1_a3: 0.76,
      odp_a1_a3: 0.00000008,
      ap_a1_a3: 0.0032,
      ep_a1_a3: 0.00045,
      gwp_d: -0.35,
      gwp_total: 0.41,
    },
    properties: {
      density: 7850,
      yield_strength: 500,
      fire_class: 'A1',
      recycled_content: 85,
      recyclable: true,
    },
    declared_unit: { value: 1, unit: 'kg' },
    use_cases: ['reinforcement', 'concrete-reinforcement'],
    suitable_for: ['slab', 'wall', 'beam', 'column', 'foundation'],
    valid_until: '2027-12-31',
    pcr: 'EN 15804+A2',
    program_operator: 'EPD International',
    region: 'Europe',
    verification: 'verified',
    keywords: ['rebar', 'reinforcement', 'B500', 'concrete', 'betonstahl'],
    description: 'Reinforcing steel bars for concrete structures.',
  },

  // ============ WOOD ============
  {
    id: 'mock-wood-001',
    name: 'Cross-Laminated Timber (CLT)',
    name_de: 'Brettsperrholz (BSP)',
    manufacturer: 'Stora Enso',
    category: 'WOOD',
    subcategory: 'Engineered wood',
    impacts: {
      gwp_a1_a3: -680,
      odp_a1_a3: 0.000002,
      ap_a1_a3: 0.15,
      ep_a1_a3: 0.025,
      gwp_c1_c4: 450,
      gwp_total: -230,
    },
    properties: {
      density: 470,
      fire_rating: 'REI 60',
      fire_class: 'D-s2,d0',
      thermal_conductivity: 0.12,
      biogenic_carbon: 850,
      recycled_content: 0,
    },
    declared_unit: { value: 1, unit: 'm3' },
    use_cases: ['structural', 'sustainable', 'prefab'],
    suitable_for: ['wall', 'slab', 'roof'],
    valid_until: '2028-12-31',
    pcr: 'EN 15804+A2',
    program_operator: 'IBU',
    region: 'Europe',
    verification: 'verified',
    keywords: ['CLT', 'cross-laminated', 'timber', 'wood', 'mass-timber', 'carbon-negative', 'holz', 'BSP'],
    description: 'Carbon-storing mass timber for structural walls and floors.',
  },
  {
    id: 'mock-wood-002',
    name: 'Glulam Beam GL24h',
    name_de: 'Brettschichtholz GL24h',
    manufacturer: 'Binderholz',
    category: 'WOOD',
    subcategory: 'Engineered wood',
    impacts: {
      gwp_a1_a3: -720,
      odp_a1_a3: 0.0000018,
      ap_a1_a3: 0.12,
      ep_a1_a3: 0.022,
      gwp_c1_c4: 480,
      gwp_total: -240,
    },
    properties: {
      density: 420,
      fire_rating: 'R 60',
      fire_class: 'D-s2,d0',
      thermal_conductivity: 0.13,
      biogenic_carbon: 880,
    },
    declared_unit: { value: 1, unit: 'm3' },
    use_cases: ['structural', 'long-span'],
    suitable_for: ['beam', 'column', 'truss'],
    valid_until: '2028-09-30',
    pcr: 'EN 15804+A2',
    program_operator: 'IBU',
    region: 'Austria',
    verification: 'verified',
    keywords: ['glulam', 'beam', 'timber', 'laminated', 'GL24', 'brettschichtholz'],
    description: 'Glue-laminated timber beams for structural applications.',
  },
  {
    id: 'mock-wood-003',
    name: 'Softwood Timber (Spruce)',
    name_de: 'Konstruktionsvollholz Fichte',
    manufacturer: 'Regional Average',
    category: 'WOOD',
    subcategory: 'Solid wood',
    impacts: {
      gwp_a1_a3: -750,
      odp_a1_a3: 0.0000012,
      ap_a1_a3: 0.08,
      ep_a1_a3: 0.015,
      gwp_c1_c4: 500,
      gwp_total: -250,
    },
    properties: {
      density: 450,
      fire_class: 'D-s2,d0',
      thermal_conductivity: 0.13,
      biogenic_carbon: 900,
    },
    declared_unit: { value: 1, unit: 'm3' },
    use_cases: ['structural', 'framing', 'general'],
    suitable_for: ['wall', 'roof', 'floor'],
    valid_until: '2027-06-30',
    pcr: 'EN 15804+A2',
    program_operator: 'EPD Norway',
    region: 'Nordic',
    verification: 'verified',
    keywords: ['softwood', 'spruce', 'timber', 'solid', 'framing', 'fichte', 'nadelholz'],
    description: 'Solid softwood timber for general construction.',
  },

  // ============ INSULATION ============
  {
    id: 'mock-insulation-001',
    name: 'Mineral Wool (Stone Wool)',
    name_de: 'Steinwolle Dämmplatte',
    manufacturer: 'Rockwool',
    category: 'INSULATION',
    subcategory: 'Mineral wool',
    impacts: {
      gwp_a1_a3: 1.12,
      odp_a1_a3: 0.0000001,
      ap_a1_a3: 0.008,
      ep_a1_a3: 0.0012,
      gwp_total: 1.25,
    },
    properties: {
      density: 40,
      fire_rating: 'A1',
      fire_class: 'A1',
      thermal_conductivity: 0.035,
      sound_reduction: 45,
      recycled_content: 25,
    },
    declared_unit: { value: 1, unit: 'kg' },
    use_cases: ['thermal-insulation', 'acoustic', 'fire-protection'],
    suitable_for: ['wall', 'roof', 'floor', 'facade'],
    valid_until: '2028-12-31',
    pcr: 'EN 15804+A2',
    program_operator: 'IBU',
    region: 'Europe',
    verification: 'verified',
    keywords: ['mineral-wool', 'stone-wool', 'rockwool', 'insulation', 'fireproof', 'steinwolle'],
    description: 'Non-combustible mineral wool insulation with excellent fire performance.',
  },
  {
    id: 'mock-insulation-002',
    name: 'EPS Insulation (Grey)',
    name_de: 'EPS Dämmplatte grau',
    manufacturer: 'BASF Neopor',
    category: 'INSULATION',
    subcategory: 'Foam plastic',
    impacts: {
      gwp_a1_a3: 3.25,
      odp_a1_a3: 0.0000002,
      ap_a1_a3: 0.012,
      ep_a1_a3: 0.0018,
      gwp_total: 3.45,
    },
    properties: {
      density: 20,
      fire_class: 'E',
      thermal_conductivity: 0.031,
      recycled_content: 0,
    },
    declared_unit: { value: 1, unit: 'kg' },
    use_cases: ['thermal-insulation', 'ETICS'],
    suitable_for: ['wall', 'facade', 'roof'],
    valid_until: '2027-09-30',
    pcr: 'EN 15804+A2',
    program_operator: 'IBU',
    region: 'Germany',
    verification: 'verified',
    keywords: ['EPS', 'styrofoam', 'grey', 'neopor', 'ETICS', 'polystyrene'],
    description: 'Enhanced EPS with graphite for improved thermal performance.',
  },
  {
    id: 'mock-insulation-003',
    name: 'Wood Fiber Insulation',
    name_de: 'Holzfaserdämmplatte',
    manufacturer: 'Steico',
    category: 'INSULATION',
    subcategory: 'Natural fiber',
    impacts: {
      gwp_a1_a3: -0.85,
      odp_a1_a3: 0.00000005,
      ap_a1_a3: 0.005,
      ep_a1_a3: 0.0008,
      gwp_c1_c4: 1.2,
      gwp_total: 0.35,
    },
    properties: {
      density: 160,
      fire_class: 'E',
      thermal_conductivity: 0.038,
      sound_reduction: 38,
      biogenic_carbon: 1.5,
      recycled_content: 0,
    },
    declared_unit: { value: 1, unit: 'kg' },
    use_cases: ['thermal-insulation', 'sustainable', 'acoustic'],
    suitable_for: ['wall', 'roof'],
    valid_until: '2028-06-30',
    pcr: 'EN 15804+A2',
    program_operator: 'IBU',
    region: 'Germany',
    verification: 'verified',
    keywords: ['wood-fiber', 'natural', 'sustainable', 'holzfaser', 'ecological', 'bio'],
    description: 'Carbon-storing natural insulation from wood fibers.',
  },

  // ============ GLASS ============
  {
    id: 'mock-glass-001',
    name: 'Triple Glazing Unit (Argon)',
    name_de: 'Dreifach-Isolierglas Argon',
    manufacturer: 'Saint-Gobain',
    category: 'GLASS',
    subcategory: 'Insulating glass',
    impacts: {
      gwp_a1_a3: 32,
      odp_a1_a3: 0.000003,
      ap_a1_a3: 0.12,
      ep_a1_a3: 0.018,
      gwp_total: 35,
    },
    properties: {
      density: 2500,
      fire_class: 'A1',
      thermal_conductivity: 0.9,
      u_value: 0.6,
      sound_reduction: 35,
      recycled_content: 20,
    },
    declared_unit: { value: 1, unit: 'm2' },
    use_cases: ['glazing', 'facade', 'energy-efficient'],
    suitable_for: ['window', 'curtain-wall', 'facade'],
    valid_until: '2028-12-31',
    pcr: 'EN 15804+A2',
    program_operator: 'IBU',
    region: 'Europe',
    verification: 'verified',
    keywords: ['triple', 'glazing', 'insulating', 'argon', 'window', 'low-e', 'isolierglas'],
    description: 'High-performance triple glazing with low-e coating and argon fill.',
  },
  {
    id: 'mock-glass-002',
    name: 'Double Glazing Unit (Standard)',
    name_de: 'Zweifach-Isolierglas',
    manufacturer: 'Pilkington',
    category: 'GLASS',
    subcategory: 'Insulating glass',
    impacts: {
      gwp_a1_a3: 22,
      odp_a1_a3: 0.000002,
      ap_a1_a3: 0.09,
      ep_a1_a3: 0.014,
      gwp_total: 24,
    },
    properties: {
      density: 2500,
      fire_class: 'A1',
      u_value: 1.1,
      sound_reduction: 32,
      recycled_content: 15,
    },
    declared_unit: { value: 1, unit: 'm2' },
    use_cases: ['glazing', 'standard'],
    suitable_for: ['window', 'facade'],
    valid_until: '2027-12-31',
    pcr: 'EN 15804+A2',
    program_operator: 'EPD International',
    region: 'Europe',
    verification: 'verified',
    keywords: ['double', 'glazing', 'insulating', 'window', 'standard'],
    description: 'Standard double glazing unit for general applications.',
  },

  // ============ GYPSUM ============
  {
    id: 'mock-gypsum-001',
    name: 'Gypsum Board (Standard)',
    name_de: 'Gipskartonplatte',
    manufacturer: 'Knauf',
    category: 'GYPSUM',
    subcategory: 'Plasterboard',
    impacts: {
      gwp_a1_a3: 2.8,
      odp_a1_a3: 0.0000002,
      ap_a1_a3: 0.012,
      ep_a1_a3: 0.0018,
      gwp_total: 3.1,
    },
    properties: {
      density: 680,
      fire_class: 'A2-s1,d0',
      fire_rating: 'EI 30',
      thermal_conductivity: 0.25,
      thickness: 12.5,
      recycled_content: 25,
    },
    declared_unit: { value: 1, unit: 'm2' },
    use_cases: ['interior', 'partition', 'drywall'],
    suitable_for: ['wall', 'ceiling'],
    valid_until: '2028-12-31',
    pcr: 'EN 15804+A2',
    program_operator: 'IBU',
    region: 'Germany',
    verification: 'verified',
    keywords: ['gypsum', 'plasterboard', 'drywall', 'partition', 'knauf', 'gipskarton'],
    description: 'Standard gypsum board for interior walls and ceilings.',
  },
  {
    id: 'mock-gypsum-002',
    name: 'Fire-Rated Gypsum Board (F)',
    name_de: 'Gipskarton-Feuerschutzplatte GKF',
    manufacturer: 'Rigips',
    category: 'GYPSUM',
    subcategory: 'Fire-rated board',
    impacts: {
      gwp_a1_a3: 3.5,
      odp_a1_a3: 0.00000025,
      ap_a1_a3: 0.015,
      ep_a1_a3: 0.0022,
      gwp_total: 3.8,
    },
    properties: {
      density: 800,
      fire_class: 'A2-s1,d0',
      fire_rating: 'EI 60',
      thermal_conductivity: 0.25,
      thickness: 15,
      recycled_content: 20,
    },
    declared_unit: { value: 1, unit: 'm2' },
    use_cases: ['interior', 'fire-protection', 'partition'],
    suitable_for: ['wall', 'ceiling'],
    valid_until: '2028-06-30',
    pcr: 'EN 15804+A2',
    program_operator: 'IBU',
    region: 'Germany',
    verification: 'verified',
    keywords: ['gypsum', 'fire-rated', 'GKF', 'fireproof', 'feuerschutz', 'rigips'],
    description: 'Fire-resistant gypsum board for enhanced fire protection.',
  },

  // ============ ALUMINUM ============
  {
    id: 'mock-aluminum-001',
    name: 'Aluminum Profile (Primary)',
    name_de: 'Aluminiumprofil Primär',
    manufacturer: 'Schüco',
    category: 'ALUMINUM',
    subcategory: 'Profiles',
    impacts: {
      gwp_a1_a3: 8.5,
      odp_a1_a3: 0.0000008,
      ap_a1_a3: 0.045,
      ep_a1_a3: 0.0065,
      gwp_d: -4.2,
      gwp_total: 4.3,
    },
    properties: {
      density: 2700,
      fire_class: 'A1',
      thermal_conductivity: 160,
      recycled_content: 30,
      recyclable: true,
    },
    declared_unit: { value: 1, unit: 'kg' },
    use_cases: ['facade', 'window-frame', 'curtain-wall'],
    suitable_for: ['window', 'curtain-wall', 'facade'],
    valid_until: '2028-12-31',
    pcr: 'EN 15804+A2',
    program_operator: 'IBU',
    region: 'Germany',
    verification: 'verified',
    keywords: ['aluminum', 'profile', 'facade', 'window', 'curtain-wall', 'schüco'],
    description: 'Aluminum profiles for facade and window systems.',
  },
  {
    id: 'mock-aluminum-002',
    name: 'Recycled Aluminum Profile',
    name_de: 'Aluminium-Recyclingprofil',
    manufacturer: 'Hydro CIRCAL',
    category: 'ALUMINUM',
    subcategory: 'Recycled profiles',
    impacts: {
      gwp_a1_a3: 2.1,
      odp_a1_a3: 0.0000002,
      ap_a1_a3: 0.015,
      ep_a1_a3: 0.002,
      gwp_d: -1.8,
      gwp_total: 0.3,
    },
    properties: {
      density: 2700,
      fire_class: 'A1',
      thermal_conductivity: 160,
      recycled_content: 75,
      recyclable: true,
    },
    declared_unit: { value: 1, unit: 'kg' },
    use_cases: ['facade', 'sustainable', 'window-frame'],
    suitable_for: ['window', 'curtain-wall', 'facade'],
    valid_until: '2028-09-30',
    pcr: 'EN 15804+A2',
    program_operator: 'EPD Norway',
    region: 'Norway',
    verification: 'verified',
    keywords: ['aluminum', 'recycled', 'circal', 'sustainable', 'low-carbon', 'green'],
    description: 'Low-carbon aluminum with 75% post-consumer recycled content.',
  },

  // ============ MASONRY ============
  {
    id: 'mock-masonry-001',
    name: 'Clay Brick (Facing)',
    name_de: 'Klinker Vormauerziegel',
    manufacturer: 'Wienerberger',
    category: 'MASONRY',
    subcategory: 'Clay brick',
    impacts: {
      gwp_a1_a3: 0.21,
      odp_a1_a3: 0.00000001,
      ap_a1_a3: 0.00085,
      ep_a1_a3: 0.00012,
      gwp_total: 0.24,
    },
    properties: {
      density: 1900,
      fire_class: 'A1',
      fire_rating: 'REI 90',
      thermal_conductivity: 0.68,
      sound_reduction: 48,
    },
    declared_unit: { value: 1, unit: 'kg' },
    use_cases: ['facade', 'masonry', 'exterior'],
    suitable_for: ['wall', 'facade'],
    valid_until: '2028-01-31',
    pcr: 'EN 15804+A2',
    program_operator: 'IBU',
    region: 'Germany',
    verification: 'verified',
    keywords: ['brick', 'clay', 'facing', 'klinker', 'masonry', 'ziegel'],
    description: 'Traditional clay facing brick for exterior walls.',
  },
  {
    id: 'mock-masonry-002',
    name: 'Lightweight Concrete Block',
    name_de: 'Leichtbetonstein',
    manufacturer: 'Liapor',
    category: 'MASONRY',
    subcategory: 'Concrete block',
    impacts: {
      gwp_a1_a3: 0.065,
      odp_a1_a3: 0.000000005,
      ap_a1_a3: 0.00028,
      ep_a1_a3: 0.00004,
      gwp_total: 0.072,
    },
    properties: {
      density: 600,
      fire_class: 'A1',
      fire_rating: 'REI 90',
      thermal_conductivity: 0.14,
      sound_reduction: 42,
      recycled_content: 50,
    },
    declared_unit: { value: 1, unit: 'kg' },
    use_cases: ['masonry', 'thermal-insulation'],
    suitable_for: ['wall'],
    valid_until: '2027-08-31',
    pcr: 'EN 15804+A2',
    program_operator: 'EPD International',
    region: 'Germany',
    verification: 'verified',
    keywords: ['lightweight', 'concrete', 'block', 'liapor', 'thermal', 'leichtbeton'],
    description: 'Lightweight aggregate concrete blocks with thermal benefits.',
  },
];

// ============ Database Query Functions ============

/**
 * Parse fire rating to numeric value for comparison
 * REI 120 > REI 90 > REI 60 > REI 30 > EI 60 > EI 30 > R 60 > none
 */
function parseFireRating(rating: string | undefined): number {
  if (!rating) return 0;
  const match = rating.match(/(\d+)/);
  const minutes = match ? parseInt(match[1]) : 0;
  const hasR = rating.includes('R');
  const hasE = rating.includes('E');
  const hasI = rating.includes('I');

  // REI is best, then EI, then R, then E, then I
  let multiplier = 1;
  if (hasR && hasE && hasI) multiplier = 4;
  else if (hasE && hasI) multiplier = 3;
  else if (hasR) multiplier = 2;

  return minutes * multiplier;
}

/**
 * Check if EPD meets minimum fire rating requirement
 */
function meetsFireRating(epdRating: string | undefined, minRating: string): boolean {
  return parseFireRating(epdRating) >= parseFireRating(minRating);
}

/**
 * Calculate relevance score for search
 */
function calculateRelevance(epd: MockEPD, criteria: EPDSearchCriteria): { score: number; reasons: string[] } {
  let score = 50; // Base score
  const reasons: string[] = [];

  // Category match (required)
  if (criteria.category && epd.category !== criteria.category) {
    return { score: 0, reasons: ['Category mismatch'] };
  }
  if (criteria.category) {
    score += 20;
    reasons.push(`Category: ${epd.category}`);
  }

  // Subcategory match
  if (criteria.subcategory && epd.subcategory?.toLowerCase().includes(criteria.subcategory.toLowerCase())) {
    score += 15;
    reasons.push(`Subcategory: ${epd.subcategory}`);
  }

  // GWP range
  const gwp = epd.impacts.gwp_a1_a3;
  if (criteria.gwp_max !== undefined && gwp > criteria.gwp_max) {
    return { score: 0, reasons: [`GWP ${gwp} exceeds max ${criteria.gwp_max}`] };
  }
  if (criteria.gwp_min !== undefined && gwp < criteria.gwp_min) {
    return { score: 0, reasons: [`GWP ${gwp} below min ${criteria.gwp_min}`] };
  }

  // Fire rating
  if (criteria.fire_rating_min) {
    if (!meetsFireRating(epd.properties.fire_rating, criteria.fire_rating_min)) {
      return { score: 0, reasons: [`Fire rating ${epd.properties.fire_rating || 'none'} doesn't meet ${criteria.fire_rating_min}`] };
    }
    score += 15;
    reasons.push(`Fire rating: ${epd.properties.fire_rating}`);
  }

  // Strength class
  if (criteria.strength_class && epd.properties.compressive_strength) {
    if (epd.properties.compressive_strength.includes(criteria.strength_class)) {
      score += 15;
      reasons.push(`Strength class: ${epd.properties.compressive_strength}`);
    }
  }

  // Use case
  if (criteria.use_case && epd.use_cases.includes(criteria.use_case)) {
    score += 10;
    reasons.push(`Use case: ${criteria.use_case}`);
  }

  // Suitable for
  if (criteria.suitable_for && epd.suitable_for.includes(criteria.suitable_for)) {
    score += 10;
    reasons.push(`Suitable for: ${criteria.suitable_for}`);
  }

  // Thermal conductivity
  if (criteria.thermal_conductivity_max !== undefined) {
    if (epd.properties.thermal_conductivity && epd.properties.thermal_conductivity <= criteria.thermal_conductivity_max) {
      score += 10;
      reasons.push(`Thermal conductivity: ${epd.properties.thermal_conductivity} W/(m·K)`);
    } else if (epd.properties.thermal_conductivity && epd.properties.thermal_conductivity > criteria.thermal_conductivity_max) {
      score -= 20;
    }
  }

  // Recycled content
  if (criteria.recycled_content_min !== undefined) {
    if (epd.properties.recycled_content && epd.properties.recycled_content >= criteria.recycled_content_min) {
      score += 10;
      reasons.push(`Recycled content: ${epd.properties.recycled_content}%`);
    }
  }

  // Keywords
  if (criteria.keywords && criteria.keywords.length > 0) {
    const matchedKeywords = criteria.keywords.filter(kw =>
      epd.keywords.some(ek => ek.toLowerCase().includes(kw.toLowerCase())) ||
      epd.name.toLowerCase().includes(kw.toLowerCase()) ||
      epd.description.toLowerCase().includes(kw.toLowerCase())
    );
    if (matchedKeywords.length > 0) {
      score += matchedKeywords.length * 5;
      reasons.push(`Keywords matched: ${matchedKeywords.join(', ')}`);
    }
  }

  // Prefer verified EPDs
  if (epd.verification === 'verified') {
    score += 5;
  }

  // Prefer lower GWP within valid range
  score -= Math.abs(gwp) * 0.01;

  return { score, reasons };
}

// ============ Exported Database Class ============

export class MockEPDDatabase {
  private epds: MockEPD[] = mockEPDData;

  /**
   * Search EPDs with criteria
   */
  searchEPDs(criteria: EPDSearchCriteria): EPDSearchResult[] {
    const results: EPDSearchResult[] = [];

    for (const epd of this.epds) {
      const { score, reasons } = calculateRelevance(epd, criteria);
      if (score > 0) {
        results.push({
          epd,
          relevance_score: score,
          match_reasons: reasons,
        });
      }
    }

    // Sort by relevance
    results.sort((a, b) => b.relevance_score - a.relevance_score);

    // Apply pagination
    const offset = criteria.offset || 0;
    const limit = criteria.limit || 10;

    return results.slice(offset, offset + limit);
  }

  /**
   * Get EPD by ID
   */
  getEPD(id: string): MockEPD | undefined {
    return this.epds.find(e => e.id === id);
  }

  /**
   * Get all EPDs in a category
   */
  getByCategory(category: MaterialCategory): MockEPD[] {
    return this.epds.filter(e => e.category === category);
  }

  /**
   * Compare multiple EPDs
   */
  compareEPDs(ids: string[]): EPDComparison | null {
    const epds = ids.map(id => this.getEPD(id)).filter((e): e is MockEPD => e !== undefined);
    if (epds.length < 2) return null;

    const comparison: EPDComparison['comparison'] = [
      {
        property: 'GWP (kg CO₂e/unit)',
        values: epds.map(e => e.impacts.gwp_a1_a3),
        winner_index: epds.reduce((minIdx, e, idx, arr) =>
          e.impacts.gwp_a1_a3 < arr[minIdx].impacts.gwp_a1_a3 ? idx : minIdx, 0),
        note: 'Lower is better',
      },
      {
        property: 'Fire Rating',
        values: epds.map(e => e.properties.fire_rating || 'N/A'),
        winner_index: epds.reduce((maxIdx, e, idx, arr) =>
          parseFireRating(e.properties.fire_rating) > parseFireRating(arr[maxIdx].properties.fire_rating) ? idx : maxIdx, 0),
        note: 'Higher rating is better',
      },
      {
        property: 'Recycled Content (%)',
        values: epds.map(e => e.properties.recycled_content || 0),
        winner_index: epds.reduce((maxIdx, e, idx, arr) =>
          (e.properties.recycled_content || 0) > (arr[maxIdx].properties.recycled_content || 0) ? idx : maxIdx, 0),
        note: 'Higher is better',
      },
      {
        property: 'Declared Unit',
        values: epds.map(e => `${e.declared_unit.value} ${e.declared_unit.unit}`),
      },
      {
        property: 'Verification',
        values: epds.map(e => e.verification),
      },
    ];

    // Find best overall (lowest GWP among those meeting requirements)
    const lowestGWPIdx = epds.reduce((minIdx, e, idx, arr) =>
      e.impacts.gwp_a1_a3 < arr[minIdx].impacts.gwp_a1_a3 ? idx : minIdx, 0);

    return {
      epds,
      comparison,
      recommendation: {
        epd_id: epds[lowestGWPIdx].id,
        reason: `Lowest GWP at ${epds[lowestGWPIdx].impacts.gwp_a1_a3} kg CO₂e/${epds[lowestGWPIdx].declared_unit.unit}`,
      },
    };
  }

  /**
   * Get alternatives to an EPD (same category, different options)
   */
  getAlternatives(id: string, preferLowerGWP = true): MockEPD[] {
    const epd = this.getEPD(id);
    if (!epd) return [];

    const alternatives = this.epds.filter(e =>
      e.id !== id &&
      e.category === epd.category
    );

    if (preferLowerGWP) {
      alternatives.sort((a, b) => a.impacts.gwp_a1_a3 - b.impacts.gwp_a1_a3);
    }

    return alternatives.slice(0, 5);
  }

  /**
   * Get all available categories
   */
  getCategories(): MaterialCategory[] {
    return [...new Set(this.epds.map(e => e.category))];
  }

  /**
   * Get database statistics
   */
  getStats(): { total: number; by_category: Record<string, number> } {
    const by_category: Record<string, number> = {};
    for (const epd of this.epds) {
      by_category[epd.category] = (by_category[epd.category] || 0) + 1;
    }
    return { total: this.epds.length, by_category };
  }
}

// Singleton instance
export const mockEPDDatabase = new MockEPDDatabase();

// ============ Tool Response Formatters ============

/**
 * Format EPD for LLM context (concise)
 */
export function formatEPDForLLM(epd: MockEPD): string {
  const props = [];
  if (epd.properties.fire_rating) props.push(`Fire: ${epd.properties.fire_rating}`);
  if (epd.properties.compressive_strength) props.push(`Strength: ${epd.properties.compressive_strength}`);
  if (epd.properties.thermal_conductivity) props.push(`λ: ${epd.properties.thermal_conductivity} W/(m·K)`);
  if (epd.properties.recycled_content) props.push(`Recycled: ${epd.properties.recycled_content}%`);

  return `[${epd.id}] ${epd.name}
  GWP: ${epd.impacts.gwp_a1_a3} kg CO₂e/${epd.declared_unit.unit}
  ${props.join(' | ')}
  Use: ${epd.use_cases.join(', ')}`;
}

/**
 * Format search results for LLM
 */
export function formatSearchResultsForLLM(results: EPDSearchResult[]): string {
  if (results.length === 0) {
    return 'No EPDs found matching the criteria.';
  }

  return results.map((r, i) =>
    `${i + 1}. ${formatEPDForLLM(r.epd)}\n   Score: ${r.relevance_score} | Reasons: ${r.match_reasons.join(', ')}`
  ).join('\n\n');
}

/**
 * Format comparison for LLM
 */
export function formatComparisonForLLM(comparison: EPDComparison): string {
  let output = '=== EPD Comparison ===\n\n';

  output += 'EPDs compared:\n';
  comparison.epds.forEach((epd, i) => {
    output += `  ${i + 1}. ${epd.name} (${epd.id})\n`;
  });

  output += '\nComparison:\n';
  for (const row of comparison.comparison) {
    const values = row.values.map((v, i) =>
      row.winner_index === i ? `**${v}** ✓` : String(v)
    ).join(' | ');
    output += `  ${row.property}: ${values}${row.note ? ` (${row.note})` : ''}\n`;
  }

  if (comparison.recommendation) {
    output += `\n💡 Recommendation: ${comparison.recommendation.epd_id}\n   ${comparison.recommendation.reason}`;
  }

  return output;
}
