# IFC-AI-LCA Demo Application - Comprehensive Plan

## Executive Summary

A web application that combines **3D IFC model viewing** with **AI-powered EPD matching** for Life Cycle Assessment (LCA). Users can upload IFC building models, automatically extract materials and quantities, and receive AI-suggested Environmental Product Declaration (EPD) matches through an interactive chat interface.

---

## Table of Contents

1. [Technology Stack](#technology-stack)
2. [Architecture Overview](#architecture-overview)
3. [Data Models](#data-models)
4. [UI/UX Design](#uiux-design)
5. [Component Structure](#component-structure)
6. [User Flows](#user-flows)
7. [AI Integration](#ai-integration)
8. [Implementation Phases](#implementation-phases)

---

## Technology Stack

### Frontend
| Technology | Purpose | Version |
|------------|---------|---------|
| **Next.js 15** | React framework with App Router | ^15.0 |
| **React 19** | UI library | ^19.0 |
| **TypeScript** | Type safety | ^5.0 |
| **Tailwind CSS** | Styling | ^3.4 |
| **shadcn/ui** | UI component library | latest |
| **@ifc-lite/parser** | IFC file parsing | latest |
| **@ifc-lite/geometry** | Geometry processing | latest |
| **@ifc-lite/renderer** | WebGPU 3D rendering | latest |
| **@ifc-lite/query** | IFC data querying | latest |

### AI & Backend
| Technology | Purpose |
|------------|---------|
| **Vercel AI SDK v6** | Chat UI, streaming, tool calling |
| **Vercel AI Gateway** | Model access without API key management |
| **Claude/GPT-4** | LLM for EPD matching and explanations |

### Data
| Source | Purpose |
|--------|---------|
| **Sample EPD JSON** | Pre-defined EPD database for demo |
| **openEPD format** | EPD data structure standard |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BROWSER (Client)                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────┐  │
│  │   3D Model Viewer    │  │    EPD Panel         │  │   AI Chat        │  │
│  │   ──────────────     │  │    ─────────         │  │   ────────       │  │
│  │                      │  │                      │  │                  │  │
│  │  ┌──────────────┐   │  │  • Material List     │  │  [User Message]  │  │
│  │  │              │   │  │  • Matched EPDs      │  │  [AI Response]   │  │
│  │  │   WebGPU     │   │  │  • GWP Values        │  │  [Tool Results]  │  │
│  │  │   Canvas     │◄──┼──┼──• Click to Select   │  │                  │  │
│  │  │              │   │  │  • Confidence %      │  │  ┌────────────┐  │  │
│  │  └──────────────┘   │  │                      │  │  │   Input    │  │  │
│  │                      │  │  ┌────────────────┐ │  │  └────────────┘  │  │
│  │  [Upload IFC]        │  │  │ Total GWP:     │ │  │                  │  │
│  │  [Fit View] [Select] │  │  │ 1,234 kg CO2e  │ │  │  Suggested:      │  │
│  └──────────────────────┘  │  └────────────────┘ │  │  • "Compare..."  │  │
│                            └──────────────────────┘  │  • "Explain..."  │  │
│                                                      └──────────────────┘  │
│                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐│
│  │                        Shared State (Zustand)                          ││
│  │  • selectedElementId  • materials[]  • quantities[]  • epdMatches[]   ││
│  └────────────────────────────────────────────────────────────────────────┘│
│                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐│
│  │                        IFC-Lite (WASM)                                 ││
│  │  IfcParser → GeometryProcessor → Renderer                              ││
│  │  extractMaterials() → QuantityExtractor                                ││
│  └────────────────────────────────────────────────────────────────────────┘│
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ HTTP/SSE
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Next.js API Routes                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  POST /api/chat                                                             │
│  ─────────────                                                              │
│  • Receives: messages[], materials[], quantities[], epdMatches[]            │
│  • Uses: Vercel AI SDK v6 Agent with tools                                  │
│  • Returns: Streaming response with tool calls                              │
│                                                                             │
│  Tools Available to AI:                                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ • findBestEPD(material, category)      → Returns EPD match          │   │
│  │ • compareEPDs(epdIds[])                → Compare environmental data │   │
│  │ • calculateTotalGWP(quantities[])      → Sum GWP for selection     │   │
│  │ • highlightElements(elementIds[])      → Trigger 3D highlight      │   │
│  │ • explainEPD(epdId)                    → Detailed EPD breakdown    │   │
│  │ • suggestAlternatives(epdId)           → Lower-impact options      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ Vercel AI Gateway
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Vercel AI Gateway                                 │
│                    https://ai-gateway.vercel.sh/v3/ai                       │
├─────────────────────────────────────────────────────────────────────────────┤
│  • No API key management needed                                             │
│  • Automatic model routing                                                  │
│  • Usage tracking & billing                                                 │
│  • Supports Claude, GPT-4, etc.                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Data Models

### IFC Extracted Data

```typescript
// Material extracted from IFC
interface ExtractedMaterial {
  id: string;
  name: string;                    // e.g., "Concrete C30/37"
  category: MaterialCategory;      // CONCRETE, STEEL, WOOD, etc.
  elements: string[];             // Element IDs using this material
  totalVolume?: number;           // m³
  totalArea?: number;             // m²
  totalLength?: number;           // m
  totalWeight?: number;           // kg
  properties: Record<string, any>; // IFC properties
}

// Quantity extracted from IFC
interface ExtractedQuantity {
  elementId: string;
  elementType: string;            // IFCWALL, IFCSLAB, etc.
  materialId: string;
  name: string;
  quantities: {
    volume?: number;              // m³
    area?: number;                // m²
    length?: number;              // m
    weight?: number;              // kg
    count?: number;
  };
  location?: {
    storey: string;
    building: string;
  };
}

type MaterialCategory =
  | 'CONCRETE'
  | 'STEEL'
  | 'WOOD'
  | 'GLASS'
  | 'INSULATION'
  | 'MASONRY'
  | 'ALUMINUM'
  | 'GYPSUM'
  | 'PLASTIC'
  | 'OTHER';
```

### EPD Data Model (openEPD-inspired)

```typescript
// Environmental Product Declaration
interface EPD {
  id: string;
  name: string;
  manufacturer: string;
  category: MaterialCategory;
  subcategory?: string;           // e.g., "Ready Mix" for concrete

  // Environmental impacts (per declared unit)
  impacts: {
    gwp: number;                  // kg CO2e - Global Warming Potential
    odp?: number;                 // kg CFC-11e - Ozone Depletion
    ap?: number;                  // kg SO2e - Acidification
    ep?: number;                  // kg PO4e - Eutrophication
    pocp?: number;                // kg C2H4e - Smog Formation
  };

  // Declared unit
  declaredUnit: {
    value: number;
    unit: 'm3' | 'm2' | 'kg' | 'piece' | 'ton';
  };

  // Metadata
  validUntil: string;             // ISO date
  pcr: string;                    // Product Category Rule
  programOperator: string;        // EPD publisher
  plantLocation?: string;

  // For matching
  keywords: string[];             // Searchable terms
  specifications?: Record<string, string | number>;
}

// Match result
interface EPDMatch {
  material: ExtractedMaterial;
  epd: EPD;
  confidence: number;             // 0-100%
  matchReason: string;            // Why this was matched
  calculatedGWP: number;          // GWP for total quantity
  alternatives?: EPD[];           // Lower-impact options
}
```

### Application State

```typescript
interface AppState {
  // IFC Model
  model: {
    loaded: boolean;
    fileName: string | null;
    store: IfcDataStore | null;
  };

  // Extracted data
  materials: ExtractedMaterial[];
  quantities: ExtractedQuantity[];

  // EPD matching
  epdDatabase: EPD[];
  matches: EPDMatch[];
  totalGWP: number;

  // Selection
  selectedElementId: string | null;
  selectedMaterialId: string | null;
  highlightedElements: string[];

  // UI
  activePanel: 'materials' | 'epds' | 'summary';
  chatOpen: boolean;
}
```

---

## UI/UX Design

### Layout (Desktop-First)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │ 🏗️ IFC-AI-LCA Demo    [Upload IFC] [Sample Model]        [About] [Help] │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────────────┐ ┌────────────────────────┐ ┌─────────────┐  │
│  │                            │ │                        │ │             │  │
│  │                            │ │   MATERIALS & EPDs     │ │  AI CHAT    │  │
│  │                            │ │   ────────────────     │ │  ────────   │  │
│  │        3D VIEWER           │ │                        │ │             │  │
│  │        ─────────           │ │ [Materials] [EPDs]     │ │  Messages   │  │
│  │                            │ │                        │ │  stream     │  │
│  │    WebGPU Canvas           │ │ ┌──────────────────┐  │ │  here...    │  │
│  │                            │ │ │ 🧱 Concrete      │  │ │             │  │
│  │    • Orbit controls        │ │ │   3 elements     │  │ │             │  │
│  │    • Click to select       │ │ │   45.2 m³        │  │ │             │  │
│  │    • Hover for info        │ │ │   ✓ Matched      │◄─┼─┤  [Click to  │  │
│  │                            │ │ │   120 kg CO2e/m³ │  │ │   highlight]│  │
│  │                            │ │ └──────────────────┘  │ │             │  │
│  │                            │ │ ┌──────────────────┐  │ │             │  │
│  │    [Fit] [Top] [Front]     │ │ │ 🔩 Steel Rebar   │  │ │  ┌────────┐ │  │
│  │                            │ │ │   12 elements    │  │ │  │ Input  │ │  │
│  │                            │ │ │   1,200 kg       │  │ │  └────────┘ │  │
│  │                            │ │ │   ⚠ No match     │  │ │             │  │
│  │                            │ │ └──────────────────┘  │ │  Suggested: │  │
│  │                            │ │                        │ │  • Why...?  │  │
│  │                            │ │ ═══════════════════   │ │  • Compare  │  │
│  │                            │ │ Total: 5,420 kg CO2e  │ │  • Reduce   │  │
│  └────────────────────────────┘ └────────────────────────┘ └─────────────┘  │
│        60%                              25%                      15%         │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Color Scheme & Visual Design

```css
/* Color tokens */
:root {
  /* Primary - Green for sustainability */
  --primary: #10B981;           /* Emerald 500 */
  --primary-dark: #059669;      /* Emerald 600 */

  /* Semantic - Environmental impact */
  --impact-low: #22C55E;        /* Green - Low GWP */
  --impact-medium: #F59E0B;     /* Amber - Medium GWP */
  --impact-high: #EF4444;       /* Red - High GWP */

  /* Confidence indicators */
  --confidence-high: #10B981;   /* 80-100% match */
  --confidence-medium: #F59E0B; /* 50-79% match */
  --confidence-low: #EF4444;    /* <50% match */

  /* UI */
  --background: #0F172A;        /* Slate 900 - Dark mode */
  --surface: #1E293B;           /* Slate 800 */
  --border: #334155;            /* Slate 700 */
  --text: #F8FAFC;              /* Slate 50 */
  --text-muted: #94A3B8;        /* Slate 400 */
}
```

### Interactive States

```
┌─────────────────────────────────────────────────────────────────┐
│  ELEMENT SELECTED IN 3D                                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. User clicks element in 3D viewer                            │
│     → Element glows/highlights in viewer                        │
│     → Material card scrolls into view + highlights              │
│     → Chat shows context: "Selected: Wall-001 (Concrete)"       │
│                                                                 │
│  2. User clicks material card                                   │
│     → All elements with that material highlight in 3D           │
│     → EPD match details expand                                  │
│     → Chat suggests: "Want to compare alternatives?"            │
│                                                                 │
│  3. User asks chat about specific element                       │
│     → AI calls highlightElements tool                           │
│     → 3D highlights the mentioned elements                      │
│     → Material panel shows relevant cards                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Responsive Behavior

```
Desktop (>1280px):  [Viewer 60%] [Panel 25%] [Chat 15%]
Tablet (768-1280):  [Viewer 100%] ───tabs─── [Panel|Chat]
Mobile (<768px):    [Viewer 100%] ─bottom sheet─ [Panel/Chat]
```

---

## Component Structure

```
src/
├── app/
│   ├── layout.tsx              # Root layout with providers
│   ├── page.tsx                # Main page
│   ├── api/
│   │   └── chat/
│   │       └── route.ts        # AI chat endpoint
│   └── globals.css
│
├── components/
│   ├── layout/
│   │   ├── Header.tsx          # App header with actions
│   │   ├── MainLayout.tsx      # 3-panel layout manager
│   │   └── Panel.tsx           # Resizable panel wrapper
│   │
│   ├── viewer/
│   │   ├── IFCViewer.tsx       # Main 3D viewer component
│   │   ├── ViewerControls.tsx  # Camera controls, view buttons
│   │   ├── ViewerOverlay.tsx   # Loading, info overlays
│   │   └── hooks/
│   │       ├── useIFCParser.ts     # IFC parsing logic
│   │       ├── useGeometry.ts      # Geometry processing
│   │       └── useRenderer.ts      # WebGPU rendering
│   │
│   ├── materials/
│   │   ├── MaterialPanel.tsx   # Material list container
│   │   ├── MaterialCard.tsx    # Individual material display
│   │   ├── EPDMatchBadge.tsx   # Match confidence indicator
│   │   └── QuantityDisplay.tsx # Quantity breakdown
│   │
│   ├── epd/
│   │   ├── EPDPanel.tsx        # EPD matches container
│   │   ├── EPDCard.tsx         # EPD detail card
│   │   ├── EPDComparison.tsx   # Side-by-side comparison
│   │   ├── GWPIndicator.tsx    # Visual GWP representation
│   │   └── ImpactChart.tsx     # Environmental impact chart
│   │
│   ├── chat/
│   │   ├── ChatPanel.tsx       # Chat container
│   │   ├── ChatMessage.tsx     # Message bubble
│   │   ├── ChatInput.tsx       # Input with suggestions
│   │   ├── ToolResult.tsx      # Tool call result display
│   │   └── SuggestedPrompts.tsx # Quick action buttons
│   │
│   ├── summary/
│   │   ├── SummaryPanel.tsx    # Total impact summary
│   │   ├── ImpactBreakdown.tsx # By material/element
│   │   └── ExportButton.tsx    # Export results
│   │
│   └── ui/                     # shadcn/ui components
│       ├── button.tsx
│       ├── card.tsx
│       ├── dialog.tsx
│       ├── tabs.tsx
│       └── ...
│
├── lib/
│   ├── ifc/
│   │   ├── parser.ts           # IFC parsing utilities
│   │   ├── materials.ts        # Material extraction
│   │   ├── quantities.ts       # Quantity extraction
│   │   └── types.ts            # IFC-related types
│   │
│   ├── epd/
│   │   ├── database.ts         # Sample EPD data
│   │   ├── matcher.ts          # EPD matching algorithm
│   │   ├── calculator.ts       # GWP calculations
│   │   └── types.ts            # EPD types
│   │
│   ├── ai/
│   │   ├── agent.ts            # AI SDK v6 Agent definition
│   │   ├── tools.ts            # Tool definitions
│   │   └── prompts.ts          # System prompts
│   │
│   └── utils/
│       ├── format.ts           # Number/unit formatting
│       └── colors.ts           # Color utilities
│
├── store/
│   └── index.ts                # Zustand store
│
├── data/
│   └── sample-epds.json        # Demo EPD database
│
└── types/
    └── index.ts                # Shared TypeScript types
```

---

## User Flows

### Flow 1: Initial Load & Model Upload

```
┌─────────────────────────────────────────────────────────────────┐
│  FLOW: Upload and Process IFC Model                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. USER LANDS ON PAGE                                          │
│     ├─ Show empty viewer with upload prompt                     │
│     ├─ Chat: "Hello! Upload an IFC file to get started,         │
│     │         or try our sample model."                         │
│     └─ [Upload IFC] [Load Sample] buttons visible               │
│                                                                 │
│  2. USER UPLOADS/SELECTS FILE                                   │
│     ├─ Show progress: "Parsing IFC file..."                     │
│     ├─ Progress: "Processing geometry..."                       │
│     ├─ Progress: "Extracting materials..."                      │
│     └─ Progress: "Extracting quantities..."                     │
│                                                                 │
│  3. PROCESSING COMPLETE                                         │
│     ├─ 3D model appears in viewer                               │
│     ├─ Fit camera to model bounds                               │
│     ├─ Material panel populates with extracted materials        │
│     └─ Chat: "I found 8 materials in your model.                │
│              Would you like me to find matching EPDs?"          │
│                                                                 │
│  4. EPD MATCHING (automatic or user-triggered)                  │
│     ├─ Show matching progress per material                      │
│     ├─ Populate EPD matches with confidence scores              │
│     ├─ Calculate total GWP                                      │
│     └─ Chat: "I've matched 6/8 materials with EPDs.             │
│              Total estimated GWP: 5,420 kg CO2e.                │
│              2 materials need manual review."                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Flow 2: Exploring Materials & EPDs

```
┌─────────────────────────────────────────────────────────────────┐
│  FLOW: Interactive Material Exploration                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  A. SELECT ELEMENT IN 3D                                        │
│     User clicks on wall in 3D viewer                            │
│     ├─ Wall highlights (glow effect)                            │
│     ├─ Material panel scrolls to "Concrete C30/37"              │
│     ├─ Card expands showing:                                    │
│     │   • Volume: 12.5 m³                                       │
│     │   • EPD: "Generic Concrete - Ready Mix"                   │
│     │   • GWP: 120 kg CO2e/m³ → 1,500 kg CO2e total            │
│     │   • Confidence: 85%                                       │
│     └─ Chat: "This wall uses Concrete C30/37.                   │
│              The matched EPD suggests 1,500 kg CO2e.            │
│              [Compare alternatives] [Why this match?]"          │
│                                                                 │
│  B. SELECT MATERIAL CARD                                        │
│     User clicks material card "Steel Reinforcement"             │
│     ├─ All 12 rebar elements highlight in 3D                    │
│     ├─ Show aggregated quantities:                              │
│     │   • Total weight: 1,200 kg                                │
│     │   • Elements: 12 rebar instances                          │
│     ├─ EPD details expand:                                      │
│     │   • Manufacturer: ArcelorMittal                           │
│     │   • GWP: 0.75 kg CO2e/kg                                  │
│     │   • Confidence: 92%                                       │
│     └─ Chat suggests: "Steel has high impact.                   │
│              Want to see recycled steel alternatives?"          │
│                                                                 │
│  C. NO EPD MATCH FOUND                                          │
│     Material "Specialty Coating" has no match                   │
│     ├─ Card shows warning: "⚠ No EPD match found"              │
│     ├─ Chat: "I couldn't find an EPD for 'Specialty Coating'.   │
│     │         Can you tell me more about this material?         │
│     │         [It's a paint] [It's an adhesive] [Describe it]"  │
│     └─ After user input, AI suggests closest EPD                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Flow 3: AI Chat Interactions

```
┌─────────────────────────────────────────────────────────────────┐
│  FLOW: AI-Powered Analysis & Recommendations                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  EXAMPLE CONVERSATIONS:                                         │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│  User: "Which material has the highest environmental impact?"   │
│                                                                 │
│  AI: [Calls calculateTotalGWP, highlightElements]               │
│      "The concrete in your model contributes the most to        │
│       global warming potential at 3,200 kg CO2e (59% of total). │
│       I've highlighted all concrete elements in the viewer.     │
│                                                                 │
│       The main contributors are:                                │
│       • Foundation slab: 1,800 kg CO2e                          │
│       • External walls: 1,400 kg CO2e                           │
│                                                                 │
│       [Show alternatives] [Explain calculation]"                │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│  User: "Can you suggest lower-carbon concrete options?"         │
│                                                                 │
│  AI: [Calls suggestAlternatives, compareEPDs]                   │
│      "Here are 3 lower-carbon concrete alternatives:            │
│                                                                 │
│       1. CEM III Slag Cement Concrete                           │
│          GWP: 85 kg CO2e/m³ (-29%)                              │
│          Confidence: 78%                                        │
│                                                                 │
│       2. Recycite Low-Carbon Ready Mix                          │
│          GWP: 95 kg CO2e/m³ (-21%)                              │
│          Confidence: 82%                                        │
│                                                                 │
│       3. Geopolymer Concrete                                    │
│          GWP: 65 kg CO2e/m³ (-46%)                              │
│          Confidence: 65% (may need verification)                │
│                                                                 │
│       Would you like me to recalculate total impact             │
│       using one of these alternatives?"                         │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│  User: "Explain why you matched my insulation with that EPD"    │
│                                                                 │
│  AI: [Calls explainEPD]                                         │
│      "I matched your 'Mineral Wool 100mm' with the EPD          │
│       'ROCKWOOL ProRox SL 930' because:                         │
│                                                                 │
│       ✓ Material type: Both mineral wool (stone wool)           │
│       ✓ Density: Your spec (30 kg/m³) matches EPD range         │
│       ✓ Thickness: 100mm falls within declared unit             │
│       ✓ Thermal conductivity: Compatible values                 │
│                                                                 │
│       Confidence: 88%                                           │
│                                                                 │
│       Note: The EPD is for EU production. If your project       │
│       is elsewhere, consider regional alternatives.             │
│                                                                 │
│       [See EPD document] [Find regional options]"               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## AI Integration

### Vercel AI SDK v6 Agent Definition

```typescript
// lib/ai/agent.ts
import { createAgent } from 'ai';
import { gateway } from '@ai-sdk/ai-gateway';

export const lcaAgent = createAgent({
  model: gateway('anthropic/claude-sonnet'),

  instructions: `You are an expert in Life Cycle Assessment (LCA) for buildings.
    You help users understand the environmental impact of their building materials
    by matching them with Environmental Product Declarations (EPDs).

    Key behaviors:
    - Always explain your reasoning in simple terms
    - Highlight when matches have low confidence
    - Suggest alternatives when asked about reducing impact
    - Use tools to interact with the 3D model and highlight elements
    - Be precise with numbers and units (kg CO2e, m³, etc.)
    - Reference specific element IDs when discussing selections

    You have access to:
    - The building's materials and quantities (extracted from IFC)
    - A database of EPDs with environmental impact data
    - Tools to highlight elements in the 3D viewer
    - Tools to compare and calculate environmental impacts`,

  tools: [
    findBestEPDTool,
    compareEPDsTool,
    calculateTotalGWPTool,
    highlightElementsTool,
    explainEPDTool,
    suggestAlternativesTool,
  ],
});
```

### Tool Definitions

```typescript
// lib/ai/tools.ts
import { tool } from 'ai';
import { z } from 'zod';

export const findBestEPDTool = tool({
  description: 'Find the best matching EPD for a material',
  parameters: z.object({
    materialName: z.string().describe('Name of the material'),
    category: z.enum(['CONCRETE', 'STEEL', 'WOOD', 'GLASS', ...]),
    specifications: z.record(z.string()).optional(),
  }),
  execute: async ({ materialName, category, specifications }) => {
    // Match against EPD database
    return { epd, confidence, reason };
  },
});

export const highlightElementsTool = tool({
  description: 'Highlight elements in the 3D viewer',
  parameters: z.object({
    elementIds: z.array(z.string()),
    color: z.string().optional(),
  }),
  execute: async ({ elementIds, color }) => {
    // This triggers a client-side action via tool result
    return { action: 'highlight', elementIds, color };
  },
});

export const calculateTotalGWPTool = tool({
  description: 'Calculate total GWP for selected elements or materials',
  parameters: z.object({
    scope: z.enum(['all', 'selection', 'material']),
    materialId: z.string().optional(),
  }),
  execute: async ({ scope, materialId }) => {
    // Calculate based on quantities and EPD matches
    return { totalGWP, breakdown, unit: 'kg CO2e' };
  },
});

export const compareEPDsTool = tool({
  description: 'Compare multiple EPDs side by side',
  parameters: z.object({
    epdIds: z.array(z.string()),
  }),
  execute: async ({ epdIds }) => {
    // Return comparison data
    return { comparison: [...] };
  },
});

export const suggestAlternativesTool = tool({
  description: 'Suggest lower-impact alternatives for an EPD',
  parameters: z.object({
    currentEPDId: z.string(),
    maxAlternatives: z.number().default(3),
  }),
  execute: async ({ currentEPDId, maxAlternatives }) => {
    // Find lower-GWP alternatives in same category
    return { alternatives: [...], potentialSavings };
  },
});
```

### API Route

```typescript
// app/api/chat/route.ts
import { streamText } from 'ai';
import { lcaAgent } from '@/lib/ai/agent';

export async function POST(req: Request) {
  const { messages, context } = await req.json();

  // Context includes current materials, quantities, matches
  const systemContext = buildSystemContext(context);

  const result = streamText({
    agent: lcaAgent,
    messages: [
      { role: 'system', content: systemContext },
      ...messages,
    ],
  });

  return result.toDataStreamResponse();
}
```

### Client Integration

```typescript
// components/chat/ChatPanel.tsx
'use client';

import { useChat } from '@ai-sdk/react';
import { useStore } from '@/store';

export function ChatPanel() {
  const { materials, quantities, matches } = useStore();

  const { messages, input, handleSubmit, setInput } = useChat({
    api: '/api/chat',
    body: {
      context: { materials, quantities, matches },
    },
    onToolResult: (toolResult) => {
      // Handle tool results that affect UI
      if (toolResult.action === 'highlight') {
        useStore.getState().setHighlightedElements(toolResult.elementIds);
      }
    },
  });

  return (
    <div className="flex flex-col h-full">
      <MessageList messages={messages} />
      <ChatInput value={input} onChange={setInput} onSubmit={handleSubmit} />
      <SuggestedPrompts onSelect={setInput} />
    </div>
  );
}
```

---

## Implementation Phases

### Phase 1: Foundation (Days 1-2)
- [ ] Initialize Next.js 15 project with TypeScript
- [ ] Set up Tailwind CSS + shadcn/ui
- [ ] Create basic 3-panel layout
- [ ] Integrate ifc-lite parser and renderer
- [ ] Basic IFC file upload and 3D viewing
- [ ] Implement camera controls

### Phase 2: Data Extraction (Days 2-3)
- [ ] Implement material extraction from IFC
- [ ] Implement quantity extraction
- [ ] Create material/quantity data models
- [ ] Build MaterialPanel component
- [ ] Add click-to-select in 3D viewer
- [ ] Bidirectional selection sync (3D ↔ Panel)

### Phase 3: EPD Database & Matching (Days 3-4)
- [ ] Create sample EPD database (JSON)
- [ ] Implement EPD matching algorithm
- [ ] Build EPDCard and EPDPanel components
- [ ] GWP calculation logic
- [ ] Visual impact indicators
- [ ] Summary panel with totals

### Phase 4: AI Chat Integration (Days 4-5)
- [ ] Set up Vercel AI Gateway
- [ ] Create AI agent with tools
- [ ] Build ChatPanel component
- [ ] Implement all AI tools
- [ ] Connect tool results to UI updates
- [ ] Add suggested prompts

### Phase 5: Polish & Integration (Days 5-6)
- [ ] Full bidirectional sync between all panels
- [ ] Loading states and error handling
- [ ] Responsive design adjustments
- [ ] Sample IFC model for demo
- [ ] Documentation and README
- [ ] Deploy to Vercel

---

## Sample EPD Data Structure

For the demo, we'll include ~20 sample EPDs covering common materials:

```json
{
  "epds": [
    {
      "id": "epd-concrete-001",
      "name": "Generic Ready-Mix Concrete C30/37",
      "manufacturer": "Industry Average",
      "category": "CONCRETE",
      "subcategory": "Ready Mix",
      "impacts": {
        "gwp": 120,
        "odp": 0.000001,
        "ap": 0.45,
        "ep": 0.08
      },
      "declaredUnit": { "value": 1, "unit": "m3" },
      "keywords": ["concrete", "ready mix", "C30", "C37", "structural"],
      "specifications": {
        "strength": "30-37 MPa",
        "density": "2400 kg/m³"
      }
    },
    {
      "id": "epd-steel-001",
      "name": "Structural Steel - Hot Rolled Sections",
      "manufacturer": "ArcelorMittal",
      "category": "STEEL",
      "impacts": { "gwp": 1.85 },
      "declaredUnit": { "value": 1, "unit": "kg" },
      "keywords": ["steel", "structural", "hot rolled", "I-beam", "H-beam"]
    },
    // ... more EPDs
  ]
}
```

---

## Key Interactions Summary

| User Action | 3D Viewer Response | Material Panel Response | Chat Response |
|-------------|-------------------|------------------------|---------------|
| Upload IFC | Renders model | Populates materials | Welcomes, offers to match |
| Click element in 3D | Highlights element | Scrolls to & expands material | Shows context |
| Click material card | Highlights all elements | Expands EPD details | Suggests actions |
| Ask "highest impact?" | Highlights contributors | Expands relevant cards | Explains with data |
| Ask "alternatives?" | (unchanged) | Shows comparison | Lists options |
| Click "Compare" | (unchanged) | Opens comparison view | Explains differences |

---

## Success Criteria

1. **Functional**: User can upload IFC, see 3D model, view extracted materials with quantities
2. **Intelligent**: AI successfully matches materials to EPDs with reasonable confidence
3. **Interactive**: Clicking elements/materials updates all panels bidirectionally
4. **Conversational**: AI can answer questions, compare options, and explain matches
5. **Informative**: Total GWP is calculated and displayed clearly
6. **Responsive**: Works on desktop and tablet

---

## Sources Referenced

- [AI SDK 6 - Vercel](https://vercel.com/blog/ai-sdk-6)
- [AI SDK UI: useChat](https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat)
- [Vercel AI Gateway](https://vercel.com/ai-gateway)
- [Building Transparency EC3](https://www.buildingtransparency.org/tools/ec3/)
- [openEPD REST API](https://openepd.buildingtransparency.org/)
- [openEPD Python Library](https://github.com/cchangelabs/openepd)
- IFC-Lite Documentation (from README)
