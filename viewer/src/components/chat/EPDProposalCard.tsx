/**
 * EPD Proposal Card Component
 * Displays an EPD mapping proposal from the agent with accept/reject actions
 */

import React, { useState } from 'react';
import { Check, X, ArrowRight, TrendingDown, TrendingUp, Sparkles, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import type { EPDProposal } from '../../store/slices/lcaSlice';

interface EPDProposalCardProps {
  proposal: EPDProposal;
  onAccept: (proposalId: string) => void;
  onReject: (proposalId: string) => void;
}

export function EPDProposalCard({ proposal, onAccept, onReject }: EPDProposalCardProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  const isImprovement = proposal.gwp_difference < 0;
  const absChange = Math.abs(proposal.gwp_difference_percent);

  // Confidence badge colors
  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return 'bg-green-500/20 text-green-700 dark:text-green-400';
    if (confidence >= 0.6) return 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400';
    return 'bg-orange-500/20 text-orange-700 dark:text-orange-400';
  };

  const handleAccept = async () => {
    setIsProcessing(true);
    setActionFeedback(null);

    // Small delay for visual feedback
    await new Promise(r => setTimeout(r, 300));

    onAccept(proposal.id);
    setActionFeedback(`Applied "${proposal.proposed_epd_name}" - saving ${Math.abs(proposal.gwp_difference).toFixed(0)} kg CO₂e`);
    setIsProcessing(false);
  };

  const handleReject = async () => {
    setIsProcessing(true);
    setActionFeedback(null);

    await new Promise(r => setTimeout(r, 300));

    onReject(proposal.id);
    setActionFeedback(`Kept current EPD for ${proposal.material_name}`);
    setIsProcessing(false);
  };

  // Status-based styling
  if (proposal.status === 'accepted') {
    return (
      <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-3">
        <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
          <Check className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm font-medium truncate">Applied: {proposal.proposed_epd_name}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Saved {Math.abs(proposal.gwp_difference).toFixed(0)} kg CO₂e on {proposal.material_name}
        </p>
      </div>
    );
  }

  if (proposal.status === 'rejected') {
    return (
      <div className="rounded-lg border border-muted bg-muted/20 p-3">
        <div className="flex items-center gap-2 text-muted-foreground">
          <X className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm truncate">Skipped: {proposal.proposed_epd_name}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Kept current EPD for {proposal.material_name}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-2 space-y-1.5 w-full overflow-hidden">
      {/* Header - compact */}
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <Sparkles className="w-3.5 h-3.5 text-primary flex-shrink-0" />
          <span className="text-xs font-medium truncate">{proposal.material_name}</span>
        </div>
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${getConfidenceColor(proposal.confidence)}`}>
          {Math.round(proposal.confidence * 100)}%
        </span>
      </div>

      {/* Current → Proposed - Compact horizontal on wide, vertical on narrow */}
      <div className="flex gap-1.5 items-stretch text-xs">
        <div className="flex-1 p-1.5 rounded bg-muted/50 min-w-0">
          <div className="text-[10px] text-muted-foreground">Current</div>
          <div className="truncate" title={proposal.current_epd_name}>{proposal.current_epd_name || 'No EPD'}</div>
          <div className="text-[10px] text-muted-foreground">{proposal.current_gwp?.toLocaleString()} kg</div>
        </div>
        <div className="flex items-center">
          <ArrowRight className="w-3 h-3 text-muted-foreground" />
        </div>
        <div className="flex-1 p-1.5 rounded bg-primary/10 border border-primary/20 min-w-0">
          <div className="text-[10px] text-primary">Proposed</div>
          <div className="truncate font-medium" title={proposal.proposed_epd_name}>{proposal.proposed_epd_name}</div>
          <div className="text-[10px] text-muted-foreground">{proposal.proposed_gwp.toLocaleString()} kg</div>
        </div>
      </div>

      {/* Impact change - inline compact */}
      <div className={`flex items-center gap-1 text-xs ${
        isImprovement ? 'text-green-600 dark:text-green-400' : 'text-orange-600 dark:text-orange-400'
      }`}>
        {isImprovement ? <TrendingDown className="w-3.5 h-3.5" /> : <TrendingUp className="w-3.5 h-3.5" />}
        <span className="font-semibold">{isImprovement ? '-' : '+'}{absChange.toFixed(0)}%</span>
        <span className="text-[10px] text-muted-foreground">({(proposal.gwp_difference/1000).toFixed(1)}t CO₂e)</span>
      </div>

      {/* Actions - compact */}
      <div className="flex gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="flex-1 h-7 text-[11px] border-red-500/30 text-red-600 hover:bg-red-500/10"
          onClick={handleReject}
          disabled={isProcessing}
        >
          {isProcessing ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
        </Button>
        <Button
          size="sm"
          className="flex-1 h-7 text-[11px] bg-green-600 hover:bg-green-700 text-white"
          onClick={handleAccept}
          disabled={isProcessing}
        >
          {isProcessing ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Check className="w-3 h-3 mr-0.5" />Apply</>}
        </Button>
      </div>
    </div>
  );
}

/**
 * EPD Proposals List
 * Renders multiple EPD proposals in a list
 */
interface EPDProposalsListProps {
  proposals: EPDProposal[];
  onAccept: (proposalId: string) => void;
  onReject: (proposalId: string) => void;
}

export function EPDProposalsList({ proposals, onAccept, onReject }: EPDProposalsListProps) {
  if (proposals.length === 0) return null;

  const pending = proposals.filter(p => p.status === 'pending');
  const processed = proposals.filter(p => p.status !== 'pending');

  return (
    <div className="space-y-3">
      {/* Pending proposals first */}
      {pending.map(proposal => (
        <EPDProposalCard
          key={proposal.id}
          proposal={proposal}
          onAccept={onAccept}
          onReject={onReject}
        />
      ))}

      {/* Processed proposals (collapsed) */}
      {processed.map(proposal => (
        <EPDProposalCard
          key={proposal.id}
          proposal={proposal}
          onAccept={onAccept}
          onReject={onReject}
        />
      ))}
    </div>
  );
}
