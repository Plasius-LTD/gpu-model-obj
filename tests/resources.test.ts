import { createGpuModelDocument } from "@plasius/gpu-model-core";
import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
import { sha256Hex, PackageResourceResolver, defaultSleep } from "@plasius/gpu-model-runtime";
import type { ResourceResolver } from "@plasius/gpu-model-runtime";
import { parseObj, exportObj, createObjRuntimeAdapter } from "../src/index.js";
const bytes = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array) => new TextDecoder().decode(b);
const triangle = "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n";
const obj = (path = "materials/a.mtl") => bytes(`mtllib ${path}\nusemtl painted\n${triangle}`);
const mtl = (path = "../invalid.png") => bytes(`newmtl painted\nKd 1 0 0\nmap_Kd ${path}\n`);
const options = (extra: object = {}) => ({ resources: {}, materialLibraries: [{ name: "materials/a.mtl", bytes: mtl("textures/red.png") }], mode: "tolerant" as const, allowLoss: true, ...extra });
function resolver(table: Record<string, Uint8Array>) {
  const resolve = vi.fn<ResourceResolver["resolve"]>(async (ref) => {
    const path = typeof ref === "string" ? ref : ref.path; const value = table[path];
    if (!value) throw new Error("PRIVATE LOCATION");
    return { path, bytes: value, contentHash: await sha256Hex(value), rangeSupported: false };
  }); return { resolve };
}
const refs = (r: Awaited<ReturnType<typeof parseObj>>) => r.document!.metadata.objResourceReferences as readonly { path: string; role: string; status: string; contentHash?: string }[];

