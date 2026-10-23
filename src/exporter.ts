import { safeResourcePath, encodeResourcePath } from "./resources.js";
import { createModelResultBase, isGpuModelDocument, type GpuModelDocument, type GpuModelConversionIssue, type GpuModelMetadataValue, type ModelTarget, type ModelExportResult } from "@plasius/gpu-model-core";
import { exportPolicy, exportTarget, exportClock, exportLimit, ObjExportError, ObjExportRejection, type ObjExportOptions } from "./export-policy.js";
import { exportMaterials } from "./materials.js";
import type { ObjMaterialLibrary } from "./policy.js";
import { exportScene, geometryReader, worldVector } from "./export-geometry.js";

/** Declared target support; no file, stream, resolver or archive writer is bundled. */
export const OBJ_EXPORT_TARGET_KINDS = Object.freeze(["uint8-array", "array-buffer", "blob"] as const);
const encoder = new TextEncoder();
// Match core's native Blob boundary; ignore caller-added payload methods.
const resourceArrayBuffer = Blob.prototype.arrayBuffer;
function reference(value: GpuModelMetadataValue | undefined, fallback: string, token = false): string {
  const text = value === undefined ? fallback : value;
  if (typeof text !== "string" || !text || text.length > 256 || text !== text.trim() || Array.from(text).some(character => { const point = character.codePointAt(0)!; return character === "#" || character === "\\" || point < 32 || point >= 127 && point <= 159 || point >= 0x2028 && point <= 0x202e || point >= 0x2066 && point <= 0x2069; }) || token && /\s/u.test(text)) throw new ObjExportRejection("OBJ_EXPORT_INVALID_REFERENCE");
  return text;
}

/** Core export result with optional actual material-file bytes. */
export interface ObjExportResult extends ModelExportResult { readonly materialLibrary?: ObjMaterialLibrary; readonly materialLibraries?: readonly ObjMaterialLibrary[] }

/** Export branded canonical triangle geometry through core's in-memory contracts.
 * Unsupported fidelity produces a rejected report and no output. Materials export
 * as references by default; includeMaterials returns paired MTL bytes.
 */
