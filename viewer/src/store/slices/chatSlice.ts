/**
 * Chat State Slice
 * Manages chat messages and AI conversation state
 */

import type { StateCreator } from 'zustand';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface ChatSlice {
  // Chat messages
  chatMessages: ChatMessage[];
  isChatLoading: boolean;
  chatError: string | null;

  // Actions
  addChatMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => string;
  updateChatMessage: (id: string, content: string) => void;
  setChatLoading: (loading: boolean) => void;
  setChatError: (error: string | null) => void;
  clearChat: () => void;
}

export const createChatSlice: StateCreator<ChatSlice, [], [], ChatSlice> = (set, get) => ({
  // Initial state
  chatMessages: [],
  isChatLoading: false,
  chatError: null,

  // Actions
  addChatMessage: (message) => {
    const id = `${message.role}-${Date.now()}`;
    const newMessage: ChatMessage = {
      ...message,
      id,
      timestamp: Date.now(),
    };
    set((state) => ({
      chatMessages: [...state.chatMessages, newMessage],
    }));
    return id;
  },

  updateChatMessage: (id, content) => {
    set((state) => ({
      chatMessages: state.chatMessages.map((m) =>
        m.id === id ? { ...m, content } : m
      ),
    }));
  },

  setChatLoading: (loading) => {
    set({ isChatLoading: loading });
  },

  setChatError: (error) => {
    set({ chatError: error });
  },

  clearChat: () => {
    set({
      chatMessages: [],
      chatError: null,
    });
  },
});
