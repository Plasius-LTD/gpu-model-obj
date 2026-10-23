import { describe, expect, it, vi } from "vitest";
import { createGpuModelDocument, createAndVerifyGpuModelDocument, createModelConversionRegistry, createModelResultBase, isGpuModelDocument, verifyGpuModelResource, type GpuModelMetadata, type GpuModelDocument, type ModelTarget, type GpuModelResourceVerificationPort } from "@plasius/gpu-model-core";
import { sha256Hex } from "@plasius/gpu-model-runtime";
import { parseObj, exportObj, OBJ_EXPORT_LIMITS } from "../src/index.js";

const encode = (text: string) => new TextEncoder().encode(text);
const triangle = "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n";
const target = { kind: "uint8-array" } as const;
async function model(text = triangle) {
  const result = await parseObj(encode(text));
  if (!result.document) throw new Error("fixture failed");
  return result.document;
}
async function textOf(result: Awaited<ReturnType<typeof exportObj>>) {
  const output = result.output;
  if (output instanceof Blob) return output.text();
  if (output instanceof Uint8Array || output instanceof ArrayBuffer) return new TextDecoder().decode(output);
  throw new Error("no output");
}
async function values(document: GpuModelDocument, semantic: string) {
  const output: number[][] = [];
  for (const primitive of document.meshes.flatMap(mesh => mesh.primitives)) {
    const attr = primitive.attributes.find(a => a.semantic === semantic);
    if (!attr) { output.push([]); continue; }
    const accessor = document.accessors.find(a => a.id === attr.accessorId)!;
    const resource = document.resources.find(r => r.id === accessor.resourceId)!;
    const bytes = new DataView(await resource.payload.arrayBuffer());
    const width = accessor.elementType === "vec2" ? 2 : 3;
    output.push(Array.from({ length: accessor.count * width }, (_, i) => bytes.getFloat32(accessor.byteOffset + i * 4, true)));
  }
  return output;
}
function modify(document: GpuModelDocument, fields: Partial<GpuModelDocument>) { return createGpuModelDocument({ ...document, ...fields }); }

