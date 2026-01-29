/**
 * Stub for @ifc-lite/export
 * Provides stub implementations for exports not yet available in the package
 */

export class StepExporter {
  constructor(_store: unknown) {}
  async export(_options?: unknown): Promise<Uint8Array> {
    return new Uint8Array();
  }
  async exportToString(_options?: unknown): Promise<string> {
    return '';
  }
}

export class GLTFExporter {
  constructor(_store: unknown) {}
  async export(_options?: unknown): Promise<Uint8Array> {
    return new Uint8Array();
  }
  async exportToBlob(_options?: unknown): Promise<Blob> {
    return new Blob();
  }
}

export class CSVExporter {
  constructor(_store: unknown) {}
  export(_options?: unknown): string {
    return '';
  }
  exportProperties(_entityIds?: number[]): string {
    return '';
  }
  exportQuantities(_entityIds?: number[]): string {
    return '';
  }
  exportSpatialHierarchy(): string {
    return '';
  }
}

export class JSONExporter {
  constructor(_store: unknown) {}
  export(_options?: unknown): string {
    return '{}';
  }
  exportToObject(_options?: unknown): unknown {
    return {};
  }
}

export class IFCExporter {
  constructor(_store: unknown) {}
  async export(_options?: unknown): Promise<Uint8Array> {
    return new Uint8Array();
  }
  async exportToString(_options?: unknown): Promise<string> {
    return '';
  }
}
