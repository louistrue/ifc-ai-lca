/**
 * EPD Proposal Card Component
 * Displays an EPD mapping proposal from the agent with accept/reject actions
 */

import React from 'react';
import { Check, X, ArrowRight, TrendingDown, TrendingUp, Sparkles, Info } from 'lucide-react';
import { Button } from '../ui/button';
import type { EPDProposal } from '../../store/slices/lcaSlice';

interface EPDProposalCardProps {
  proposal: EPDProposal;
  onAccept: (proposalId: string) => void;
  onReject: (proposalId: string) => void;
}

export function EPDProposalCard({ proposal, onAccept, onReject }: EPDProposalCardProps) {
  const isImprovement = proposal.gwp_difference < 0;
  const absChange = Math.abs(proposal.gwp_difference_percent);

  // Confidence badge colors
  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return 'bg-green-500/20 text-green-700 dark:text-green-400';
    if (confidence >= 0.6) return 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400';
    return 'bg-orange-500/20 text-orange-700 dark:text-orange-400';
  };

  // Status-based styling
  if (proposal.status === 'accepted') {
    return (
      <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-3">
        <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
          <Check className="w-4 h-4" />
          <span className="text-sm font-medium">Accepted: {proposal.proposed_epd_name}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Applied to {proposal.material_name}
        </p>
      </div>
    );
  }

  if (proposal.status === 'rejected') {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3">
        <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
          <X className="w-4 h-4" />
          <span className="text-sm font-medium">Rejected: {proposal.proposed_epd_name}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Kept current EPD for {proposal.material_name}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">EPD Proposal</span>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full ${getConfidenceColor(proposal.confidence)}`}>
          {Math.round(proposal.confidence * 100)}% confident
        </span>
      </div>

      {/* Material name */}
      <div className="text-xs text-muted-foreground">
        For: <span className="font-medium text-foreground">{proposal.material_name}</span>
      </div>

      {/* Current → Proposed */}
      <div className="flex items-center gap-2 text-sm">
        <div className="flex-1 p-2 rounded bg-muted/50 truncate" title={proposal.current_epd_name}>
          <div className="text-xs text-muted-foreground mb-0.5">Current</div>
          <div className="truncate">{proposal.current_epd_name || 'No EPD'}</div>
          {proposal.current_gwp !== undefined && (
            <div className="text-xs text-muted-foreground mt-0.5">
              {proposal.current_gwp.toFixed(1)} kg CO₂e
            </div>
          )}
        </div>
        <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        <div className="flex-1 p-2 rounded bg-primary/10 truncate" title={proposal.proposed_epd_name}>
          <div className="text-xs text-primary mb-0.5">Proposed</div>
          <div className="truncate font-medium">{proposal.proposed_epd_name}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {proposal.proposed_gwp.toFixed(1)} kg CO₂e
          </div>
        </div>
      </div>

      {/* Impact change */}
      <div className={`flex items-center gap-1.5 text-sm ${
        isImprovement ? 'text-green-600 dark:text-green-400' : 'text-orange-600 dark:text-orange-400'
      }`}>
        {isImprovement ? (
          <TrendingDown className="w-4 h-4" />
        ) : (
          <TrendingUp className="w-4 h-4" />
        )}
        <span className="font-medium">
          {isImprovement ? '-' : '+'}{absChange.toFixed(1)}% GWP
        </span>
        <span className="text-xs text-muted-foreground">
          ({isImprovement ? '' : '+'}{proposal.gwp_difference.toFixed(1)} kg CO₂e)
        </span>
      </div>

      {/* Reasoning */}
      <div className="text-xs space-y-1.5">
        <div className="flex items-start gap-1.5">
          <Info className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
          <p className="text-muted-foreground">{proposal.reasoning}</p>
        </div>

        {proposal.key_benefits.length > 0 && (
          <ul className="pl-5 space-y-0.5 text-muted-foreground">
            {proposal.key_benefits.slice(0, 3).map((benefit, i) => (
              <li key={i} className="list-disc">{benefit}</li>
            ))}
          </ul>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          variant="outline"
          className="flex-1 h-8 text-xs border-red-500/30 text-red-600 hover:bg-red-500/10 hover:text-red-600"
          onClick={() => onReject(proposal.id)}
        >
          <X className="w-3.5 h-3.5 mr-1" />
          Reject
        </Button>
        <Button
          size="sm"
          className="flex-1 h-8 text-xs bg-green-600 hover:bg-green-700 text-white"
          onClick={() => onAccept(proposal.id)}
        >
          <Check className="w-3.5 h-3.5 mr-1" />
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