describe("deterministic canonical OBJ exporter", () => {
  it("writes stable one-based triangles with LF and no partial state", async () => {
    const doc = await model();
    const a = await exportObj(doc, target);
    const b = await exportObj(doc, target);
    expect(a.report.accepted).toBe(true);
    expect(OBJ_EXPORT_LIMITS.maxOutputBytes).toBe(8*1024*1024);
    expect(a.output).toEqual(b.output);
    expect(await textOf(a)).toContain("v 0 0 0\nv 1 0 0\nv 0 1 0\n");
    expect(await textOf(a)).toContain("f 1 2 3\n");
    expect(await textOf(a)).not.toContain("\r");
    expect(a.target).toBe("uint8-array");
    expect(a.resourcePackage).toEqual({ format: "inline", entries: [{ id: "obj", role: "mesh", path: "model.obj", contentType: "text/plain" }] });
    const again = await parseObj(a.output as Uint8Array);
    expect(again.report.accepted).toBe(true);
    expect(await values(again.document!, "POSITION")).toEqual(await values(doc, "POSITION"));
  });

  it.each(["uint8-array", "array-buffer", "blob"] as const)("honours the core %s target", async kind => {
    const doc = await model();
    const result = await exportObj(doc, { kind });
    expect(result.report.accepted).toBe(true);
    expect(result.output).toBeInstanceOf(kind === "blob" ? Blob : kind === "array-buffer" ? ArrayBuffer : Uint8Array);
    if (result.output instanceof Blob) expect(result.output.type).toBe("text/plain");
    expect(await textOf(result)).toBe(await textOf(await exportObj(doc, target)));
  });

  it("preserves f32 positions, UV seams, normals, named references and face order", async () => {
    const source = "mtllib missing.mtl\no named mesh\ng a b\nusemtl matte\ns 1\n" +
      "v 0.1 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 0 1\nvn 0 0 2\n" +
      "f 1/3/1 2/2/1 3/1/1\nusemtl gloss\ng c\ns off\nf -1/1/1 -2/2/1 -3/3/1\n";
    const doc = await model(source);
    const output = await exportObj(doc, target);
    const reimport = await model(await textOf(output));
    for (const semantic of ["POSITION", "TEXCOORD_0", "NORMAL"]) expect(await values(reimport, semantic)).toEqual(await values(doc, semantic));
    expect(reimport.metadata.materialLibraries).toEqual(doc.metadata.materialLibraries);
    expect(reimport.meshes[0]!.primitives.map(p => p.metadata)).toEqual(doc.meshes[0]!.primitives.map(p => p.metadata));
    expect(output.lossReports).toEqual([]);
  });

  it("keeps v/vt/vn counters independent between attribute profiles", async () => {
    const doc = await model(triangle + "o second\nvt 0 0\nvt 1 0\nvt 0 1\nf 1/1 2/2 3/3\no third\nvn 0 0 1\nf 1//1 2//1 3//1");
    const text = await textOf(await exportObj(doc, target));
    expect(text).toContain("f 1/1 2/2 3/3");
    expect(text).toContain("f 1//1 2//1 3//1");
    expect((await model(text)).meshes[0]!.primitives).toHaveLength(3);
  });

  it("bakes parent transforms and reflection while preserving normal direction", async () => {
    const doc = await model("vn 0 0 1\n" + triangle.replace("f 1 2 3", "f 1//1 2//1 3//1"));
    const root = doc.nodes[0]!;
    const transformed = modify(doc, {
      roots: ["parent"], nodes: [
        { id: "parent", children: [root.id], localMatrix: [1,0,0,0,0,1,0,0,0,0,1,0,2,0,0,1] },
        { ...root, localMatrix: [-2,0,0,0,0,3,0,0,0,0,4,0,0,0,0,1] },
      ], bounds: { min: [0,0,0], max: [2,3,0] },
    });
    const output = await exportObj(transformed, target);
    const reimport = await model(await textOf(output));
    expect(await values(reimport, "POSITION")).toEqual([[2,0,0,2,3,0,0,0,0]]);
    expect(await values(reimport, "NORMAL")).toEqual([[0,0,0.25,0,0,0.25,0,0,0.25]]);
  });

  it.each(["u8","u16","u32"] as const)("supports verified interleaved geometry with little-endian %s indices", async componentType => {
    const doc = await model();
    const size=componentType === "u8" ? 1 : componentType === "u16" ? 2 : 4;
    const bytes = new Uint8Array(48+3*size); const view = new DataView(bytes.buffer);
    [0,0,0,99, 1,0,0,99, 0,1,0,99].forEach((n,i) => view.setFloat32(i*4,n,true));
    [2,0,1].forEach((n,i) => {if(size===1)view.setUint8(48+i,n);else if(size===2)view.setUint16(48+i*2,n,true);else view.setUint32(48+i*4,n,true);});
    const port: GpuModelResourceVerificationPort = {
      async digestSha256(chunks) { const all=[];for await(const c of chunks) all.push(...c);return sha256Hex(new Uint8Array(all)); },
      async inspectResource(chunks) {for await(const _c of chunks) void _c;return {valid:true,detectedMimeType:"application/octet-stream"};},
    };
    const indexed = await createAndVerifyGpuModelDocument({ ...doc,
      resources: [{id:"b",kind:"buffer",byteLength:bytes.byteLength,contentHash:await sha256Hex(bytes),mimeType:"application/octet-stream",payload:new Blob([bytes.buffer])}],
      accessors:[{id:"p",resourceId:"b",byteOffset:0,byteStride:16,count:3,componentType:"f32",elementType:"vec3",min:[0,0,0],max:[1,1,0]},{id:"i",resourceId:"b",byteOffset:48,count:3,componentType,elementType:"scalar"}],
      meshes:[{id:"mesh",primitives:[{id:"p",topology:"triangles",indicesAccessorId:"i",attributes:[{semantic:"POSITION",accessorId:"p"}]}]}],
    },port);
    const reimport = await model(await textOf(await exportObj(indexed,target)));
    expect(await values(reimport,"POSITION")).toEqual([[0,1,0,0,0,0,1,0,0]]);
  });

  it("rejects unverified documents without evaluating their fields", async () => {
    const read=vi.fn(()=>{throw Error("private source");});
    const bad=Object.defineProperty({},"nodes",{get:read});
    await expect(exportObj(bad as GpuModelDocument,target)).rejects.toMatchObject({code:"OBJ_EXPORT_INVALID_DOCUMENT"});
    expect(read).not.toHaveBeenCalled();
    await expect(exportObj({...await model()},target)).rejects.toMatchObject({code:"OBJ_EXPORT_INVALID_DOCUMENT"});
  });

  it.each([null,{}, {kind:"blob",fileName:null},{kind:"blob",unknown:1},{kind:"blob",mimeType:"text/html"},{kind:"blob",fileName:"../private.obj"},{kind:"uint8-array",path:"private"},{kind:"file-path",path:"private"},{kind:"stream",stream:{}},{kind:"package",packageFormat:"zip"}])("rejects malformed/unsupported targets without values in errors", async bad => {
    await expect(exportObj(await model(),bad as ModelTarget)).rejects.toMatchObject({code:"OBJ_EXPORT_INVALID_TARGET",message:"OBJ export: OBJ_EXPORT_INVALID_TARGET"});
  });

  it("does not evaluate getters in targets/options or retain external failures", async () => {
    const get=vi.fn(()=>"private");const t=Object.defineProperty({},"kind",{get});
    const doc=await model();
    await expect(exportObj(doc,t as ModelTarget)).rejects.toMatchObject({code:"OBJ_EXPORT_INVALID_TARGET"});
    await expect(exportObj(doc,target,Object.defineProperty({},"mode",{get}))).rejects.toMatchObject({code:"OBJ_EXPORT_INVALID_OPTIONS"});
    expect(get).not.toHaveBeenCalled();
  });

  it.each([null,{mode:null},{allowLoss:null},{timeoutMs:null},{mode:"invalid"},{allowLoss:"yes"},{timeoutMs:0},{timeoutMs:30001},{signal:{}},{limits:{maxOutputBytes:0}},{limits:{maxOutputBytes:8*1024*1024+1}},{limits:{unknown:1}},{unknown:1}])("rejects invalid export policy", async bad => {
    await expect(exportObj(await model(),target,bad as never)).rejects.toMatchObject({code:"OBJ_EXPORT_INVALID_OPTIONS"});
  });

  it("rejects unsupported topology/attributes and animation rather than dropping them", async () => {
    const doc=await model();const mesh=doc.meshes[0]!;const primitive=mesh.primitives[0]!;
    const cases=[
      modify(doc,{meshes:[{...mesh,primitives:[{...primitive,topology:"line-strip"}]}]}),
      modify(doc,{meshes:[{...mesh,primitives:[{...primitive,attributes:[...primitive.attributes,{semantic:"_CUSTOM",accessorId:primitive.attributes[0]!.accessorId}]}]}]}),
      modify(doc,{animations:[{id:"a",durationSeconds:0,samplers:[],channels:[],sourceMetadata:{}}]}),
    ];
    for(const input of cases){const result=await exportObj(input,target,{mode:"forensic",allowLoss:true});expect(result.report.accepted).toBe(false);expect(result.output).toBeUndefined();expect(JSON.stringify(result.report)).not.toContain("private");}
  });

  it("requires explicit loss consent to export canonical material references without MTL", async () => {
    const doc=await model();const mesh=doc.meshes[0]!;
    const materialDoc=modify(doc,{materials:[{id:"mat",name:"matte",workflow:"metallic-roughness",alphaMode:"opaque",baseColorFactor:[1,1,1,1],textures:{},extensions:{},sourceMetadata:{}}],meshes:[{...mesh,primitives:[{...mesh.primitives[0]!,materialId:"mat"}]}]});
    const rejected=await exportObj(materialDoc,target);
    expect(rejected.output).toBeUndefined();expect(rejected.lossReports).toHaveLength(1);
    const accepted=await exportObj(materialDoc,target,{allowLoss:true});
    expect(accepted.report.accepted).toBe(true);expect(await textOf(accepted)).toContain("usemtl mat\n");expect(accepted.resourcePackage!.entries).toHaveLength(1);
  });

  it("rejects record injection through canonical names and metadata", async () => {
    const doc=await model();const mesh=doc.meshes[0]!;
    for(const name of ["private#truncated"," private","private\\name"]){
      const input=modify(doc,{meshes:[{...mesh,primitives:[{...mesh.primitives[0]!,metadata:{objectName:name}}]}]});
      const result=await exportObj(input,target,{mode:"forensic"});expect(result.output).toBeUndefined();expect(JSON.stringify(result.report)).not.toContain("private");
    }
  });

  it.each(["maxResourceBytes","maxNodes","maxPrimitives","maxOutputVertices","maxOutputBytes"] as const)("enforces tighten-only %s", async key => {
    let doc=await model();
    if(key==="maxNodes") {const root=doc.nodes[0]!;doc=modify(doc,{roots:[root.id,"unused"],nodes:[root,{id:"unused",children:[],localMatrix:root.localMatrix}]});}
    if(key==="maxPrimitives") doc=await model(triangle+"o second\nf 1 2 3");
    const result=await exportObj(doc,target,{limits:{[key]:1}});
    expect(result.output).toBeUndefined();expect(result.diagnostics.some(d=>d.code==="OBJ_EXPORT_LIMIT_EXCEEDED")).toBe(true);
  });

  it("honours pre/mid-operation cancellation and deadlines with safe fixed errors", async () => {
    const doc=await model(triangle+"f 1 2 3\n".repeat(1000));
    const c=new AbortController();c.abort("private");await expect(exportObj(doc,target,{signal:c.signal})).rejects.toMatchObject({code:"OBJ_EXPORT_ABORTED"});
    const mid=new AbortController();const pending=exportObj(doc,target,{signal:mid.signal});setTimeout(()=>mid.abort("private"),0);await expect(pending).rejects.toMatchObject({code:"OBJ_EXPORT_ABORTED"});
    await expect(exportObj(doc,target,{timeoutMs:1})).rejects.toMatchObject({code:"OBJ_EXPORT_DEADLINE_EXCEEDED"});
  });

  it("never invokes implicit external I/O for declared resource references", async () => {
    const doc=await model("mtllib ../absent.mtl\nusemtl private-name\n"+triangle);
    const fetch=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("private"));
    try {const result=await exportObj(doc,target);expect(result.report.accepted).toBe(true);expect(fetch).not.toHaveBeenCalled();expect(JSON.stringify(result.report)).not.toContain("private-name");}finally{fetch.mockRestore();}
  });
});

