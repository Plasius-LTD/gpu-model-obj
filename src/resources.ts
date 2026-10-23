import type { GpuModelConversionIssue, GpuModelDiagnosticMode } from "@plasius/gpu-model-core";
import { sha256Hex, type ResourceResolver } from "@plasius/gpu-model-runtime";
import { ObjImportError, type ObjMaterialLibrary, type ObjParserLimits, type parserClock } from "./policy.js";

/** Explicit resource-reference preservation. Only the injected port may read bytes. */
export interface ObjResourceOptions { readonly resolver?: ResourceResolver }
/** Inert package-root identity; available means byte/hash verification, never image decoding. */
export interface ObjResourceReference {
  readonly path: string;
  readonly role: "material" | "texture";
  readonly status: "available" | "unresolved";
  readonly contentHash?: string;
}
export interface ObjTextureReference { readonly command: string; readonly path: string }
export const MAP_COMMANDS: ReadonlySet<string> = new Set(["map_Ka", "map_Kd", "map_Ks", "map_Ke", "map_Ns", "map_d", "bump", "map_bump", "disp", "decal", "norm", "map_Pr", "map_Pm", "map_Ps"]);
/** This bounded portable profile rejects rather than normalizes ambiguous paths. */
export function safeResourcePath(path: unknown): path is string {
  return typeof path === "string" && path.length <= 256 && path.split("/").every(segment => segment.length > 0 && segment !== "." && segment !== ".." && /^[A-Za-z0-9_. -]+$/.test(segment) && segment === segment.trim() && !segment.startsWith("-") && !segment.endsWith("."));
}
/** Quoting/backslash-space are syntax only; stored paths contain literal spaces. */
export function resourcePaths(raw: string, multiple: boolean): string[] | undefined {
  const paths: string[] = []; let token = ""; let quoted = false; let closed = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!;
    if (c === '"') { if (!quoted && token) return; quoted = !quoted; closed = !quoted; continue; }
    if (c === "\\") { if (raw[i + 1] !== " ") return; token += " "; i++; continue; }
    if (c === "#") { if (quoted || i > 0 && !/[\t ]/.test(raw[i - 1]!)) return; break; }
    if (!quoted && /[\t ]/.test(c) && multiple) { if (token) { paths.push(token); token = ""; } closed = false; continue; }
    if (closed && !/[\t ]/.test(c)) return;
    token += c;
  }
  if (quoted) return;
  if (token.trim()) paths.push(token.trim());
  return paths.length && paths.every(safeResourcePath) ? paths : undefined;
}
export function encodeResourcePath(path: string): string { return path.includes(" ") ? '"' + path + '"' : path; }
export function resourcePathFromLibrary(library: string, path: string): string | undefined {
  const rootPath = library.slice(0, library.lastIndexOf("/") + 1) + path;
  return safeResourcePath(rootPath) ? rootPath : undefined;
}
/** No upward traversal is emitted; external paths must remain under the library. */
export function resourcePathForLibrary(library: string, path: string): string | undefined {
  const directory = library.slice(0, library.lastIndexOf("/") + 1);
  if (!safeResourcePath(path) || !path.startsWith(directory)) return;
  const relative = path.slice(directory.length); return safeResourcePath(relative) ? relative : undefined;
}
export function resourceSession(files: readonly ObjMaterialLibrary[], limits: ObjParserLimits, mode: GpuModelDiagnosticMode, clock: ReturnType<typeof parserClock>, emit: (issue: GpuModelConversionIssue) => boolean, initialBytes: number, resolver?: ResourceResolver) {
  const entries: ObjResourceReference[] = []; const table = new Map(files.map(f => [f.name, f.bytes]));
  const cache = new Map<string, Uint8Array | undefined>(); let usedBytes = initialBytes;
  const fail = (code: string) => { emit({ kind: "unsupported", code, path: "/resources", message: "Resource data violates the bounded relative-reference contract." }); };
  const acquire = async (path: string, role: "material" | "texture"): Promise<Uint8Array | undefined> => {
    clock.check();
    if (cache.has(path)) {
      if (entries.find(e => e.path === path)!.role !== role) fail("OBJ_RESOURCE_CONFLICT");
      return cache.get(path);
    }
    if (!safeResourcePath(path)) { fail("OBJ_UNSAFE_RESOURCE_PATH"); return; }
    if (entries.length >= limits.maxReferences) { fail("OBJ_RESOURCE_LIMIT"); return; }
    const index = entries.length;
    entries.push({ path, role, status: "unresolved" }); cache.set(path, undefined);
    let bytes = role === "material" ? table.get(path) : undefined;
    let hash: string | undefined;
    if (!bytes && resolver) {
      const remaining = limits.maxInputBytes - usedBytes;
      if (remaining < 1) { fail("OBJ_RESOURCE_LIMIT"); return; }
      try {
        const result = await clock.run(signal => resolver.resolve(path, { signal, maxBytes: remaining }));
        clock.check();
        if (!result || result.path !== path || !(result.bytes instanceof Uint8Array) || result.bytes.byteLength > remaining || !/^[a-f0-9]{64}$/.test(result.contentHash)) { fail("OBJ_INVALID_RESOURCE"); return; }
        bytes = new Uint8Array(result.bytes); usedBytes += bytes.byteLength;
        hash = await sha256Hex(bytes); clock.check();
        if (hash !== result.contentHash) { fail("OBJ_INVALID_RESOURCE"); return; }
      } catch (error) {
        clock.check(); if (error instanceof ObjImportError) throw error;
        // Port details are private; absence is a controlled unresolved identity.
      }
    }
    if (bytes && hash === undefined) { hash = await sha256Hex(bytes); clock.check(); }
    entries[index] = { path, role, status: bytes ? "available" : "unresolved", ...(hash ? { contentHash: hash } : {}) }; cache.set(path, bytes);
    if (bytes && role === "texture") emit({ kind: "warning", code: "MTL_TEXTURE_REFERENCE_ONLY", path: "/resources", message: "Texture bytes were identified; image decoding and renderer bindings are outside this reference profile." });
    if (!bytes) {
      if (role === "material") emit({ kind: "warning", code: "OBJ_MISSING_LIBRARY", path: "/resources", message: "Referenced material library remains unresolved." });
      else {
        emit({ kind: "violation", ruleId: "missing-texture-path", code: "MTL_MISSING_TEXTURE", path: "/resources", message: "Texture identity is preserved without an available image payload.", originalValue: { resource: index }, repairApplied: mode !== "strict" });
        emit({ kind: "loss", effect: "approximated", code: "MTL_UNRESOLVED_TEXTURE", path: "/resources", message: "Texture identity remains external and the appearance binding is unresolved." });
      }
    }
    return bytes;
  };
  return { entries, acquire };
}
export type ObjResourceSession = ReturnType<typeof resourceSession>;
