import type { GpuModelAccessor, GpuModelDocument, GpuModelMatrix4, GpuModelPrimitive } from "@plasius/gpu-model-core";
import { ObjExportRejection, exportLimit, type ObjExportLimits } from "./export-policy.js";

const identity: GpuModelMatrix4 = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
function unsupported(): never { throw new ObjExportRejection("OBJ_EXPORT_UNSUPPORTED_DATA"); }
function multiply(a: readonly number[], b: readonly number[]): number[] {
  return Array.from({ length: 16 }, (_, i) => {
    const row = i % 4; const col = Math.floor(i / 4);
    return a[row]! * b[col * 4]! + a[4 + row]! * b[col * 4 + 1]! + a[8 + row]! * b[col * 4 + 2]! + a[12 + row]! * b[col * 4 + 3]!;
  });
}
export interface ObjExportPrimitive {
  readonly primitive: GpuModelPrimitive;
  readonly objectFallback: string;
  readonly world: readonly number[];
  readonly determinant: number;
}

/** Scene order is semantic. Bake instances in root/child/primitive order. */
export function exportScene(document: GpuModelDocument, limits: ObjExportLimits): ObjExportPrimitive[] {
  exportLimit(document.nodes.length > limits.maxNodes || document.resources.length > limits.maxResources || document.accessors.length > limits.maxAccessors);
  if (document.skeletons.length || document.joints.length || document.skins.length || document.animations.length || document.blendShapes.length || document.analyticGeometry.length || document.textures.length) unsupported();
  const nodes = new Map(document.nodes.map(n => [n.id, n]));
  const meshes = new Map(document.meshes.map(m => [m.id, m]));
  const output: ObjExportPrimitive[] = [];
  const stack = document.roots.map(id => ({ id, parent: identity as readonly number[] })).reverse();
  while (stack.length) {
    const { id, parent } = stack.pop()!; const node = nodes.get(id)!;
    const world = multiply(parent, node.localMatrix);
    const [a,b,c,d,e,f,g,h,i] = [world[0]!,world[4]!,world[8]!,world[1]!,world[5]!,world[9]!,world[2]!,world[6]!,world[10]!];
    const determinant = a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);
    if (!world.every(Number.isFinite) || !Number.isFinite(determinant) || determinant === 0) unsupported();
    if (node.meshId) {
      const mesh = meshes.get(node.meshId)!;
      for (const primitive of mesh.primitives) {
        exportLimit(output.length >= limits.maxPrimitives);
        if (primitive.topology !== "triangles" || primitive.attributes.some(a => !["POSITION", "NORMAL", "TEXCOORD_0"].includes(a.semantic))) unsupported();
        output.push({ primitive, world, determinant, objectFallback: node.name ?? mesh.name ?? node.id });
      }
    }
    for (let index = node.children.length - 1; index >= 0; index--) stack.push({ id: node.children[index]!, parent: world });
  }
  if (!output.length) unsupported();
  return output;
}

/** f32 output is finite and never silently underflows a nonzero component. */
function f32(value: number): number {
  const rounded = Math.fround(value);
  if (!Number.isFinite(rounded) || value !== 0 && rounded === 0) unsupported();
  return rounded === 0 ? 0 : rounded;
}
export function worldVector(values: readonly number[], matrix: readonly number[], determinant: number, normal: boolean): number[] {
  const [x,y,z] = values as [number,number,number];
  let result: number[];
  if (!normal) {
    result = [matrix[0]!*x+matrix[4]!*y+matrix[8]!*z+matrix[12]!, matrix[1]!*x+matrix[5]!*y+matrix[9]!*z+matrix[13]!, matrix[2]!*x+matrix[6]!*y+matrix[10]!*z+matrix[14]!];
  } else {
    const [a,b,c,d,e,f,g,h,i] = [matrix[0]!,matrix[4]!,matrix[8]!,matrix[1]!,matrix[5]!,matrix[9]!,matrix[2]!,matrix[6]!,matrix[10]!];
    result = [((e*i-f*h)*x+(f*g-d*i)*y+(d*h-e*g)*z)/determinant, ((c*h-b*i)*x+(a*i-c*g)*y+(b*g-a*h)*z)/determinant, ((b*f-c*e)*x+(c*d-a*f)*y+(a*e-b*d)*z)/determinant];
  }
  const rounded = result.map(f32);
  if (normal && rounded.every(v => v === 0)) unsupported();
  return rounded;
}

export function geometryReader(document: GpuModelDocument, buffers: ReadonlyMap<string, DataView>) {
  const accessors = new Map(document.accessors.map(a => [a.id, a]));
  function read(accessor: GpuModelAccessor, index: number, width: number): number[] {
    const size = accessor.componentType === "u8" ? 1 : accessor.componentType === "u16" ? 2 : 4;
    const offset = accessor.byteOffset + index * (accessor.byteStride ?? width * size);
    const view = buffers.get(accessor.resourceId)!;
    return Array.from({ length: width }, (_, c) => {
      const at = offset + c * size;
      if (accessor.componentType === "u8") return view.getUint8(at);
      if (accessor.componentType === "u16") return view.getUint16(at, true);
      if (accessor.componentType === "u32") return view.getUint32(at, true);
      return view.getFloat32(at, true);
    });
  }
  return (primitive: GpuModelPrimitive) => {
    const attributes = new Map(primitive.attributes.map(a => [a.semantic, accessors.get(a.accessorId)!]));
    const position = attributes.get("POSITION")!;
    for (const [semantic, accessor] of attributes) if (accessor.componentType !== "f32" || accessor.normalized || accessor.elementType !== (semantic === "TEXCOORD_0" ? "vec2" : "vec3")) unsupported();
    const indices = primitive.indicesAccessorId ? accessors.get(primitive.indicesAccessorId)! : undefined;
    if (indices && (!["u8","u16","u32"].includes(indices.componentType) || indices.normalized || indices.elementType !== "scalar")) unsupported();
    const count = indices?.count ?? position.count;
    return { count, corner(index: number) {
      const vertex = indices ? read(indices, index, 1)[0]! : index;
      const uv = attributes.get("TEXCOORD_0"); const normal = attributes.get("NORMAL");
      return { position: read(position, vertex, 3), uv: uv ? read(uv, vertex, 2) : undefined, normal: normal ? read(normal, vertex, 3) : undefined };
    } };
  };
}
