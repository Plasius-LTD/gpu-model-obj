import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { encodeGpuModelDocumentCanonical, isGpuModelDocument, type GpuModelDocument } from "@plasius/gpu-model-core";
import { AdapterRegistry, ModelRuntime } from "@plasius/gpu-model-runtime";
import { parseObj, exportObj, createObjRuntimeAdapter, OBJ_PARSER_LIMITS, type ObjParseOptions } from "../src/index.js";

type Point = [number, number, number];
const convex: Point[] = [[0,0,0],[2,0,0],[2,2,0],[1,3,0],[0,2,0]];
const concave: Point[] = [[0,0,0],[3,0,0],[3,3,0],[1,1,0],[0,3,0]];
const encode = (text: string) => new TextEncoder().encode(text);
const obj = (points: Point[], face = points.map((_,i)=>i+1).join(" ")) => points.map(p=>`v ${p.join(" ")}\n`).join("") + `f ${face}\n`;
async function values(result: { readonly document?: GpuModelDocument }, semantic = "POSITION") {
  const d = result.document!;
  const id = d.meshes[0]!.primitives[0]!.attributes.find(a=>a.semantic===semantic)!.accessorId;
  const a = d.accessors.find(a=>a.id===id)!;
  const r = d.resources.find(r=>r.id===a.resourceId)!;
  const view = new DataView(await r.payload.arrayBuffer());
  const width = a.elementType === "vec2" ? 2 : 3;
  return Array.from({length:a.count},(_,i)=>Array.from({length:width},(_,j)=>view.getFloat32(a.byteOffset+(i*width+j)*4,true)));
}
function cross(a: number[],b: number[],c: number[],axes=[0,1]) {
  const [x,y]=axes as [number,number];
  return (b[x]!-a[x]!)*(c[y]!-a[y]!)-(b[y]!-a[y]!)*(c[x]!-a[x]!);
}
function topology(points: Point[], triangles: number[][], axes=[0,1]) {
  expect(triangles).toHaveLength((points.length-2)*3);
  const area = points.reduce((sum,p,i)=>sum+p[axes[0]!]!*points[(i+1)%points.length]![axes[1]!]!-p[axes[1]!]!*points[(i+1)%points.length]![axes[0]!]!,0);
  let actual=0; const edges=new Map<string,number>();
  const add=(a:number,b:number)=>{const k=`${a},${b}`;edges.set(k,(edges.get(k)??0)+1);};
  for(let i=0;i<triangles.length;i+=3) {
    const tri=triangles.slice(i,i+3); const signed=cross(tri[0]!,tri[1]!,tri[2]!,axes);
    expect(Math.sign(signed)).toBe(Math.sign(area));actual+=signed;
    const ids=tri.map(p=>points.findIndex(q=>q.every((v,i)=>v===p[i])));
    expect(ids.every(id=>id>=0)).toBe(true);
    for(let j=0;j<3;j++) add(ids[j]!,ids[(j+1)%3]!);
  }
  expect(actual).toBeCloseTo(area,8);
  for(let i=0;i<points.length;i++) {
    const k=`${i},${(i+1)%points.length}`; expect(edges.get(k)).toBe(1);edges.delete(k);
  }
  for(const [k,count] of edges) expect(edges.get(k.split(",").reverse().join(","))).toBe(count);
}