export const exportObj: (document: GpuModelDocument, target: ModelTarget, options?: ObjExportOptions) => Promise<ObjExportResult> = async (document, target, options = {}) => {
  const policy = exportPolicy(options); const destination = exportTarget(target);
  const clock = exportClock(policy.signal, policy.timeoutMs); clock.check();
  if (!isGpuModelDocument(document)) throw new ObjExportError("OBJ_EXPORT_INVALID_DOCUMENT");
  const issues: GpuModelConversionIssue[] = [];
  const result = (): ModelExportResult => ({ ...createModelResultBase({ standard: "obj-mtl", mode: policy.mode, allowLoss: policy.allowLoss, issues, ...(policy.mode === "forensic" ? { rawSource: { nodeCount: document.nodes.length, resourceCount: document.resources.length }, maxEvidenceBytes: 65536 } : {}) }), target: destination.kind });
  try {
    const scene = exportScene(document, policy.limits);
    let totalBytes = 0;
    for (const resource of document.resources) { totalBytes += resource.byteLength; exportLimit(totalBytes > policy.limits.maxResourceBytes); }
    if (policy.includeMaterials && scene.some(({ primitive }) => !primitive.materialId && primitive.metadata?.materialName !== undefined && primitive.metadata.materialName !== "off")) throw new ObjExportRejection("OBJ_EXPORT_UNSUPPORTED_DATA");
    const resourceProfile = document.metadata.objResourceReferences;
    let identities: { path: string; role: "material" | "texture"; status: "available" | "unresolved" }[] | undefined;
    if (resourceProfile !== undefined) {
      if (!Array.isArray(resourceProfile) || resourceProfile.length > 32) throw new ObjExportRejection("OBJ_EXPORT_INVALID_REFERENCE");
      exportLimit(resourceProfile.length > policy.limits.maxResources);
      const seen = new Set<string>(); identities = [];
      for (const item of resourceProfile) {
        if (!item || typeof item !== "object" || Array.isArray(item) || !safeResourcePath(item.path) || item.role !== "material" && item.role !== "texture" || item.role === "material" && !item.path.endsWith(".mtl") || item.status !== "available" && item.status !== "unresolved" || seen.has(item.path) || item.path === destination.fileName) throw new ObjExportRejection("OBJ_EXPORT_INVALID_REFERENCE");
        seen.add(item.path); identities.push({ path: item.path, role: item.role, status: item.status });
      }
    }
    if (identities?.some(r => r.role === "texture")) issues.push({ kind: "warning", code: "OBJ_EXPORT_EXTERNAL_TEXTURES", path: "/resources", message: "Texture identities are retained; image payloads must be supplied separately by the caller." });
    const paired = policy.includeMaterials;
    const materialFiles: ObjMaterialLibrary[] = [];
    const materialNames = new Map<string, string>();
    if (paired) exportLimit(document.materials.length > policy.limits.maxMaterials);
    if (paired && identities) {
      const libraryPaths = identities.filter(r => r.role === "material").map(r => r.path);
      for (const m of document.materials) {
        if (typeof m.sourceMetadata.objMaterialLibrary !== "string" || !libraryPaths.includes(m.sourceMetadata.objMaterialLibrary)) throw new ObjExportRejection("OBJ_EXPORT_INVALID_REFERENCE");
        const refs = m.sourceMetadata.objTextureReferences;
        if (!Array.isArray(refs) || refs.some(ref => !ref || typeof ref !== "object" || Array.isArray(ref) || !identities!.some(i => i.role === "texture" && i.path === ref.path))) throw new ObjExportRejection("OBJ_EXPORT_INVALID_REFERENCE");
      }
      const emittedNames = new Set<string>();
      for (const path of libraryPaths) {
        const materials = document.materials.filter(m => m.sourceMetadata.objMaterialLibrary === path);
        if (!materials.length && identities.find(i => i.path === path)!.status === "unresolved") continue;
        const output = exportMaterials(materials, policy.limits, issues, path);
        materialFiles.push({ name: path, bytes: output.bytes });
        for (const [id, name] of output.names) { if (emittedNames.has(name)) throw new ObjExportRejection("OBJ_EXPORT_INVALID_REFERENCE"); emittedNames.add(name); materialNames.set(id, name); }
      }
    } else if (paired) {
      const output = exportMaterials(document.materials, policy.limits, issues);
      materialFiles.push({ name: "model.mtl", bytes: output.bytes });
      for (const [id, name] of output.names) materialNames.set(id, name);
    }
    const materialBytes = materialFiles.reduce((total, file) => total + file.bytes.byteLength, 0);
    exportLimit(materialBytes > policy.limits.maxOutputBytes);
    if (document.materials.length && !policy.includeMaterials) issues.push({ kind: "loss", effect: "dropped", code: "OBJ_EXPORT_MTL_DEFINITIONS_OMITTED", message: "Material references are preserved; material definitions require the MTL exporter.", path: "/materials" });
    if (!result().report.accepted) return result();
    const buffers = new Map<string, DataView>();
    for (const resource of document.resources) {
      clock.check();
      if (resource.kind === "buffer") buffers.set(resource.id, new DataView(await clock.run(() => Reflect.apply(resourceArrayBuffer, resource.payload, []) as Promise<ArrayBuffer>)));
      clock.check();
    }
    const read = geometryReader(document, buffers);
    const lines: string[] = []; let outputBytes = materialBytes; let outputVertices = 0;
    const elements = { v: new Map<string, number>(), vt: new Map<string, number>(), vn: new Map<string, number>() };
    const emit = (line: string) => { const record = line + "\n"; outputBytes += encoder.encode(record).byteLength; exportLimit(outputBytes > policy.limits.maxOutputBytes); lines.push(record); };
    const element = (kind: keyof typeof elements, values: readonly number[]) => {
      if (values.some(v => !Number.isFinite(v))) throw new ObjExportRejection("OBJ_EXPORT_UNSUPPORTED_DATA");
      const key = values.map(v => v === 0 ? 0 : v).join(" ");
      const existing = elements[kind].get(key);
      if (existing !== undefined) return existing;
      exportLimit(elements.v.size + elements.vt.size + elements.vn.size >= policy.limits.maxSourceElements);
      const index = elements[kind].size + 1;
      emit(kind + " " + key); elements[kind].set(key, index); return index;
    };
    emit("# plasius OBJ triangle export 1");
    if (paired) for (const path of identities ? identities.filter(r => r.role === "material").map(r => r.path) : ["model.mtl"]) emit("mtllib " + encodeResourcePath(path));
    const libraries = paired ? undefined : document.metadata.materialLibraries;
    if (libraries !== undefined) {
      if (!Array.isArray(libraries) || libraries.length > 32) throw new ObjExportRejection("OBJ_EXPORT_INVALID_REFERENCE");
      for (const library of libraries) {
        if (identities) { if (!safeResourcePath(library)) throw new ObjExportRejection("OBJ_EXPORT_INVALID_REFERENCE"); emit("mtllib " + encodeResourcePath(library)); }
        else emit("mtllib " + reference(library, "", true));
      }
    }
    let previousObject: string | undefined; let previousMaterial = "";
    for (const entry of scene) {
      await clock.checkpoint();
      const primitive = entry.primitive; const metadata = primitive.metadata;
      const object = reference(metadata?.objectName, entry.objectFallback);
      if (object !== previousObject) { emit("o " + object); previousObject = object; }
      const groups = metadata?.groups ?? [];
      if (!Array.isArray(groups) || groups.length > 16 || groups.map(g => typeof g === "string" ? g : "").join(" ").length > 256) throw new ObjExportRejection("OBJ_EXPORT_INVALID_REFERENCE");
      emit("g" + (groups.length ? " " + groups.map(g => reference(g, "", true)).join(" ") : ""));
      // Binding IDs, rather than non-unique display names, preserve material identity.
      const material = primitive.materialId ? reference(materialNames.get(primitive.materialId) ?? primitive.materialId, "") : metadata?.materialName === undefined ? "" : reference(metadata.materialName, "");
      if (material || previousMaterial) emit("usemtl " + (material || "off"));
      previousMaterial = material;
      emit("s " + reference(metadata?.smoothing, "off"));
      const reader = read(primitive); exportLimit(outputVertices + reader.count > policy.limits.maxOutputVertices); outputVertices += reader.count;
      for (let face = 0; face < reader.count; face += 3) {
        if (face % 384 === 0) await clock.checkpoint();
        const corners = [0, entry.determinant < 0 ? 2 : 1, entry.determinant < 0 ? 1 : 2].map(i => reader.corner(face + i));
        const faceIndices: string[] = [];
        for (const corner of corners) {
          const position = element("v", worldVector(corner.position, entry.world, entry.determinant, false));
          const uv = corner.uv ? element("vt", corner.uv) : undefined;
          const normal = corner.normal ? element("vn", worldVector(corner.normal, entry.world, entry.determinant, true)) : undefined;
          faceIndices.push(uv ? `${position}/${uv}${normal ? `/${normal}` : ""}` : normal ? `${position}//${normal}` : String(position));
        }
        emit("f " + faceIndices.join(" "));
      }
    }
    clock.check(); const bytes = encoder.encode(lines.join("")); clock.check();
    const output = destination.kind === "blob" ? new Blob([bytes.buffer], { type: "text/plain" }) : destination.kind === "array-buffer" ? bytes.buffer : bytes;
    return { ...result(), output, ...(paired ? { materialLibraries: materialFiles, ...(materialFiles.length === 1 ? { materialLibrary: materialFiles[0]! } : {}) } : {}), resourcePackage: { format: identities?.some(r => r.role === "texture" || !materialFiles.some(f => f.name === r.path)) ? "directory-manifest" : "inline", entries: [
      { id: "obj", role: "mesh", path: destination.fileName, contentType: "text/plain" },
      ...(identities ? identities.map((r, i) => ({ id: `external-${i}`, role: r.role, path: r.path, ...(r.role === "material" ? { contentType: "text/plain" } : {}) })) : materialFiles.map((f, i) => ({ id: i === 0 ? "mtl" : `mtl-${i}`, role: "material" as const, path: f.name, contentType: "text/plain" }))),
    ] } };

  } catch (error) {
    clock.check();
    if (error instanceof ObjExportError) throw error;
    if (!(error instanceof ObjExportRejection)) throw new ObjExportError("OBJ_EXPORT_RESOURCE_FAILED");
    issues.push({ kind: "unsupported", code: error.code, message: "Canonical data cannot be represented within the declared OBJ export profile.", path: "/export" });
    return result();
  }
};
