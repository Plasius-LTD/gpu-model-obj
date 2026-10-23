import type { ObjGeometryGroup } from "./canonical.js";
import type { ObjParserLimits, parserClock } from "./policy.js";

/** Internal source identities survive expansion until normal policy completes. */
export interface ObjNormalFace {
  readonly group: ObjGeometryGroup;
  readonly offset: number;
  readonly corners: readonly { readonly p: number; readonly n: number | undefined }[];
  readonly triangles: readonly number[];
}
type Vector = [number, number, number];
type Sum = [number, number, number, number];

export class ObjNormalError extends Error {
  public constructor(public readonly code: "OBJ_LIMIT_EXCEEDED" | "OBJ_AMBIGUOUS_NORMAL") { super(code); }
}

/** Resolve explicit generation in bounded linear passes, without welding or I/O. */
export async function generateObjNormals(
  faces: readonly ObjNormalFace[], positions: readonly number[][],
  limits: ObjParserLimits, clock: ReturnType<typeof parserClock>,
): Promise<boolean> {
  const sums = new Map<string, Sum>();
  const vectors: Vector[] = [];
  let work = 0; let generated = false;
  const step = async () => {
    if (++work > limits.maxNormalWork) throw new ObjNormalError("OBJ_LIMIT_EXCEEDED");
    if (work % 256 === 0) await clock.checkpoint();
  };
  const key = (face: ObjNormalFace, p: number) => JSON.stringify([face.group.objectName, face.group.smoothing, p]);
  clock.check();
  for (const face of faces) {
    // Sum the signed triangle area vectors. Each original face contributes once
    // to each source corner, regardless of the ear-clipping vertex incidence.
    const vector: Vector = [0, 0, 0];
    for (let i = 0; i < face.triangles.length; i += 3) {
      await step();
      const a = positions[face.corners[face.triangles[i]!]!.p]!;
      const b = positions[face.corners[face.triangles[i + 1]!]!.p]!;
      const c = positions[face.corners[face.triangles[i + 2]!]!.p]!;
      const u = b.map((v, j) => v - a[j]!) as Vector;
      const v = c.map((v, j) => v - a[j]!) as Vector;
      vector[0] += u[1] * v[2] - u[2] * v[1];
      vector[1] += u[2] * v[0] - u[0] * v[2];
      vector[2] += u[0] * v[1] - u[1] * v[0];
    }
    vectors.push(vector);
    if (face.group.smoothing === "off") continue;
    const weight = Math.hypot(...vector);
    for (const corner of face.corners) {
      await step();
      const id = key(face, corner.p); const sum = sums.get(id) ?? [0, 0, 0, 0];
      sum[0] += vector[0]; sum[1] += vector[1]; sum[2] += vector[2]; sum[3] += weight;
      sums.set(id, sum);
    }
  }
  for (const [index, face] of faces.entries()) {
    for (const [i, cornerIndex] of face.triangles.entries()) {
      await step();
      const corner = face.corners[cornerIndex]!;
      if (corner.n !== undefined) continue;
      const vector = face.group.smoothing === "off" ? vectors[index]! : sums.get(key(face, corner.p))!;
      const length = Math.hypot(vector[0], vector[1], vector[2]);
      const weight = vector.length === 4 ? vector[3]! : length;
      if (!Number.isFinite(length) || length <= weight * 1e-12 || length === 0) throw new ObjNormalError("OBJ_AMBIGUOUS_NORMAL");
      for (let axis = 0; axis < 3; axis++) {
        const value = Math.fround(vector[axis]! / length);
        face.group.normals[face.offset + i * 3 + axis] = value === 0 ? 0 : value;
      }
      generated = true;
    }
  }
  clock.check();
  return generated;
}
