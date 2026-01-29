/**
 * EPD Assistant Chat Panel
 * AI-powered EPD mapping assistant with full model context
 * Helps users find better EPD matches for their building materials
 */

import React, { useRef, useEffect, useState, FormEvent, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { useViewerStore } from '../../store';
import { ScrollArea } from '../ui/scroll-area';
import { Button } from '../ui/button';
import { Send, Bot, User, Loader2, AlertCircle, Copy, Check, Wand2, Leaf, Search, BarChart3 } from 'lucide-react';
import { EPDProposalsList } from './EPDProposalCard';
import type { EPDProposal } from '../../store/slices/lcaSlice';

/** EPD Agent API endpoint */
const AGENT_API_ENDPOINT = import.meta.env.DEV
  ? 'http://localhost:3001/api/epd-agent'
  : '/api/epd-agent';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  proposals?: EPDProposal[];
}

const suggestedPrompts = [
  { icon: Search, text: 'Find better EPDs for my materials' },
  { icon: Leaf, text: 'Suggest lower-carbon alternatives' },
  { icon: BarChart3, text: 'Which materials have the highest impact?' },
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

  // Chat state from store
  const chatMessages = useViewerStore((s) => s.chatMessages);
  const isChatLoading = useViewerStore((s) => s.isChatLoading);
  const chatError = useViewerStore((s) => s.chatError);
  const addChatMessage = useViewerStore((s) => s.addChatMessage);
  const setChatLoading = useViewerStore((s) => s.setChatLoading);
  const setChatError = useViewerStore((s) => s.setChatError);

  // EPD proposal state
  const addEPDProposals = useViewerStore((s) => s.addEPDProposals);
  const acceptProposal = useViewerStore((s) => s.acceptProposal);
  const rejectProposal = useViewerStore((s) => s.rejectProposal);
  const setAgentProcessing = useViewerStore((s) => s.setAgentProcessing);
  const isAgentProcessing = useViewerStore((s) => s.isAgentProcessing);

  // Model context
  const lcaResults = useViewerStore((s) => s.lcaResults);

  // Local input state
  const [input, setInput] = useState('');

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      const scrollElement = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollElement) {
        scrollElement.scrollTop = scrollElement.scrollHeight;
      }
    }
  }, [chatMessages]);

  // Build full model context for the agent
  const buildModelContext = useCallback(() => {
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
    if (!input.trim() || isChatLoading || isAgentProcessing) return;

    const userMessage = input.trim();
    setInput('');
    setChatError(null);
    setChatLoading(true);
    setAgentProcessing(true);

    // Add user message
    addChatMessage({ role: 'user', content: userMessage });

    try {
      // Always use the EPD agent with full model context
      const { materials, currentMatches } = buildModelContext();

      const response = await fetch(AGENT_API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
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
        throw new Error(data.error || 'Request failed');
      }

      const data = await response.json();

      // Add proposals to store if any
      const proposals: EPDProposal[] = data.proposals || [];
      if (proposals.length > 0) {
        addEPDProposals(proposals);
      }

      // Add assistant response
      addChatMessage({
        role: 'assistant',
        content: data.response || data.message || 'Analysis complete.',
        proposals: proposals
      });
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setChatLoading(false);
      setAgentProcessing(false);
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
        <Wand2 className="w-8 h-8 mb-2 opacity-50" />
        <p className="text-sm">Load an IFC file to get EPD recommendations</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border flex items-center gap-2">
        <Wand2 className="w-4 h-4 text-primary" />
        <span className="text-xs font-medium">EPD Assistant</span>
        <span className="text-xs text-muted-foreground">
          • {lcaResults.matches.length} materials loaded
        </span>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="p-3 space-y-3">
          {chatMessages.length === 0 && (
            <div className="space-y-3">
              <div className="text-center py-4">
                <Wand2 className="w-6 h-6 mx-auto mb-2 text-primary" />
                <p className="text-sm font-medium">EPD Assistant</p>
                <p className="text-xs text-muted-foreground">
                  I have access to your model's materials, properties, and current EPD mappings.
                  Ask me to find better matches or optimize your LCA results.
                </p>
              </div>

              {/* Suggested prompts */}
              <div className="space-y-2">
                {suggestedPrompts.map((prompt, i) => (
                  <button
                    key={i}
                    onClick={() => handleSuggestedPrompt(prompt.text)}
                    className="w-full flex items-center gap-2 p-2 rounded-lg border border-primary/30 hover:bg-primary/10 transition-colors text-left text-sm"
                  >
                    <prompt.icon className="w-4 h-4 flex-shrink-0 text-primary" />
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
          {isAgentProcessing && chatMessages[chatMessages.length - 1]?.role !== 'assistant' && (
            <div className="flex gap-2">
              <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-primary to-purple-500 text-white">
                <Wand2 className="w-4 h-4" />
              </div>
              <div className="bg-muted rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-xs text-muted-foreground">
                    Analyzing materials & searching EPDs...
                  </span>
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
            placeholder="Ask about EPDs, materials, or LCA optimization..."
            className="flex-1 resize-none rounded-lg px-3 py-2 text-sm bg-primary/5 focus:outline-none focus:ring-1 focus:ring-primary border border-primary/20 min-h-[40px] max-h-[120px]"
            rows={1}
            disabled={isAgentProcessing}
          />
          <Button
            type="submit"
            size="icon"
            disabled={!input.trim() || isAgentProcessing}
            className="flex-shrink-0 bg-gradient-to-br from-primary to-purple-500 hover:from-primary/90 hover:to-purple-500/90"
          >
            {isAgentProcessing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
