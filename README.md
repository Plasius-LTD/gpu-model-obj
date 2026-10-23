# @plasius/gpu-model-obj

OBJ and MTL import, export, triangulation policy, and explicit fidelity-loss reports.

This repository is the dedicated package boundary defined by ADR 0094.

## Parser status

`parseObj` imports the bounded triangle OBJ profile into the published canonical
core. `createObjRuntimeAdapter` binds it to runtime acquisition and orchestration.
Historical `packageName`/`packageBootstrap` exports remain compatible. The
deterministic `exportObj` geometry exporter is available below.
Opt-in bounded MTL mapping is available below. External resources, polygon triangulation, normal generation and
advanced fidelity reporting remain tracked separately below.

```ts
import { parseObj } from "@plasius/gpu-model-obj";

const result = await parseObj(new TextEncoder().encode(
  "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n",
));
if (result.document) {
  // Immutable, byte-verified GpuModelDocument from @plasius/gpu-model-core.
  console.log(result.document.bounds);
}
```

The profile accepts `v x y z` (optional homogeneous `1`), `vt u v`, `vn x y z`
and triangle `f` records with independent positive/negative position/UV/normal
indices. Preserve names from `o`, `g`, `usemtl`, `mtllib` and `s` as inert
metadata; libraries and textures are never fetched. Missing attributes remain
absent. Unsupported records, polygons, vertex colours, non-unit weights and
mixed attribute presence within a face fail explicitly. OBJ's unitless values
are assumed to use metres/Y-up/right-handed coordinates at the authored origin;
the separate static-demo floor-centred profile needs explicit normalization.

`mode` defaults to `strict`. Tolerant/forensic can discard invalid-index faces
only with explicit `allowLoss: true`, producing paired core repair/loss entries.
Other malformed elements block the whole import. Rejected results have no
document. Forensic evidence contains bounded numeric indices and counts, with
no original comments/names/paths. Canonical asset metadata retains authored
names and should not be logged as telemetry. Fixed-code `ObjImportError` handles
invalid options/input, abort/deadline, runtime rejection and canonical failure.

`OBJ_PARSER_LIMITS` declares hard ceilings: 8 MiB input, 4096 UTF-8 bytes/line,
100,000 combined source elements, 100,000 faces, 300,000 expanded vertices,
128 primitive groups, 128 materials, 32 library references and 64 diagnostic entries. Pass
`limits` to tighten any ceiling, `signal` for cancellation and `timeoutMs`
(1–30,000, default 30,000) for the whole parse. The parser copies the input before
asynchronous work and cooperatively yields while parsing/packing. Core validation
is synchronous and bounded; supply application worker isolation when needed.

```ts
import { AdapterRegistry, ModelRuntime } from "@plasius/gpu-model-runtime";
import { OBJ_PARSER_LIMITS } from "@plasius/gpu-model-obj";

const registry = new AdapterRegistry().register({
  formatId: "obj",
  extensions: ["obj"],
  load: async () => (await import("@plasius/gpu-model-obj")).createObjRuntimeAdapter(),
});
const runtime = new ModelRuntime({ registry });
// Invoke only after the consumer's remote feature evaluator allows conversion.
const loaded = await runtime.loadModel({ kind: "uint8-array", bytes }, {
  formatId: "obj", mode: "strict",
  fetchPolicy: { maxBytes: OBJ_PARSER_LIMITS.maxInputBytes },
});
```

`bytes` above is the caller's admitted source. The bridge advertises no bundled
worker and interprets fixed constructor `limits`, `timeoutMs`, and `allowLoss`,
rather than runtime per-call `adapterOptions`. Runtime owns acquisition, cache
and resolver policy; the parser never invokes related-resource resolution.
See [ADR-0007](docs/adrs/adr-0007-bounded-canonical-obj-parser.md) and the
[parser plan](docs/designs/obj-parser.md).

## Deterministic export

```ts
import { exportObj } from "@plasius/gpu-model-obj";

// document is the branded, byte-verified result from parseObj or model core.
const exported = await exportObj(document, { kind: "uint8-array" });
if (exported.report.accepted && exported.output instanceof Uint8Array) {
  // The caller owns saving/transmitting these bytes after its own authorization.
}
```

`exportObj` uses core's `ModelTarget`, `ExportOptions` and `ModelExportResult`.
`OBJ_EXPORT_TARGET_KINDS` declares `uint8-array`, `array-buffer` and `blob` support.
Blob MIME type is `text/plain`; an optional safe basename such as `mesh-1.obj`
changes the inline manifest's path. Default path is `model.obj`. File paths, URLs,
streams and archive/package targets are rejected; no implicit I/O occurs.

