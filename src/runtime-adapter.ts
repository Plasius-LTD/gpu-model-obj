import type { ModelAdapter } from "@plasius/gpu-model-runtime";
import { parseObj } from "./parser.js";
import { ObjImportError, parserPolicy, type ObjParseOptions } from "./policy.js";

/** Runtime acquisition bridge. Worker isolation must be supplied by the caller. */
export function createObjRuntimeAdapter(options: Pick<ObjParseOptions, "limits" | "timeoutMs" | "allowLoss"> = {}): ModelAdapter {
  const policy = parserPolicy(options);
  return Object.freeze({
    formatId: "obj",
    supportsWorker: false,
    sniff(input) {
      const prefix = new TextDecoder().decode(input.bytes.subarray(0, 4096));
      return /(?:^|\n)[\t ]*v[\t ]+[+-]?(?:\d|\.)/u.test(prefix) ? 1 : 0;
    },
    async load(input, context) {
      const result = await parseObj(input.bytes, { limits: policy.limits, timeoutMs: policy.timeoutMs, allowLoss: policy.allowLoss, mode: context.mode, signal: context.signal });
      if (!result.document) throw new ObjImportError("OBJ_IMPORT_REJECTED", result.report);
      return { canonicalModel: result.document, diagnostics: result.diagnostics };
    },
  } satisfies ModelAdapter);
}
