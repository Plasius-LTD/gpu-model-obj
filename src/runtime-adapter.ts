import type { ModelAdapter } from "@plasius/gpu-model-runtime";
import { parseObj } from "./parser.js";
import { ObjImportError, parserPolicy, type ObjParseOptions } from "./policy.js";

/** Runtime acquisition bridge. Worker isolation must be supplied by the caller. */
export function createObjRuntimeAdapter(options: Pick<ObjParseOptions, "limits" | "timeoutMs" | "allowLoss" | "missingNormals"> & { readonly resolveResources?: boolean } = {}): ModelAdapter {
  if (!options || typeof options !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(options))) throw new ObjImportError("OBJ_INVALID_OPTIONS");
  const parseOptions: Record<string, unknown> = {}; let resolveResources: unknown;
  for (const key of Reflect.ownKeys(options)) {
    if (typeof key !== "string" || !["limits", "timeoutMs", "allowLoss", "resolveResources", "missingNormals"].includes(key)) throw new ObjImportError("OBJ_INVALID_OPTIONS");
    const descriptor = Object.getOwnPropertyDescriptor(options, key)!;
    if (!("value" in descriptor)) throw new ObjImportError("OBJ_INVALID_OPTIONS");
    if (key === "resolveResources") resolveResources = descriptor.value; else parseOptions[key] = descriptor.value;
  }
  if (resolveResources !== undefined && typeof resolveResources !== "boolean") throw new ObjImportError("OBJ_INVALID_OPTIONS");
  const policy = parserPolicy(parseOptions);
  return Object.freeze({
    formatId: "obj",
    supportsWorker: false,
    sniff(input) {
      const prefix = new TextDecoder().decode(input.bytes.subarray(0, 4096));
      return /(?:^|\n)[\t ]*v[\t ]+[+-]?(?:\d|\.)/u.test(prefix) ? 1 : 0;
    },
    async load(input, context) {
      const result = await parseObj(input.bytes, { limits: policy.limits, timeoutMs: policy.timeoutMs, allowLoss: policy.allowLoss, missingNormals: policy.missingNormals, mode: context.mode, signal: context.signal, ...(resolveResources ? { resources: { resolver: input.resourceResolver } } : {}) });
      if (!result.document) throw new ObjImportError("OBJ_IMPORT_REJECTED", result.report);
      return { canonicalModel: result.document, diagnostics: result.diagnostics };
    },
  } satisfies ModelAdapter);
}
