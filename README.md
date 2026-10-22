# @plasius/gpu-model-obj

OBJ and MTL import, export, triangulation policy, and explicit fidelity-loss reports.

This repository is the dedicated package boundary defined by ADR 0094.

## Parser status

`parseObj` imports the bounded triangle OBJ profile into the published canonical
core. `createObjRuntimeAdapter` binds it to runtime acquisition and orchestration.
Historical `packageName`/`packageBootstrap` exports remain compatible. Export,
MTL mapping, external resources, polygon triangulation, normal generation and
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
128 primitive groups, 32 library references and 64 diagnostic entries. Pass
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
remain incomplete after parser delivery. The parser uses exact published
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
