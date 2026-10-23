import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createGpuModelDocument, encodeGpuModelDocumentCanonical, isGpuModelDocument, type GpuModelDocument } from "@plasius/gpu-model-core";
import { AdapterRegistry, ModelRuntime } from "@plasius/gpu-model-runtime";
import { parseObj, exportObj, createObjRuntimeAdapter, OBJ_PARSER_LIMITS, type ObjParseOptions } from "../src/index.js";
import { generateObjNormals } from "../src/normals.js";
import { parserClock } from "../src/policy.js";
import type { ObjGeometryGroup } from "../src/canonical.js";

const enc = (text: string) => new TextEncoder().encode(text);
const vertices = "v 0 0 0\nv 1 0 0\nv 0 1 0\nv 0 0 1\n";
const wedge = (s = "round") => vertices + `s ${s}\nf 1 2 3\nf 1 4 2\n`;
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const generated = { missingNormals: "generate" } as const;
type Result = Awaited<ReturnType<typeof parseObj>>;
async function values(r: { readonly document?: GpuModelDocument }, semantic = "NORMAL", primitive = 0) {
  const d = r.document!;
  const ref = d.meshes[0]!.primitives[primitive]!.attributes.find(a => a.semantic === semantic);
  if (!ref) return [];
  const a = d.accessors.find(a => a.id === ref.accessorId)!;
  const resource = d.resources.find(b => b.id === a.resourceId)!;
  const view = new DataView(await resource.payload.arrayBuffer());
  const width = a.elementType === "vec2" ? 2 : 3;
  return Array.from({ length: a.count }, (_, i) => Array.from({ length: width }, (_, j) => view.getFloat32(a.byteOffset + (i * width + j) * 4, true)));
}
function close(actual: number[] | undefined, expected: number[]) {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((x, i) => expect(actual![i]).toBeCloseTo(x, 6));
}
function rejected(r: Result, code: string) {
  expect(r.report.accepted).toBe(false); expect(r.document).toBeUndefined();
  expect(JSON.stringify(r)).toContain(code); expect(r.repairs).toEqual([]);
}

