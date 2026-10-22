import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { isGpuModelDocument, encodeGpuModelDocumentCanonical } from "@plasius/gpu-model-core";
import { AdapterRegistry, ModelRuntime } from "@plasius/gpu-model-runtime";
import { parseObj, createObjRuntimeAdapter, OBJ_PARSER_LIMITS, ObjImportError } from "../src/index.js";

const encode = (text: string) => new TextEncoder().encode(text);
const vertices = "v 0 0 0\nv 1 0 0\nv 0 1 0\n";
const triangle = vertices + "f 1 2 3\n";
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

async function floats(document: NonNullable<Awaited<ReturnType<typeof parseObj>>["document"]>, semantic: string) {
  const attribute = document.meshes[0]!.primitives[0]!.attributes.find(a => a.semantic === semantic)!;
  const accessor = document.accessors.find(a => a.id === attribute.accessorId)!;
  const resource = document.resources.find(r => r.id === accessor.resourceId)!;
  const view = new DataView(await resource.payload.arrayBuffer());
  const size = accessor.elementType === "vec2" ? 2 : 3;
  return Array.from({ length: accessor.count * size }, (_, i) => view.getFloat32(accessor.byteOffset + i * 4, true));
}

describe("bounded canonical OBJ parser", () => {
  it("imports the authored triangle into immutable byte-verified canonical core", async () => {
    const result = await parseObj(fixture("triangle.obj"));
    expect(result.report.accepted).toBe(true);
    expect(isGpuModelDocument(result.document)).toBe(true);
    expect(Object.isFrozen(result.document)).toBe(true);
    expect(result.document!.bounds).toEqual({ min: [0, 0, 0], max: [1, 1, 0] });
    expect(await floats(result.document!, "POSITION")).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(result.document!.provenance.sourceFormat).toBe("obj");
  });

  it("preserves independent positive/negative UV/normal indices and seams", async () => {
    const result = await parseObj(encode(vertices + "vt 0 0\nvt 1 0\nvt 0 1\nvn 0 0 1\nf -3/3/1 -2/2/1 -1/1/1\n"));
    expect(result.report.accepted).toBe(true);
    expect(await floats(result.document!, "TEXCOORD_0")).toEqual([0, 1, 1, 0, 0, 0]);
    expect(await floats(result.document!, "NORMAL")).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const normalOnly = await parseObj(encode(vertices + "vn 0 0 1\nf 1//1 2//1 3//1"));
    expect(normalOnly.document!.accessors).toHaveLength(2);
  });

  it("preserves object/group/material/library references as inert bounded metadata", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("implicit I/O"));
    try {
      const result = await parseObj(encode("mtllib absent.mtl\no mesh name\ng front panel\nusemtl matte\ns off\n" + triangle + "usemtl gloss\nf 1 2 3\n"));
      expect(result.report.accepted).toBe(true);
      expect(result.document!.meshes[0]!.primitives).toHaveLength(2);
      expect(result.document!.meshes[0]!.primitives[0]!.metadata).toMatchObject({ objectName: "mesh name", groups: ["front", "panel"], materialName: "matte", smoothing: "off" });
      expect(result.document!.metadata.materialLibraries).toEqual(["absent.mtl"]);
      expect(result.document!.materials).toEqual([]);
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });

  it("fails strict malformed indices and records only actually dropped faces in tolerant/forensic", async () => {
    const bytes = encode(new TextDecoder().decode(fixture("malformed-indices.obj")) + "f -3 -2 -1\n");
    const strict = await parseObj(bytes);
    expect(strict.document).toBeUndefined();
    expect(strict.report.accepted).toBe(false);
    expect(strict.repairs).toEqual([]);
    const tolerant = await parseObj(bytes, { mode: "tolerant", allowLoss: true });
    expect(tolerant.report.accepted).toBe(true);
    expect(tolerant.repairs).toHaveLength(2);
    expect(tolerant.repairs.every(r => r.ruleId === "invalid-indices")).toBe(true);
    expect(tolerant.report.rawSource).toBeUndefined();
    const forensic = await parseObj(bytes, { mode: "forensic", allowLoss: true });
    expect(forensic.report.rawSource).toMatchObject({ sourceBytes: bytes.byteLength });
    expect(forensic.repairs).toHaveLength(2);
    expect(forensic.document!.accessors[0]!.count).toBe(3);
  });

  it.each(["f 0 2 3", "f 1 2 4", "f -4 2 3", "f 1/0 2/1 3/1", "f 1//0 2//1 3//1", "f 1e0 2 3", "f 9007199254740992 2 3", "f 1/ 2 3", "f 1///1 2 3"])("rejects an invalid face without clamping: %s", async face => {
    const result = await parseObj(encode(vertices + face + "\nf 1 2 3"), { mode: "tolerant", allowLoss: true });
    expect(result.repairs).toHaveLength(1);
    expect(result.document!.accessors[0]!.count).toBe(3);
  });

  it.each(["v NaN 0 0", "v Infinity 0 0", "v 1e40 0 0", "v 1e-60 0 0", "v 1e-999 0 0", "v 0 0", "v 0 0 0 2", "v 0 0 0 1.00000001", "vt 0 0 1", "vn 0 0 0", "v 0x10 0 0", "v 0 0 0 1 1 1"])("rejects unsupported/malformed numeric data: %s", async record => {
    const result = await parseObj(encode(record + "\n" + triangle), { mode: "tolerant", allowLoss: true });
    expect(result.report.accepted).toBe(false);
    expect(result.document).toBeUndefined();
  });

  it.each(["f 1 2", "f 1 2 3 1", "l 1 2", "p 1", "curv 1 2", "f 1/1 2 3", "g " + "x ".repeat(17), "o " + "x".repeat(257), "o bad\u0000name", "usemtl"])("fails closed for unsupported syntax: %s", async record => {
    const result = await parseObj(encode("vt 0 0\n" + vertices + record), { mode: "forensic", allowLoss: true });
    expect(result.report.accepted).toBe(false);
    expect(result.document).toBeUndefined();
  });

  it("handles CRLF, comments, BOM, scientific notation and optional homogeneous 1", async () => {
    const result = await parseObj(encode("\ufeffv 0 0 0 1\r\nv +1e0 0 0 # comment\r\nv 0 .1e1 0\r\nf +1 2 3"));
    expect(result.report.accepted).toBe(true);
    expect(await floats(result.document!, "POSITION")).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  });

  it("does not shift index identity after a malformed source vertex", async () => {
    const result = await parseObj(encode("v NaN 0 0\n" + triangle), { mode: "tolerant", allowLoss: true });
    expect(result.report.accepted).toBe(false);
  });

  it("fails empty, invalid UTF8, and inputs with no surviving geometry", async () => {
    for (const bytes of [encode(""), encode("# private comment"), encode(vertices), encode(vertices + "f 0 2 3"), new Uint8Array([255])]) {
      const result = await parseObj(bytes, { mode: "tolerant", allowLoss: true });
      expect(result.report.accepted).toBe(false);
      expect(result.document).toBeUndefined();
    }
  });

  it("is deterministic and keeps diagnostic/forensic evidence free of raw names/text", async () => {
    const bytes = encode("# private-token\no private-name\n" + triangle + "f 0 2 3");
    const a = await parseObj(bytes, { mode: "forensic", allowLoss: true });
    const b = await parseObj(bytes, { mode: "forensic", allowLoss: true });
    expect(a.report).toEqual(b.report);
    expect(encodeGpuModelDocumentCanonical(a.document!)).toEqual(encodeGpuModelDocumentCanonical(b.document!));
    expect(JSON.stringify(a.report)).not.toMatch(/private-token|private-name/);
  });

  it.each([
    ["maxInputBytes", 1, triangle], ["maxLineBytes", 4, triangle],
    ["maxSourceElements", 2, triangle], ["maxFaces", 1, triangle + "f 1 2 3"],
    ["maxOutputVertices", 2, triangle], ["maxPrimitiveGroups", 1, triangle + "o other\nf 1 2 3"],
    ["maxReferences", 1, "mtllib a b\n" + triangle],
    ["maxDiagnostics", 1, vertices + "f 0 2 3\nf 1 2 4\nf 1 2 3"],
  ] as const)("enforces %s before returning geometry", async (name, value, text) => {
    const result = await parseObj(encode(text), { limits: { [name]: value }, mode: "tolerant" });
    expect(result.report.accepted).toBe(false);
    expect(result.document).toBeUndefined();
    expect(result.diagnostics.some(d => d.code === "OBJ_LIMIT_EXCEEDED")).toBe(true);
  });

  it("rejects invalid options without evaluating accessors or exposing values", async () => {
    for (const options of [{mode: "other"}, {timeoutMs: 0}, {timeoutMs: Infinity}, {limits:{maxFaces:0}}, {limits:{maxFaces:OBJ_PARSER_LIMITS.maxFaces + 1}}, {limits:{unknown:1}}, {unknown:"private"}]) {
      await expect(parseObj(encode(triangle), options as never)).rejects.toMatchObject({ code: "OBJ_INVALID_OPTIONS" });
    }
    const getter = vi.fn(() => 1);
    await expect(parseObj(encode(triangle), Object.defineProperty({}, "timeoutMs", {get: getter}) as never)).rejects.toBeInstanceOf(ObjImportError);
    expect(getter).not.toHaveBeenCalled();
    await expect(parseObj("private" as never)).rejects.toMatchObject({code:"OBJ_INVALID_INPUT"});
  });

  it("owns input bytes before its first asynchronous checkpoint", async () => {
    const bytes = encode(triangle);
    const pending = parseObj(bytes);
    bytes.fill(0);
    expect((await pending).report.accepted).toBe(true);
  });

  it("returns the fixed invalid-input code for detached byte arrays", async () => {
    const bytes = encode(triangle);
    structuredClone(bytes.buffer, {transfer:[bytes.buffer]});
    await expect(parseObj(bytes)).rejects.toMatchObject({code:"OBJ_INVALID_INPUT",message:"OBJ import: OBJ_INVALID_INPUT"});
  });

  it("counts line content equally at exact LF and CRLF byte boundaries", async () => {
    const body = "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3";
    for (const text of [body,body.replaceAll("\n","\r\n"),body.replaceAll("\n","\r\n")+"\r\n"]) {
      const result=await parseObj(encode(text),{limits:{maxLineBytes:7}});
      expect(result.report.accepted).toBe(true);
    }
    const oversized=await parseObj(encode("v 0 0 00\r\n"+triangle),{limits:{maxLineBytes:7}});
    expect(oversized.diagnostics[0]!.code).toBe("OBJ_LIMIT_EXCEEDED");
  });

  it("requires caller loss consent even in tolerant and forensic modes", async () => {
    for (const mode of ["strict", "tolerant", "forensic"] as const) {
      const result = await parseObj(encode(triangle + "f 0 2 3"), {mode});
      expect(result.report.accepted).toBe(false);
      expect(result.document).toBeUndefined();
      expect(result.lossReports).toHaveLength(1);
    }
  });

  it("bounds malformed corner evidence and long/Unicode physical lines", async () => {
    const result = await parseObj(encode(vertices + "f 1" + "/".repeat(2000) + " 2 3\nf 1 2 3"), {mode:"forensic",allowLoss:true});
    expect(result.report.accepted).toBe(true);
    expect(JSON.stringify(result.report).length).toBeLessThan(2000);
    const long = await parseObj(encode("#".repeat(5000)));
    expect(long.diagnostics[0]!.code).toBe("OBJ_LIMIT_EXCEEDED");
    const unicode = await parseObj(encode("#" + "é".repeat(25) + "\n" + triangle), {limits:{maxLineBytes:40}});
    expect(unicode.report.accepted).toBe(false);
  });

  it("preserves face order across group transitions and keeps primitive bounds distinct", async () => {
    const result = await parseObj(encode(vertices + "v 10 0 0\nv 11 0 0\nv 10 1 0\no a\nf 1 2 3\no b\nf 4 5 6\no a\nf 1 2 3"));
    expect(result.document!.meshes[0]!.primitives).toHaveLength(3);
    expect(result.document!.accessors.map(a=>a.count)).toEqual([3,3,3]);
    expect(result.document!.accessors.map(a=>a.min)).toEqual([[0,0,0],[10,0,0],[0,0,0]]);
    expect(result.document!.bounds.max).toEqual([11,1,0]);
    const adjacent = await parseObj(encode(triangle + "f 1 2 3"));
    expect(adjacent.document!.meshes[0]!.primitives).toHaveLength(1);
    expect(adjacent.document!.accessors[0]!.count).toBe(6);
  });

  it("caps generic unsupported-record diagnostics without truncating success", async () => {
    const result = await parseObj(encode("other\n".repeat(100) + triangle));
    expect(result.diagnostics).toHaveLength(OBJ_PARSER_LIMITS.maxDiagnostics);
    expect(result.diagnostics.at(-1)!.code).toBe("OBJ_LIMIT_EXCEEDED");
    expect(result.document).toBeUndefined();
  });

  it("honours pre-abort, mid-parse cancellation and bounded deadline", async () => {
    const before = new AbortController(); before.abort("private abort reason");
    await expect(parseObj(encode(triangle), {signal: before.signal})).rejects.toMatchObject({code:"OBJ_ABORTED"});
    const controller = new AbortController();
    const input = encode("# comment\n".repeat(10_000) + triangle);
    const pending = parseObj(input, {signal: controller.signal});
    setTimeout(() => controller.abort("private abort reason"), 0);
    await expect(pending).rejects.toMatchObject({code:"OBJ_ABORTED"});
    await expect(parseObj(input, {timeoutMs:1})).rejects.toMatchObject({code:"OBJ_DEADLINE_EXCEEDED"});
  });

  it("sanitizes both source-hash and core-resource verification failures", async () => {
    const native = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
    for (const failAt of [1,3]) {
      let calls = 0;
      const digest = vi.spyOn(globalThis.crypto.subtle,"digest").mockImplementation((...args) => {
        if (++calls === failAt) return Promise.reject(new Error("private provider detail"));
        return native(...args);
      });
      try {
        await expect(parseObj(encode(triangle))).rejects.toMatchObject({code:"OBJ_CANONICAL_VALIDATION_FAILED",message:"OBJ import: OBJ_CANONICAL_VALIDATION_FAILED"});
      } finally { digest.mockRestore(); }
    }
  });

  it("bridges the runtime acquisition port without invoking related-resource resolution", async () => {
    const adapter = createObjRuntimeAdapter();
    const registry = new AdapterRegistry().register({formatId:"obj", load:async () => adapter});
    const runtime = new ModelRuntime({registry});
    const result = await runtime.loadModel({kind:"uint8-array",bytes:encode(triangle)}, {formatId:"obj",mode:"strict"});
    expect(isGpuModelDocument(result.canonicalModel)).toBe(true);
    expect(adapter.supportsWorker).toBe(false);
    expect(adapter.sniff({bytes:encode(triangle),sourceKind:"uint8-array"})).toBeGreaterThan(0);
    expect(adapter.sniff({bytes:encode("other"),sourceKind:"uint8-array"})).toBe(0);
    await expect(runtime.loadModel({kind:"uint8-array",bytes:encode(vertices + "f 0 2 3")}, {formatId:"obj"})).rejects.toThrow(ObjImportError);
  });
});
