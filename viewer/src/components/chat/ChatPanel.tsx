/**
 * AI Chat Panel Component
 * Chat interface for LCA analysis with markdown rendering, copy support, and EPD agent
 */

import React, { useRef, useEffect, useState, FormEvent, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { useViewerStore } from '../../store';
import { ScrollArea } from '../ui/scroll-area';
import { Button } from '../ui/button';
import { Send, Bot, User, Loader2, Sparkles, AlertCircle, Leaf, BarChart3, Lightbulb, Copy, Check, Wand2, RefreshCw } from 'lucide-react';
import { EPDProposalsList } from './EPDProposalCard';
import type { EPDProposal } from '../../store/slices/lcaSlice';

/** API endpoints */
const CHAT_API_ENDPOINT = import.meta.env.DEV
  ? 'http://localhost:3001/api/chat'
  : '/api/chat';

const AGENT_API_ENDPOINT = import.meta.env.DEV
  ? 'http://localhost:3001/api/epd-agent'
  : '/api/epd-agent';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  proposals?: EPDProposal[]; // Embedded EPD proposals from agent
}

const suggestedPrompts = [
  { icon: BarChart3, text: 'Which material has the highest impact?' },
  { icon: Lightbulb, text: 'Suggest lower-carbon alternatives' },
  { icon: Leaf, text: 'Explain the total GWP calculation' },
];

const agentPrompts = [
  { icon: Wand2, text: 'Find better EPDs for all materials' },
  { icon: RefreshCw, text: 'Find lower-carbon concrete alternatives' },
  { icon: Leaf, text: 'Suggest EPDs with recycled content' },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="p-1 rounded hover:bg-background/50 transition-colors opacity-0 group-hover:opacity-100"
      title="Copy message"
    >
      {copied ? (
        <Check className="w-3.5 h-3.5 text-green-500" />
      ) : (
        <Copy className="w-3.5 h-3.5 text-muted-foreground" />
      )}
    </button>
  );
}

interface MessageBubbleProps {
  message: ChatMessage;
  onAcceptProposal?: (id: string) => void;
  onRejectProposal?: (id: string) => void;
}

