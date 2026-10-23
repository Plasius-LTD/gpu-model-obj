/** Package identity and rollout metadata for the initial repository baseline. */
export const packageName = "@plasius/gpu-model-obj" as const;

export const packageBootstrap = Object.freeze({
  packageName,
  featureFlag: "gpu.model.conversion.enabled",
  status: "bootstrap",
} as const);

export { parseObj } from "./parser.js";
export { createObjRuntimeAdapter } from "./runtime-adapter.js";
export { OBJ_PARSER_LIMITS, ObjImportError } from "./policy.js";
export type { ObjParserLimits, ObjParseOptions, ObjImportErrorCode } from "./policy.js";

export { exportObj, OBJ_EXPORT_TARGET_KINDS } from "./exporter.js";
export { OBJ_EXPORT_LIMITS, ObjExportError } from "./export-policy.js";
export type { ObjExportLimits, ObjExportOptions, ObjExportErrorCode } from "./export-policy.js";
