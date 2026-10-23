import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createGpuModelDocument, createAndVerifyGpuModelDocument, type GpuModelDocument } from "@plasius/gpu-model-core";
import { exportObj, parseObj } from "../src/index.js";

const target = { kind: "uint8-array" } as const;
const triangle = new TextEncoder().encode("v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n");
const rest = { translation: [0,0,0], rotation: [0,0,0,1], scale: [1,1,1] } as const;
async function fixtures() {
  const base = (await parseObj(triangle)).document!;
  const root = base.nodes[0]!;
  const rig = {
    joints: [{ id: "joint", nodeId: root.id, restLocalTransform: rest, sourceMetadata: { note: "synthetic-private-fixture" } }],
    skeletons: [{ id: "rig", jointIds: ["joint"], rootJointIds: ["joint"], sourceMetadata: {} }],
  };
  const skin = { id: "skin", skeletonId: "rig", jointIds: ["joint"], inverseBindMatrices: [root.localMatrix], weightSets: [{ primitiveId: base.meshes[0]!.primitives[0]!.id, influencesPerVertex: 4, joints: [[0,0,0,0],[0,0,0,0],[0,0,0,0]], weights: [[1,0,0,0],[1,0,0,0],[1,0,0,0]] }], sourceMetadata: {} };
  const animation = { id: "animation", name: "synthetic-private-fixture", durationSeconds: 1, samplers: [{ id: "motion", inputAccessorId: "time", outputAccessorId: "motion", inputTimesSeconds: [0,1], outputValues: [0,0,0,1,0,0], interpolation: "linear" as const, sourceMetadata: {} }], channels: [{ id: "channel", samplerId: "motion", targetType: "node-translation" as const, targetId: root.id, sourceMetadata: {} }], sourceMetadata: {} };
  const material = { id: "material", workflow: "metallic-roughness", alphaMode: "opaque", baseColorFactor: [1,1,1,1], metallicFactor: 0.7, roughnessFactor: 0.2, clearcoatFactor: 0.5, textures: {}, extensions: { synthetic: "synthetic-private-fixture" }, sourceMetadata: {} } as const;
  const make = (fields: Partial<GpuModelDocument>) => createGpuModelDocument({ ...base, ...fields });
  const bytes = new Uint8Array(92);
  const view = new DataView(bytes.buffer);
  for (let vertex = 0; vertex < 3; vertex++) view.setFloat32(12 + vertex * 16, 1, true);
  view.setFloat32(64, 1, true); view.setFloat32(80, 1, true);
  const skinned = await createAndVerifyGpuModelDocument({ ...base, ...rig, skins: [skin], nodes: [{ ...root, skinId: "skin" }],
    resources: [...base.resources, { id: "skin-buffer", kind: "buffer", byteLength: bytes.byteLength, contentHash: createHash("sha256").update(bytes).digest("hex"), mimeType: "application/octet-stream", payload: new Blob([bytes.buffer]) }],
    accessors: [...base.accessors, { id: "joints", resourceId: "skin-buffer", byteOffset: 0, count: 3, componentType: "u8", elementType: "vec4" }, { id: "weights", resourceId: "skin-buffer", byteOffset: 12, count: 3, componentType: "f32", elementType: "vec4" }, { id: "time", resourceId: "skin-buffer", byteOffset: 60, count: 2, componentType: "f32", elementType: "scalar", min: [0], max: [1] }, { id: "motion", resourceId: "skin-buffer", byteOffset: 68, count: 2, componentType: "f32", elementType: "vec3" }],
    meshes: base.meshes.map(mesh => ({ ...mesh, primitives: mesh.primitives.map(p => ({ ...p, attributes: [...p.attributes, { semantic: "JOINTS_0", accessorId: "joints" }, { semantic: "WEIGHTS_0", accessorId: "weights" }] })) })),
  }, { async digestSha256(chunks) { const hash = createHash("sha256"); for await (const chunk of chunks) hash.update(chunk); return hash.digest("hex"); }, async inspectResource(chunks) { for await (const chunk of chunks) void chunk; return { valid: true, detectedMimeType: "application/octet-stream" }; } });
  return { base, rig: make(rig), skinned, animated: make({ ...skinned, joints: [], skeletons: [], skins: [], nodes: base.nodes, meshes: base.meshes, animations: [animation] }), advanced: make({ materials: [material] }), combined: make({ ...skinned, animations: [animation], materials: [material] }) };
}