describe("explicit bounded OBJ normal policy", () => {
  it("keeps the default missing-normal profile and never invents normals", async () => {
    const r = await parseObj(enc(wedge()));
    expect(r.report.accepted).toBe(true); expect(await values(r)).toEqual([]);
    const explicit = await parseObj(enc(wedge()), { missingNormals: "preserve" });
    expect(encodeGpuModelDocumentCanonical(explicit.document!)).toEqual(encodeGpuModelDocumentCanonical(r.document!));
  });
  it.each(["off", "0"])("generates original-face hard edges for s %s", async s => {
    const r = await parseObj(enc(wedge(s)), generated); expect(r.report.accepted).toBe(true);
    expect(await values(r)).toEqual([[0,0,1],[0,0,1],[0,0,1],[0,1,0],[0,1,0],[0,1,0]]);
    expect(r.document!.meshes[0]!.primitives[0]!.metadata!.smoothing).toBe("off");
    expect(r.repairs).toEqual([]); expect(r.lossReports).toEqual([]);
    expect(JSON.stringify(r.diagnostics)).toContain("OBJ_NORMALS_GENERATED");
  });
  it.each(["1", "42", "rounded", "on"])("smooths shared source indices under group %s", async s => {
    const r = await parseObj(enc(wedge(s)), generated); expect(r.report.accepted).toBe(true);
    const ns = await values(r); const h = Math.SQRT1_2;
    close(ns[0], [0,h,h]); close(ns[1], [0,h,h]); close(ns[2], [0,0,1]);
    close(ns[3], [0,h,h]); close(ns[4], [0,1,0]); close(ns[5], [0,h,h]);
    expect(r.document!.meshes[0]!.primitives[0]!.metadata!.smoothing).toBe(s === "on" ? "1" : s);
  });
  it("smooths across material, group and UV seams without merging their canonical primitives", async () => {
    const r = await parseObj(fixture("smooth-wedge.obj"), generated);
    expect(r.report.accepted).toBe(true); expect(r.document!.meshes[0]!.primitives).toHaveLength(2);
    close((await values(r))[0], [0,Math.SQRT1_2,Math.SQRT1_2]);
    close((await values(r,"NORMAL",1))[0], [0,Math.SQRT1_2,Math.SQRT1_2]);
    expect(r.document!.meshes[0]!.primitives.map(p => p.metadata!.materialName)).toEqual(["red","blue"]);
    const uv = await parseObj(enc(vertices + "vt 0 0\nvt 1 1\ns same\nf 1/1 2/1 3/1\nf 1/2 4/2 2/2"), generated);
    close((await values(uv))[0], [0,Math.SQRT1_2,Math.SQRT1_2]);
    expect((await values(uv,"TEXCOORD_0"))[3]).toEqual([1,1]);
  });
  it("separates smoothing transitions and object identities", async () => {
    for (const transition of ["s other", "s off", "o other"]) {
      const r = await parseObj(enc(vertices + `o first\ns round\nf 1 2 3\n${transition}\nf 1 4 2`), generated);
      expect((await values(r))[0]).toEqual([0,0,1]);
      expect((await values(r,"NORMAL",1))[0]).toEqual([0,1,0]);
    }
  });
  it("does not weld distinct source positions with coincident coordinates", async () => {
    const r = await parseObj(enc(vertices + "v 0 0 0\ns same\nf 1 2 3\nf 5 4 2"), generated);
    const ns = await values(r); expect(ns[0]).toEqual([0,0,1]); expect(ns[3]).toEqual([0,1,0]);
  });
  it("uses area weights rather than equal face weights", async () => {
    const r = await parseObj(enc(wedge().replace("v 0 0 1", "v 0 0 2")), generated);
    close((await values(r))[0], [0,2/Math.sqrt(5),1/Math.sqrt(5)]);
  });
  it("counts an original polygon once per source corner, independently of ear incidence", async () => {
    const r = await parseObj(enc("v 0 0 0\nv 2 0 0\nv 2 2 0\nv 0 2 0\nv 0 0 2\ns one\nf 1 2 3 4\nf 1 5 2"), generated);
    const ps = await values(r,"POSITION"); const ns = await values(r);
    ps.forEach((p,i) => { if (p[1] === 0 && p[2] === 0) close(ns[i], [0,1/Math.sqrt(5),2/Math.sqrt(5)]); });
  });
  it("preserves authored f32 normal values while filling individual missing corners", async () => {
    const r = await parseObj(fixture("mixed-normals.obj"), generated);
    expect(r.report.accepted).toBe(true); expect(await values(r)).toEqual([[0,0,2],[0,0,1],[0,0,1]]);
    rejected(await parseObj(fixture("mixed-normals.obj")), "OBJ_MIXED_ATTRIBUTES");
  });
  it("includes geometry of authored-normal faces in missing-neighbour smoothing", async () => {
    const r = await parseObj(enc(vertices + "vn 1 0 0\ns same\nf 1//1 2//1 3//1\nf 1 4 2"), generated);
    expect(await values(r)).toEqual([[1,0,0],[1,0,0],[1,0,0]]);
    close((await values(r,"NORMAL",1))[0], [0,Math.SQRT1_2,Math.SQRT1_2]);
  });
  it.each(["strict","tolerant","forensic"] as const)("rejects missing normals explicitly in %s", async mode => {
    rejected(await parseObj(enc(wedge()), { mode, allowLoss:true, missingNormals:"reject" }), "OBJ_MISSING_NORMALS");
    const r = await parseObj(fixture("mixed-normals.obj"), { mode, allowLoss:true, missingNormals:"reject" });
    rejected(r, "OBJ_MISSING_NORMALS");
  });
  it.each(["strict","tolerant","forensic"] as const)("rejects cancelling smooth normals atomically in %s", async mode => {
    rejected(await parseObj(enc(vertices + "s same\nf 1 2 3\nf 1 3 2"), { ...generated, mode, allowLoss:true }), "OBJ_AMBIGUOUS_NORMAL");
  });
  it("does not reject authored normals merely because geometric smooth sums cancel", async () => {
    const r = await parseObj(enc(vertices + "vn 0 0 3\ns same\nf 1//1 2//1 3//1\nf 1//1 3//1 2//1"), generated);
    expect(r.report.accepted).toBe(true); expect(JSON.stringify(r.diagnostics)).not.toContain("OBJ_NORMALS_GENERATED");
  });
  it("rejects near-cancelling requested directions and does not expose source text",async()=>{
    const r=await parseObj(enc(vertices+"v 0 1 1e-13\ns private-asset-name\nf 1 2 3\nf 1 5 2"),generated);
    rejected(r,"OBJ_AMBIGUOUS_NORMAL");expect(JSON.stringify(r.diagnostics)).not.toContain("private-asset-name");
  });
  it("processes a bounded multi-batch smooth mesh and preserves every corner",async()=>{
    const r=await parseObj(enc(vertices+"s batch\n"+"f 1 2 3\n".repeat(1000)),generated);
    expect(r.report.accepted).toBe(true);expect(await values(r)).toEqual(Array.from({length:3000},()=>[0,0,1]));
  });
  it.each(["bad group", "", "bad\u00a0group", "bad\\group"])("rejects invalid smoothing tokens without leaking them: %s", async s => {
    for (const mode of ["strict","tolerant"] as const) rejected(await parseObj(enc(vertices + `s ${s}\nf 1 2 3`), { ...generated, mode }), "OBJ_INVALID_SMOOTHING");
  });
  it.each(["invent", null, true, 1])("validates the normal policy value %s", async missingNormals => {
    await expect(parseObj(enc(wedge()), { missingNormals } as unknown as ObjParseOptions)).rejects.toMatchObject({ code:"OBJ_INVALID_OPTIONS" });
  });
  it("rejects getters without invoking them", async () => {
    let called = false; const options = Object.defineProperty({},"missingNormals",{ get(){called=true;return "generate";} });
    await expect(parseObj(enc(wedge()), options)).rejects.toMatchObject({code:"OBJ_INVALID_OPTIONS"}); expect(called).toBe(false);
  });
  it("bounds normal work and diagnostic capacity with no partial document", async () => {
    expect(OBJ_PARSER_LIMITS.maxNormalWork).toBe(1_000_000);
    rejected(await parseObj(enc(wedge()), { ...generated, limits:{maxNormalWork:1} }), "OBJ_LIMIT_EXCEEDED");
    rejected(await parseObj(enc("v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4"), { ...generated, limits:{maxDiagnostics:1} }), "OBJ_LIMIT_EXCEEDED");
  });
  it("checks cancellation and deadlines during normal generation itself", async () => {
    for (const cancel of [true,false]) {
      const controller=new AbortController(); const clock=parserClock(controller.signal,30_000);
      const group:ObjGeometryGroup={objectName:"",groups:[],materialName:"",smoothing:"same",positions:[],uvs:[],normals:[]};
      const face={group,offset:0,corners:[{p:0,n:undefined},{p:1,n:undefined},{p:2,n:undefined}],triangles:[0,1,2]};
      const checkpoint=vi.spyOn(clock,"checkpoint").mockImplementation(async()=>{
        if(cancel) controller.abort("private cancellation detail");
        else vi.spyOn(performance,"now").mockReturnValue(Number.MAX_SAFE_INTEGER);
        clock.check();
      });
      try {
        await expect(generateObjNormals(Array.from({length:100},()=>face),[[0,0,0],[1,0,0],[0,1,0]],OBJ_PARSER_LIMITS,clock)).rejects.toMatchObject({code:cancel?"OBJ_ABORTED":"OBJ_DEADLINE_EXCEEDED"});
        expect(checkpoint).toHaveBeenCalled();
      } finally {vi.restoreAllMocks();}
    }
  });
  it("keeps complete authored normals under reject and generate policies", async()=>{
    for(const missingNormals of ["reject","generate"] as const){
      const r=await parseObj(enc(vertices+"vn 0 0 7\nf 1//1 2//1 3//1"),{missingNormals});
      expect(r.report.accepted).toBe(true);expect(await values(r)).toEqual([[0,0,7],[0,0,7],[0,0,7]]);
    }
    rejected(await parseObj(enc(vertices+"vt 0 0\nf 1/1 2 3"),generated),"OBJ_MIXED_ATTRIBUTES");
  });
  it("rejects invalid smoothing metadata on export and canonicalizes aliases",async()=>{
    const r=await parseObj(enc(wedge()));const d=r.document!;const mesh=d.meshes[0]!;
    for(const smoothing of ["private multi token","0","on"]){
      const document=createGpuModelDocument({...d,meshes:[{...mesh,primitives:mesh.primitives.map(p=>({...p,metadata:{...p.metadata,smoothing}}))}]});
      const out=await exportObj(document,{kind:"uint8-array"});
      if(smoothing.includes(" ")){expect(out.output).toBeUndefined();expect(JSON.stringify(out.diagnostics)).toContain("OBJ_EXPORT_INVALID_REFERENCE");expect(JSON.stringify(out.diagnostics)).not.toContain("private multi token");}
      else {expect(out.report.accepted).toBe(true);expect(new TextDecoder().decode(out.output as Uint8Array)).toContain(`s ${smoothing==="0"?"off":"1"}\n`);}
    }
  });
  it.each([1e-15,1e15])("generates finite unit directions at scale %s", async s => {
    const r=await parseObj(enc(`v 0 0 0\nv ${s} 0 0\nv 0 ${s} 0\nf 1 2 3`),generated);
    expect(await values(r)).toEqual([[0,0,1],[0,0,1],[0,0,1]]);
  });
  it("keeps winding and all original polygon flat normals", async () => {
    const r = await parseObj(enc("v 0 0 0\nv 2 0 0\nv 2 2 0\nv 1 1 0\nv 0 2 0\ns off\nf 5 4 3 2 1"), generated);
    expect(await values(r)).toEqual(Array.from({length:9},()=>[0,0,-1]));
  });
  it("exports named/numeric transitions deterministically and round trips authored/generated directions", async () => {
    const bytes=enc(vertices+"s rounded\nf 1 2 3\ns 17\nf 1 4 2\ns off\nf 1 2 3");
    const r=await parseObj(bytes,generated); const a=await parseObj(bytes,generated);
    expect(encodeGpuModelDocumentCanonical(r.document!)).toEqual(encodeGpuModelDocumentCanonical(a.document!));
    const target={kind:"uint8-array"} as const;
    const x=await exportObj(r.document!,target); const y=await exportObj(r.document!,target);
    expect(x.output).toEqual(y.output); const text=new TextDecoder().decode(x.output as Uint8Array);
    expect(text).toContain("s rounded\n"); expect(text).toContain("s 17\n"); expect(text).toContain("s off\n");
    const back=await parseObj(x.output as Uint8Array,{missingNormals:"reject"}); expect(back.report.accepted).toBe(true);
    for(let i=0;i<3;i++) expect(await values(back,"NORMAL",i)).toEqual(await values(r,"NORMAL",i));
  });
  it("passes the generation policy through the existing runtime bridge", async () => {
    const adapter=createObjRuntimeAdapter(generated);
    const runtime=new ModelRuntime({registry:new AdapterRegistry().register({formatId:"obj",load:async()=>adapter})});
    const r=await runtime.loadModel({kind:"uint8-array",bytes:enc(wedge())},{formatId:"obj",mode:"strict"});
    if(!isGpuModelDocument(r.canonicalModel)) throw new Error("Invalid runtime document");
    close((await values({document:r.canonicalModel}))[0],[0,Math.SQRT1_2,Math.SQRT1_2]);
    expect(()=>createObjRuntimeAdapter({missingNormals:"unknown"} as never)).toThrow();
  });
  it("supports remote consumer enable, disable and rollback without introducing a package evaluator", async () => {
    const evaluator=vi.fn(async()=>false); const parse=vi.fn(()=>parseObj(enc(wedge()),generated));
    const consume=async()=>await evaluator()?parse():undefined;
    expect(await consume()).toBeUndefined(); expect(parse).not.toHaveBeenCalled();
    evaluator.mockResolvedValue(true); expect((await consume())!.report.accepted).toBe(true);
    evaluator.mockResolvedValue(false); expect(await consume()).toBeUndefined(); expect(parse).toHaveBeenCalledTimes(1);
  });
});
