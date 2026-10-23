# OBJ triangulation design and acceptance tests

Task https://github.com/Plasius-LTD/gpu-model-obj/issues/27 implements
[ADR0011](../adrs/adr-0011-bounded-polygon-triangulation.md).

- Parser resolves independent signed OBJ indices before geometry validation;
  attributes must be consistently present on every corner.
- Internal triangulation module validates normalized canonical f32 positions and
  returns indices into the original corner list. Parser expands those indices
  into existing canonical groups. No generated normals or material changes.
- Policy adds per-face corner and global work ceilings through existing limits.
- Shape failures use fixed codes/messages and numeric line locations. No caller
  names, comments, coordinates or exceptions enter report text. Any failure
  prevents exposing a partial document.

Tests are defined before implementation: authored convex5 and concave5 contours,
all three projection axes and reverse winding; exactly n-2 nonzero triangles,
signed area sum, original boundary edges/internal edge pairing and unchanged
corner tuples; deterministic bytes/reports and export/reimport triangle geometry;
negative/independent indices, material/smoothing groups and runtime admission;
collinearity, repeated vertices, touching/crossing contours, non-planarity, thin
ambiguity and f32 collapse in strict/tolerant/forensic; hard/tightened face/work/
expanded-output budgets and abort/deadline during the ear search. Generated
simple radial contours exercise deterministic topology across varying sizes.

Baseline and final validation use npm ci/test/coverage/lint/typecheck/build,
whole-test strict typing, pack/public-artifact checks, audit/tree/signatures,
packed and actual public dual-module/browser consumers and approved hosted
CI/CD qualification. Source remains dependency-free beyond the existing public
core/runtime. No external assets, third-party fixture rights or secrets required.
