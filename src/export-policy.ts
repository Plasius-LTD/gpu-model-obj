import type { ExportOptions, ModelTarget, GpuModelDiagnosticMode } from "@plasius/gpu-model-core";

/** Tighten-only ceilings for one deterministic in-memory export. */
export const OBJ_EXPORT_LIMITS = Object.freeze({
  maxResourceBytes: 16 * 1024 * 1024,
  maxResources: 32,
  maxMaterials: 128,
  maxAccessors: 512,
  maxNodes: 4096,
  maxPrimitives: 128,
  maxOutputVertices: 300_000,
  maxSourceElements: 100_000,
  maxOutputBytes: 8 * 1024 * 1024,
} as const);
export type ObjExportLimits = { readonly [K in keyof typeof OBJ_EXPORT_LIMITS]: number };
/** Core operation policy with optional tighter work budgets. No implicit I/O. */
export interface ObjExportOptions extends ExportOptions {
  readonly limits?: Partial<ObjExportLimits>;
  /** Return actual paired MTL bytes; omitted/false retains reference-only export. */
  readonly includeMaterials?: boolean;
}
export type ObjExportErrorCode = "OBJ_EXPORT_INVALID_DOCUMENT" | "OBJ_EXPORT_INVALID_OPTIONS" | "OBJ_EXPORT_INVALID_TARGET" | "OBJ_EXPORT_ABORTED" | "OBJ_EXPORT_DEADLINE_EXCEEDED" | "OBJ_EXPORT_RESOURCE_FAILED";
/** Fixed, value-free operational failures; rejected conversions use core reports. */
export class ObjExportError extends Error {
  public constructor(public readonly code: ObjExportErrorCode) { super(`OBJ export: ${code}`); this.name = "ObjExportError"; }
}

function dataRecord(value: unknown, allowed: readonly string[], code: ObjExportErrorCode): Record<string, unknown> {
  try {
    if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new ObjExportError(code);
    const data: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string" || !allowed.includes(key)) throw new ObjExportError(code);
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!("value" in descriptor)) throw new ObjExportError(code);
      data[key] = descriptor.value;
    }
    return data;
  } catch { throw new ObjExportError(code); }
}

export function exportPolicy(options: ObjExportOptions) {
  const code = "OBJ_EXPORT_INVALID_OPTIONS";
  const data = dataRecord(options, ["mode", "allowLoss", "signal", "timeoutMs", "limits", "includeMaterials"], code);
  const limits: ObjExportLimits = { ...OBJ_EXPORT_LIMITS };
  if (data.limits !== undefined) {
    const values = dataRecord(data.limits, Object.keys(limits), code);
    for (const key of Object.keys(values) as (keyof ObjExportLimits)[]) {
      const value = values[key];
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > OBJ_EXPORT_LIMITS[key]) throw new ObjExportError(code);
      (limits as Record<keyof ObjExportLimits, number>)[key] = value;
    }
  }
  const includeMaterials = data.includeMaterials === undefined ? false : data.includeMaterials;
  if (typeof includeMaterials !== "boolean") throw new ObjExportError(code);
  const mode = data.mode === undefined ? "strict" : data.mode;
  const allowLoss = data.allowLoss === undefined ? false : data.allowLoss;
  const timeoutMs = data.timeoutMs === undefined ? 30_000 : data.timeoutMs;
  if (mode !== "strict" && mode !== "tolerant" && mode !== "forensic" || typeof allowLoss !== "boolean" || typeof timeoutMs !== "number" || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000 || data.signal !== undefined && !(data.signal instanceof AbortSignal)) throw new ObjExportError(code);
  return { limits, includeMaterials, mode: mode as GpuModelDiagnosticMode, allowLoss, timeoutMs, signal: data.signal as AbortSignal | undefined };
}

export function exportTarget(target: ModelTarget): { kind: "blob" | "array-buffer" | "uint8-array"; fileName: string } {
  const code = "OBJ_EXPORT_INVALID_TARGET";
  const data = dataRecord(target, ["kind", "mimeType", "fileName"], code);
  if (data.kind !== "blob" && data.kind !== "array-buffer" && data.kind !== "uint8-array") throw new ObjExportError(code);
  if (data.kind !== "blob" && Reflect.ownKeys(data).length !== 1) throw new ObjExportError(code);
  if (data.mimeType !== undefined && data.mimeType !== "text/plain") throw new ObjExportError(code);
  const fileName = data.fileName === undefined ? "model.obj" : data.fileName;
  if (typeof fileName !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}\.obj$/.test(fileName)) throw new ObjExportError(code);
  return { kind: data.kind, fileName };
}

export function exportClock(signal: AbortSignal | undefined, timeoutMs: number) {
  const deadline = performance.now() + timeoutMs;
  const check = () => {
    if (signal?.aborted) throw new ObjExportError("OBJ_EXPORT_ABORTED");
    if (performance.now() >= deadline) throw new ObjExportError("OBJ_EXPORT_DEADLINE_EXCEEDED");
  };
  return {
    check,
    async checkpoint() { check(); await new Promise<void>(resolve => setTimeout(resolve, 0)); check(); },
    async run<T>(operation: () => Promise<T>): Promise<T> {
      check();
      let abort: () => void = () => {};
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await new Promise<T>((resolve, reject) => {
          abort = () => reject(new ObjExportError("OBJ_EXPORT_ABORTED"));
          timer = setTimeout(() => reject(new ObjExportError("OBJ_EXPORT_DEADLINE_EXCEEDED")), Math.max(1, deadline - performance.now()));
          signal?.addEventListener("abort", abort, { once: true });
          operation().then(resolve, reject);
        });
      } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
    },
  };
}

/** Internal, fixed report category; contains no authored value. */
export class ObjExportRejection extends Error {
  public constructor(public readonly code: "OBJ_EXPORT_UNSUPPORTED_DATA" | "OBJ_EXPORT_INVALID_REFERENCE" | "OBJ_EXPORT_LIMIT_EXCEEDED") { super(code); }
}
export function exportLimit(exceeded: boolean): void { if (exceeded) throw new ObjExportRejection("OBJ_EXPORT_LIMIT_EXCEEDED"); }
