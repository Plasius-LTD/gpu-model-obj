# @plasius/gpu-model-obj

OBJ and MTL import, export, triangulation policy, and explicit fidelity-loss reports.

This repository is the dedicated package boundary defined by ADR 0094.

## Bootstrap status

This initial repository contains the approved schema baseline, legal and governance files, and a package smoke-test surface. Functional model conversion work is tracked in the repository's [TASK] issues and must flow through the canonical GPU model boundary.

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
artifacts using exact, case-normalised path checks. CI runs on approved
self-hosted runners for same-repository pull requests and `main`; fork PR code
is denied. Normal publication uses the GitHub-hosted `production` job with Node 24 and
npm 11.5.1 or newer. It is token-free and proceeds only while the prepared SHA
is the exact `main` head after successful push-triggered CI. Because npm cannot
bind a trusted publisher before the package exists, the initial `0.1.0` release
has an explicit, package-absence-checked bootstrap path using a short-lived
credential in `production`. Remove that path and credential immediately after
the trusted publisher is bound and a later OIDC release is proven.
<!-- END PLASIUS RELEASE INTEGRITY -->