describe("OBJ exporter boundary qualification", () => {
  it("stops stalled resource work on timeout/abort and removes listeners", async () => {
    const doc=await model();
    const read=vi.spyOn(Blob.prototype,"arrayBuffer").mockImplementation(()=>new Promise(()=>{}));
    const c=new AbortController(); const remove=vi.spyOn(c.signal,"removeEventListener");
    try {
      await expect(exportObj(doc,target,{timeoutMs:10})).rejects.toMatchObject({code:"OBJ_EXPORT_DEADLINE_EXCEEDED"});
      const pending=exportObj(doc,target,{signal:c.signal});setTimeout(()=>c.abort("private"),0);
      await expect(pending).rejects.toMatchObject({code:"OBJ_EXPORT_ABORTED"});expect(remove).toHaveBeenCalled();
    } finally {read.mockRestore();remove.mockRestore();}
  });
  it("scrubs asynchronous resource failures", async () => {
    const doc=await model();const read=vi.spyOn(Blob.prototype,"arrayBuffer").mockRejectedValue(Error("private path"));
    try {await expect(exportObj(doc,target)).rejects.toMatchObject({code:"OBJ_EXPORT_RESOURCE_FAILED",message:"OBJ export: OBJ_EXPORT_RESOURCE_FAILED"});}finally{read.mockRestore();}
  });
  it("keeps emitted source elements within the importer's admitted profile", async () => {
    const doc=await model(); const result=await exportObj(doc,target,{limits:{maxSourceElements:2}});
    expect(result.output).toBeUndefined();expect(result.diagnostics[0]!.code).toBe("OBJ_EXPORT_LIMIT_EXCEEDED");
  });
  it("rejects too-long group records and malformed library/group metadata", async () => {
    const doc=await model();const mesh=doc.meshes[0]!;
    const bad=[
      modify(doc,{metadata:{materialLibraries:"private"}}),
      modify(doc,{metadata:{materialLibraries:["private name.mtl"]}}),
      ...([{groups:["a".repeat(200),"b".repeat(200)]},{groups:"private"},{groups:["private group"]},{smoothing:22}] as GpuModelMetadata[]).map(metadata=>modify(doc,{meshes:[{...mesh,primitives:[{...mesh.primitives[0]!,metadata}]}]})),
    ];
    for(const input of bad){const result=await exportObj(input,target,{mode:"forensic"});expect(result.output).toBeUndefined();expect(JSON.stringify(result.report)).not.toContain("private");}
  });
  it("does not inherit a material from an earlier primitive", async () => {
    const doc=await model("usemtl matte\n"+triangle+"o next\nf 1 2 3");const mesh=doc.meshes[0]!;
    const cleared=modify(doc,{meshes:[{...mesh,primitives:mesh.primitives.map((p,i)=>i?{...p,metadata:{objectName:"next"}}:p)}]});
    const output=await textOf(await exportObj(cleared,target));expect(output).toContain("usemtl off\n");
  });
  it("preserves scene order for instanced meshes and nested transforms", async () => {
    const doc=await model();const root=doc.nodes[0]!;
    const instances=modify(doc,{roots:["left","right"],nodes:[{...root,id:"left"},{...root,id:"right",localMatrix:[1,0,0,0,0,1,0,0,0,0,1,0,2,0,0,1]}],bounds:{min:[0,0,0],max:[3,1,0]}});
    const output=await textOf(await exportObj(instances,target));expect(output.indexOf("o left")).toBeLessThan(output.indexOf("o right"));
    const reimport=await model(output);expect(await values(reimport,"POSITION")).toEqual([[0,0,0,1,0,0,0,1,0],[2,0,0,3,0,0,2,1,0]]);
  });
  it("uses explicit blob filename metadata only for an inert output manifest", async () => {
    const result=await exportObj(await model(),{kind:"blob",fileName:"mesh-1.obj",mimeType:"text/plain"});
    expect(result.resourcePackage!.entries[0]!.path).toBe("mesh-1.obj");expect(Object.isFrozen(OBJ_EXPORT_LIMITS)).toBe(true);
  });
});

