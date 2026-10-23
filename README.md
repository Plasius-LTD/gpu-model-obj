# @plasius/gpu-model-obj

OBJ and MTL import, export, triangulation policy, and explicit fidelity-loss reports.

This repository is the dedicated package boundary defined by ADR 0094.

## Parser status

`parseObj` imports the bounded simple planar polygon OBJ profile into the published canonical
core. `createObjRuntimeAdapter` binds it to runtime acquisition and orchestration.
Historical `packageName`/`packageBootstrap` exports remain compatible. The
deterministic `exportObj` geometry exporter is available below.
Opt-in bounded MTL mapping and explicit safe external-resource identities are available below. Polygon triangulation is described below. Normal generation and
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
and simple planar `f` records with independent positive/negative position/UV/normal
indices. Preserve names from `o`, `g`, `usemtl`, `mtllib` and `s` as inert
metadata. Default parsing never acquires libraries or textures; explicit resource policy is described below. Missing attributes remain
absent. Unsupported records, ambiguous polygons, vertex colours, non-unit weights and
mixed UV presence within a face fail explicitly. Mixed normal presence requires
the explicit generation policy below. OBJ's unitless values
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
100,000 combined source elements, 100,000 faces, 256 corners/face, 1,000,000 global triangulation work units and 1,000,000 normal work units,
300,000 expanded vertices,
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
and resolver policy. Related-resource resolution requires the explicit constructor opt-in described below.
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
Task29 retains its separate advanced fidelity responsibilities. Task26 preserves inert external references as described below.

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
basenames matching `[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\.mtl`; directories require the explicit resource profile below. No ambient filesystem read or fetch is involved. Files are snapshotted before the
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

## Safe external resource identities

