# EPD Agent Model Context Architecture

## Problem Statement

The EPD agent needs full access to IFC model data (properties, attributes, relations, spatial structure, quantities) to make intelligent EPD recommendations. However:

1. **Model lives in browser** - IFC data is parsed and stored in the browser's Zustand store
2. **Agent runs on server** - Vercel Edge Function can't directly access browser state
3. **Large models** - Can't send all data to LLM (token limits, cost, latency)

## Solution: Tiered Context with Tool-Based Retrieval

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                           BROWSER                                   │
│  ┌─────────────┐    ┌──────────────────┐    ┌───────────────────┐  │
│  │  IFC Store  │───▶│ ModelContext     │───▶│   ChatPanel       │  │
│  │  (full data)│    │ Builder          │    │   (sends context) │  │
│  └─────────────┘    └──────────────────┘    └─────────┬─────────┘  │
└───────────────────────────────────────────────────────┼─────────────┘
                                                        │
                                              POST /api/epd-agent
                                              {message, modelContext}
                                                        │
                                                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      VERCEL EDGE FUNCTION                           │
│  ┌──────────────────┐    ┌─────────────────┐    ┌───────────────┐  │
│  │  Model Context   │◀───│   Tool Handlers │◀───│   LLM Agent   │  │
│  │  (passed in req) │    │   (query/filter)│    │   (OpenAI)    │  │
│  └──────────────────┘    └─────────────────┘    └───────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Data Tiers

#### Tier 1: Model Summary (Always Sent, ~10-50KB)

Compact overview for the LLM to understand the model:

```typescript
interface ModelSummary {
  project: {
    name: string;
    elementCount: number;
    buildingCount: number;
    storeyCount: number;
    totalVolume: number;  // m³
  };

  // Material summary (primary focus for EPD)
  materials: MaterialSummary[];

  // Spatial summary
  storeys: StoreySummary[];

  // Current LCA results
  lca?: {
    totalGwp: number;
    gwpByCategory: Record<string, number>;
  };
}

interface MaterialSummary {
  id: string;
  name: string;
  category: string;  // CONCRETE, STEEL, etc.

  // Aggregated quantities
  totalVolume: number;
  totalArea: number;
  totalWeight: number | null;
  elementCount: number;

  // Element type breakdown (critical for EPD selection)
  elementTypes: Record<string, number>;  // {"IfcWall": 5, "IfcSlab": 3}

  // Key properties aggregated (without element details)
  commonProperties?: {
    thicknesses?: number[];      // unique values
    fireRatings?: string[];      // unique values
    strengthClasses?: string[];  // e.g., "C30/37"
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

interface StoreySummary {
  id: number;
  name: string;
  elevation: number;
  elementCount: number;
  materialBreakdown: Record<string, number>;  // material name -> count
}
```

#### Tier 2: Detailed Data (On-Demand via Tools, variable size)

Agent tools can request more details when needed:

```typescript
// Returned by get_elements_for_material tool
interface MaterialElements {
  materialId: string;
  materialName: string;
  elements: ElementDetail[];
}

interface ElementDetail {
  id: number;
  type: string;           // IfcWall, IfcSlab, etc.
  name: string;
  description?: string;

  // Quantities
  volume?: number;
  area?: number;
  weight?: number;

  // Spatial context
  storeyId?: number;
  storeyName?: string;
  spaceName?: string;

  // Key properties (flattened from property sets)
  properties: Record<string, string | number | boolean>;
}

// Returned by get_element_properties tool
interface ElementProperties {
  elementId: number;
  type: string;
  name: string;

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

  // Relationships
  materials: string[];
  containedIn?: { type: string; name: string };  // storey/space
  relatedElements?: Array<{ id: number; type: string; relation: string }>;
}
```

### Agent Tools

#### Existing Tools (Updated)
1. `query_building_elements` - Now uses rich MaterialSummary
2. `get_material_details` - Returns MaterialSummary + sample elements
3. `search_epd_database` - Unchanged
4. `get_epd_details` - Unchanged
5. `compare_epds` - Unchanged
6. `propose_epd_mapping` - Unchanged

#### New Tools
7. `get_elements_for_material(materialId, limit?)` - Returns ElementDetail[] for a material
8. `get_element_properties(elementIds[])` - Returns full properties for specific elements
9. `get_spatial_breakdown(storeyName?)` - Returns elements grouped by storey/material
10. `get_high_impact_elements(limit?)` - Returns elements with highest GWP contribution
11. `search_elements(query)` - Search elements by name/description/property

### Size Budgets

To keep payloads reasonable:

| Component | Max Size | Strategy |
|-----------|----------|----------|
| Model Summary | 50KB | Always sent with each request |
| Material Summary | 1KB each | Max 100 materials = 100KB |
| Element Details | 500B each | Returned on-demand, max 100 at a time |
| Full Properties | 2KB each | Only for specific element queries |

### Implementation Steps

1. **Create `buildModelContext()` utility** in `viewer/src/lib/model-context.ts`
   - Extracts data from IFC store
   - Computes aggregations and summaries
   - Enforces size limits

2. **Update `ChatPanel`** to call `buildModelContext()` and include in requests

3. **Add new agent tools** in `viewer/api/epd-agent.ts`
   - Tool handlers operate on the ModelContext passed in request
   - For Tier 2 data, elements are included in a separate `elementIndex` field

4. **Update agent system prompt** to explain available context and tools

5. **Add element index** for large models
   - For models >1000 elements, send compact index separately
   - Tools can query the index for detailed data

### Data Flow Example

**User asks: "Find lower-carbon alternatives for the concrete in the slabs"**

1. ChatPanel builds ModelContext with:
   - Summary showing "Concrete C30/37" material has 500m³ across 12 IfcSlab elements
   - Current EPD: GWP = 285 kg CO₂e/m³, total = 142,500 kg CO₂e

2. Agent receives context, sees the concrete material summary

3. Agent calls `get_elements_for_material("concrete-001")` to see:
   - Slab thicknesses: 200mm, 250mm, 300mm
   - Storeys: Ground Floor (4 slabs), Level 1 (4 slabs), Level 2 (4 slabs)
   - Properties: Fire rating REI 90, strength class C30/37

4. Agent calls `search_epd_database({category: "CONCRETE", strength_class: "C30/37", use_case: "structural"})`:
   - Finds low-carbon alternatives with CEM III

5. Agent calls `propose_epd_mapping` with:
   - Reasoning based on actual element properties
   - Confidence based on technical compatibility

### Payload Structure

```typescript
interface AgentRequest {
  message: string;

  // Tier 1: Always included
  modelContext: ModelSummary;

  // Tier 2: Optional, for large models with many elements
  elementIndex?: Array<{
    id: number;
    type: string;
    name: string;
    materialId: string;
  }>;

  conversationHistory?: Message[];
}
```

### Benefits

1. **Scalable** - Works for models with 100 or 100,000 elements
2. **Intelligent** - Agent can drill down into specific elements when needed
3. **Efficient** - Only fetches detailed data when relevant
4. **Context-aware** - Agent understands spatial context, element types, properties
5. **Serverless-compatible** - All data passed in request, no persistent state
