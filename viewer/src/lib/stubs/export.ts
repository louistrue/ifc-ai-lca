/**
 * Stub exports for @ifc-lite/export
 * Re-exports real exports and adds missing ones
 */

// Re-export everything from the real package
export * from '@ifc-lite/export';

// Add missing StepExporter stub
export class StepExporter {
  constructor(_store: unknown) {}
  async export(_options?: unknown): Promise<Uint8Array> {
    return new Uint8Array();
  }
  async exportToString(_options?: unknown): Promise<string> {
    return '';
  }
}
