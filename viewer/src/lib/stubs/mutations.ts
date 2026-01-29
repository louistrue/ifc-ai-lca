/**
 * Stub for @ifc-lite/mutations
 * This module is not yet published, so we provide empty stubs
 */

export class MutationEngine {
  constructor(_store: unknown) {}
  applyMutation(_mutation: unknown) { return null; }
  getMutations() { return []; }
  undo() { return null; }
  redo() { return null; }
  canUndo() { return false; }
  canRedo() { return false; }
  clear() {}
}

export function createMutation(_type: string, _data: unknown) {
  return null;
}

export function serializeMutations(_mutations: unknown[]) {
  return '';
}

export function deserializeMutations(_data: string) {
  return [];
}

export type Mutation = {
  type: string;
  data: unknown;
};

export type MutationResult = {
  success: boolean;
  mutation?: Mutation;
};
