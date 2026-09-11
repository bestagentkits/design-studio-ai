# Released engine adoption probe

Date: 2026-09-10. Status: DONE_WITH_CONCERNS. This is a bounded release/API probe, not completion of the Phase 01 device, history, paint or performance gates.

## Decision

Select the planned native SVG/Canvas interaction/rendering route for the full Board surface. Excalidraw 0.18.1 fails the required arbitrary editable Bézier-path primitive through its released element/renderer contract. Do not add it to repository dependencies. Preserve the accepted Board, four diagram families, GIF and Paint scope; the fallback still needs implementation and validation.

Concrete evidence: in a real mounted release, `restoreElements([{type:'path', commands:[…]}], null)` returns zero elements. Its element union has no arbitrary path variant. Representing cubic handles as `customData` on a line retains metadata but produces exactly the same nonempty exported SVG path geometry as the line without those handles. The renderer is not using that metadata as editable curve geometry. Sampling into line points or importing SVG as an image would discard the requested independent control-handle editing semantics. A host-authored renderer, hit tester and control-handle editor could supply them, but that is already native implementation rather than a thin released-engine adapter.

This decision does **not** claim that history integration or GIF overlays are mathematically impossible. Those remain unproven; they are not the deciding blocker.

## Reproduce

From the repository with its existing development dependencies and Chromium installed:

```sh
node --check scripts/probes/excalidraw-release.mjs
node scripts/probes/excalidraw-release.mjs
```

The script creates a scratch directory outside the repository, fetches the pinned tarball, verifies SHA-512 before installing that local archive, installs React/React DOM 19.2.8 in scratch, bundles with the repository's esbuild, mounts the real package in Chromium, and records `result.json` in scratch. No server, live account, provider call or repository dependency edit is involved. Browser network requests are blocked; text/font/CDN integration is consequently **not** validated. The browser closes in `finally`.

Executed successfully using `/tmp/dsa-excalidraw-probe`, Node 25.2.1, esbuild 0.28.2, Playwright 1.63.0, Chromium 153.0.8010.12 and React/React DOM 19.2.8 (the installed repository React version). Scratch files are ephemeral; the script and pinned integrity are the durable reproduction. Transitive dependency versions are resolved by npm at run time, so this is not a fully frozen transitive installation. The inspected engine bytes are hash-pinned.

## Exact release and evidence

