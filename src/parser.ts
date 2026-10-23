import { resourcePaths, resourceSession } from "./resources.js";
import { createModelResultBase, type GpuModelConversionIssue, type ModelLoadResult } from "@plasius/gpu-model-core";
import { sha256Hex } from "@plasius/gpu-model-runtime";
import { importMaterials } from "./materials.js";
import { projectObj, type ObjGeometryGroup } from "./canonical.js";
import { parserClock, parserPolicy, ObjImportError, type ObjParseOptions } from "./policy.js";

const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const INDEX = /^[+-]?\d+$/;
const encoder = new TextEncoder();

function numeric(token: string): number | undefined {
  if (!NUMBER.test(token)) return undefined;
  const number = Number(token); const value = Math.fround(number);
  const nonzeroMantissa = /[1-9]/.test(token.split(/[eE]/, 1)[0]!);
  return Number.isFinite(value) && (!nonzeroMantissa || value !== 0) ? value : undefined;
}

function indexOf(token: string, count: number): number | undefined {
  if (!INDEX.test(token)) return undefined;
  const number = Number(token);
  const index = number > 0 ? number - 1 : count + number;
  return number !== 0 && Number.isSafeInteger(number) && index >= 0 && index < count ? index : undefined;
}

function unsafeText(text: string): boolean {
  return Array.from(text).some(character => {
    const point = character.codePointAt(0)!;
    return point < 32 && point !== 9 || point >= 127 && point <= 159 || point >= 0x2028 && point <= 0x202e || point >= 0x2066 && point <= 0x2069;
  });
}

