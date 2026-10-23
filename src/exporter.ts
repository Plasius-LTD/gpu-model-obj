import { createModelResultBase, isGpuModelDocument, type GpuModelDocument, type GpuModelConversionIssue, type GpuModelMetadataValue, type ModelTarget, type ModelExportResult, type ModelAdapter } from "@plasius/gpu-model-core";
import { exportPolicy, exportTarget, exportClock, exportLimit, ObjExportError, ObjExportRejection, type ObjExportOptions } from "./export-policy.js";
import { exportScene, geometryReader, worldVector } from "./export-geometry.js";

/** Declared target support; no file, stream, resolver or archive writer is bundled. */
export const OBJ_EXPORT_TARGET_KINDS = Object.freeze(["uint8-array", "array-buffer", "blob"] as const);
const encoder = new TextEncoder();
function reference(value: GpuModelMetadataValue | undefined, fallback: string, token = false): string {
  const text = value === undefined ? fallback : value;
  if (typeof text !== "string" || !text || text.length > 256 || text !== text.trim() || Array.from(text).some(character => { const point = character.codePointAt(0)!; return character === "#" || character === "\\" || point < 32 || point >= 127 && point <= 159 || point >= 0x2028 && point <= 0x202e || point >= 0x2066 && point <= 0x2069; }) || token && /\s/u.test(text)) throw new ObjExportRejection("OBJ_EXPORT_INVALID_REFERENCE");
  return text;
}

/** Export branded canonical triangle geometry through core's in-memory contracts.
 * Unsupported fidelity produces a rejected report and no output. Materials export
 * as references only, with explicit consent for omitted MTL definitions.
 */
export const exportObj: (document: GpuModelDocument, target: ModelTarget, options?: ObjExportOptions) => ReturnType<ModelAdapter["export"]> = async (document, target, options = {}) => {
  const policy = exportPolicy(options); const destination = exportTarget(target);
  const clock = exportClock(policy.signal, policy.timeoutMs); clock.check();
  if (!isGpuModelDocument(document)) throw new ObjExportError("OBJ_EXPORT_INVALID_DOCUMENT");
  const issues: GpuModelConversionIssue[] = [];
  const result = (): ModelExportResult => ({ ...createModelResultBase({ standard: "obj-mtl", mode: policy.mode, allowLoss: policy.allowLoss, issues, ...(policy.mode === "forensic" ? { rawSource: { nodeCount: document.nodes.length, resourceCount: document.resources.length }, maxEvidenceBytes: 65536 } : {}) }), target: destination.kind });
  try {
    const scene = exportScene(document, policy.limits);
    let totalBytes = 0;
    for (const resource of document.resources) { totalBytes += resource.byteLength; exportLimit(totalBytes > policy.limits.maxResourceBytes); }
    if (document.materials.length) issues.push({ kind: "loss", effect: "dropped", code: "OBJ_EXPORT_MTL_DEFINITIONS_OMITTED", message: "Material references are preserved; material definitions require the MTL exporter.", path: "/materials" });
    if (!result().report.accepted) return result();
    const buffers = new Map<string, DataView>();
    for (const resource of document.resources) {
      clock.check();
      if (resource.kind === "buffer") buffers.set(resource.id, new DataView(await clock.run(() => resource.payload.arrayBuffer())));
      clock.check();
    }
    const read = geometryReader(document, buffers);
    const lines: string[] = []; let outputBytes = 0; let outputVertices = 0;
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
    const libraries = document.metadata.materialLibraries;
    if (libraries !== undefined) {
      if (!Array.isArray(libraries) || libraries.length > 32) throw new ObjExportRejection("OBJ_EXPORT_INVALID_REFERENCE");
      for (const library of libraries) emit("mtllib " + reference(library, "", true));
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
      const material = primitive.materialId ? reference(primitive.materialId, "") : metadata?.materialName === undefined ? "" : reference(metadata.materialName, "");
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
    return { ...result(), output, resourcePackage: { format: "inline", entries: [{ id: "obj", role: "mesh", path: destination.fileName, contentType: "text/plain" }] } };
  } catch (error) {
    clock.check();
    if (error instanceof ObjExportError) throw error;
    if (!(error instanceof ObjExportRejection)) throw new ObjExportError("OBJ_EXPORT_RESOURCE_FAILED");
    issues.push({ kind: "unsupported", code: error.code, message: "Canonical data cannot be represented within the declared OBJ export profile.", path: "/export" });
    return result();
  }
};