function MessageBubble({ message, onAcceptProposal, onRejectProposal }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const hasProposals = message.proposals && message.proposals.length > 0;

  return (
    <div className={`flex gap-2 group ${isUser ? 'flex-row-reverse' : ''}`}>
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
          isUser ? 'bg-primary text-primary-foreground' : hasProposals ? 'bg-gradient-to-br from-primary to-purple-500 text-white' : 'bg-muted'
        }`}
      >
        {isUser ? <User className="w-4 h-4" /> : hasProposals ? <Wand2 className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
      </div>
      <div
        className={`flex-1 rounded-lg px-3 py-2 text-sm relative ${
          isUser ? 'bg-primary text-primary-foreground' : 'bg-muted'
        }`}
      >
        {/* Copy button */}
        <div className={`absolute top-1 ${isUser ? 'left-1' : 'right-1'}`}>
          <CopyButton text={message.content} />
        </div>

        {/* Message content with markdown */}
        {isUser ? (
          <div className="whitespace-pre-wrap pr-6">{message.content}</div>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none pr-6 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
            <ReactMarkdown
              components={{
                // Style headings
                h1: ({ children }) => <h3 className="text-base font-bold mt-3 mb-2">{children}</h3>,
                h2: ({ children }) => <h4 className="text-sm font-bold mt-3 mb-1.5">{children}</h4>,
                h3: ({ children }) => <h5 className="text-sm font-semibold mt-2 mb-1">{children}</h5>,
                // Style paragraphs
                p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                // Style lists
                ul: ({ children }) => <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>,
                li: ({ children }) => <li className="text-sm">{children}</li>,
                // Style bold/italic
                strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
                em: ({ children }) => <em className="italic">{children}</em>,
                // Style code
                code: ({ children, className }) => {
                  const isBlock = className?.includes('language-');
                  if (isBlock) {
                    return (
                      <code className="block bg-background/50 rounded p-2 text-xs overflow-x-auto my-2">
                        {children}
                      </code>
                    );
                  }
                  return (
                    <code className="bg-background/50 rounded px-1 py-0.5 text-xs font-mono">
                      {children}
                    </code>
                  );
                },
                // Style blockquotes
                blockquote: ({ children }) => (
                  <blockquote className="border-l-2 border-primary/50 pl-3 italic my-2">
                    {children}
                  </blockquote>
                ),
                // Style tables
                table: ({ children }) => (
                  <div className="overflow-x-auto my-2">
                    <table className="min-w-full text-xs border-collapse">{children}</table>
                  </div>
                ),
                th: ({ children }) => (
                  <th className="border border-border px-2 py-1 bg-muted/50 font-semibold text-left">
                    {children}
                  </th>
                ),
                td: ({ children }) => (
                  <td className="border border-border px-2 py-1">{children}</td>
                ),
                // Style horizontal rules
                hr: () => <hr className="my-3 border-border" />,
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Separate component to render proposals after a message
 * This keeps proposals visually connected but semantically separate
 */
function MessageProposals({
  proposals,
  onAccept,
  onReject
}: {
  proposals: EPDProposal[];
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
}) {
  if (!proposals || proposals.length === 0) return null;

  return (
    <div className="ml-9 mt-2">
      <EPDProposalsList
        proposals={proposals}
        onAccept={onAccept}
        onReject={onReject}
      />
    </div>
  );
}

export function ChatPanel() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Use Zustand store for persistent chat state
  const chatMessages = useViewerStore((s) => s.chatMessages);
  const isChatLoading = useViewerStore((s) => s.isChatLoading);
  const chatError = useViewerStore((s) => s.chatError);
  const addChatMessage = useViewerStore((s) => s.addChatMessage);
  const updateChatMessage = useViewerStore((s) => s.updateChatMessage);
  const setChatLoading = useViewerStore((s) => s.setChatLoading);
  const setChatError = useViewerStore((s) => s.setChatError);

  // EPD Agent state
  const epdProposals = useViewerStore((s) => s.epdProposals);
  const isAgentProcessing = useViewerStore((s) => s.isAgentProcessing);
  const addEPDProposals = useViewerStore((s) => s.addEPDProposals);
  const acceptProposal = useViewerStore((s) => s.acceptProposal);
  const rejectProposal = useViewerStore((s) => s.rejectProposal);
  const setAgentProcessing = useViewerStore((s) => s.setAgentProcessing);

  // Local state
  const [input, setInput] = useState('');
  const [isAgentMode, setIsAgentMode] = useState(false);

  // Get LCA context from store
  const lcaResults = useViewerStore((s) => s.lcaResults);
  const matchingMethod = useViewerStore((s) => s.matchingMethod);
  const extractedMaterials = useViewerStore((s) => s.extractedMaterials);

  // Build context for the AI - include matching method for better responses
  const lcaContext = lcaResults
    ? {
        totalGWP: lcaResults.totalGWP,
        matchedCount: lcaResults.matches.length,
        unmatchedCount: lcaResults.unmatchedMaterials.length,
        matchingMethod: matchingMethod,
        materials: lcaResults.matches.map((m) => ({
          name: m.material.name,
          category: m.material.category,
          gwp: m.calculatedGWP,
          confidence: m.confidence,
          epd: m.epd.name,
          quantity: m.quantity,
          unit: m.calculatedUnit,
          elementCount: m.material.elementIds.length,
          matchReason: m.matchReason,
          alternatives: m.alternatives?.map((a) => ({
            name: a.name,
            gwp: a.impacts.gwp,
          })),
        })),
        byCategory: Object.fromEntries(lcaResults.byCategory),
      }
    : null;

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      const scrollElement = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollElement) {
        scrollElement.scrollTop = scrollElement.scrollHeight;
      }
    }
  }, [chatMessages]);

  // Detect if message is an EPD agent request
  const isAgentRequest = useCallback((message: string): boolean => {
    const agentKeywords = [
      'find epd', 'find better epd', 'suggest epd', 'epd for',
      'alternative epd', 'lower carbon', 'lower-carbon',
      'recycled content', 'sustainable alternative',
      'better material', 'replace', 'swap', 'change epd',
      'map epd', 'match epd', 'epd mapping',
      'find all epd', 'update epd', 'optimize'
    ];
    const lowerMessage = message.toLowerCase();
    return agentKeywords.some(kw => lowerMessage.includes(kw));
  }, []);

  // Build agent request data from current LCA data
  const buildAgentRequestData = useCallback(() => {
    if (!lcaResults) return { materials: [], currentMatches: {} };

    const materials = lcaResults.matches.map(m => ({
      id: m.material.id,
      name: m.material.name,
      category: m.material.category,
      elementIds: m.material.elementIds,
      totalVolume: m.material.totalVolume,
      totalArea: m.material.totalArea,
      properties: m.material.properties,
    }));

    const currentMatches: Record<string, {
      epdId: string;
      epdName: string;
      confidence: number;
      gwp: number;
      calculatedGWP: number;
    }> = {};

    lcaResults.matches.forEach(m => {
      currentMatches[m.material.id] = {
        epdId: m.epd.id,
        epdName: m.epd.name,
        confidence: m.confidence,
        gwp: m.epd.impacts.gwp,
        calculatedGWP: m.calculatedGWP,
      };
    });

    return { materials, currentMatches };
  }, [lcaResults]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isChatLoading) return;

    const userMessageContent = input.trim();
    setInput('');
    setChatError(null);
    setChatLoading(true);

    // Add user message to store
    addChatMessage({ role: 'user', content: userMessageContent });

    // Determine if we should use the agent
    const useAgent = isAgentMode || isAgentRequest(userMessageContent);

    try {
      if (useAgent) {
        // Use EPD Agent endpoint
        setAgentProcessing(true);

        const { materials, currentMatches } = buildAgentRequestData();
        const response = await fetch(AGENT_API_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: userMessageContent,
            materials,
            currentMatches,
            conversationHistory: chatMessages.slice(-6).map(m => ({
              role: m.role,
              content: m.content
            }))
          }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Agent request failed');
        }

        const data = await response.json();

        // Add agent response with embedded proposals
        const proposals: EPDProposal[] = data.proposals || [];
        if (proposals.length > 0) {
          addEPDProposals(proposals);
        }

        // Add message with reference to proposals
        // Agent returns 'response' field, not 'message'
        addChatMessage({
          role: 'assistant',
          content: data.response || data.message || data.content || 'Analysis complete.',
          proposals: proposals
        });

        setAgentProcessing(false);
      } else {
        // Use regular chat endpoint
        const messagesForApi = [
          ...chatMessages.map((m) => ({ role: m.role, content: m.content })),
          { role: 'user' as const, content: userMessageContent },
        ];

        const response = await fetch(CHAT_API_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: messagesForApi,
            context: lcaContext,
            stream: false,
          }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to get response');
        }

        const contentType = response.headers.get('content-type');

        if (contentType?.includes('application/json')) {
          const data = await response.json();
          addChatMessage({ role: 'assistant', content: data.content || data.message || 'No response' });
        } else {
          // Handle streaming response (fallback)
          const reader = response.body?.getReader();
          if (!reader) throw new Error('No response body');

          const decoder = new TextDecoder();
          let assistantContent = '';
          let buffer = '';
          const assistantId = addChatMessage({ role: 'assistant', content: '' });

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.startsWith('0:')) {
                try {
                  const text = JSON.parse(line.slice(2));
                  assistantContent += text;
                  updateChatMessage(assistantId, assistantContent);
                } catch {
                  // Skip parse errors
                }
              }
            }
          }

          if (buffer.startsWith('0:')) {
            try {
              const text = JSON.parse(buffer.slice(2));
              assistantContent += text;
              updateChatMessage(assistantId, assistantContent);
            } catch {
              // Skip
            }
          }
        }
      }
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'An error occurred');
      setAgentProcessing(false);
    } finally {
      setChatLoading(false);
    }
  };

  // Handle suggested prompt click
  const handleSuggestedPrompt = (prompt: string) => {
    setInput(prompt);
    inputRef.current?.focus();
  };

  // Handle keyboard submit
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const form = e.currentTarget.closest('form');
      if (form) {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
    }
  };

  if (!lcaResults) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 text-center text-muted-foreground">
        <Sparkles className="w-8 h-8 mb-2 opacity-50" />
        <p className="text-sm">Load an IFC file to start chatting about its environmental impact</p>
      </div>
    );
  }

  // Get current prompts based on mode
  const currentPrompts = isAgentMode ? agentPrompts : suggestedPrompts;

  return (
    <div className="h-full flex flex-col">
      {/* Mode Toggle Header */}
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isAgentMode ? (
            <Wand2 className="w-4 h-4 text-primary" />
          ) : (
            <Bot className="w-4 h-4 text-muted-foreground" />
          )}
          <span className="text-xs font-medium">
            {isAgentMode ? 'EPD Agent Mode' : 'Chat Mode'}
          </span>
        </div>
        <button
          onClick={() => setIsAgentMode(!isAgentMode)}
          className={`px-2 py-1 text-xs rounded-full transition-colors ${
            isAgentMode
              ? 'bg-primary/20 text-primary border border-primary/30'
              : 'bg-muted text-muted-foreground hover:bg-muted/80'
          }`}
        >
          {isAgentMode ? 'Switch to Chat' : 'Enable Agent'}
        </button>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="p-3 space-y-3">
          {chatMessages.length === 0 && (
            <div className="space-y-3">
              <div className="text-center py-4">
                {isAgentMode ? (
                  <>
                    <Wand2 className="w-6 h-6 mx-auto mb-2 text-primary" />
                    <p className="text-sm font-medium">EPD Agent</p>
                    <p className="text-xs text-muted-foreground">
                      AI-powered EPD matching with full model access
                    </p>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-6 h-6 mx-auto mb-2 text-primary" />
                    <p className="text-sm font-medium">AI LCA Assistant</p>
                    <p className="text-xs text-muted-foreground">
                      Ask questions about your building's environmental impact
                    </p>
                  </>
                )}
              </div>

              {/* Suggested prompts */}
              <div className="space-y-2">
                {currentPrompts.map((prompt, i) => (
                  <button
                    key={i}
                    onClick={() => handleSuggestedPrompt(prompt.text)}
                    className={`w-full flex items-center gap-2 p-2 rounded-lg border transition-colors text-left text-sm ${
                      isAgentMode
                        ? 'border-primary/30 hover:bg-primary/10'
                        : 'border-border hover:bg-muted/50'
                    }`}
                  >
                    <prompt.icon className={`w-4 h-4 flex-shrink-0 ${
                      isAgentMode ? 'text-primary' : 'text-muted-foreground'
                    }`} />
                    <span>{prompt.text}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {chatMessages.map((message) => (
            <div key={message.id}>
              <MessageBubble
                message={message}
                onAcceptProposal={acceptProposal}
                onRejectProposal={rejectProposal}
              />
              {/* Render proposals after the message */}
              {message.proposals && message.proposals.length > 0 && (
                <MessageProposals
                  proposals={message.proposals}
                  onAccept={acceptProposal}
                  onReject={rejectProposal}
                />
              )}
            </div>
          ))}

          {/* Loading indicator */}
          {(isChatLoading || isAgentProcessing) && chatMessages[chatMessages.length - 1]?.role !== 'assistant' && (
            <div className="flex gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                isAgentProcessing
                  ? 'bg-gradient-to-br from-primary to-purple-500 text-white'
                  : 'bg-muted'
              }`}>
                {isAgentProcessing ? (
                  <Wand2 className="w-4 h-4" />
                ) : (
                  <Bot className="w-4 h-4" />
                )}
              </div>
              <div className="bg-muted rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {isAgentProcessing && (
                    <span className="text-xs text-muted-foreground">
                      Analyzing model & finding EPDs...
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {chatError && (
            <div className="flex items-center gap-2 text-sm text-red-500 p-2 bg-red-500/10 rounded-lg">
              <AlertCircle className="w-4 h-4" />
              <span>{chatError}</span>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-2 border-t border-border">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isAgentMode
              ? "Ask the agent to find better EPDs..."
              : "Ask about environmental impact..."
            }
            className={`flex-1 resize-none rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 min-h-[40px] max-h-[120px] ${
              isAgentMode
                ? 'bg-primary/5 focus:ring-primary border border-primary/20'
                : 'bg-muted focus:ring-primary'
            }`}
            rows={1}
            disabled={isChatLoading || isAgentProcessing}
          />
          <Button
            type="submit"
            size="icon"
            disabled={!input.trim() || isChatLoading || isAgentProcessing}
            className={`flex-shrink-0 ${
              isAgentMode ? 'bg-gradient-to-br from-primary to-purple-500 hover:from-primary/90 hover:to-purple-500/90' : ''
            }`}
          >
            {isChatLoading || isAgentProcessing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : isAgentMode ? (
              <Wand2 className="w-4 h-4" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
