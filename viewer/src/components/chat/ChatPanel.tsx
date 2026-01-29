/**
 * AI Chat Panel Component
 * Chat interface for LCA analysis using non-streaming API for reliability
 */

import React, { useRef, useEffect, useState, FormEvent } from 'react';
import { useViewerStore } from '../../store';
import { ScrollArea } from '../ui/scroll-area';
import { Button } from '../ui/button';
import { Send, Bot, User, Loader2, Sparkles, AlertCircle, Leaf, BarChart3, Lightbulb } from 'lucide-react';

/** API endpoint for chat - use Express server in dev, Vercel in production */
const CHAT_API_ENDPOINT = import.meta.env.DEV
  ? 'http://localhost:3001/api/chat'
  : '/api/chat';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

const suggestedPrompts = [
  { icon: BarChart3, text: 'Which material has the highest impact?' },
  { icon: Lightbulb, text: 'Suggest lower-carbon alternatives' },
  { icon: Leaf, text: 'Explain the total GWP calculation' },
];

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
          isUser ? 'bg-primary text-primary-foreground' : 'bg-muted'
        }`}
      >
        {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
      </div>
      <div
        className={`flex-1 rounded-lg px-3 py-2 text-sm ${
          isUser ? 'bg-primary text-primary-foreground' : 'bg-muted'
        }`}
      >
        <div className="whitespace-pre-wrap">{message.content}</div>
      </div>
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

  // Local state just for the input field
  const [input, setInput] = useState('');

  // Get LCA context from store
  const lcaResults = useViewerStore((s) => s.lcaResults);
  const matchingMethod = useViewerStore((s) => s.matchingMethod);

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

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isChatLoading) return;

    const userMessageContent = input.trim();
    setInput('');
    setChatError(null);
    setChatLoading(true);

    // Add user message to store
    addChatMessage({ role: 'user', content: userMessageContent });

    try {
      // Build messages for API (from store)
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
          stream: false, // Request non-streaming response
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to get response');
      }

      // Check if response is streaming or JSON
      const contentType = response.headers.get('content-type');

      if (contentType?.includes('application/json')) {
        // Non-streaming JSON response
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

        // Process remaining buffer
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
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'An error occurred');
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

  return (
    <div className="h-full flex flex-col">
      {/* Messages */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="p-3 space-y-3">
          {chatMessages.length === 0 && (
            <div className="space-y-3">
              <div className="text-center py-4">
                <Sparkles className="w-6 h-6 mx-auto mb-2 text-primary" />
                <p className="text-sm font-medium">AI LCA Assistant</p>
                <p className="text-xs text-muted-foreground">
                  Ask questions about your building's environmental impact
                </p>
              </div>

              {/* Suggested prompts */}
              <div className="space-y-2">
                {suggestedPrompts.map((prompt, i) => (
                  <button
                    key={i}
                    onClick={() => handleSuggestedPrompt(prompt.text)}
                    className="w-full flex items-center gap-2 p-2 rounded-lg border border-border hover:bg-muted/50 transition-colors text-left text-sm"
                  >
                    <prompt.icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <span>{prompt.text}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {chatMessages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}

          {isChatLoading && chatMessages[chatMessages.length - 1]?.role !== 'assistant' && (
            <div className="flex gap-2">
              <div className="w-7 h-7 rounded-full flex items-center justify-center bg-muted flex-shrink-0">
                <Bot className="w-4 h-4" />
              </div>
              <div className="bg-muted rounded-lg px-3 py-2">
                <Loader2 className="w-4 h-4 animate-spin" />
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
            placeholder="Ask about environmental impact..."
            className="flex-1 resize-none bg-muted rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary min-h-[40px] max-h-[120px]"
            rows={1}
            disabled={isChatLoading}
          />
          <Button
            type="submit"
            size="icon"
            disabled={!input.trim() || isChatLoading}
            className="flex-shrink-0"
          >
            {isChatLoading ? (
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