describe("explicit OBJ resource identities", () => {
  it("preserves relative libraries and root-relative map identities without ambient I/O", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("implicit I/O"));
    try {
      const r = await parseObj(obj(), options()); expect(r.document).toBeDefined();
      expect(refs(r).map(x => [x.path, x.role, x.status])).toEqual([["materials/a.mtl", "material", "available"], ["materials/textures/red.png", "texture", "unresolved"]]);
      expect(r.document!.materials[0]!.sourceMetadata.objTextureReferences).toEqual([{ command: "map_Kd", path: "materials/textures/red.png" }]);
      expect(r.document!.textures).toEqual([]); expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });
  it("uses the actual runtime package resolver only when explicitly injected", async () => {
    const runtimePort = new PackageResourceResolver({ sourceKind: "uint8-array", package: { resources: { "materials/a.mtl": { bytes: mtl("red.png") }, "materials/red.png": { bytes: bytes("red") } } }, fetch: async () => { throw new Error("unexpected fetch"); }, hashBytes: sha256Hex, sleep: defaultSleep });
    const actual = await parseObj(obj(), { resources: { resolver: runtimePort } });
    expect(actual.report.accepted).toBe(true);
    const port = resolver({ "materials/a.mtl": mtl("textures/red.png"), "materials/textures/red.png": bytes("image-owned-by-caller") });
    const parsed = await parseObj(obj(), { resources: { resolver: port } });
    expect(parsed.report.accepted).toBe(true); expect(port.resolve.mock.calls.map(c => c[0])).toEqual(["materials/a.mtl", "materials/textures/red.png"]);
    expect(refs(parsed).every(r => r.status === "available" && /^[a-f0-9]{64}$/.test(r.contentHash!))).toBe(true);
  });
  it.each(['"material files/a.mtl"', 'material\\ files/a.mtl'])("supports a quoted or escaped library path %s", async path => {
    const r = await parseObj(obj(path), options({ materialLibraries: [{ name: "material files/a.mtl", bytes: mtl('"texture files/red image.png"') }] }));
    expect(refs(r).map(x => x.path)).toEqual(["material files/a.mtl", "material files/texture files/red image.png"]);
  });
  it("keeps unquoted map filename spaces literal", async () => {
    const r = await parseObj(obj(), options({ materialLibraries: [{ name: "materials/a.mtl", bytes: mtl("texture files/red image.png") }] }));
    expect(refs(r)[1]!.path).toBe("materials/texture files/red image.png");
  });
  it.each(["../a.mtl", "/a.mtl", "https://host/a.mtl", "file:a.mtl", "C:/a.mtl", "%2e%2e/a.mtl", "a/./b.mtl", "a//b.mtl", "a?b.mtl", "a\\b.mtl", '"a#b.mtl"', '"unterminated.mtl'])("rejects unsafe library %s before any read", async path => {
    const port = resolver({}); const r = await parseObj(obj(path), { resources: { resolver: port }, mode: "tolerant", allowLoss: true });
    expect(r.report.accepted).toBe(false); expect(r.document).toBeUndefined(); expect(port.resolve).not.toHaveBeenCalled();
  });
  it.each(["../escape.png", "/absolute.png", "https://host/image.png", "%2Fimage.png", "texture\\folder.png", "a/./b.png", "-s 1 1 1 texture.png"])("rejects unsafe/unsupported map %s without texture reads", async path => {
    const port = resolver({}); const r = await parseObj(obj(), options({ materialLibraries: [{ name: "materials/a.mtl", bytes: mtl(path) }], resources: { resolver: port } }));
    expect(r.report.accepted).toBe(false); expect(port.resolve).not.toHaveBeenCalled(); expect(JSON.stringify(r.diagnostics)).not.toContain(path);
  });
  it("handles missing library fixture through explicit diagnostics", async () => {
    const input = readFileSync(new URL("./fixtures/missing-library.obj", import.meta.url));
    const r = await parseObj(input, { resources: {} }); expect(r.diagnostics.some(d => d.code === "OBJ_MISSING_LIBRARY")).toBe(true);
    expect(JSON.stringify(r.diagnostics)).not.toContain("absent-library.mtl");
  });
  it("handles missing texture fixture in strict and consented tolerant modes", async () => {
    const input = readFileSync(new URL("./fixtures/missing-texture.obj", import.meta.url)); const library = readFileSync(new URL("./fixtures/missing-texture.mtl", import.meta.url));
    const supplied = { resources: {}, materialLibraries: [{ name: "missing-texture.mtl", bytes: library }] };
    const strict = await parseObj(input, supplied); expect(strict.document).toBeUndefined();
    const tolerant = await parseObj(input, { ...supplied, mode: "tolerant", allowLoss: true }); expect(tolerant.document).toBeDefined();
    expect(refs(tolerant).at(-1)!.status).toBe("unresolved"); expect(tolerant.repairs.some(d => d.ruleId === "missing-texture-path")).toBe(true);
  });
  it("resolves shared identities once and snapshots supplied library bytes", async () => {
    const file = bytes("newmtl painted\nmap_Kd red.png\nmap_Ke red.png\n"); const port = resolver({ "materials/red.png": bytes("red") });
    const promise = parseObj(obj(), options({ materialLibraries: [{ name: "materials/a.mtl", bytes: file }], resources: { resolver: port } })); file.fill(0);
    const r = await promise; expect(r.document).toBeDefined(); expect(port.resolve).toHaveBeenCalledTimes(1); expect(refs(r)).toHaveLength(2);
  });
  it("rejects duplicate map slots", async () => {
    const r = await parseObj(obj(), options({ materialLibraries: [{ name: "materials/a.mtl", bytes: bytes("newmtl painted\nmap_Kd a.png\nmap_Kd b.png\n") }] })); expect(r.report.accepted).toBe(false);
  });
  it("enforces reference count and aggregate input bytes", async () => {
    const r = await parseObj(obj(), options({ limits: { maxReferences: 1 } })); expect(r.document).toBeUndefined();
    const port = resolver({ "materials/a.mtl": new Uint8Array(512) }); const sized = await parseObj(obj(), { resources: { resolver: port }, limits: { maxInputBytes: 128 } }); expect(sized.document).toBeUndefined(); expect(port.resolve.mock.calls[0]![1]!.maxBytes).toBeLessThan(128);
  });
  it("bounds diagnostics without echoing resolver exceptions", async () => {
    const port = resolver({}); const r = await parseObj(obj(), { resources: { resolver: port }, limits: { maxDiagnostics: 1 } });
    expect(r.diagnostics.length).toBeLessThanOrEqual(1); expect(JSON.stringify(r)).not.toContain("PRIVATE LOCATION");
  });
  it("rejects a dishonest resolver content hash", async () => {
    const port = { resolve: async (path: unknown) => ({ path, bytes: mtl("red.png"), contentHash: "0".repeat(64), rangeSupported: false }) };
    const r = await parseObj(obj(), { resources: { resolver: port as ResourceResolver }, mode: "tolerant", allowLoss: true }); expect(r.document).toBeUndefined();
  });
  it("cancels a non-settling port at the whole-operation deadline", async () => {
    let signal: AbortSignal | undefined; const port: ResourceResolver = { resolve: async (_r, o) => { signal = o?.signal; return new Promise(() => {}); } };
    await expect(parseObj(obj(), { resources: { resolver: port }, timeoutMs: 40 })).rejects.toMatchObject({ code: "OBJ_DEADLINE_EXCEEDED" }); expect(signal!.aborted).toBe(true);
  });
  it("propagates external abort to a non-settling port", async () => {
    const controller = new AbortController(); let signal: AbortSignal | undefined;
    const port: ResourceResolver = { resolve: async (_r, o) => { signal = o?.signal; controller.abort("PRIVATE"); return new Promise(() => {}); } };
    await expect(parseObj(obj(), { resources: { resolver: port }, signal: controller.signal })).rejects.toMatchObject({ code: "OBJ_ABORTED" }); expect(signal!.aborted).toBe(true);
  });
  it("exports multiple actual libraries and reloads the same resource identities", async () => {
    const source = bytes(`mtllib "material files/a.mtl" second.mtl\nusemtl painted\n${triangle}usemtl blue\nf 1 2 3\n`);
    const files = [{ name: "material files/a.mtl", bytes: mtl("textures/red.png") }, { name: "second.mtl", bytes: bytes("newmtl blue\nmap_Ke blue.png\n") }];
    const original = await parseObj(source, options({ materialLibraries: files }));
    const out = await exportObj(original.document!, { kind: "uint8-array" }, { includeMaterials: true, allowLoss: true });
    expect(out.report.accepted).toBe(true); expect(out.materialLibraries!.map(x => x.name)).toEqual(files.map(x => x.name));
    expect(out.resourcePackage!.entries.filter(x => x.role === "texture").map(x => x.path)).toEqual(["material files/textures/red.png", "blue.png"]);
    const reload = await parseObj(out.output as Uint8Array, options({ materialLibraries: out.materialLibraries }));
    expect(refs(reload).map(x => [x.path, x.role])).toEqual(refs(original).map(x => [x.path, x.role]));
    expect(reload.document!.materials.map(x => x.sourceMetadata.objTextureReferences)).toEqual(original.document!.materials.map(x => x.sourceMetadata.objTextureReferences));
    const twice = await exportObj(original.document!, { kind: "uint8-array" }, { includeMaterials: true, allowLoss: true }); expect(twice.output).toEqual(out.output); expect(twice.materialLibraries).toEqual(out.materialLibraries);
    expect(text(out.materialLibraries![0]!.bytes)).toContain("map_Kd textures/red.png");
  });
  it.each([null, [], { resolver: null }, { resolver: {} }, { unknown: true }, { resolver: { get resolve() { throw new Error("getter"); } } }])("rejects malformed resource policy without evaluating getters", async resources => {
    await expect(parseObj(obj(), { resources } as never)).rejects.toMatchObject({ code: "OBJ_INVALID_OPTIONS" });
  });
  it.each([null, [], { unknown: true }, { resolveResources: "true" }, { get allowLoss() { throw new Error("getter"); } }, { [Symbol("option")]: true }])("rejects malformed runtime opt-in without getters", options => {
    expect(() => createObjRuntimeAdapter(options as never)).toThrowError(expect.objectContaining({ code: "OBJ_INVALID_OPTIONS" }));
  });
  it("snapshots resolver methods before awaiting", async () => {
    const port = resolver({ "materials/a.mtl": mtl("red.png"), "materials/red.png": bytes("red") });
    const promise = parseObj(obj(), { resources: { resolver: port } }); const original = port.resolve;
    port.resolve = vi.fn().mockRejectedValue(new Error("substitution"));
    const r = await promise; expect(r.document).toBeDefined(); expect(original).toHaveBeenCalledTimes(2); expect(port.resolve).not.toHaveBeenCalled();
  });
  it("keeps empty available libraries as actual exported files", async () => {
    const parsed = await parseObj(bytes(`mtllib empty.mtl\n${triangle}`), { resources: {}, materialLibraries: [{ name: "empty.mtl", bytes: bytes("# empty\n") }] });
    const out = await exportObj(parsed.document!, { kind: "uint8-array" }, { includeMaterials: true }); expect(out.materialLibraries).toHaveLength(1);
    const reload = await parseObj(out.output as Uint8Array, { resources: {}, materialLibraries: out.materialLibraries }); expect(refs(reload)[0]!.status).toBe("available");
  });
  it("preserves an unresolved unused library without fabricating bytes", async () => {
    const parsed = await parseObj(bytes(`mtllib absent.mtl\n${triangle}`), { resources: {} });
    const out = await exportObj(parsed.document!, { kind: "uint8-array" }, { includeMaterials: true }); expect(out.materialLibraries).toHaveLength(0); expect(out.resourcePackage!.format).toBe("directory-manifest"); expect(text(out.output as Uint8Array)).toContain("mtllib absent.mtl");
  });
  it.each(["../escape.png", "https://host/a.png", "model.obj"])("rejects forged output package identity %s atomically", async path => {
    const r = await parseObj(obj(), options()); const d = createGpuModelDocument({ ...r.document!, metadata: { ...r.document!.metadata, objResourceReferences: [{ path, role: "texture", status: "available" }] } });
    const out = await exportObj(d, { kind: "blob" }, { includeMaterials: true, allowLoss: true }); expect(out.output).toBeUndefined(); expect(out.materialLibraries).toBeUndefined();
  });
  it("rejects a map identity that escapes its declaring library on export", async () => {
    const r = await parseObj(obj(), options()); const d = createGpuModelDocument({ ...r.document!, metadata: { ...r.document!.metadata, objResourceReferences: [{ path: "materials/a.mtl", role: "material", status: "available" }, { path: "outside.png", role: "texture", status: "unresolved" }] }, materials: r.document!.materials.map(m => ({ ...m, sourceMetadata: { ...m.sourceMetadata, objTextureReferences: [{ command: "map_Kd", path: "outside.png" }] } })) });
    expect((await exportObj(d, { kind: "uint8-array" }, { includeMaterials: true, allowLoss: true })).output).toBeUndefined();
  });
  it("preserves reference-only library paths with spaces", async () => {
    const r = await parseObj(obj('"material files/a.mtl"'), options({ materialLibraries: [{ name: "material files/a.mtl", bytes: bytes("newmtl painted\n") }] }));
    const out = await exportObj(r.document!, { kind: "uint8-array" }, { allowLoss: true }); expect(text(out.output as Uint8Array)).toContain('mtllib "material files/a.mtl"');
  });
  it("does not retry a malformed resource shared by multiple slots", async () => {
    const port = { resolve: vi.fn(async (path: unknown) => ({ path, bytes: bytes("red"), contentHash: "0".repeat(64), rangeSupported: false })) };
    const r = await parseObj(obj(), options({ materialLibraries: [{ name: "materials/a.mtl", bytes: bytes("newmtl painted\nmap_Kd red.png\nmap_Ke red.png\n") }], resources: { resolver: port as ResourceResolver } }));
    expect(r.document).toBeUndefined(); expect(port.resolve).toHaveBeenCalledTimes(1);
  });
  it("enforces tightened export reference ceilings without partial files", async () => {
    const r = await parseObj(obj(), options()); const out = await exportObj(r.document!, { kind: "uint8-array" }, { includeMaterials: true, allowLoss: true, limits: { maxResources: 1 } });
    expect(out.output).toBeUndefined(); expect(out.materialLibraries).toBeUndefined();
  });
  it.each(["wrong-path", "oversized", "not-bytes"])("rejects malformed resolver payload %s", async kind => {
    const payload = mtl("red.png"); const port: ResourceResolver = { resolve: async path => ({ path: kind === "wrong-path" ? "wrong.mtl" : path, bytes: kind === "not-bytes" ? [] : kind === "oversized" ? new Uint8Array(200) : payload, contentHash: await sha256Hex(payload), rangeSupported: false }) as never };
    const r = await parseObj(obj(), { resources: { resolver: port }, limits: { maxInputBytes: 180 }, allowLoss: true, mode: "tolerant" }); expect(r.document).toBeUndefined(); expect(r.diagnostics.some(d => d.code === "OBJ_INVALID_RESOURCE")).toBe(true);
  });
  it("applies the material export ceiling across all libraries", async () => {
    const source = bytes(`mtllib a.mtl b.mtl\nusemtl painted\n${triangle}usemtl blue\nf 1 2 3\n`);
    const r = await parseObj(source, { resources: {}, materialLibraries: [{ name: "a.mtl", bytes: bytes("newmtl painted\n") }, { name: "b.mtl", bytes: bytes("newmtl blue\n") }] });
    const out = await exportObj(r.document!, { kind: "uint8-array" }, { includeMaterials: true, limits: { maxMaterials: 1 } }); expect(out.output).toBeUndefined(); expect(out.materialLibraries).toBeUndefined();
  });
  it.each([false, true])("rejects mismatched declared libraries before output (paired=%s)", async includeMaterials => {
    const r = await parseObj(obj(), options());
    for (const declared of [["other.mtl"], [], ["materials/a.mtl", "extra.mtl"], "not-an-array"]) {
      const d = createGpuModelDocument({ ...r.document!, metadata: { ...r.document!.metadata, materialLibraries: declared } });
      const out = await exportObj(d, { kind: "uint8-array" }, { includeMaterials, allowLoss: true }); expect(out.output).toBeUndefined(); expect(out.materialLibraries).toBeUndefined();
    }
    const metadata = { ...r.document!.metadata }; delete metadata.materialLibraries;
    const d = createGpuModelDocument({ ...r.document!, metadata }); expect((await exportObj(d, { kind: "blob" }, { includeMaterials, allowLoss: true })).output).toBeUndefined();
  });
  it("accepts duplicate equivalent library declarations with one manifest identity", async () => {
    const r = await parseObj(obj(), options()); const d = createGpuModelDocument({ ...r.document!, metadata: { ...r.document!.metadata, materialLibraries: ["materials/a.mtl", "materials/a.mtl"] } });
    const out = await exportObj(d, { kind: "uint8-array" }, { includeMaterials: true, allowLoss: true }); expect(out.output).toBeDefined(); expect(out.materialLibraries).toHaveLength(1); expect(out.resourcePackage!.entries.filter(e => e.role === "material")).toHaveLength(1);
  });
  it("runtime bridge requires explicit opt-in for resource I/O", async () => {
    const port = resolver({ "materials/a.mtl": mtl("red.png"), "materials/red.png": bytes("red") }); const input = { source: { kind: "uint8-array", bytes: obj() }, bytes: obj(), contentHash: await sha256Hex(obj()), rangeSupported: false, resourceResolver: port } as const;
    const context = { signal: new AbortController().signal, mode: "strict", execution: "main", adapterOptions: {} } as const;
    await createObjRuntimeAdapter().load(input, context); expect(port.resolve).not.toHaveBeenCalled();
    const r = await createObjRuntimeAdapter({ resolveResources: true }).load(input, context); expect(r.canonicalModel).toBeDefined(); expect(port.resolve).toHaveBeenCalledTimes(2);
  });
});
