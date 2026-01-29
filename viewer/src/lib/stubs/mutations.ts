/**
 * Stub for @ifc-lite/mutations
 * This module is not yet published, so we provide empty stubs
 */

// Classes
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
  setOnDemandExtractor(_extractor: unknown) {}
  hasChanges() { return false; }
  getChanges() { return []; }
  clearChanges() {}
}

export class BulkQueryEngine {
  constructor(_store: unknown, _propertyView?: unknown) {}
  query(_criteria: unknown): unknown[] { return []; }
  preview(_criteria: unknown): unknown { return { matchCount: 0, entities: [] }; }
  applyBulkAction(_action: unknown): unknown { return { success: true, modifiedCount: 0 }; }
}

export class CsvConnector {
  constructor(_store: unknown, _propertyView?: unknown) {}
  parseCSV(_content: string): unknown[] { return []; }
  matchEntities(_rows: unknown[], _strategy: unknown): unknown[] { return []; }
  importData(_mappings: unknown[]): unknown { return { success: true, importedCount: 0 }; }
  exportToCSV(_entityIds: number[]): string { return ''; }
}

// Functions
export function createMutation(_type: string, _data: unknown) {
  return null;
}

export function serializeMutations(_mutations: unknown[]) {
  return '';
}

export function deserializeMutations(_data: string) {
  return [];
}

// Types
export type Mutation = {
  type: string;
  data: unknown;
};

export type MutationResult = {
  success: boolean;
  mutation?: Mutation;
};

export type ChangeSet = {
  id: string;
  mutations: Mutation[];
  timestamp: number;
  description?: string;
};

export type PropertyValue = {
  type: string;
  value: unknown;
  unit?: string;
};

export type SelectionCriteria = {
  ifcType?: string;
  propertyFilters?: PropertyFilter[];
  spatialFilter?: unknown;
};

export type BulkAction = {
  type: 'setProperty' | 'addProperty' | 'removeProperty' | 'addPropertySet' | 'removePropertySet';
  propertySetName?: string;
  propertyName?: string;
  value?: unknown;
};

export type FilterOperator = 'equals' | 'contains' | 'startsWith' | 'endsWith' | 'gt' | 'lt' | 'gte' | 'lte' | 'regex';

export type PropertyFilter = {
  propertySetName: string;
  propertyName: string;
  operator: FilterOperator;
  value: unknown;
};

export type BulkQueryPreview = {
  matchCount: number;
  entities: unknown[];
  sampleProperties?: unknown[];
};

export type BulkQueryResult = {
  success: boolean;
  modifiedCount: number;
  errors?: string[];
};

export type CsvRow = Record<string, string | number | boolean | null>;

export type MatchStrategy = {
  type: 'globalId' | 'expressId' | 'name' | 'property';
  columnName: string;
  propertySetName?: string;
  propertyName?: string;
};

export type PropertyMapping = {
  sourceColumn: string;
  targetPropertySet: string;
  targetProperty: string;
  valueType?: string;
};

export type DataMapping = {
  row: CsvRow;
  entityId: number;
  matchConfidence: number;
};

export type MatchResult = {
  matched: DataMapping[];
  unmatched: CsvRow[];
  ambiguous: { row: CsvRow; candidates: number[] }[];
};

export type ImportStats = {
  totalRows: number;
  matchedRows: number;
  importedProperties: number;
  errors: string[];
};
