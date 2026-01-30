/**
 * EPD Proposal Card Component
 * Displays an EPD mapping proposal from the agent with accept/reject actions
 */

import React, { useState } from 'react';
import { Check, X, ArrowRight, ArrowDown, TrendingDown, TrendingUp, Sparkles, Info, Loader2 } from 'lucide-react';
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
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2 w-full overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="w-4 h-4 text-primary flex-shrink-0" />
          <span className="text-sm font-medium">EPD Proposal</span>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${getConfidenceColor(proposal.confidence)}`}>
          {Math.round(proposal.confidence * 100)}%
        </span>
      </div>

      {/* Material name */}
      <div className="text-xs text-muted-foreground">
        For: <span className="font-medium text-foreground">{proposal.material_name}</span>
      </div>

      {/* Current → Proposed - Stacked layout for narrow containers */}
      <div className="space-y-2">
        <div className="p-2 rounded bg-muted/50">
          <div className="text-xs text-muted-foreground mb-0.5">Current</div>
          <div className="text-sm truncate" title={proposal.current_epd_name}>{proposal.current_epd_name || 'No EPD'}</div>
          {proposal.current_gwp !== undefined && (
            <div className="text-xs text-muted-foreground mt-0.5">
              {proposal.current_gwp.toLocaleString()} kg CO₂e
            </div>
          )}
        </div>

        <div className="flex justify-center">
          <ArrowDown className="w-4 h-4 text-muted-foreground" />
        </div>

        <div className="p-2 rounded bg-primary/10 border border-primary/20">
          <div className="text-xs text-primary mb-0.5">Proposed</div>
          <div className="text-sm font-medium truncate" title={proposal.proposed_epd_name}>{proposal.proposed_epd_name}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {proposal.proposed_gwp.toLocaleString()} kg CO₂e
          </div>
        </div>
      </div>

      {/* Impact change */}
      <div className={`flex items-center gap-1.5 text-sm flex-wrap ${
        isImprovement ? 'text-green-600 dark:text-green-400' : 'text-orange-600 dark:text-orange-400'
      }`}>
        {isImprovement ? (
          <TrendingDown className="w-4 h-4 flex-shrink-0" />
        ) : (
          <TrendingUp className="w-4 h-4 flex-shrink-0" />
        )}
        <span className="font-medium whitespace-nowrap">
          {isImprovement ? '-' : '+'}{absChange.toFixed(1)}% GWP
        </span>
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          ({isImprovement ? '' : '+'}{proposal.gwp_difference.toLocaleString()} kg CO₂e)
        </span>
      </div>

      {/* Reasoning - collapsible on narrow screens */}
      <div className="text-xs space-y-1.5">
        <div className="flex items-start gap-1.5">
          <Info className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
          <p className="text-muted-foreground line-clamp-3">{proposal.reasoning}</p>
        </div>

        {proposal.key_benefits.length > 0 && (
          <ul className="pl-5 space-y-0.5 text-muted-foreground">
            {proposal.key_benefits.slice(0, 2).map((benefit, i) => (
              <li key={i} className="list-disc line-clamp-1">{benefit}</li>
            ))}
          </ul>
        )}
      </div>

      {/* Action feedback */}
      {actionFeedback && (
        <div className="text-xs text-center py-1 px-2 bg-muted/50 rounded text-muted-foreground">
          {actionFeedback}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          variant="outline"
          className="flex-1 h-9 text-xs border-red-500/30 text-red-600 hover:bg-red-500/10 hover:text-red-600"
          onClick={handleReject}
          disabled={isProcessing}
        >
          {isProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5 mr-1" />}
          Reject
        </Button>
        <Button
          size="sm"
          className="flex-1 h-9 text-xs bg-green-600 hover:bg-green-700 text-white"
          onClick={handleAccept}
          disabled={isProcessing}
        >
          {isProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5 mr-1" />}
          Apply
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
