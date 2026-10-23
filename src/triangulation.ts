import type { ObjParserLimits, parserClock } from "./policy.js";

type Point = readonly number[];
type FaceCode = "OBJ_DEGENERATE_FACE" | "OBJ_SELF_INTERSECTING_FACE" | "OBJ_NON_PLANAR_FACE" | "OBJ_LIMIT_EXCEEDED";

/** Internal fixed-code failure; no authored coordinates enter diagnostics. */
export class ObjTriangulationError extends Error {
  public constructor(public readonly code: FaceCode) { super(code); }
}

const AREA_EPSILON = 1e-12;
const DISTANCE_SQUARED_EPSILON = 1e-24;
const PLANE_EPSILON = 1e-7;
const cross = (a: Point, b: Point, c: Point) => (b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!);
const near = (a: Point, b: Point) => a.reduce((sum, x, i) => sum + (x - b[i]!) ** 2, 0) <= DISTANCE_SQUARED_EPSILON;
const onSegment = (a: Point, b: Point, p: Point) => Math.abs(cross(a, b, p)) <= AREA_EPSILON &&
  p.every((v, i) => v >= Math.min(a[i]!, b[i]!) - AREA_EPSILON && v <= Math.max(a[i]!, b[i]!) + AREA_EPSILON);

function intersects(a: Point, b: Point, c: Point, d: Point): boolean {
  const abC = cross(a, b, c); const abD = cross(a, b, d);
  const cdA = cross(c, d, a); const cdB = cross(c, d, b);
  if (onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b)) return true;
  return ((abC > AREA_EPSILON && abD < -AREA_EPSILON) || (abC < -AREA_EPSILON && abD > AREA_EPSILON)) &&
    ((cdA > AREA_EPSILON && cdB < -AREA_EPSILON) || (cdA < -AREA_EPSILON && cdB > AREA_EPSILON));
}

/** One import-wide work budget; returns original corner indices, never new points. */
export function createObjTriangulator(limits: ObjParserLimits, clock: ReturnType<typeof parserClock>) {
  let work = 0;
  const step = async () => {
    if (++work > limits.maxTriangulationWork) throw new ObjTriangulationError("OBJ_LIMIT_EXCEEDED");
    if (work % 256 === 0) await clock.checkpoint();
    else clock.check();
  };
  return async (source: readonly Point[]): Promise<number[]> => {
    const fail = (code: FaceCode): never => { throw new ObjTriangulationError(code); };
    const count = source.length;
    // Parser admits 3..maxFaceVertices; retain an internal defensive boundary.
    if (count < 3 || count > limits.maxFaceVertices) fail("OBJ_LIMIT_EXCEEDED");
    const min = [Infinity, Infinity, Infinity]; const max = [-Infinity, -Infinity, -Infinity];
    for (const p of source) {
      await step();
      for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i]!, p[i]!); max[i] = Math.max(max[i]!, p[i]!); }
    }
    const scale = Math.max(...max.map((value, i) => value - min[i]!));
    if (!(scale > 0)) fail("OBJ_DEGENERATE_FACE");
    const points = source.map(p => p.map((v, i) => (v - min[i]!) / scale));
    const origin = points[0]!;
    let normal = [0, 0, 0]; let magnitudeSquared = 0;
    for (let i = 1; i < count - 1; i++) {
      await step();
      const a = points[i]!.map((v, j) => v - origin[j]!); const b = points[i + 1]!.map((v, j) => v - origin[j]!);
      const candidate = [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
      const length = candidate.reduce((sum, v) => sum + v * v, 0);
      if (length > magnitudeSquared) { magnitudeSquared = length; normal = candidate; }
    }
    if (magnitudeSquared <= AREA_EPSILON ** 2) fail("OBJ_DEGENERATE_FACE");
    const magnitude = Math.sqrt(magnitudeSquared);
    for (const p of points) {
      await step();
      if (Math.abs(p.reduce((sum, v, i) => sum + (v - origin[i]!) * normal[i]!, 0)) > PLANE_EPSILON * magnitude) fail("OBJ_NON_PLANAR_FACE");
    }
    let axis = 0;
    for (let i = 1; i < 3; i++) if (Math.abs(normal[i]!) > Math.abs(normal[axis]!)) axis = i;
    const projected = points.map(p => p.filter((_, i) => i !== axis));
    let signedArea = 0;
    for (let i = 0; i < count; i++) {
      await step();
      const a = projected[i]!; const b = projected[(i + 1) % count]!;
      signedArea += a[0]! * b[1]! - b[0]! * a[1]!;
      if (Math.abs(cross(projected[(i + count - 1) % count]!, a, b)) <= AREA_EPSILON) fail("OBJ_DEGENERATE_FACE");
      for (let j = i + 1; j < count; j++) {
        await step();
        if (near(a, projected[j]!)) fail("OBJ_DEGENERATE_FACE");
        if (j === i + 1 || i === 0 && j === count - 1) continue;
        if (intersects(a, b, projected[j]!, projected[(j + 1) % count]!)) fail("OBJ_SELF_INTERSECTING_FACE");
      }
    }
    if (Math.abs(signedArea) <= AREA_EPSILON) fail("OBJ_DEGENERATE_FACE");
    if (count === 3) return [0, 1, 2];
    const winding = Math.sign(signedArea);
    const remaining = Array.from({ length: count }, (_, i) => i); const triangles: number[] = [];
    while (remaining.length > 3) {
      let ear = false;
      for (let i = 0; i < remaining.length; i++) {
        await step();
        const a = remaining[(i + remaining.length - 1) % remaining.length]!; const b = remaining[i]!; const c = remaining[(i + 1) % remaining.length]!;
        if (winding * cross(projected[a]!, projected[b]!, projected[c]!) <= AREA_EPSILON) continue;
        let blocked = false;
        for (const corner of remaining) {
          await step();
          if (corner === a || corner === b || corner === c) continue;
          const p = projected[corner]!;
          if (winding * cross(projected[a]!, projected[b]!, p) >= -AREA_EPSILON &&
              winding * cross(projected[b]!, projected[c]!, p) >= -AREA_EPSILON &&
              winding * cross(projected[c]!, projected[a]!, p) >= -AREA_EPSILON) { blocked = true; break; }
        }
        if (blocked) continue;
        triangles.push(a, b, c); remaining.splice(i, 1); ear = true; break;
      }
      if (!ear) fail("OBJ_DEGENERATE_FACE");
    }
    if (winding * cross(projected[remaining[0]!]!, projected[remaining[1]!]!, projected[remaining[2]!]!) <= AREA_EPSILON) fail("OBJ_DEGENERATE_FACE");
    triangles.push(...remaining);
    return triangles;
  };
}