it("satisfies the published core registry export and resource-manifest contract", async () => {
  const unused = async (): Promise<never> => { throw Error("not this operation"); };
  const registry=createModelConversionRegistry([{
    metadata:{formatId:"obj",displayName:"OBJ",supportedSourceKinds:[],supportedTargetKinds:["uint8-array","array-buffer","blob"],supportsAnimations:false,supportsSkins:false,supportsAnalyticGeometry:false},
    inspect:unused,load:unused,validate:async input => ({...createModelResultBase({standard:"obj-mtl",issues:[]}),valid:isGpuModelDocument(input)}),export:exportObj,
  }]);
  const result=await registry.export("obj",await model(),target);
  expect(result.accepted).toBe(true);expect(result.exported!.target).toBe("uint8-array");expect(result.resourcePackage!.entries[0]!.path).toBe("model.obj");
});

it("bounds resource/accessor counts before processing or copying payloads", async () => {
  const doc=await model();const resource=doc.resources[0]!;
  const port:GpuModelResourceVerificationPort={async digestSha256(chunks){const values:number[]=[];for await(const chunk of chunks)values.push(...chunk);return sha256Hex(new Uint8Array(values));},async inspectResource(chunks){for await(const chunk of chunks)void chunk;return {valid:true,detectedMimeType:"application/octet-stream"};}};
  const extra=await verifyGpuModelResource({...resource,id:"extra"},port);
  const resources=modify(doc,{resources:[...doc.resources,extra]});
  const tooManyResources=await exportObj(resources,target,{limits:{maxResources:1}});
  expect(tooManyResources.output).toBeUndefined();expect(tooManyResources.diagnostics[0]!.code).toBe("OBJ_EXPORT_LIMIT_EXCEEDED");
  const accessors=modify(doc,{accessors:[...doc.accessors,{...doc.accessors[0]!,id:"extra"}]});
  const tooManyAccessors=await exportObj(accessors,target,{limits:{maxAccessors:1}});
  expect(tooManyAccessors.output).toBeUndefined();expect(tooManyAccessors.diagnostics[0]!.code).toBe("OBJ_EXPORT_LIMIT_EXCEEDED");
});

