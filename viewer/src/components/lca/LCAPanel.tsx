/**
 * LCA Panel Component
 * Displays extracted materials, EPD matches, and total GWP
 */

import { useEffect, useMemo } from 'react';
import { useViewerStore } from '../../store';
import { extractMaterialsFromIFC } from '../../store/slices/lcaSlice';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { ScrollArea } from '../ui/scroll-area';
import { Badge } from '../ui/badge';
import { Leaf, AlertTriangle, CheckCircle, ArrowRight, Loader2, Sparkles, Cpu, Database, Cloud } from 'lucide-react';
import type { EPDMatch, ExtractedMaterial, MaterialCategory } from '../../lib/epd/types';

const categoryColors: Record<MaterialCategory, string> = {
  CONCRETE: 'bg-gray-500',
  STEEL: 'bg-blue-500',
  WOOD: 'bg-amber-600',
  GLASS: 'bg-cyan-400',
  INSULATION: 'bg-pink-400',
  MASONRY: 'bg-orange-500',
  ALUMINUM: 'bg-slate-400',
  GYPSUM: 'bg-stone-300',
  PLASTIC: 'bg-purple-400',
  MEMBRANE: 'bg-zinc-500',
  OTHER: 'bg-neutral-400',
};

function formatGWP(gwp: number): string {
  if (Math.abs(gwp) >= 1000) {
    return `${(gwp / 1000).toFixed(1)}t`;
  }
  return `${gwp.toFixed(0)} kg`;
}

function getConfidenceColor(confidence: number): string {
  if (confidence >= 70) return 'text-green-500';
  if (confidence >= 50) return 'text-yellow-500';
  return 'text-red-500';
}

