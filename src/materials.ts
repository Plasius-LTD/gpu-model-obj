import { MAP_COMMANDS, resourcePaths, resourcePathFromLibrary, encodeResourcePath, resourcePathForLibrary, safeResourcePath, type ObjResourceSession, type ObjTextureReference } from "./resources.js";
import type {
  GpuModelMaterial,
  GpuModelConversionIssue,
  GpuModelDiagnosticMode,
} from "@plasius/gpu-model-core";
import { sha256Hex } from "@plasius/gpu-model-runtime";
import type { ObjGeometryGroup } from "./canonical.js";
import type {
  ObjMaterialLibrary,
  ObjParserLimits,
  parserClock,
} from "./policy.js";
import {
  exportLimit,
  ObjExportRejection,
  type ObjExportLimits,
} from "./export-policy.js";
const ADVANCED_RANGES: Readonly<
  Record<string, readonly [number, number, boolean]>
> = Object.freeze({
  Ka: [0, 1, true],
  Ks: [0, 1, true],
  Tf: [0, 1, true],
  Ns: [0, 1000, false],
  Ni: [0.001, 10, false],
  illum: [0, 10, false],
  sharpness: [0, 1000, false],
  Pr: [0, 1, false],
  Pm: [0, 1, false],
  Ps: [0, 1, false],
  Pc: [0, 1, false],
  Pcr: [0, 1, false],
  aniso: [0, 1, false],
  anisor: [0, 1, false],
});
const encoder = new TextEncoder();
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const safeName = (text: string) =>
  text.length > 0 &&
  text.length <= 256 &&
  text.isWellFormed() &&
  !/[\s#\\\p{Cc}\p{Cf}]/u.test(text);
const scalar = (token: string | undefined) => {
  if (!token || !NUMBER.test(token)) return undefined;
  const n = Number(token);
  return Number.isFinite(n) &&
    (n !== 0 || !/[1-9]/.test(token.split(/[eE]/, 1)[0]!))
    ? n
    : undefined;
};
function material(
  id: string,
  name: string,
  color: readonly number[] = [1, 1, 1],
  alpha = 1,
  emissive: readonly number[] = [0, 0, 0],
): GpuModelMaterial {
  return {
    id,
    name,
    workflow: "metallic-roughness",
    alphaMode: alpha < 1 ? "blend" : "opaque",
    baseColorFactor: [color[0]!, color[1]!, color[2]!, alpha],
    metallicFactor: 0,
    roughnessFactor: 1,
    emissiveFactor: [emissive[0]!, emissive[1]!, emissive[2]!],
    textures: {},
    extensions: {},
    sourceMetadata: {},
  };
}
/** Internal projection through core's material and registered repair contracts. */
export async function importMaterials(
  files: readonly ObjMaterialLibrary[],
  references: readonly string[],
  groups: readonly ObjGeometryGroup[],
  limits: ObjParserLimits,
  mode: GpuModelDiagnosticMode,
  clock: ReturnType<typeof parserClock>,
  emit: (issue: GpuModelConversionIssue) => boolean,
  resources?: ObjResourceSession,
): Promise<{
  materials: GpuModelMaterial[];
  libraryHashes: { name: string; contentHash: string }[];
}> {
  const libraryHashes: { name: string; contentHash: string }[] = [];
  const output: GpuModelMaterial[] = [];
  const byName = new Map<string, GpuModelMaterial>();
  const issue = (code: string, path: string, loss = false) =>
    emit({
      kind: loss ? "loss" : "unsupported",
      code,
      path,
      message: "Material data is outside the declared diffuse MTL profile.",
      ...(loss ? { effect: "dropped" as const } : {}),
    } as GpuModelConversionIssue);
  const table = new Map(files.map((f) => [f.name, f.bytes]));
  let keepGoing = true;
  for (const [fileIndex, name] of [...new Set(references)].entries()) {
    const bytes = table.get(name);
    // Missing files are observed at each used binding below; no implicit resolver.
    if (!bytes) continue;
    libraryHashes.push({ name, contentHash: await sha256Hex(bytes) });
    clock.check();
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      issue("MTL_INVALID_UTF8", `/materialLibraries/${fileIndex}`);
      continue;
    }
    let current:
      | {
          name: string;
          color: number[];
          alpha: number;
          emissive: number[];
          seen: Set<string>;
          maps: ObjTextureReference[];
        }
      | undefined;
    const flush = () => {
      if (current) {
        let m = material(
          `material-${output.length}`,
          current.name,
          current.color,
          current.alpha,
          current.emissive,
        );
        if (resources) m = { ...m, sourceMetadata: { objMaterialLibrary: name, objTextureReferences: current.maps.map(r => ({ ...r })) } };
        output.push(m);
        byName.set(current.name, m);
      }
    };
    let start = 0;
    let lineNumber = 0;
    for (let end = 0; end <= text.length && keepGoing; end++) {
      const atEnd = end === text.length || text.charCodeAt(end) === 10;
      const contentLength =
        end -
        start -
        (atEnd && end > start && text.charCodeAt(end - 1) === 13 ? 1 : 0);
      if (contentLength > limits.maxLineBytes) {
        issue(
          "MTL_LIMIT_EXCEEDED",
          `/materialLibraries/${fileIndex}/lines/${lineNumber + 1}`,
        );
        keepGoing = false;
        break;
      }
      if (end < text.length && text.charCodeAt(end) !== 10) continue;
      lineNumber++;
      if (lineNumber % 128 === 0) await clock.checkpoint();
      clock.check();
      const physical = text.slice(start, end).replace(/\r$/, "");
      start = end + 1;
      const path = `/materialLibraries/${fileIndex}/lines/${lineNumber}`;
      if (encoder.encode(physical).byteLength > limits.maxLineBytes) {
        issue("MTL_LIMIT_EXCEEDED", path);
        keepGoing = false;
        break;
      }
      const record = physical.split("#", 1)[0]!;
      if (/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(record.replace(/\t/g, ""))) {
        keepGoing = issue("MTL_INVALID_TEXT", path);
        continue;
      }
      const tokens = record.trim().split(/[\t ]+/);
      const command = tokens.shift()!;
      if (!command) continue;
      if (command === "newmtl") {
        flush();
        current = undefined;
        if (tokens.length !== 1 || !safeName(tokens[0]!)) {
          keepGoing = issue("MTL_INVALID_NAME", path);
          continue;
        }
        if (byName.has(tokens[0]!)) {
          keepGoing = issue("MTL_DUPLICATE_MATERIAL", path);
          continue;
        }
        if (output.length >= limits.maxMaterials) {
          issue("MTL_LIMIT_EXCEEDED", path);
          keepGoing = false;
          break;
        }
        current = {
          name: tokens[0]!,
          color: [1, 1, 1],
          alpha: 1,
          emissive: [0, 0, 0],
          seen: new Set(),
          maps: [],
        };
        continue;
      }
      if (!current) {
        keepGoing = issue("MTL_MISSING_DECLARATION", path);
        continue;
      }
      if (resources && MAP_COMMANDS.has(command)) {
        const paths = resourcePaths(physical.trim().slice(command.length).trim(), false);
        const identity = paths?.length === 1 ? resourcePathFromLibrary(name, paths[0]!) : undefined;
        if (!identity || current.seen.has(command)) { keepGoing = issue("MTL_INVALID_RESOURCE_REFERENCE", path); continue; }
        current.seen.add(command); current.maps.push({ command, path: identity });
        await resources.acquire(identity, "texture"); clock.check();
      } else if (["Kd", "Ke", "d", "Tr"].includes(command)) {
        const key = command === "Tr" ? "d" : command;
        if (current.seen.has(key)) {
          keepGoing = issue("MTL_INVALID_VALUE", path);
          continue;
        }
        current.seen.add(key);
        const values = tokens.map(scalar);
        const rgb = command === "Kd" || command === "Ke";
        if (
          !(rgb ? [1, 3].includes(values.length) : values.length === 1) ||
          values.some(
            (v) => v === undefined || v < 0 || (command !== "Ke" && v > 1),
          )
        ) {
          keepGoing = issue("MTL_INVALID_VALUE", path);
          continue;
        }
        const numbers = values as number[];
        const value = numbers[0]!;
        if (command === "Kd")
          current.color =
            numbers.length === 1 ? Array(3).fill(numbers[0]) : numbers;
        else if (command === "Ke")
          current.emissive =
            numbers.length === 1 ? Array(3).fill(numbers[0]) : numbers;
        else if (command === "Tr" && value !== 0 && 1 - value === 1) {
          keepGoing = issue("MTL_INVALID_VALUE", path);
        } else current.alpha = command === "Tr" ? 1 - value : value;
      } else {
        const range = Object.hasOwn(ADVANCED_RANGES, command)
          ? ADVANCED_RANGES[command]
          : undefined;
        if (
          !tokens.length ||
          (range &&
            (!(range[2]
              ? [1, 3].includes(tokens.length)
              : tokens.length === 1) ||
              tokens
                .map(scalar)
                .some((v) => v === undefined || v < range[0] || v > range[1]) ||
              (command === "illum" && !Number.isInteger(Number(tokens[0])))))
        ) {
          keepGoing = issue("MTL_INVALID_VALUE", path);
          continue;
        }
        // Unknown/advanced numeric semantics and textures are never silently consumed.
        keepGoing = issue("MTL_UNSUPPORTED_PROPERTY", path, true);
      }
    }
    flush();
    if (!keepGoing) break;
  }
  let fallback: GpuModelMaterial | undefined;
  for (const [index, group] of groups.entries()) {
    if (
      !group.materialName ||
      (group.materialName === "off" && !byName.has("off"))
    )
      continue;
    const found = byName.get(group.materialName);
    if (found) {
      group.materialId = found.id;
      continue;
    }
    if (!fallback) {
      if (output.length >= limits.maxMaterials) {
        issue("MTL_LIMIT_EXCEEDED", "/materials");
        break;
      }
      fallback = material(`material-${output.length}`, "default");
      output.push(fallback);
    }
    group.materialId = fallback.id;
    const path = `/meshes/0/primitives/${index}/materialId`;
    if (
      !emit({
        kind: "violation",
        code: "MTL_MISSING_MATERIAL",
        ruleId: "malformed-material-reference",
        path,
        message:
          "Referenced material definition is unavailable; canonical default assigned.",
        originalValue: { primitive: index },
        repairApplied: mode !== "strict",
      })
    )
      break;
    if (
      !emit({
        kind: "loss",
        effect: "approximated",
        code: "MTL_DEFAULT_MATERIAL",
        path,
        message:
          "Missing material appearance replaced by the canonical default.",
      })
    )
      break;
  }
  clock.check();
  return { materials: output, libraryHashes };
}