describe("bounded deterministic polygon triangulation",()=>{
  it("imports the authored convex n-gon with exact signed area and boundary topology",async()=>{
    const bytes=new Uint8Array(readFileSync(new URL("./fixtures/ngon.obj",import.meta.url)));
    const r=await parseObj(bytes);expect(r.report.accepted).toBe(true);topology(convex,await values(r));
    expect(r.repairs).toEqual([]);expect(r.lossReports).toEqual([]);
  });
  it.each([false,true])("preserves concave topology and winding with reversal=%s",async reverse=>{
    const points=reverse?[...concave].reverse():concave;
    const r=await parseObj(encode(obj(points)));expect(r.report.accepted).toBe(true);topology(points,await values(r));
  });
  it.each([0,1,2])("supports dominant projection axis %s and tilted planes",async axis=>{
    const points=concave.map(([x,y])=>(axis===0?[0,x,y]:axis===1?[x,0,y]:[x,y,0]) as Point);
    for(const p of [points,[...points].reverse()]) {
      const r=await parseObj(encode(obj(p)));expect(r.report.accepted).toBe(true);
      topology(p,await values(r),axis===0?[1,2]:axis===1?[0,2]:[0,1]);
    }
  });
  it("preserves tilted and translated planar contours",async()=>{
    const p=concave.map(([x,y])=>[x+1048576,y+1048576,x+y+1048576] as Point);
    const r=await parseObj(encode(obj(p)));expect(r.report.accepted).toBe(true);topology(p,await values(r));
  });
  it.each([1e-15,1e15])("normalizes stable predicates at scale %s",async scale=>{
    const p=concave.map(v=>v.map(x=>Math.fround(x*scale)) as Point);
    const r=await parseObj(encode(obj(p)));expect(r.report.accepted).toBe(true);
    const triangles=await values(r);expect(triangles).toHaveLength(9);
    expect(triangles.every(v=>p.some(q=>q.every((x,i)=>x===v[i])))).toBe(true);
  });
  it("preserves independent negative UV/normal indices on every emitted corner",async()=>{
    const source=concave.map(p=>`v ${p.join(" ")}`).join("\n")+"\n"+
      concave.map((_,i)=>`vt ${i} ${i+1}\nvn ${i+1} 0 1`).join("\n")+"\nf -5/5/1 -4/4/2 -3/3/3 -2/2/4 -1/1/5\n";
    const r=await parseObj(encode(source));expect(r.report.accepted).toBe(true);
    const ps=await values(r),uv=await values(r,"TEXCOORD_0"),ns=await values(r,"NORMAL");topology(concave,ps);
    for(let i=0;i<ps.length;i++) {const j=concave.findIndex(p=>p.every((x,k)=>x===ps[i]![k]));expect(uv[i]).toEqual([4-j,5-j]);expect(ns[i]).toEqual([j+1,0,1]);}
  });
  it("is byte deterministic, preserves metadata and round-trips triangle export",async()=>{
    const bytes=encode("o mesh\ng panel\nusemtl matte\ns 2\n"+obj(concave));
    const a=await parseObj(bytes),b=await parseObj(bytes);
    expect(a.report).toEqual(b.report);expect(encodeGpuModelDocumentCanonical(a.document!)).toEqual(encodeGpuModelDocumentCanonical(b.document!));
    expect(a.document!.meshes[0]!.primitives[0]!.metadata).toMatchObject({objectName:"mesh",groups:["panel"],materialName:"matte",smoothing:"2"});
    const x=await exportObj(a.document!,{kind:"uint8-array"}),y=await exportObj(b.document!,{kind:"uint8-array"});
    expect(x.report.accepted).toBe(true);expect(x.output).toEqual(y.output);
    const c=await parseObj(x.output as Uint8Array);expect(c.report.accepted).toBe(true);expect(await values(c)).toEqual(await values(a));
  });
  it("supports runtime orchestration without implicit fetch",async()=>{
    const fetch=vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("private"));
    try {
      const registry=new AdapterRegistry().register({formatId:"obj",extensions:["obj"],load:async()=>createObjRuntimeAdapter()});
      const r=await new ModelRuntime({registry}).loadModel({kind:"uint8-array",bytes:encode(obj(concave))},{formatId:"obj",mode:"strict"});
      expect(isGpuModelDocument(r.canonicalModel)).toBe(true);
      if (!isGpuModelDocument(r.canonicalModel)) throw new Error("Missing canonical model");
      topology(concave,await values({document:r.canonicalModel}));expect(fetch).not.toHaveBeenCalled();
    } finally {fetch.mockRestore();}
  });
  const bad: [string,Point[]][]=[
    ["collinear",[[0,0,0],[1,0,0],[2,0,0]]],
    ["repeated closing vertex",[...convex,convex[0]!]],
    ["consecutive duplicate",[convex[0]!,convex[0]!,...convex.slice(1)]],
    ["collinear corner",[[0,0,0],[1,0,0],[2,0,0],[2,2,0],[0,2,0]]],
    ["bow tie",[[0,0,0],[2,2,0],[0,2,0],[2,0,0]]],
    ["crossing with nonzero area",[[0,0,0],[3,0,0],[0,2,0],[3,3,0],[1,3,0]]],
    ["touching",[[0,0,0],[2,0,0],[2,2,0],[1,0,0],[0,2,0]]],
    ["non-planar",[[0,0,0],[2,0,0],[2,2,.01],[0,2,0]]],
    ["thin ambiguous triangle",[[0,0,0],[1,0,0],[.5,1e-13,0]]],
    ["f32 collapse",[[1e10,0,0],[1e10+1,0,0],[1e10,1,0]]],
    ["all coincident",[[0,0,0],[0,0,0],[0,0,0]]],
  ];
  it.each(bad)("rejects %s in every mode without silently repairing",async(_,p)=>{
    for(const mode of ["strict","tolerant","forensic"] as const) {
      const r=await parseObj(encode("# private-token\no private-name\n"+obj(p)+"v 0 0 0\nv 1 0 0\nv 0 1 0\nf -3 -2 -1"),{mode,allowLoss:true});
      expect(r.report.accepted).toBe(false);expect(r.document).toBeUndefined();expect(r.repairs).toEqual([]);
      expect(JSON.stringify(r.report)).not.toMatch(/private-token|private-name/);
    }
  });
  it.each([
    {maxFaceVertices:4}, {maxTriangulationWork:1}, {maxOutputVertices:8},
  ])("rejects a tightened triangulation budget %j atomically",async limits=>{
    const r=await parseObj(encode(obj(concave)),{limits} as ObjParseOptions);
    expect(r.report.accepted).toBe(false);expect(r.document).toBeUndefined();expect(r.diagnostics.some(d=>d.code==="OBJ_LIMIT_EXCEEDED")).toBe(true);
  });
  it("enforces an import-wide work budget rather than resetting it per face",async()=>{
    const single=await parseObj(encode(obj(convex)),{limits:{maxTriangulationWork:50}});expect(single.report.accepted).toBe(true);
    const r=await parseObj(encode(obj(convex)+"f 1 2 3 4 5\n"),{limits:{maxTriangulationWork:50}});
    expect(r.report.accepted).toBe(false);expect(r.diagnostics.some(d=>d.code==="OBJ_LIMIT_EXCEEDED")).toBe(true);
  });
  it("publishes and validates immutable hard ceilings",async()=>{
    expect(OBJ_PARSER_LIMITS).toMatchObject({maxFaceVertices:256,maxTriangulationWork:1000000});expect(Object.isFrozen(OBJ_PARSER_LIMITS)).toBe(true);
    for(const limits of [{maxFaceVertices:257},{maxTriangulationWork:1000001},{maxFaceVertices:0}]) await expect(parseObj(encode(obj(convex)),{limits} as ObjParseOptions)).rejects.toMatchObject({code:"OBJ_INVALID_OPTIONS"});
    const boundary=Array.from({length:256},(_,i)=>[Math.cos(i*2*Math.PI/256),Math.sin(i*2*Math.PI/256),0] as Point);
    const admitted=await parseObj(encode(obj(boundary)));expect(admitted.report.accepted).toBe(true);expect(await values(admitted)).toHaveLength(762);
    const p=Array.from({length:257},(_,i)=>[Math.cos(i*2*Math.PI/257),Math.sin(i*2*Math.PI/257),0] as Point);
    const r=await parseObj(encode(obj(p)));expect(r.report.accepted).toBe(false);expect(r.diagnostics.some(d=>d.code==="OBJ_LIMIT_EXCEEDED")).toBe(true);
  });
  it("yields inside one polygon for cancellation/deadline before source-line checkpoints",async()=>{
    // 80 vertices + one face: cancellation must occur inside geometry work (<128 source lines).
    const p=Array.from({length:80},(_,i)=>[Math.cos(i*2*Math.PI/80),Math.sin(i*2*Math.PI/80),0] as Point);
    const controller=new AbortController();const pending=parseObj(encode(obj(p)),{signal:controller.signal});
    setTimeout(()=>controller.abort("private-reason"),0);
    await expect(pending).rejects.toMatchObject({code:"OBJ_ABORTED",message:"OBJ import: OBJ_ABORTED"});
    await expect(parseObj(encode(obj(p)),{timeoutMs:1})).rejects.toMatchObject({code:"OBJ_DEADLINE_EXCEEDED"});
  });
  it("records one bounded conversion warning and fails when diagnostics cannot fit",async()=>{
    const bytes=encode(obj(convex)+"f 1 2 3 4 5\n");
    const r=await parseObj(bytes,{limits:{maxDiagnostics:1}});expect(r.report.accepted).toBe(true);
    expect(r.diagnostics.filter(d=>d.code==="OBJ_POLYGON_TRIANGULATED")).toHaveLength(1);
    const blocked=await parseObj(encode("bad-record\n"+obj(convex)),{limits:{maxDiagnostics:1}});
    expect(blocked.report.accepted).toBe(false);expect(blocked.document).toBeUndefined();
  });
  it("leaves malformed-index recovery explicit for polygon faces",async()=>{
    const bytes=encode(obj(concave)+"f 0 2 3 4 5\n");
    const r=await parseObj(bytes,{mode:"tolerant",allowLoss:true});expect(r.report.accepted).toBe(true);
    expect(r.repairs).toHaveLength(1);expect(r.repairs[0]!.ruleId).toBe("invalid-indices");
    expect(r.lossReports).toHaveLength(1);topology(concave,await values(r));
  });
  it("satisfies topology for deterministic generated convex/concave radial contours",async()=>{
    for(const n of [4,7,12,24]) {
      const p=Array.from({length:n},(_,i)=>{const radius=i%2?1:2;return [Math.fround(radius*Math.cos(i*2*Math.PI/n)),Math.fround(radius*Math.sin(i*2*Math.PI/n)),0] as Point;});
      const a=await parseObj(encode(obj(p))),b=await parseObj(encode(obj(p)));expect(a.report.accepted).toBe(true);
      const triangles=await values(a);topology(p,triangles);expect(await values(b)).toEqual(triangles);
    }
  });
});