The profile writes f32 triangle POSITION/NORMAL/TEXCOORD_0 with optional
u8/u16/u32 indices and interleaved buffers. Scene instances/transforms are baked
in root/child/primitive order, normals use inverse transpose, and reflections
reverse winding. Numeric spelling round-trips f32 values without a decimal
precision setting; identical tuples use independent one-based indices in stable
first-use order. Output uses LF and a fixed header. Unsupported attributes,
component types, topologies, singular transforms and nonrepresentable values
produce a rejected core report with no partial output.

Object/group/material/library/smoothing references are preserved as inert asset
text. A missing object name falls back to node name, mesh name, then node ID;
clearing a previous material emits `usemtl off`. Parser reimport retains that off
marker as metadata. Canonical material binding IDs take precedence over source hints; display names
are not used as IDs because they need not be unique.
The default reference-only path omits material **definitions** with a `dropped`
loss requiring explicit `allowLoss: true`. Set `includeMaterials: true` for the
paired MTL path below. Texture files are not included. Rigs, skins, animation,
blend shapes, textures and analytic geometry are rejected even with consent;
Tasks26–29 retain their separate fidelity and resource responsibilities.

`OBJ_EXPORT_LIMITS` bounds aggregate resources (16 MiB), resources (32), accessors
(512), nodes (4096), primitive instances (128), corners (300,000), unique source
elements (100,000), materials (128) and aggregate UTF-8 output (8 MiB across
OBJ plus MTL when requested). Tighten using `limits`; `signal` and
`timeoutMs` (1–30,000 ms) cover the whole operation, including stalled resource
reads. Output is staged in memory, with cooperative processing checkpoints.
Caller workers and concurrency limits provide additional execution isolation.

Unverified document copies, invalid target/options and operational failures throw
fixed-code `ObjExportError`; unsupported content and exhausted budgets return
rejected reports. Strict/tolerant/forensic policy comes from core. Forensic evidence
contains numeric counts only. Asset bytes intentionally retain authored names;
do not log arbitrary assets or treat them as safe HTML/telemetry. See
[ADR0008](docs/adrs/adr-0008-deterministic-canonical-obj-export.md) and the
[exporter plan](docs/designs/obj-exporter.md).

## Opt-in OBJ and MTL material mapping

```ts
import { parseObj, exportObj } from "@plasius/gpu-model-obj";

// Bytes are admitted/provided by the caller; the package performs no acquisition.
const loaded = await parseObj(objBytes, {
  materialLibraries: [{ name: "model.mtl", bytes: mtlBytes }],
});
if (loaded.document) {
  const exported = await exportObj(loaded.document, { kind: "uint8-array" }, {
    includeMaterials: true,
  });
  if (exported.output instanceof Uint8Array && exported.materialLibrary) {
    // Actual paired bytes, not just a manifest descriptor.
    const roundTrip = await parseObj(exported.output, {
      materialLibraries: [exported.materialLibrary],
    });
    console.log(roundTrip.report.accepted);
  }
}
```

`materialLibraries` is an explicit in-memory table of `ObjMaterialLibrary`
(`name`, `bytes`). Omitting it retains the existing geometry/reference-only
profile. Passing `[]` requests definition/binding validation with no supplied
files. Only files named by `mtllib` are interpreted, in first reference order;
the input table's order does not change output. Names are safe, case-sensitive
basenames matching `[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\.mtl`; no directory, URL,
resolver, filesystem read or fetch is involved. Files are snapshotted before the
first await. Aggregate OBJ + supplied MTL input uses the 8 MiB ceiling, including
unreferenced table entries; the table cannot exceed 32 entries or 8 MiB itself.
An invalid/duplicate table entry throws `OBJ_INVALID_OPTIONS` before parsing.
Referenced library hashes are retained with names in asset metadata
`materialLibraryContentHashes`; `provenance.sourceContentHash` remains the exact
OBJ hash. Do not log arbitrary asset metadata.

The diffuse material profile supports `newmtl`, RGB `Kd`, RGB `Ke` (common
emissive extension), and scalar dissolve `d` or inverse-transparency `Tr`.
RGB accepts one value repeated across channels, or exactly three values. `Kd`
and opacity must be finite in [0,1]; `Ke` must be finite and non-negative. Numeric
spelling must be decimal, with optional exponent; overflow, underflow to zero,
inexpressible `Tr` inversion and non-numeric/partial tokens fail. Defaults are
white diffuse, opaque and zero emission, with canonical metallic 0/roughness 1.
Material names are single non-whitespace tokens of up to 256 characters, with
no controls, bidi formatting, `#` or backslash. Canonical IDs are separate stable
`material-N` identifiers, and face groups receive actual `materialId` bindings.
`usemtl off` clears a binding unless a supplied material is literally named off.

Duplicate definitions across or within files, repeated supported properties,
conflicting `d`/`Tr`, invalid UTF-8/names/values and properties before `newmtl`
block all modes. Unsupported legacy/Phong/PBR/texture statements create explicit
`dropped` losses and require `allowLoss: true` in every mode. Recognized advanced
numeric fields are validated before dropping; the profile intentionally limits
reflectance colours to [0,1], `Ns`/sharpness to [0,1000], `Ni` to [.001,10],
`illum` to integer [0,10], and PBR scalar fields to [0,1]. Spectral/XYZ colours,
halo dissolve and texture options are outside this profile. Texture-reference
preservation is Task26; do not interpret loss consent as texture acquisition.