function MaterialCard({
  material,
  match,
  isSelected,
  onSelect,
}: {
  material: ExtractedMaterial;
  match?: EPDMatch;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const gwp = match?.calculatedGWP || 0;
  const isNegative = gwp < 0; // Carbon storing materials like wood

  return (
    <div
      className={`p-3 rounded-lg border cursor-pointer transition-all ${
        isSelected
          ? 'border-primary bg-primary/10'
          : 'border-border hover:border-primary/50 hover:bg-muted/50'
      }`}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${categoryColors[material.category]}`} />
            <span className="font-medium text-sm truncate">{material.name}</span>
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {material.elementIds.length} element{material.elementIds.length !== 1 ? 's' : ''}
            {material.totalVolume && ` • ${material.totalVolume.toFixed(2)} m³`}
            {material.totalArea && ` • ${material.totalArea.toFixed(1)} m²`}
          </div>
        </div>

        {match ? (
          <div className="text-right">
            <div className={`text-sm font-semibold ${isNegative ? 'text-green-600' : ''}`}>
              {isNegative ? '' : '+'}{formatGWP(gwp)} CO₂e
            </div>
            <div className={`text-xs flex items-center gap-1 justify-end ${getConfidenceColor(match.confidence)}`}>
              {match.confidence >= 70 ? (
                <CheckCircle className="w-3 h-3" />
              ) : match.confidence >= 50 ? (
                <AlertTriangle className="w-3 h-3" />
              ) : (
                <AlertTriangle className="w-3 h-3" />
              )}
              {match.confidence}%
            </div>
          </div>
        ) : (
          <Badge variant="outline" className="text-xs text-muted-foreground">
            No match
          </Badge>
        )}
      </div>

      {match && isSelected && (
        <div className="mt-3 pt-3 border-t border-border/50">
          <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
            <span>Matched EPD:</span>
            {match.matchReason.startsWith('LLM:') && (
              <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">
                <Sparkles className="w-2.5 h-2.5 mr-0.5" />
                AI
              </Badge>
            )}
          </div>
          <div className="text-sm font-medium">{match.epd.name}</div>
          <div className="text-xs text-muted-foreground">{match.epd.manufacturer}</div>
          <div className="text-xs text-muted-foreground mt-1">
            {match.matchReason.startsWith('LLM:')
              ? match.matchReason.replace('LLM: ', '')
              : match.matchReason}
          </div>

          {match.alternatives && match.alternatives.length > 0 && (
            <div className="mt-2">
              <div className="text-xs text-muted-foreground mb-1">Lower-impact alternatives:</div>
              {match.alternatives.slice(0, 2).map((alt) => (
                <div key={alt.id} className="text-xs flex items-center gap-1 text-green-600">
                  <ArrowRight className="w-3 h-3" />
                  {alt.name}: {alt.impacts.gwp} {alt.declaredUnit.unit === 'kg' ? 'kg' : `kg/${alt.declaredUnit.unit}`} CO₂e
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryCard({ lcaResults }: { lcaResults: NonNullable<ReturnType<typeof useViewerStore.getState>['lcaResults']> }) {
  const sortedCategories = useMemo(() => {
    const entries = Array.from(lcaResults.byCategory.entries());
    return entries.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  }, [lcaResults.byCategory]);

  const maxGWP = Math.max(...sortedCategories.map(([, gwp]) => Math.abs(gwp)));

  return (
    <div className="space-y-4">
      {/* Total GWP */}
      <div className="p-4 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/30">
        <div className="flex items-center gap-2 mb-2">
          <Leaf className="w-5 h-5 text-primary" />
          <span className="font-medium">Total Embodied Carbon</span>
        </div>
        <div className="text-3xl font-bold">
          {lcaResults.totalGWP >= 0 ? '+' : ''}{formatGWP(lcaResults.totalGWP)}
        </div>
        <div className="text-sm text-muted-foreground">kg CO₂ equivalent (A1-A3)</div>
      </div>

      {/* Category breakdown */}
      <div>
        <div className="text-sm font-medium mb-2">By Category</div>
        <div className="space-y-2">
          {sortedCategories.map(([category, gwp]) => (
            <div key={category} className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${categoryColors[category]}`} />
              <span className="text-sm flex-1">{category}</span>
              <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full ${gwp < 0 ? 'bg-green-500' : 'bg-primary'}`}
                  style={{ width: `${(Math.abs(gwp) / maxGWP) * 100}%` }}
                />
              </div>
              <span className={`text-xs w-20 text-right ${gwp < 0 ? 'text-green-600' : ''}`}>
                {gwp >= 0 ? '+' : ''}{formatGWP(gwp)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 text-center">
        <div className="p-2 rounded bg-muted/50">
          <div className="text-lg font-semibold">{lcaResults.matches.length}</div>
          <div className="text-xs text-muted-foreground">Matched</div>
        </div>
        <div className="p-2 rounded bg-muted/50">
          <div className="text-lg font-semibold">{lcaResults.unmatchedMaterials.length}</div>
          <div className="text-xs text-muted-foreground">Unmatched</div>
        </div>
      </div>
    </div>
  );
}

export function LCAPanel() {
  const ifcDataStore = useViewerStore((s) => s.ifcDataStore);
  const geometryResult = useViewerStore((s) => s.geometryResult);
  const extractedMaterials = useViewerStore((s) => s.extractedMaterials);
  const lcaResults = useViewerStore((s) => s.lcaResults);
  const selectedMaterialId = useViewerStore((s) => s.selectedMaterialId);
  const isMatchingInProgress = useViewerStore((s) => s.isMatchingInProgress);
  const matchingMethod = useViewerStore((s) => s.matchingMethod);
  const setExtractedMaterials = useViewerStore((s) => s.setExtractedMaterials);
  const runEPDMatching = useViewerStore((s) => s.runEPDMatching);
  const selectMaterial = useViewerStore((s) => s.selectMaterial);
  const setSelectedEntityIds = useViewerStore((s) => s.setSelectedEntityIds);

  // Ökobaudat state
  const epdDataSource = useViewerStore((s) => s.epdDataSource);
  const epdCount = useViewerStore((s) => s.epdCount);
  const isLoadingEPDs = useViewerStore((s) => s.isLoadingEPDs);
  const loadEPDsFromOekobaudat = useViewerStore((s) => s.loadEPDsFromOekobaudat);

  // Load EPDs from Ökobaudat on mount
  useEffect(() => {
    loadEPDsFromOekobaudat();
  }, [loadEPDsFromOekobaudat]);

  // Extract materials when IFC data is loaded
  useEffect(() => {
    if (ifcDataStore && geometryResult) {
      const materials = extractMaterialsFromIFC(ifcDataStore, geometryResult.meshes);
      setExtractedMaterials(materials);
    }
  }, [ifcDataStore, geometryResult, setExtractedMaterials]);

  // Run fuzzy/algorithmic EPD matching when materials are extracted (instant results)
  // LLM refinement is available through the chat panel's EPD Agent mode
  useEffect(() => {
    if (extractedMaterials.length > 0 && !lcaResults && !isMatchingInProgress) {
      runEPDMatching();
    }
  }, [extractedMaterials, lcaResults, isMatchingInProgress, runEPDMatching]);

  // Highlight elements when material is selected
  const handleSelectMaterial = (materialId: string) => {
    const isDeselecting = selectedMaterialId === materialId;
    selectMaterial(isDeselecting ? null : materialId);

    if (!isDeselecting) {
      const material = extractedMaterials.find((m) => m.id === materialId);
      if (material) {
        setSelectedEntityIds(material.elementIds);
      }
    } else {
      setSelectedEntityIds([]);
    }
  };

  if (!ifcDataStore) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm p-4 text-center">
        <div>
          <Leaf className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>Load an IFC file to analyze embodied carbon</p>
        </div>
      </div>
    );
  }

  if (extractedMaterials.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Extracting materials...
      </div>
    );
  }

  if (isMatchingInProgress) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        <div className="text-center">
          <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-primary" />
          <p>Matching materials to EPDs...</p>
          <p className="text-xs mt-1 opacity-70">Use Chat for AI-powered refinement</p>
        </div>
      </div>
    );
  }

  return (
    <Tabs defaultValue="materials" className="h-full flex flex-col">
      <TabsList className="mx-2 mt-2 grid grid-cols-2">
        <TabsTrigger value="materials">Materials</TabsTrigger>
        <TabsTrigger value="summary">Summary</TabsTrigger>
      </TabsList>

      {/* Data source and matching method indicator */}
      <div className="mx-2 mt-2 flex flex-col items-center gap-1 text-xs text-muted-foreground">
        {/* EPD Data Source */}
        <div className="flex items-center gap-1.5">
          {isLoadingEPDs ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>Loading EPD database...</span>
            </>
          ) : epdDataSource === 'oekobaudat' ? (
            <>
              <Cloud className="w-3 h-3 text-green-500" />
              <span className="text-green-600">Ökobaudat ({epdCount} EPDs)</span>
            </>
          ) : (
            <>
              <Database className="w-3 h-3 text-yellow-500" />
              <span className="text-yellow-600">Fallback data ({epdCount} EPDs)</span>
            </>
          )}
        </div>

        {/* Matching method */}
        {matchingMethod !== 'none' && (
          <div className="flex items-center gap-1.5">
            {matchingMethod === 'llm' ? (
              <>
                <Sparkles className="w-3 h-3 text-primary" />
                <span>AI-matched (GPT-4o-mini)</span>
              </>
            ) : (
              <>
                <Cpu className="w-3 h-3" />
                <span>Algorithmic matching</span>
              </>
            )}
          </div>
        )}
      </div>

      <TabsContent value="materials" className="flex-1 min-h-0 m-0">
        <ScrollArea className="h-full">
          <div className="p-2 space-y-2">
            {extractedMaterials.map((material) => {
              const match = lcaResults?.matches.find((m) => m.material.id === material.id);
              return (
                <MaterialCard
                  key={material.id}
                  material={material}
                  match={match}
                  isSelected={selectedMaterialId === material.id}
                  onSelect={() => handleSelectMaterial(material.id)}
                />
              );
            })}
          </div>
        </ScrollArea>
      </TabsContent>

      <TabsContent value="summary" className="flex-1 min-h-0 m-0">
        <ScrollArea className="h-full">
          <div className="p-3">
            {lcaResults ? (
              <SummaryCard lcaResults={lcaResults} />
            ) : (
              <div className="text-center text-muted-foreground py-8">
                <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
                Running EPD matching...
              </div>
            )}
          </div>
        </ScrollArea>
      </TabsContent>
    </Tabs>
  );
}