/** Shared target-profile predicate; never reads payload bytes or source metadata. */
export function hasAdvancedMaterialSemantics(m: GpuModelMaterial): boolean {
  return (
    m.workflow !== "metallic-roughness" ||
    (m.metallicFactor ?? 0) !== 0 ||
    (m.roughnessFactor ?? 1) !== 1 ||
    m.alphaMode === "mask" ||
    (m.alphaMode === "opaque" && m.baseColorFactor[3] !== 1) ||
    m.doubleSided === true ||
    Object.keys(m.extensions).length > 0 ||
    Object.keys(m.textures).length > 0 ||
    m.transmissionFactor !== undefined ||
    m.clearcoatFactor !== undefined ||
    m.clearcoatRoughnessFactor !== undefined ||
    m.sheenColorFactor !== undefined ||
    m.sheenRoughnessFactor !== undefined ||
    m.normalScale !== undefined ||
    m.occlusionStrength !== undefined
  );
}

/** Deterministic paired material bytes; no filesystem or network work. */
export function exportMaterials(
  materials: readonly GpuModelMaterial[],
  limits: ObjExportLimits,
  issues: GpuModelConversionIssue[],
  library?: string,
) {
  exportLimit(materials.length > limits.maxMaterials);
  const names = new Map<string, string>();
  const used = new Set<string>();
  const counts = new Map<string, number>();
  for (const m of materials)
    if (m.name) counts.set(m.name, (counts.get(m.name) ?? 0) + 1);
  // Reserve authored unique safe names before allocating fallback identifiers.
  for (const m of materials)
    if (
      m.name &&
      safeName(m.name) &&
      m.name !== "off" &&
      counts.get(m.name) === 1
    ) {
      names.set(m.id, m.name);
      used.add(m.name);
    }
  for (const m of materials)
    if (!names.has(m.id)) {
      let name = m.id;
      let suffix = 0;
      while (used.has(name)) name = `mtl-${suffix++}-${m.id}`;
      if (!safeName(name))
        throw new ObjExportRejection("OBJ_EXPORT_INVALID_REFERENCE");
      names.set(m.id, name);
      used.add(name);
    }
  const lines = ["# plasius diffuse MTL export 1\n"];
  let size = encoder.encode(lines[0]).byteLength;
  const emit = (text: string) => {
    size += encoder.encode(text).byteLength;
    exportLimit(size > limits.maxOutputBytes);
    lines.push(text);
  };
  for (const [index, m] of materials.entries()) {
    const advanced = hasAdvancedMaterialSemantics(m);
    if (m.name !== undefined && names.get(m.id) !== m.name)
      issues.push({
        kind: "loss",
        effect: "dropped",
        code: "MTL_EXPORT_NAME_CHANGED",
        path: `/materials/${index}/name`,
        message:
          "Unrepresentable or duplicate display name replaced by a unique material identifier.",
      });
    if (advanced)
      issues.push({
        kind: "loss",
        effect: "approximated",
        code: "MTL_EXPORT_ADVANCED_MATERIAL",
        path: `/materials/${index}`,
        message:
          "Advanced material semantics approximated by the diffuse MTL profile.",
      });
    const color = m.baseColorFactor
      .slice(0, 3)
      .map((v) => (v === 0 ? 0 : v))
      .join(" ");
    const emissive = (m.emissiveFactor ?? [0, 0, 0])
      .map((v) => (v === 0 ? 0 : v))
      .join(" ");
    const alpha = m.alphaMode === "opaque" ? 1 : m.baseColorFactor[3];
    emit(
      `newmtl ${names.get(m.id)!}\nKd ${color}\nKe ${emissive}\nd ${alpha === 0 ? 0 : alpha}\n\n`,
    );
    if (library !== undefined) {
      const refs = m.sourceMetadata.objTextureReferences;
      if (!Array.isArray(refs) || refs.length > 32) throw new ObjExportRejection("OBJ_EXPORT_INVALID_REFERENCE");
      const commands = new Set<string>();
      for (const ref of refs) {
        if (!ref || typeof ref !== "object" || Array.isArray(ref)) throw new ObjExportRejection("OBJ_EXPORT_INVALID_REFERENCE");
        const command = ref.command; const path = ref.path;
        if (typeof command !== "string" || !MAP_COMMANDS.has(command) || commands.has(command) || !safeResourcePath(path)) throw new ObjExportRejection("OBJ_EXPORT_INVALID_REFERENCE");
        commands.add(command);
        const relative = resourcePathForLibrary(library, path);
        if (!relative) throw new ObjExportRejection("OBJ_EXPORT_INVALID_REFERENCE");
        emit(command + " " + encodeResourcePath(relative) + "\n");
      }
    }
  }
  exportLimit(size > limits.maxOutputBytes);
  return { names, bytes: encoder.encode(lines.join("")) };
}