Task [26](https://github.com/Plasius-LTD/gpu-model-obj/issues/26) adds an explicit
reference-preservation profile. Image bytes remain caller-owned; this profile
neither decodes images nor creates canonical texture/renderer bindings. An
`available` resource means its bytes and SHA-256 were observed, **not** that an
image decoder approved its content. Accepted results contain a fixed warning
for that limitation. No ambient fetch, filesystem API, resolver construction,
archive extraction, retry, or image upload occurs.

```ts
import { parseObj, exportObj } from "@plasius/gpu-model-obj";
import type { ResourceResolver } from "@plasius/gpu-model-runtime";

// approvedResolver is constructed/authorized by the caller's acquisition layer.
const approvedResolver: ResourceResolver = callerOwnedResolver;
const loaded = await parseObj(objBytes, { resources: { resolver: approvedResolver } });
if (loaded.document) {
  const output = await exportObj(loaded.document, { kind: "uint8-array" }, {
    includeMaterials: true,
  });
  // Save actual OBJ and output.materialLibraries bytes only after authorization.
  // The directory manifest also names external textures; provide their admitted
  // bytes separately. No texture payload is included by this exporter.
}
```

Passing `resources: {}` enables preservation without granting any I/O. Supply
`materialLibraries` for in-memory MTL files, including safe relative directory
paths. Missing textures are retained as unresolved identities; strict mode
rejects them, and tolerant/forensic require `allowLoss: true` for core's registered
`missing-texture-path` repair. Missing libraries emit `OBJ_MISSING_LIBRARY`;
used definitions retain the existing default-material repair/consent requirements.
Missing unused libraries remain inert and are never fabricated during export.
Omitting `resources` preserves the 0.4.0 basename-only material profile and its
unsupported-map loss behavior.

The optional `resources.resolver` uses published runtime `ResourceResolver`.
Only validated package-root relative paths cross that port, sequentially, once
per distinct identity, with remaining `maxBytes` and a cancellation signal.
The parser verifies returned path, byte count and SHA-256, copies admitted
bytes, and sanitizes port failures. Input + all supplied MTL + acquired MTL and
texture bytes share the 8 MiB ceiling; all material/texture identities share the 32
reference ceiling. Unreferenced supplied files count against the input budget.
The whole-operation deadline covers stalled ports and aborts their signal;
providers must honor cancellation and enforce `maxBytes` while acquiring data.
Workers remain caller-provided. `createObjRuntimeAdapter({ resolveResources:
true })` explicitly forwards runtime's acquisition resolver; default bridge
construction performs no related-resource reads.

Paths are case-sensitive ASCII segments of letters, digits, underscore, dot,
hyphen and internal spaces, separated by `/`, at most 256 characters. Segments
cannot be empty, `.`/`..`, begin with `-`, end with `.`, or have edge spaces.
Absolute paths, schemes/drive letters, percent encoding, query/fragment syntax,
backslash separators, Unicode/control characters and traversal are rejected
before I/O. An OBJ `mtllib` line may list multiple paths; quote paths containing
spaces (`"material files/a.mtl"`) or escape spaces (`material\ files/a.mtl`).
For MTL map filenames, unquoted internal spaces are literal; quotes and escaped
spaces are also accepted. `#` starts a comment only outside quotes at a token
boundary. `mtllib` paths must end in `.mtl`. No path normalization, URL decoding,
upward resolution, or absolute-scheme allowlist is inferred. Resolver authors
remain responsible for keeping accepted relative keys within their own sandbox.

Supported inert map declarations are `map_Ka`, `map_Kd`, `map_Ks`, `map_Ke`,
`map_Ns`, `map_d`, `bump`, `map_bump`, `disp`, `decal`, `norm`, `map_Pr`, `map_Pm`
and `map_Ps`. Each slot occurs at most once per material. Map options (`-s`,
`-o`, etc.), reflection-type options, continuation syntax and unsupported map
semantics fail explicitly in this profile; no lossy reinterpretation occurs.
A texture path is relative to its declaring MTL directory. Canonical
`metadata.objResourceReferences` holds ordered root-relative path/role/status
and optional observed content hash; `material.sourceMetadata.objMaterialLibrary`
and `objTextureReferences` retain library ownership and map slot identities.
These are inert asset metadata and must not be logged as telemetry or treated
as permission to read. Unavailable images are deliberately not core's
byte-verified image resources or resource-graph nodes.

Paired export preserves those library paths, returns **all actual files** in
`materialLibraries`, and preserves map paths relative to each output MTL.
`materialLibrary` remains the single-file convenience when exactly one file is
returned. Default material-only export still generates `model.mtl` compatibly.
Caller-created resource metadata is revalidated before any output is returned;
collisions, mismatched declared-library/manifest identity sets, inconsistent ownership and cross-directory upward rebasing are
rejected atomically. `resourcePackage` uses `directory-manifest` when external
textures remain; descriptors never imply image payload inclusion. Reimport the
actual exported table with `resources: {}` (and consent for unresolved images),
or supply an approved resolver to revalidate image availability.

See [ADR0010](docs/adrs/adr-0010-safe-relative-resource-identities.md) and the
[resource design](docs/designs/obj-resource-references.md). Consumer rollout and
rollback still use remotely evaluated `gpu.model.conversion.enabled`; pin the
last qualified public 0.4.0 when rolling back this profile. No capability or local
flag evaluator is added by package-only reference preservation.

## Deterministic polygon triangulation

Simple planar convex and concave faces with 3–256 corners import directly into
canonical triangle topology. No option or loss consent is needed for valid
polygons. Deterministic ear clipping preserves the authored winding, original
f32 corner positions and independent UV/normal indices, face groups, materials
and smoothing metadata. Every n-corner face emits exactly n-2 triangles. A fixed
`OBJ_POLYGON_TRIANGULATED` warning records the topology conversion; no repair or
fidelity loss is claimed. Export writes the derived triangles; it does not
reconstruct original polygon contours.

Degenerate triangles/polygons, repeated or collinear corners, touching/crossing
nonadjacent edges, holes and non-planar contours reject in every mode, including
with `allowLoss: true`. There is no silent welding, projection or face removal.
The existing invalid-index face-drop ledger remains separate. Validation operates
on canonical f32 values: after translation/normalization by largest 3D extent,
plane-distance tolerance is 1e-7, orientation/area tolerance 1e-12 and squared
point-distance tolerance 1e-24. Near-threshold/thin shapes are conservatively
rejected. Admitted coordinates are retained unchanged. Triangle degeneracy
validation intentionally tightens the earlier admission profile.

`limits.maxFaceVertices` and `limits.maxTriangulationWork` tighten the hard 256
corner and 1,000,000 import-wide work ceilings. Validation and ear-search loops
consume the same global budget, including triangles; capacity for all expanded
corners is checked first. At most 256 work units run between cooperative yields.
The existing whole-operation abort/deadline covers a single complex face too.
Budget exhaustion returns `OBJ_LIMIT_EXCEEDED` without a partial document.
Applications still own worker isolation and simultaneous import admission. See
[ADR0011](docs/adrs/adr-0011-bounded-polygon-triangulation.md) and the
[triangulation design](docs/designs/obj-triangulation.md).


## Explicit missing normals and smoothing

`parseObj(bytes, { missingNormals: "preserve" })` is the compatible default:
wholly omitted normal attributes remain absent, and mixed normal presence within
a face rejects. Use `missingNormals: "reject"` to require authored normals at
every corner. `missingNormals: "generate"` explicitly fills only missing corners,
including mixed authored/missing faces; authored f32 values and magnitudes remain
unchanged. `createObjRuntimeAdapter({ missingNormals: "generate" })` forwards the
same policy through the published runtime. Mode/allowLoss never silently enable it.

```ts
const result = await parseObj(bytes, { missingNormals: "generate" });
// Check report.accepted before using result.document.
// OBJ_NORMALS_GENERATED reports that derived normals were explicitly added.
```

`s off`/`s 0` produce a hard original-face normal. `s on` aliases group `1`;
other single named/numeric tokens retain exact identity (`01` differs from `1`).
Smoothing sums signed area vectors once per original face/source corner, across
material/group/UV boundaries but only for the same object name, smoothing token
and source position index. Identical coordinates at different source indices do
not weld; repeated object declarations with the same name share identity.
Triangulating an n-gon does not add diagonal hard edges or extra corner weights.
Authored-normal faces contribute geometric area to missing neighbours without
changing their own normals. This is a deterministic area-weight policy, not an
inference of author-intended shading.

Zero or nearly cancelling requested sums (length at most 1e-12 of incident area
magnitudes) reject with `OBJ_AMBIGUOUS_NORMAL` in every mode, even with allowLoss.
There is no silent orientation repair or fallback normal. `OBJ_MISSING_NORMALS`
reports reject-policy omissions; invalid multi-token `s` records report
`OBJ_INVALID_SMOOTHING`. Diagnostics are fixed, bounded and contain no asset text.
Explicit generation emits one warning, no repair/loss claim. Diagnostic exhaustion
still rejects. UV omissions are never filled by this policy.

`limits.maxNormalWork` tightens the import-wide 1,000,000-unit ceiling; one unit
covers each triangle area, smooth source corner and expanded output corner.
Linear passes yield/check at most every256 units, sharing the whole-operation
abort/deadline and existing geometry ceilings. No partial document or I/O occurs
on generation failure. Export preserves smoothing identities and generated normal
directions deterministically; existing transform/export rules normalize authored
normal directions and do not preserve their non-unit magnitudes or source index
spelling. Reimport retains emitted normals without regeneration.

See [ADR0012](docs/adrs/adr-0012-explicit-missing-normal-policy.md) and the
[acceptance matrix](docs/designs/obj-normals.md). Rollback uses the consuming remote
`gpu.model.conversion.enabled` evaluator and pins validated public0.6.0; no local
flag replaces that control. No capability or new consumer integration is added.
