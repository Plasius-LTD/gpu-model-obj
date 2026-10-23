import type { GpuModelDiagnosticMode, ModelLoadResult } from "@plasius/gpu-model-core";

/** Hard ceilings for one import. Callers may only tighten these budgets. */
export const OBJ_PARSER_LIMITS = Object.freeze({
  maxInputBytes: 8 * 1024 * 1024,
  maxLineBytes: 4096,
  maxSourceElements: 100_000,
  maxFaces: 100_000,
  maxOutputVertices: 300_000,
  maxPrimitiveGroups: 128,
  maxReferences: 32,
  maxDiagnostics: 64,
  maxMaterials: 128,
} as const);

export type ObjParserLimits = { readonly [K in keyof typeof OBJ_PARSER_LIMITS]: number };

/** An inert, caller-owned in-memory MTL file. No path is ever dereferenced. */
export interface ObjMaterialLibrary { readonly name: string; readonly bytes: Uint8Array }

/** Triangle import policy; no external reads or implicit repair are enabled. */
export interface ObjParseOptions {
  /** Omit for reference-only compatibility; [] explicitly requests material validation. */
  readonly materialLibraries?: readonly ObjMaterialLibrary[];
  readonly mode?: GpuModelDiagnosticMode;
  /** Explicit consent for discarded invalid faces; false by default. */
  readonly allowLoss?: boolean;
  readonly limits?: Partial<ObjParserLimits>;
  readonly signal?: AbortSignal;
  /** Whole-operation deadline, from 1 to 30,000 milliseconds. */
  readonly timeoutMs?: number;
}

export type ObjImportErrorCode = "OBJ_INVALID_INPUT" | "OBJ_INVALID_OPTIONS" | "OBJ_ABORTED" | "OBJ_DEADLINE_EXCEEDED" | "OBJ_IMPORT_REJECTED" | "OBJ_CANONICAL_VALIDATION_FAILED";

/** Fixed messages never retain source text, exception causes or abort reasons. */
export class ObjImportError extends Error {
  public constructor(public readonly code: ObjImportErrorCode, public readonly report?: ModelLoadResult["report"]) {
    super(`OBJ import: ${code}`);
    this.name = "ObjImportError";
  }
}

function ownData(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new ObjImportError("OBJ_INVALID_OPTIONS");
  const result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !keys.includes(key)) throw new ObjImportError("OBJ_INVALID_OPTIONS");
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!("value" in descriptor)) throw new ObjImportError("OBJ_INVALID_OPTIONS");
    result[key] = descriptor.value;
  }
  return result;
}

export function parserPolicy(options: ObjParseOptions): { limits: ObjParserLimits; mode: GpuModelDiagnosticMode; allowLoss: boolean; signal?: AbortSignal; timeoutMs: number; materialLibraries?: readonly ObjMaterialLibrary[] } {
  const data = ownData(options, ["limits", "mode", "allowLoss", "signal", "timeoutMs", "materialLibraries"]);
  const limits: ObjParserLimits = { ...OBJ_PARSER_LIMITS };
  if (data.limits !== undefined) {
    const input = ownData(data.limits, Object.keys(OBJ_PARSER_LIMITS));
    for (const key of Object.keys(input) as (keyof ObjParserLimits)[]) {
      const value = input[key];
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > OBJ_PARSER_LIMITS[key]) throw new ObjImportError("OBJ_INVALID_OPTIONS");
      (limits as Record<keyof ObjParserLimits, number>)[key] = value;
    }
  }
  const mode = data.mode ?? "strict";
  if (mode !== "strict" && mode !== "tolerant" && mode !== "forensic") throw new ObjImportError("OBJ_INVALID_OPTIONS");
  const timeoutMs = data.timeoutMs ?? 30_000;
  if (typeof timeoutMs !== "number" || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new ObjImportError("OBJ_INVALID_OPTIONS");
  if (data.signal !== undefined && !(data.signal instanceof AbortSignal)) throw new ObjImportError("OBJ_INVALID_OPTIONS");
  const allowLoss = data.allowLoss ?? false;
  if (typeof allowLoss !== "boolean") throw new ObjImportError("OBJ_INVALID_OPTIONS");
  let materialLibraries: ObjMaterialLibrary[] | undefined;
  if (data.materialLibraries !== undefined) {
    const table = data.materialLibraries;
    if (!Array.isArray(table) || table.length > limits.maxReferences) throw new ObjImportError("OBJ_INVALID_OPTIONS");
    materialLibraries = [];
    const names = new Set<string>(); let total = 0;
    for (let i = 0; i < table.length; i++) {
      const entry = Object.getOwnPropertyDescriptor(table, String(i));
      if (!entry || !("value" in entry)) throw new ObjImportError("OBJ_INVALID_OPTIONS");
      const file = ownData(entry.value, ["name", "bytes"]);
      if (typeof file.name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\.mtl$/.test(file.name) || names.has(file.name) || !(file.bytes instanceof Uint8Array)) throw new ObjImportError("OBJ_INVALID_OPTIONS");
      const size = Reflect.apply(Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "byteLength")!.get!, file.bytes, []) as number;
      total += size;
      if (total > OBJ_PARSER_LIMITS.maxInputBytes) throw new ObjImportError("OBJ_INVALID_OPTIONS");
      const bytes = new Uint8Array(size);
      try { Uint8Array.prototype.set.call(bytes, file.bytes); } catch { throw new ObjImportError("OBJ_INVALID_OPTIONS"); }
      names.add(file.name); materialLibraries.push({ name: file.name, bytes });
    }
  }
  return { limits, mode, allowLoss, materialLibraries, signal: data.signal as AbortSignal | undefined, timeoutMs };
}

/** Cooperative parsing yields every bounded batch so timers and abort can run. */
export function parserClock(signal: AbortSignal | undefined, timeoutMs: number, startedAt = performance.now()) {
  const deadline = startedAt + timeoutMs;
  const check = () => {
    if (signal?.aborted) throw new ObjImportError("OBJ_ABORTED");
    if (performance.now() >= deadline) throw new ObjImportError("OBJ_DEADLINE_EXCEEDED");
  };
  return {
    check,
    async checkpoint() { check(); await new Promise<void>(resolve => setTimeout(resolve, 0)); check(); },
  };
}