/** Parse an owned, bounded UTF-8 triangle OBJ snapshot into canonical core. */
export async function parseObj(input: Uint8Array, options: ObjParseOptions = {}): Promise<ModelLoadResult> {
  const startedAt = performance.now();
  const { limits, mode, allowLoss, signal, timeoutMs, materialLibraries, resources } = parserPolicy(options);
  const clock = parserClock(signal, timeoutMs, startedAt);
  clock.check();
  if (!(input instanceof Uint8Array)) throw new ObjImportError("OBJ_INVALID_INPUT");
  const sourceBytes = input.byteLength;
  const issues: GpuModelConversionIssue[] = [];
  let stopped = false;
  let lineNumber = 0;
  function issue(code: string, message: string) {
    const value: GpuModelConversionIssue = { kind: "unsupported", code, message, path: `/lines/${lineNumber}` };
    if (issues.length >= limits.maxDiagnostics) {
      issues[limits.maxDiagnostics - 1] = { kind: "unsupported", code: "OBJ_LIMIT_EXCEEDED", message: "Diagnostic count exceeded the parser budget.", path: "/diagnostics" };
      stopped = true;
    } else issues.push(value);
  }
  function limit(exceeded: boolean): boolean {
    if (exceeded) { issue("OBJ_LIMIT_EXCEEDED", "Input or geometry exceeded a declared parser budget."); stopped = true; }
    return exceeded;
  }
  function result(): ModelLoadResult {
    return createModelResultBase({ standard: "obj-mtl", mode, allowLoss, issues,
      ...(mode === "forensic" ? { rawSource: { sourceBytes, linesVisited: lineNumber, issueCount: issues.length }, maxEvidenceBytes: 65536 } : {}),
    });
  }
  if (limit(input.byteLength + (materialLibraries?.reduce((sum, file) => sum + file.bytes.byteLength, 0) ?? 0) > limits.maxInputBytes)) return result();
  // Snapshot before the first await; hashes and parsing observe identical bytes.
  const bytes = new Uint8Array(input.byteLength);
  try { bytes.set(input); }
  catch { throw new ObjImportError("OBJ_INVALID_INPUT"); }
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { issue("OBJ_INVALID_UTF8", "Input is not valid UTF-8."); return result(); }
  const positions: number[][] = []; const uvs: number[][] = []; const normals: number[][] = [];
  const groups: ObjGeometryGroup[] = []; const libraryNames: string[] = [];
  let previousKey: string | undefined;
  let objectName = ""; let groupNames: string[] = []; let materialName = ""; let smoothing = "off";
  let faces = 0; let outputVertices = 0;
  let start = 0;
  for (let end = 0; end <= text.length && !stopped; end++) {
    const atEnd = end === text.length || text.charCodeAt(end) === 10;
    const contentLength = end - start - (atEnd && end > start && text.charCodeAt(end - 1) === 13 ? 1 : 0);
    if (limit(contentLength > limits.maxLineBytes)) break;
    if (end < text.length && text.charCodeAt(end) !== 10) continue;
    lineNumber++;
    if (lineNumber % 128 === 0) await clock.checkpoint();
    clock.check();
    const physical = text.slice(start, end).replace(/\r$/, ""); start = end + 1;
    if (limit(encoder.encode(physical).byteLength > limits.maxLineBytes)) break;
    const record = physical.split("#", 1)[0]!;
    if (unsafeText(record)) { issue("OBJ_INVALID_TEXT", "Record contains unsupported control characters."); continue; }
    const line = record.replace(/^[\t ]+|[\t ]+$/g, "");
    if (!line) continue;
    const tokens = line.split(/[\t ]+/); const command = tokens.shift()!;
    if (["v", "vt", "vn"].includes(command)) {
      if (limit(positions.length + uvs.length + normals.length >= limits.maxSourceElements)) break;
      const values = tokens.map(numeric);
      const size = command === "vt" ? 2 : 3;
      const homogeneous = command === "v" && tokens.length === 4 && Number(tokens[3]) === 1;
      if ((!homogeneous && tokens.length !== size) || values.some(value => value === undefined) || (command === "vn" && values.every(value => value === 0))) {
        issue("OBJ_INVALID_VERTEX", "Source element is malformed or outside the supported finite f32 profile.");
        // Reject the entire import: removing a source element would shift indices.
        stopped = true; break;
      }
      (command === "v" ? positions : command === "vt" ? uvs : normals).push(values.slice(0, size) as number[]);
    } else if (["o", "g", "usemtl", "mtllib", "s"].includes(command)) {
      if (command === "mtllib" && resources) {
        const paths = resourcePaths(physical.trim().slice(command.length).trim(), true);
        if (!paths || paths.some(path => !path.endsWith(".mtl"))) { issue("OBJ_UNSAFE_RESOURCE_PATH", "Material reference violates the relative-path policy."); continue; }
        if (limit(libraryNames.length + paths.length > limits.maxReferences)) break;
        libraryNames.push(...paths); continue;
      }
      const name = tokens.join(" ");
      if ((command !== "g" && !name) || name.length > 256 || (command === "g" && tokens.length > 16)) { issue("OBJ_INVALID_REFERENCE", "Reference name is empty or exceeds the supported profile."); continue; }
      if (command === "o") objectName = name;
      if (command === "g") groupNames = tokens;
      if (command === "usemtl") materialName = name;
      if (command === "s") smoothing = name;
      if (command === "mtllib") {
        if (limit(libraryNames.length + tokens.length > limits.maxReferences)) break;
        libraryNames.push(...tokens);
      }
    } else if (command === "f") {
      if (limit(++faces > limits.maxFaces)) break;
      if (tokens.length !== 3) { issue("OBJ_UNSUPPORTED_TOPOLOGY", "This import profile requires triangle faces; polygon triangulation is a separate policy."); continue; }
      const corners = tokens.map(token => {
        const parts = token.split("/");
        if (parts.length > 3 || !parts[0] || (parts.length === 2 && !parts[1]) || (parts.length === 3 && !parts[2])) return undefined;
        const p = indexOf(parts[0], positions.length);
        const t = parts[1] ? indexOf(parts[1], uvs.length) : undefined;
        const n = parts[2] ? indexOf(parts[2], normals.length) : undefined;
        return p === undefined || (parts[1] && t === undefined) || (parts[2] && n === undefined) ? undefined : { p, t, n };
      });
      if (corners.some(corner => corner === undefined)) {
        if (issues.length + 2 > limits.maxDiagnostics) { limit(true); break; }
        // Only this documented repair is performed: discard the whole face.
        const path = `/lines/${lineNumber}`;
        issues.push({ kind: "violation", ruleId: "invalid-indices", code: "OBJ_INVALID_INDICES", message: "Face contains a zero, malformed or out-of-range index.", path, originalValue: { line: lineNumber, indices: tokens.map(token => token.split("/").slice(0, 3).map(part => INDEX.test(part) && Number.isSafeInteger(Number(part)) ? Number(part) : null)) }, repairApplied: mode !== "strict" });
        issues.push({ kind: "loss", code: "OBJ_FACE_DROPPED", message: "Invalid face was excluded from canonical geometry.", path, effect: "dropped" });
        continue;
      }
      const valid = corners as { p: number; t: number | undefined; n: number | undefined }[];
      if (valid.some(corner => (corner.t === undefined) !== (valid[0]!.t === undefined) || (corner.n === undefined) !== (valid[0]!.n === undefined))) { issue("OBJ_MIXED_ATTRIBUTES", "A face must use consistent texture/normal index presence."); continue; }
      if (limit(outputVertices + 3 > limits.maxOutputVertices)) break;
      const key = JSON.stringify([objectName, groupNames, materialName, smoothing, valid[0]!.t !== undefined, valid[0]!.n !== undefined]);
      let group = previousKey === key ? groups.at(-1) : undefined;
      if (!group) {
        if (limit(groups.length >= limits.maxPrimitiveGroups)) break;
        group = { objectName, groups: groupNames, materialName, smoothing, positions: [], uvs: [], normals: [] };
        previousKey = key; groups.push(group);
      }
      for (const corner of valid) {
        group.positions.push(...positions[corner.p]!);
        if (corner.t !== undefined) group.uvs.push(...uvs[corner.t]!);
        if (corner.n !== undefined) group.normals.push(...normals[corner.n]!);
      }
      outputVertices += 3;
    } else issue("OBJ_UNSUPPORTED_RECORD", "Record is outside the supported OBJ triangle profile.");
  }
  if (!outputVertices && !stopped) issue("OBJ_EMPTY_GEOMETRY", "Input has no surviving triangle geometry.");
  if (stopped || !result().report.accepted) return result();
  const emit = (entry: GpuModelConversionIssue) => {
    if (issues.length >= limits.maxDiagnostics) {
      issues[limits.maxDiagnostics - 1] = { kind: "unsupported", code: "OBJ_LIMIT_EXCEEDED", message: "Diagnostic count exceeded the parser budget.", path: "/diagnostics" }; stopped = true;
    } else issues.push(entry);
    return !stopped;
  };
  const session = resources ? resourceSession(materialLibraries ?? [], limits, mode, clock, emit, bytes.byteLength + (materialLibraries?.reduce((sum, f) => sum + f.bytes.byteLength, 0) ?? 0), resources.resolver) : undefined;
  const files = [...(materialLibraries ?? [])];
  if (session) for (const name of new Set(libraryNames)) {
    if (stopped) break;
    const library = await session.acquire(name, "material");
    if (library && !files.some(f => f.name === name)) files.push({ name, bytes: library });
  }
  if (stopped || !result().report.accepted) return result();
  const materials = materialLibraries === undefined && !resources ? { materials: [], libraryHashes: [] } : await importMaterials(files, libraryNames, groups, limits, mode, clock, emit, session);
  const base = result();
  if (!base.report.accepted || stopped) return base;
  await clock.checkpoint();
  try {
    const sourceHash = await sha256Hex(bytes); clock.check();
    const document = await projectObj(groups, libraryNames, sourceHash, clock.check, clock.checkpoint, signal, materials.materials, materials.libraryHashes, session?.entries);
    clock.check();
    return Object.freeze({ ...base, document });
  } catch (error) {
    clock.check();
    if (error instanceof ObjImportError) throw error;
    throw new ObjImportError("OBJ_CANONICAL_VALIDATION_FAILED");
  }
}
