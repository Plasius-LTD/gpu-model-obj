import {
  CANONICAL_GPU_MODEL_COORDINATE_SYSTEM, GPU_MODEL_DOCUMENT_SCHEMA_VERSION,
  createAndVerifyGpuModelDocument,
  type GpuModelMaterial, type GpuModelAccessor, type GpuModelPrimitive, type GpuModelDocument,
  type GpuModelResourceVerificationPort,
} from "@plasius/gpu-model-core";
import { sha256Hex } from "@plasius/gpu-model-runtime";
import { ObjImportError } from "./policy.js";

export interface ObjGeometryGroup {
  readonly objectName: string;
  readonly groups: string[];
  readonly materialName: string;
  materialId?: string;
  readonly smoothing: string;
  readonly positions: number[];
  readonly uvs: number[];
  readonly normals: number[];
}

export async function projectObj(
  groups: readonly ObjGeometryGroup[], libraries: readonly string[], sourceHash: string,
  check: () => void, checkpoint: () => Promise<void>, signal?: AbortSignal, materials: readonly GpuModelMaterial[] = [], libraryHashes: readonly { readonly name: string; readonly contentHash: string }[] = [],
): Promise<GpuModelDocument> {
  const total = groups.reduce((sum, group) => sum + group.positions.length + group.uvs.length + group.normals.length, 0);
  const bytes = new Uint8Array(total * 4);
  const view = new DataView(bytes.buffer);
  const accessors: GpuModelAccessor[] = [];
  const primitives: GpuModelPrimitive[] = [];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let offset = 0;
  for (const [index, group] of groups.entries()) {
    const attributes: { semantic: string; accessorId: string }[] = [];
    for (const [semantic, values, width] of [["POSITION", group.positions, 3], ["TEXCOORD_0", group.uvs, 2], ["NORMAL", group.normals, 3]] as const) {
      if (!values.length) continue;
      const start = offset;
      const localMin = [Infinity, Infinity, Infinity];
      const localMax = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < values.length; i++) {
        if (i % 4096 === 0) await checkpoint();
        const value = values[i]!;
        view.setFloat32(offset, value, true); offset += 4;
        if (semantic === "POSITION") {
          const axis = i % 3;
          min[axis] = Math.min(min[axis]!, value);
          max[axis] = Math.max(max[axis]!, value);
          localMin[axis] = Math.min(localMin[axis]!, value);
          localMax[axis] = Math.max(localMax[axis]!, value);
        }
      }
      const id = `accessor-${index}-${semantic}`;
      accessors.push({ id, resourceId: "geometry", byteOffset: start, count: values.length / width, componentType: "f32", elementType: width === 2 ? "vec2" : "vec3", ...(semantic === "POSITION" ? { min: localMin, max: localMax } : {}) });
      attributes.push({ semantic, accessorId: id });
    }
    primitives.push({ id: `primitive-${index}`, topology: "triangles", attributes, ...(group.materialId ? { materialId: group.materialId } : {}),
      metadata: { ...(group.objectName ? { objectName: group.objectName } : {}), groups: group.groups, ...(group.materialName ? { materialName: group.materialName } : {}), smoothing: group.smoothing } });
  }
  check();
  const hash = await sha256Hex(bytes);
  check();
  // Only parser-generated finite little-endian f32 buffers cross this port.
  const port: GpuModelResourceVerificationPort = {
    async digestSha256(chunks) {
      const copy = new Uint8Array(bytes.byteLength); let cursor = 0;
      for await (const chunk of chunks) { check(); copy.set(chunk, cursor); cursor += chunk.byteLength; }
      check(); return sha256Hex(copy);
    },
    async inspectResource(chunks) {
      for await (const _chunk of chunks) check();
      return { valid: true, detectedMimeType: "application/octet-stream" };
    },
  };
  try {
    const document = await createAndVerifyGpuModelDocument({
      schemaVersion: GPU_MODEL_DOCUMENT_SCHEMA_VERSION,
      coordinateSystem: CANONICAL_GPU_MODEL_COORDINATE_SYSTEM,
      roots: ["root"], nodes: [{ id: "root", children: [], meshId: "mesh", localMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }],
      resources: [{ id: "geometry", kind: "buffer", contentHash: hash, byteLength: bytes.byteLength, mimeType: "application/octet-stream", payload: new Blob([bytes.buffer], { type: "application/octet-stream" }) }],
      accessors, meshes: [{ id: "mesh", primitives }],
      materials, textures: [], skeletons: [], joints: [], skins: [], blendShapes: [], animations: [], analyticGeometry: [],
      bounds: { min, max },
      provenance: { sourceFormat: "obj", sourceContentHash: sourceHash, converterId: "plasius.gpu-model-obj.triangle-import", converterVersion: "1" },
      diagnostics: [], metadata: { materialLibraries: libraries, ...(libraryHashes.length ? { materialLibraryContentHashes: libraryHashes } : {}), sourceUnit: "unitless", coordinateAssumption: "metre-y-up-right-handed-authored-origin" },
    }, port, { signal });
    check(); return document;
  } catch (error) {
    check();
    if (error instanceof ObjImportError) throw error;
    throw new ObjImportError("OBJ_CANONICAL_VALIDATION_FAILED");
  }
}
