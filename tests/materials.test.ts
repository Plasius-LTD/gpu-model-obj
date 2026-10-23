import { readFile } from "node:fs/promises";
import { createGpuModelDocument } from "@plasius/gpu-model-core";
import { describe, expect, it, vi } from "vitest";
import { parseObj, exportObj, ObjImportError } from "../src/index.js";
const encode = (s: string) => new TextEncoder().encode(s);
const decode = (b: Uint8Array) => new TextDecoder().decode(b);
const triangle = "v 0 0 0\nv 1 0 0\nv 0 1 0\n";
const obj = (name = "red") =>
  encode("mtllib test.mtl\n" + triangle + `usemtl ${name}\nf 1 2 3\n`);
const libraries = (text = "newmtl red\nKd 1 0 0\n") => [
  { name: "test.mtl", bytes: encode(text) },
];
const load = (text: string, options = {}) =>
  parseObj(obj(), { materialLibraries: libraries(text), ...options });

describe("bounded canonical MTL mapping", () => {
  it("round trips the authored fixture with material names, values and face bindings", async () => {
    const source = new Uint8Array(
      await readFile(new URL("./fixtures/multi-material.obj", import.meta.url)),
    );
    const mtl = new Uint8Array(
      await readFile(new URL("./fixtures/multi-material.mtl", import.meta.url)),
    );
    const loaded = await parseObj(source, {
      materialLibraries: [{ name: "multi-material.mtl", bytes: mtl }],
    });
    expect(loaded.report.accepted).toBe(true);
    const document = loaded.document!;
    expect(document.materials.map((m) => m.name)).toEqual(["red", "blue"]);
    expect(document.materials.map((m) => m.baseColorFactor)).toEqual([
      [1, 0, 0, 1],
      [0, 0, 1, 1],
    ]);
    expect(document.meshes[0]!.primitives.map((p) => p.materialId)).toEqual(
      document.materials.map((m) => m.id),
    );
    const a = await exportObj(
      document,
      { kind: "uint8-array" },
      { includeMaterials: true },
    );
    const b = await exportObj(
      document,
      { kind: "uint8-array" },
      { includeMaterials: true },
    );
    expect(a.report.accepted).toBe(true);
    expect(a.output).toEqual(b.output);
    expect(a.materialLibrary).toEqual(b.materialLibrary);
    expect(a.lossReports).toHaveLength(0);
    expect(a.resourcePackage!.entries.map((e) => e.role)).toEqual([
      "mesh",
      "material",
    ]);
    expect(decode(a.materialLibrary!.bytes)).toContain("newmtl red\n");
    const again = await parseObj(a.output as Uint8Array, {
      materialLibraries: [a.materialLibrary!],
    });
    expect(again.report.accepted).toBe(true);
    expect(again.document!.materials).toEqual(document.materials);
    expect(
      again.document!.meshes[0]!.primitives.map((p) => p.materialId),
    ).toEqual(document.meshes[0]!.primitives.map((p) => p.materialId));
    expect(
      new Uint8Array(await again.document!.resources[0]!.payload.arrayBuffer()),
    ).toEqual(
      new Uint8Array(await document.resources[0]!.payload.arrayBuffer()),
    );
  });
  it("maps opacity and emissive, allows RGB shorthand, and normalizes Tr", async () => {
    const a = await load("newmtl red\nKd .5\nKe 0.2 0.4 0.8\nTr 0.25\n");
    expect(a.report.accepted).toBe(true);
    expect(a.document!.materials[0]).toMatchObject({
      name: "red",
      baseColorFactor: [0.5, 0.5, 0.5, 0.75],
      emissiveFactor: [0.2, 0.4, 0.8],
      alphaMode: "blend",
    });
    const b = await load("newmtl red\nKd .5 .5 .5\nd .75\nKe .2 .4 .8\n");
    expect(a.document!.materials).toEqual(b.document!.materials);
  });
  it.each(["strict", "tolerant", "forensic"] as const)(
    "rejects duplicate material names in %s",
    async (mode) => {
      const r = await load("newmtl red\nKd 1 0 0\nnewmtl red\nKd 0 0 1\n", {
        mode,
        allowLoss: true,
      });
      expect(r.document).toBeUndefined();
      expect(
        r.diagnostics.some((d) => d.code === "MTL_DUPLICATE_MATERIAL"),
      ).toBe(true);
    },
  );
  it.each(["strict", "tolerant", "forensic"] as const)(
    "rejects missing definitions in %s without consent",
    async (mode) => {
      const r = await parseObj(obj(), { materialLibraries: [], mode });
      expect(r.document).toBeUndefined();
      expect(r.report.accepted).toBe(false);
    },
  );
  it.each(["tolerant", "forensic"] as const)(
    "uses a diagnosed canonical default for missing material in %s with consent",
    async (mode) => {
      const r = await parseObj(obj("private-name"), {
        materialLibraries: [],
        mode,
        allowLoss: true,
      });
      expect(r.report.accepted).toBe(true);
      expect(r.repairs).toHaveLength(1);
      expect(r.lossReports.length).toBeGreaterThan(0);
      const id = r.document!.meshes[0]!.primitives[0]!.materialId;
      expect(
        r.document!.materials.find((m) => m.id === id)!.baseColorFactor,
      ).toEqual([1, 1, 1, 1]);
      expect(r.document!.meshes[0]!.primitives[0]!.metadata!.materialName).toBe(
        "private-name",
      );
      expect(JSON.stringify(r.report)).not.toContain("private-name");
    },
  );
  it("strict mode rejects missing bindings even with loss consent", async () => {
    expect(
      (
        await parseObj(obj(), {
          materialLibraries: [],
          mode: "strict",
          allowLoss: true,
        })
      ).document,
    ).toBeUndefined();
  });
  it.each([
    "NaN",
    "Infinity",
    "1e999",
    "1e-999",
    "0x10",
    "1junk",
    "-0.1",
    "1.1",
  ])("rejects invalid diffuse numeric %s", async (value) => {
    const r = await load(`newmtl red\nKd ${value} 0 0\n`, {
      mode: "tolerant",
      allowLoss: true,
    });
    expect(r.document).toBeUndefined();
    expect(r.diagnostics.some((d) => d.code === "MTL_INVALID_VALUE")).toBe(
      true,
    );
  });
  it.each([
    "d -1",
    "d 1.1",
    "Tr NaN",
    "Kd 1 0",
    "Ke -1 0 0",
    "d .2\nTr .1",
    "Kd 1 0 0\nKd 0 1 0",
    "Kd spectral private.rfl",
  ])("rejects ambiguous or invalid properties: %s", async (record) => {
    expect(
      (await load("newmtl red\n" + record + "\n")).document,
    ).toBeUndefined();
  });
  it.each(["strict", "tolerant", "forensic"] as const)(
    "requires explicit consent for advanced semantics in %s",
    async (mode) => {
      const text = "newmtl red\nKd 1 0 0\nNs 30\nPr .4\n";
      expect((await load(text, { mode })).document).toBeUndefined();
      const accepted = await load(text, { mode, allowLoss: true });
      expect(accepted.report.accepted).toBe(true);
      expect(accepted.lossReports).toHaveLength(2);
    },
  );
  it("blocks records before newmtl and malformed/unsafe names without echoing values", async () => {
    for (const text of [
      "Kd 1 0 0\n",
      "newmtl\n",
      "newmtl red\u0000private\n",
      "newmtl red\\private\n",
    ]) {
      const r = await load(text, { mode: "forensic", allowLoss: true });
      expect(r.document).toBeUndefined();
      expect(JSON.stringify(r.report)).not.toContain("private");
    }
  });
  it("snapshots libraries before the first await and performs no external I/O", async () => {
    const libs = libraries();
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("no fetch"));
    try {
      const promise = parseObj(obj(), { materialLibraries: libs });
      libs[0]!.bytes.fill(0);
      libs[0]!.name = "changed";
      expect((await promise).report.accepted).toBe(true);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
  it("retains reference-only compatibility when the library table is omitted", async () => {
    const r = await parseObj(obj());
    expect(r.report.accepted).toBe(true);
    expect(r.document!.materials).toHaveLength(0);
    expect(
      (await exportObj(r.document!, { kind: "uint8-array" })).report.accepted,
    ).toBe(true);
  });
  it("rejects malformed tables and accessors before invoking their values", async () => {
    let invoked = 0;
    const getter = {
      get name() {
        invoked++;
        return "test.mtl";
      },
      bytes: encode(""),
    };
    for (const value of [
      null,
      {},
      [null],
      [getter],
      [{ name: "x", bytes: "text" }],
      [{ name: "../x.mtl", bytes: encode("") }],
      Array(33).fill(libraries()[0]),
      [...libraries(), ...libraries()],
    ]) {
      await expect(
        parseObj(obj(), { materialLibraries: value as never }),
      ).rejects.toBeInstanceOf(ObjImportError);
    }
    expect(invoked).toBe(0);
  });
  it("enforces aggregate input, material, UTF8, line and diagnostic limits", async () => {
    const small = await parseObj(obj(), {
      materialLibraries: libraries(),
      limits: { maxInputBytes: obj().length },
    });
    expect(small.document).toBeUndefined();
    expect(
      (
        await parseObj(obj(), {
          materialLibraries: [
            { name: "test.mtl", bytes: new Uint8Array([255]) },
          ],
        })
      ).document,
    ).toBeUndefined();
    expect(
      (
        await load("newmtl red\nKd 1 0 0\nnewmtl blue\n", {
          limits: { maxMaterials: 1 },
        })
      ).document,
    ).toBeUndefined();
    expect(
      (await load("newmtl red\n#" + "x".repeat(5000) + "\n")).document,
    ).toBeUndefined();
    const r = await load("newmtl red\n" + Array(100).fill("Pr .2").join("\n"), {
      allowLoss: true,
      limits: { maxDiagnostics: 2 },
    });
    expect(r.document).toBeUndefined();
    expect(r.diagnostics.length).toBeLessThanOrEqual(2);
  });
  it.each([
    "Ns NaN",
    "Ns 1e999",
    "Ns -1",
    "Ni -2",
    "illum 99",
    "Pr nope",
    "Ka NaN 0 0",
  ])(
    "blocks malformed advanced numerics before loss consent: %s",
    async (record) => {
      const r = await load("newmtl red\nKd 1 0 0\n" + record + "\n", {
        allowLoss: true,
        mode: "forensic",
      });
      expect(r.document).toBeUndefined();
      expect(r.diagnostics.some((d) => d.code === "MTL_INVALID_VALUE")).toBe(
        true,
      );
    },
  );
  it("rejects paired export when a source material reference has no canonical definition", async () => {
    const r = await parseObj(obj());
    const exported = await exportObj(
      r.document!,
      { kind: "uint8-array" },
      { includeMaterials: true, allowLoss: true },
    );
    expect(exported.report.accepted).toBe(false);
    expect(exported.output).toBeUndefined();
    expect(exported.materialLibrary).toBeUndefined();
  });
  it("checks paired byte budget including both actual files", async () => {
    const r = await load("newmtl red\nKd 1 0 0\n");
    const a = await exportObj(
      r.document!,
      { kind: "uint8-array" },
      { includeMaterials: true },
    );
    const total =
      (a.output as Uint8Array).length + a.materialLibrary!.bytes.length;
    expect(
      (
        await exportObj(
          r.document!,
          { kind: "uint8-array" },
          { includeMaterials: true, limits: { maxOutputBytes: total } },
        )
      ).report.accepted,
    ).toBe(true);
    const rejected = await exportObj(
      r.document!,
      { kind: "uint8-array" },
      { includeMaterials: true, limits: { maxOutputBytes: total - 1 } },
    );
    expect(rejected.output).toBeUndefined();
    expect(rejected.materialLibrary).toBeUndefined();
  });
  it("reports advanced canonical semantics and requires explicit loss consent", async () => {
    const r = await load("newmtl red\nKd 1 0 0\n");
    const doc = createGpuModelDocument({
      ...r.document!,
      materials: r.document!.materials.map((m) => ({
        ...m,
        metallicFactor: 0.8,
        roughnessFactor: 0.1,
      })),
    });
    expect(
      (
        await exportObj(
          doc,
          { kind: "uint8-array" },
          { includeMaterials: true },
        )
      ).output,
    ).toBeUndefined();
    const yes = await exportObj(
      doc,
      { kind: "uint8-array" },
      { includeMaterials: true, allowLoss: true },
    );
    expect(yes.report.accepted).toBe(true);
    expect(yes.lossReports).toHaveLength(1);
  });
  it("preserves material reset transitions without inventing an off material", async () => {
    const source = encode(
      "mtllib test.mtl\n" +
        triangle +
        "usemtl red\nf 1 2 3\nusemtl off\nf 1 3 2\n",
    );
    const r = await parseObj(source, { materialLibraries: libraries() });
    expect(r.report.accepted).toBe(true);
    const a = await exportObj(
      r.document!,
      { kind: "uint8-array" },
      { includeMaterials: true },
    );
    const b = await parseObj(a.output as Uint8Array, {
      materialLibraries: [a.materialLibrary!],
    });
    expect(b.report.accepted).toBe(true);
    expect(b.document!.meshes[0]!.primitives.map((p) => p.materialId)).toEqual([
      "material-0",
      undefined,
    ]);
  });
  it("supports every in-memory target with a returned actual MTL", async () => {
    const r = await load("newmtl red\n");
    for (const kind of ["blob", "array-buffer", "uint8-array"] as const) {
      const a = await exportObj(
        r.document!,
        { kind },
        { includeMaterials: true },
      );
      expect(a.report.accepted).toBe(true);
      expect(a.materialLibrary!.bytes).toBeInstanceOf(Uint8Array);
    }
  });
  it("tracks referenced MTL content hashes separately from the OBJ source hash", async () => {
    const a = await load("newmtl red\nKd 1 0 0\n");
    const b = await load("newmtl red\nKd 0 1 0\n");
    expect(a.document!.provenance.sourceContentHash).toBe(
      b.document!.provenance.sourceContentHash,
    );
    expect(a.document!.metadata.materialLibraryContentHashes).not.toEqual(
      b.document!.metadata.materialLibraryContentHashes,
    );
  });

  it("requires loss consent for duplicate display names and keeps their distinct bindings", async () => {
    const source = encode(
      "mtllib test.mtl\n" +
        triangle +
        "usemtl red\nf 1 2 3\nusemtl blue\nf 1 3 2\n",
    );
    const r = await parseObj(source, {
      materialLibraries: libraries(
        "newmtl red\nKd 1 0 0\nnewmtl blue\nKd 0 0 1\n",
      ),
    });
    const doc = createGpuModelDocument({
      ...r.document!,
      materials: r.document!.materials.map((m) => ({ ...m, name: "same" })),
    });
    expect(
      (
        await exportObj(
          doc,
          { kind: "uint8-array" },
          { includeMaterials: true },
        )
      ).output,
    ).toBeUndefined();
    const yes = await exportObj(
      doc,
      { kind: "uint8-array" },
      { includeMaterials: true, allowLoss: true },
    );
    expect(yes.report.accepted).toBe(true);
    expect(yes.lossReports).toHaveLength(2);
    const again = await parseObj(yes.output as Uint8Array, {
      materialLibraries: [yes.materialLibrary!],
    });
    expect(again.report.accepted).toBe(true);
    expect(again.document!.materials.map((m) => m.baseColorFactor)).toEqual([
      [1, 0, 0, 1],
      [0, 0, 1, 1],
    ]);
    expect(
      again.document!.meshes[0]!.primitives.map((p) => p.materialId),
    ).toEqual(["material-0", "material-1"]);
    const limited = await exportObj(
      doc,
      { kind: "uint8-array" },
      { includeMaterials: true, limits: { maxMaterials: 1 }, allowLoss: true },
    );
    expect(limited.output).toBeUndefined();
  });
  it("yields during MTL work for cancellation and checks the whole-operation deadline", async () => {
    const mtl = "newmtl red\n" + "# comment\n".repeat(4000) + "Kd 1 0 0\n";
    const c = new AbortController();
    const promise = load(mtl, { signal: c.signal });
    setTimeout(() => c.abort("private"), 0);
    await expect(promise).rejects.toMatchObject({ code: "OBJ_ABORTED" });
    await expect(load(mtl, { timeoutMs: 1 })).rejects.toMatchObject({
      code: "OBJ_DEADLINE_EXCEEDED",
    });
  });
  it("counts CRLF line budgets by content bytes, like the OBJ parser", async () => {
    const r = await load(
      "newmtl red\r\n#" + "x".repeat(15) + "\r\nKd 1 0 0\r\n",
      { limits: { maxLineBytes: 16 } },
    );
    expect(r.report.accepted).toBe(true);
  });
});
