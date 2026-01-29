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

export class MutablePropertyView {
  constructor(_store: unknown) {}
  getProperties(_entityId: number) { return []; }
  setProperty(_entityId: number, _psetName: string, _propName: string, _value: unknown) {}
  addPropertySet(_entityId: number, _psetName: string) {}
  removePropertySet(_entityId: number, _psetName: string) {}
  addProperty(_entityId: number, _psetName: string, _propName: string, _value: unknown) {}
  removeProperty(_entityId: number, _psetName: string, _propName: string) {}
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