it("rejects incompatible attribute representation without inventing conversion", async () => {
  const doc=await model();const mesh=doc.meshes[0]!;const primitive=mesh.primitives[0]!;
  const input=modify(doc,{accessors:[...doc.accessors,{id:"uv",resourceId:doc.resources[0]!.id,byteOffset:0,count:3,elementType:"vec2",componentType:"u8",normalized:true}],meshes:[{...mesh,primitives:[{...primitive,attributes:[...primitive.attributes,{semantic:"TEXCOORD_0",accessorId:"uv"}]}]}]});
  const result=await exportObj(input,target,{allowLoss:true});expect(result.output).toBeUndefined();expect(result.diagnostics[0]!.code).toBe("OBJ_EXPORT_UNSUPPORTED_DATA");
});

it("keeps canonical material identities distinct when display names collide", async () => {
  const doc=await model(triangle+"o next\nf 1 2 3");const mesh=doc.meshes[0]!;
  const materials=["first","second"].map(id=>({id,name:"same display name",workflow:"metallic-roughness" as const,alphaMode:"opaque" as const,baseColorFactor:[1,1,1,1] as const,textures:{},extensions:{},sourceMetadata:{}}));
  const input=modify(doc,{materials,meshes:[{...mesh,primitives:mesh.primitives.map((p,i)=>({...p,materialId:materials[i]!.id}))}]});
  const text=await textOf(await exportObj(input,target,{allowLoss:true}));expect(text).toContain("usemtl first\n");expect(text).toContain("usemtl second\n");
});
