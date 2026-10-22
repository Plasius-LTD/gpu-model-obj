# @plasius/gpu-model-obj

OBJ and MTL import, export, triangulation policy, and explicit fidelity-loss reports.

This repository is the dedicated package boundary defined by ADR 0094.

## Bootstrap status

This initial repository contains the approved schema baseline, legal and governance files, and a package smoke-test surface. Functional model conversion work is tracked in the repository's [TASK] issues and must flow through the canonical GPU model boundary. The published runtime exports only `packageName` and immutable `packageBootstrap` metadata; import/export APIs are pending.

## Bootstrap corpus and implementation

The [conformance plan](docs/designs/obj-bootstrap-conformance-plan.md) and
[ADR 0006](docs/adrs/adr-0006-obj-bootstrap-fixtures-and-ownership.md) define
canonical ownership, fixture rights, preservation expectations and release scope.
The [manifest](tests/fixtures/manifest.json) covers malformed indices, missing
material libraries and texture paths, n-gons, multi-material meshes, missing
normals and smoothing groups. These are synthetic Apache-2.0 source fixtures;
`npm test` verifies their integrity and semantic triggers. Adapter conformance
is pending. Fixtures are in tagged repository sources, outside the `dist`-only
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
remain incomplete after bootstrap. Future work reuses the published canonical
core and runtime packages rather than implementing shared contracts here.

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