Missing used definitions (including absent libraries) reject strict mode.
Tolerant/forensic recovery additionally needs `allowLoss: true`: core's registered
`malformed-material-reference` repair assigns one canonical default material,
paired with an appearance-loss report. The unresolved reference stays in asset
metadata; reports contain only fixed messages/numeric locations. No unregistered
repair or silent substitute is used. Unused missing libraries do not require a
default material; only used bindings determine the repair policy.

Paired export returns core-compatible `ObjExportResult`, extending
`ModelExportResult` with optional `materialLibrary: { name: "model.mtl", bytes }`.
It emits `mtllib model.mtl`, actual material bytes, matching manifest entries and
stable LF/decimal spelling in canonical material-array/property order. Safe,
unique authored names survive; otherwise unique identifiers avoid ambiguous
bindings and a name-loss report requires consent. Canonical advanced semantics
also require explicit approximation consent. Reference-only documents without
canonical definitions cannot use paired export. The same byte/material budgets,
deadline and cancellation policy cover both files; rejected results expose
neither file. The runtime acquisition bridge remains reference-only; callers
needing this material table invoke `parseObj` directly after their own admission.
See [ADR0009](docs/adrs/adr-0009-bounded-mtl-material-mapping.md) and the
[material design](docs/designs/obj-materials.md).

## Bootstrap corpus and implementation

The [conformance plan](docs/designs/obj-bootstrap-conformance-plan.md) and
[ADR 0006](docs/adrs/adr-0006-obj-bootstrap-fixtures-and-ownership.md) define
canonical ownership, fixture rights, preservation expectations and release scope.
The [manifest](tests/fixtures/manifest.json) covers malformed indices, missing
material libraries and texture paths, n-gons, multi-material meshes, missing
normals and smoothing groups. These are synthetic Apache-2.0 source fixtures;
`npm test` verifies their integrity and semantic triggers. Adapter conformance
for the remaining adapters is pending. Fixtures are in tagged repository sources, outside the `dist`-only
npm runtime artifact. No external resources are fetched by the fixture tests.

| Work package | Project Task |
| --- | --- |
| Implement canonical OBJ parser with bounded diagnostics | [#23](https://github.com/Plasius-LTD/gpu-model-obj/issues/23) |
| Implement deterministic canonical OBJ exporter | [#24](https://github.com/Plasius-LTD/gpu-model-obj/issues/24) |
| Implement MTL import and export material mapping | [#25](https://github.com/Plasius-LTD/gpu-model-obj/issues/25) |
| Preserve safe OBJ and MTL texture resource references | [#26](https://github.com/Plasius-LTD/gpu-model-obj/issues/26) |
| Define and implement OBJ polygon triangulation policy | [#27](https://github.com/Plasius-LTD/gpu-model-obj/issues/27) |
| Preserve OBJ smoothing groups and missing-normal policy | [#28](https://github.com/Plasius-LTD/gpu-model-obj/issues/28) |
| Report OBJ fidelity loss for rigs skins animations and advanced materials | [#29](https://github.com/Plasius-LTD/gpu-model-obj/issues/29) |

The [existing implementation coordinator](https://github.com/Plasius-LTD/gpu-model-obj/issues/1)
and [Feature #1151](https://github.com/Plasius-LTD/plasius-ltd-site/issues/1151)
remain incomplete after parser/exporter delivery. The parser uses exact published
`@plasius/gpu-model-core@0.7.0` and `@plasius/gpu-model-runtime@0.3.2` dependencies;
it introduces no local workspace references or shared-contract replacements.

## Rollout

- Feature flag: gpu.model.conversion.enabled
- Capability: none for this package-only layer
- Rollback: disable the feature flag and keep the published package version pinned to the last validated release

## Development

Requires Node.js 24 and npm.

```bash
npm ci
npm run typecheck
npm test
npm run lint
npm run build
npm pack --dry-run
```

## License

Apache-2.0. See LICENSE, SECURITY.md, and the files under legal/.

<!-- BEGIN PLASIUS RELEASE INTEGRITY -->
## Release integrity

CI keeps the administrative contributor registry outside Git and npm package
artifacts using exact, case-normalised path checks. CI runs on explicit
GitHub-hosted runners. Publication uses the GitHub-hosted `production` job with
Node 24 and a pinned npm 11.6.2 client. It is token-free and proceeds only while
the prepared SHA is the exact `main` head after successful push-triggered CI.
The completed `0.1.0` bootstrap path has been removed; subsequent releases must
use npm trusted publishing.
<!-- END PLASIUS RELEASE INTEGRITY -->