describe("canonical OBJ target fidelity", () => {
  it.each(["strict", "tolerant", "forensic"] as const)("reports every rejected semantic in %s with every consent policy", async mode => {
    const f = await fixtures();
    for (const allowLoss of [undefined, false, true]) {
      for (const [document, codes] of [
        [f.rig, ["OBJ_EXPORT_RIG_LOSS"]],
        [f.skinned, ["OBJ_EXPORT_RIG_LOSS", "OBJ_EXPORT_SKIN_LOSS"]],
        [f.animated, ["OBJ_EXPORT_ANIMATION_LOSS"]],
        [f.combined, ["OBJ_EXPORT_RIG_LOSS", "OBJ_EXPORT_SKIN_LOSS", "OBJ_EXPORT_ANIMATION_LOSS", "MTL_EXPORT_ADVANCED_MATERIAL"]],
      ] as const) {
        const result = await exportObj(document, target, { mode, ...(allowLoss === undefined ? {} : { allowLoss }) });
        expect(result.report.accepted).toBe(false);
        expect(result.output).toBeUndefined();
        expect(result.resourcePackage).toBeUndefined();
        expect(result.lossReports.map(loss => loss.code)).toEqual(codes);
        expect(result.lossReports.every(loss => loss.effect === "dropped")).toBe(true);
        expect(result.diagnostics.some(d => d.kind === "unsupported" && d.code === "OBJ_EXPORT_UNSUPPORTED_DATA")).toBe(true);
        expect(JSON.stringify(result)).not.toContain("synthetic-private-fixture");
        expect(result.repairs).toEqual([]);
      }
    }
  });

  it("reports all rig families with the safe default policy", async () => {
    const f = await fixtures();
    const result = await exportObj(f.combined, target);
    expect(result.report.mode).toBe("strict");
    expect(result.report.accepted).toBe(false);
    expect(result.lossReports.map(loss => loss.path)).toEqual(["/skeletons", "/skins", "/animations", "/materials"]);
    expect(result.output).toBeUndefined();
  });

  it.each(["strict", "tolerant", "forensic"] as const)("preserves the existing explicit diffuse approximation in %s", async mode => {
    const { advanced, base } = await fixtures();
    for (const allowLoss of [undefined, false, true]) {
      const result = await exportObj(advanced, target, { mode, includeMaterials: true, ...(allowLoss === undefined ? {} : { allowLoss }) });
      expect(result.lossReports.map(loss => [loss.code, loss.effect])).toEqual([["MTL_EXPORT_ADVANCED_MATERIAL", "approximated"]]);
      expect(result.report.accepted).toBe(allowLoss === true);
      if (allowLoss === true) {
        expect(result.output).toEqual((await exportObj(base, target, { includeMaterials: true })).output);
        expect(new TextDecoder().decode(result.materialLibrary!.bytes)).not.toContain("synthetic-private-fixture");
        expect((await parseObj(result.output as Uint8Array)).document!.animations).toEqual([]);
      } else expect(result.output).toBeUndefined();
      expect(JSON.stringify(result.report)).not.toContain("synthetic-private-fixture");
    }
  });

  it("reports blend-shape and analytic source loss", async () => {
    const { base } = await fixtures();
    const primitive = base.meshes[0]!.primitives[0]!;
    const cases = [
      [createGpuModelDocument({ ...base, blendShapes: [{ id: "shape", meshId: base.meshes[0]!.id, deltas: [{ primitiveId: primitive.id, positionAccessorId: primitive.attributes[0]!.accessorId }], sourceMetadata: {} }] }), "OBJ_EXPORT_BLEND_SHAPE_LOSS", "/blendShapes"],
      [createGpuModelDocument({ ...base, analyticGeometry: [{ id: "analytic", kind: "brep-placeholder", sourceResourceId: base.resources[0]!.id, sourceUnit: "metre" }] }), "OBJ_EXPORT_ANALYTIC_GEOMETRY_LOSS", "/analyticGeometry"],
    ] as const;
    for (const [document, code, path] of cases) {
      const result = await exportObj(document, target, { allowLoss: true });
      expect(result.report.accepted).toBe(false);
      expect(result.output).toBeUndefined();
      expect(result.lossReports).toEqual([expect.objectContaining({ code, path, effect: "dropped" })]);
    }
  });

  it("reports canonical texture payload loss without reading or emitting images", async () => {
    const { base } = await fixtures();
    const image = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64"));
    const hash = createHash("sha256").update(image).digest("hex");
    const document = await createAndVerifyGpuModelDocument({ ...base,
      resources: [...base.resources, { id: "image", kind: "image", contentHash: hash, byteLength: image.length, mimeType: "image/png", payload: new Blob([image.buffer]) }],
      textures: [{ id: "texture", imageResourceId: "image", contentHash: hash, byteLength: image.length, mimeType: "image/png", intendedUsage: ["base-color"], colorSpace: "srgb", sampler: { id: "sampler" }, exportEmbeddingPolicy: "prefer-embedded", sourceMetadata: {} }],
    }, { async digestSha256(chunks) { const digest = createHash("sha256"); for await (const chunk of chunks) digest.update(chunk); return digest.digest("hex"); }, async inspectResource(chunks, context) { for await (const chunk of chunks) void chunk; return context.kind === "image" ? { valid: true, detectedMimeType: "image/png", width: 1, height: 1 } : { valid: true, detectedMimeType: "application/octet-stream" }; } });
    const result = await exportObj(document, target, { allowLoss: true });
    expect(result.report.accepted).toBe(false);
    expect(result.output).toBeUndefined();
    expect(result.lossReports).toEqual([expect.objectContaining({ code: "OBJ_EXPORT_TEXTURE_LOSS", effect: "dropped", path: "/textures" })]);
  });

  it("replaces prospective material approximations when geometry later rejects", async () => {
    const { advanced } = await fixtures();
    const mesh = advanced.meshes[0]!; const primitive = mesh.primitives[0]!;
    const document = createGpuModelDocument({ ...advanced,
      accessors: [...advanced.accessors, { id: "uv", resourceId: advanced.resources[0]!.id, byteOffset: 0, count: 3, elementType: "vec2", componentType: "u8", normalized: true }],
      meshes: [{ ...mesh, primitives: [{ ...primitive, attributes: [...primitive.attributes, { semantic: "TEXCOORD_0", accessorId: "uv" }] }] }],
    });
    for (const mode of ["strict", "tolerant", "forensic"] as const) {
      const result = await exportObj(document, target, { mode, includeMaterials: true, allowLoss: true });
      expect(result.report.accepted).toBe(false);
      expect(result.output).toBeUndefined();
      expect(result.materialLibraries).toBeUndefined();
      expect(result.lossReports).toEqual([expect.objectContaining({ code: "MTL_EXPORT_ADVANCED_MATERIAL", effect: "dropped", path: "/materials" })]);
      expect(result.lossReports.some(loss => loss.effect === "approximated")).toBe(false);
    }
  });

  it("leaves lossless geometry deterministic and the input immutable after rejection", async () => {
    const { base, combined } = await fixtures();
    const before = JSON.stringify(combined);
    const first = await exportObj(combined, target, { allowLoss: true, mode: "forensic", includeMaterials: true });
    const again = await exportObj(combined, target, { allowLoss: true, mode: "forensic", includeMaterials: true });
    expect(first).toEqual(again);
    expect(JSON.stringify(combined)).toBe(before);
    expect((await exportObj(base, target)).lossReports).toEqual([]);
    expect((await exportObj(base, target)).output).toEqual((await exportObj(base, target)).output);
  });
});