Registry `latest` returned **0.18.1** at inspection. [Pinned npm archive](https://registry.npmjs.org/@excalidraw/excalidraw/-/excalidraw-0.18.1.tgz):

- SHA-256: `b280d4b364b65cba264c5aa4e7435cc2ce6421eabbbef9765a56997a0fadf534`
- SHA-512 integrity: `sha512-6i5Gt7IDTOH//qa0Z315Ly5iVRhjWpu2whrlQFqkuwrkKUWgRsMk0P5qdE7bpyDpai7jeLeWYkyj1eVAfni1lw==`
- Package license field: MIT. The [version-tagged license](https://raw.githubusercontent.com/excalidraw/excalidraw/v0.18.1/LICENSE) agrees. The tarball itself does not include a root LICENSE file. Font/artwork and transitive notices were not audited; MIT engine metadata is not a blanket media-license claim.
- Shipped React/React DOM peers: `^17.0.2 || ^18.2.0 || ^19.0.0`. Scratch installation emitted peer-override warnings for older transitive Radix packages. Mount/bundle success does not erase those warnings or establish all React interactions work.

The following paths are relative to the extracted archive's `package/`, with line numbers from its actual shipped declaration files:

| Evidence owner | Finding |
| --- | --- |
| `dist/types/excalidraw/element/types.d.ts:160` | Closed element union; no arbitrary path type or custom element registry. |
| Same file, lines 209–217 | Line/arrow geometry is `LocalPoint[]`, endpoint bindings and arrowheads; no independent Bézier control-handle fields. |
| Same file, lines 249–255 | Freedraw carries points, pressures, simulated-pressure flag. |
| Same file, line 71 | `customData` exists, but is metadata rather than renderer behavior. |
| `dist/types/excalidraw/types.d.ts:608` | Imperative `history` contains only `clear`. |
| Same file, line 616 | `registerAction` exists. Do not infer no host history interception is possible merely from `history.clear`. |
| Same file, line 460 | `renderEmbeddable` exists; there is no general `renderElement` hook in the props. |
| `dist/types/excalidraw/index.d.ts` | Public root exports include restore, SVG/canvas export, scene updates and capture modes; internal renderer/history source is not thereby a public extension API. |

Shipped source maps additionally expose these implementation owners. These are release source-map contents, not current GitHub master:

| Source-map owner | SHA-256 | Relevant lines |
| --- | --- | --- |
| `../../data/restore.ts` | `52a7042e93cb9e575ccf676ca622a0f25f3cdb69112fdb40fc1af3d1d17e9509` | 225–384: supported-type switch; unknown elements return null. |
| `../../renderer/renderElement.ts` | `b45a76dfb1e429732e3e1d54888389e78da6797d24ba8addd0ed442c1e7e9bd5` | 401–409: cached line shapes; 429–467: image-cache lookup and `drawImage`. |
| `../../components/App.tsx` | `888381b5fb6920c0ffe77f55945cb0338d05f8d541186ca75667abee5eecd85e` | 1005 onward: DOM embeddable surfaces; 1809: embeddables rendered after canvas surface. |

## Measured result versus outstanding gates

| Probe | Result | Boundary |
| --- | --- | --- |
| Released package mounts with repository React version | PASS | Real Chromium mount and esbuild bundle. Vite production integration and self-hosted font loading not tested. |
| Pressure data survives restore | PASS | `[0.1, 0.9]` preserved on freedraw. Physical pressure capture and visual stroke fidelity not established. |
| Arbitrary editable cubic path via public scene model | FAIL | Unknown path removed; custom handles have no effect on nonempty SVG geometry. Native fallback selected. |
| Public history surface | INSPECTED | Runtime keys are exactly `['clear']`; `IMMEDIATELY`, `EVENTUALLY`, `NEVER` exported. |
| Programmatic remote projection echo | OBSERVED | `updateScene` with `CaptureUpdateAction.NEVER` still emits `onChange`. Adapter needs explicit echo suppression; capture mode alone is insufficient. |
| One gesture / one undo and interleaved Board/Paint/agent/remote undo | UNMEASURED | No unified host-history implementation tested. Native route must own semantic transaction boundaries and protect remote changes. |
| Mixed vector/GIF/Paint z-order | UNMEASURED | Source uses cached canvas image drawing; custom embeddables occupy a separate DOM surface. Neither is proof of mixed animated z-order. No pixel/timing test performed. |
| GIF pause, timing, clipping, hit testing and deterministic exports | UNMEASURED | A data URL or static poster does not satisfy this gate. |
| Text, bindings, grouping, lock/flip and canonical REST/CLI round-trip | UNMEASURED | Types are encouraging but no Studio adapter exists. |
| Pencil/palm/IME, mobile, Firefox/WebKit and sustained workloads | UNMEASURED | Only synthetic desktop Chromium execution performed. |

The [official API documentation](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/excalidraw-api) agrees about the limited history surface and capture modes. Released types/runtime take precedence over broader assumptions based on current docs or unmerged work.

## Next implementation boundary

Implement native typed path geometry with explicit cubic/quadratic handles, hit testing, selection and one host transaction journal. Compose vector, decoded GIF frames and painting references in the same ordered surface; keep canonical assets and deterministic export timing shared with the server renderer. Measure that route against the existing acceptance matrix before claiming native parity. Continue evaluating permissive geometry/layout helpers separately; this probe did not adopt a new dependency.

Docs impact: none to evergreen product docs; no feature or public contract changed. Evidence only lives under the accepted plan and a development probe script.

Unresolved evidence: native interaction cost/performance, mixed animated composition, unified history/rebase behavior, device/Pencil quality, font/artwork/transitive license review if any Excalidraw code or assets are later reused. No requirement was removed.
