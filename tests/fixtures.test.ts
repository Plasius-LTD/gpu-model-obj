import { createHash } from "node:crypto";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("./fixtures/", import.meta.url));
const text = (name: string) => readFileSync(resolve(root, name), "utf8");
const lines = (name: string, keyword: string) => text(name).split(/\r?\n/)
  .map(line => line.trim()).filter(line => line.startsWith(`${keyword} `))
  .map(line => line.slice(keyword.length + 1));

// Corpus checks exercise authored source facts, not an unimplemented adapter.
describe("OBJ bootstrap corpus", () => {
  it("records rights, bounded local files, and stable source digests", () => {
    const manifest = JSON.parse(text("manifest.json"));
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.license).toBe("Apache-2.0");
    expect(manifest.authorship).toBe("repository-authored");
    expect(manifest.adapterConformance).toBe("pending");
    expect(manifest.cases.map((entry: { id: string }) => entry.id).sort()).toEqual([
      "malformed-indices", "missing-library", "missing-texture", "mixed-normals", "multi-material",
      "ngon", "smooth-wedge", "smoothing-groups", "triangle",
    ]);
    const listed = new Set<string>();
    for (const entry of manifest.cases) {
      expect(entry.expectedOutcome.length).toBeGreaterThan(20);
      for (const file of entry.files) {
        expect(file.path).toMatch(/^[a-z0-9-]+\.(obj|mtl)$/);
        expect(listed.has(file.path)).toBe(false);
        listed.add(file.path);
        const bytes = readFileSync(resolve(root, file.path));
        expect(bytes.length).toBeGreaterThan(0);
        expect(bytes.length).toBeLessThanOrEqual(4096);
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(file.sha256);
      }
    }
    expect([...listed].sort()).toEqual(readdirSync(root).filter(name => /\.(obj|mtl)$/.test(name)).sort());
  });

  it("includes a triangle without authored normals", () => {
    expect(lines("triangle.obj", "v")).toHaveLength(3);
    expect(lines("triangle.obj", "vn")).toHaveLength(0);
    expect(lines("triangle.obj", "f")).toEqual(["1 2 3"]);
  });

  it("contains both zero and out-of-range position indices", () => {
    expect(lines("malformed-indices.obj", "v")).toHaveLength(3);
    expect(lines("malformed-indices.obj", "f")).toEqual(["0 2 3", "1 2 4"]);
  });

  it("keeps deliberately missing material and texture resources absent", () => {
    const missingLibrary = lines("missing-library.obj", "mtllib");
    expect(missingLibrary).toEqual(["absent-library.mtl"]);
    const missingLibraryName = missingLibrary[0];
    if (missingLibraryName === undefined) throw new Error("Missing fixture library reference");
    expect(existsSync(resolve(root, missingLibraryName))).toBe(false);
    const material = lines("missing-texture.obj", "mtllib");
    expect(material).toEqual(["missing-texture.mtl"]);
    const materialName = material[0];
    if (materialName === undefined) throw new Error("Missing fixture material reference");
    expect(lines(materialName, "map_Kd")).toEqual(["absent-texture.png"]);
    expect(existsSync(resolve(dirname(resolve(root, materialName)), "absent-texture.png"))).toBe(false);
  });

  it("retains an untriangulated five-vertex face and its winding", () => {
    const vertices = lines("ngon.obj", "v").map(line => {
      const values = line.split(" ").map(Number);
      const [x, y, z] = values;
      if (values.length !== 3 || x === undefined || y === undefined || z === undefined) throw new Error("Malformed fixture vertex");
      return [x, y, z] as const;
    });
    expect(vertices).toHaveLength(5);
    expect(vertices.every(vertex => vertex.length === 3 && vertex[2] === 0)).toBe(true);
    expect(lines("ngon.obj", "f")).toEqual(["1 2 3 4 5"]);
    const twiceArea = vertices.reduce((sum, v, i) => {
      const next = vertices[(i + 1) % vertices.length];
      if (next === undefined) throw new Error("Missing fixture polygon vertex");
      return sum + v[0] * next[1] - next[0] * v[1];
    }, 0);
    expect(twiceArea).toBe(10);
  });

  it("binds two faces to distinct declared materials", () => {
    expect(lines("multi-material.obj", "mtllib")).toEqual(["multi-material.mtl"]);
    expect(lines("multi-material.obj", "f")).toEqual(["1 2 3", "1 3 4"]);
    expect(lines("multi-material.obj", "usemtl")).toEqual(["red", "blue"]);
    expect(lines("multi-material.mtl", "newmtl")).toEqual(["red", "blue"]);
    expect(lines("multi-material.mtl", "Kd")).toEqual(["1 0 0", "0 0 1"]);
  });

  it("preserves hard and smooth group transitions for shared vertices", () => {
    expect(lines("smoothing-groups.obj", "s")).toEqual(["off", "1"]);
    expect(lines("smoothing-groups.obj", "f")).toEqual(["1 2 3", "1 3 4"]);
    expect(lines("smoothing-groups.obj", "vn")).toHaveLength(0);
  });
});
