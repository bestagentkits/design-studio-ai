Implemented and merged by #36 at 1a23d4a. Deployed and accepted on production.

Validation before deployment:
- PR CI on 859efcf: 333 unit/integration tests and 117 desktop/mobile E2E passed, 3 configured skips; typecheck, web/CLI build and packaged skill passed.
- Desktop/mobile Chromium affected workflows, with independent Firefox and mobile WebKit character/header coverage.
- Mobile header overlap discovered by real pointer tests and repaired; local transient connection/export timing failures passed unchanged on isolated reruns.
- Reviewed durable-worker lease ownership, rig compatibility, exported bind spaces, and immutable topology-cache use.

Production acceptance:
- Main CI and deploy [34586607613](https://github.com/bestagentkits/design-studio-ai/actions/runs/34586607613) passed; main also recorded 333 unit/integration and 117 E2E passes with 3 configured skips.
- Cloudflare serves 100% version `c968fe8a-df19-4871-9162-cacbad1621e8`, message `1a23d4a4a4ca4c14c6c15f2ae7318004a908ce2b`; migration 0012, queue producer/consumer, health, OAuth discovery and thumbnail smoke succeeded.
- WebMCP preview/apply converted the actual Mochi rig, edited only walk amplitude, refined the shoulder with a recoverable checkpoint and locked weights, authored tail normal/roughness layers and four stance constraints.
- Durable save moved revision 9 to 10. Reusing the same ID and payload returned the original successful revision 10; reconciliation and reload retained it. The original 45-node page was unchanged, idle/wag settings unchanged, and source bone keys preserved.
- Actual saved character has 7 tracks rather than 76, 23 accessory rig references, and four persistent contacts. Live 25-time animation inspection returned zero warning samples; 49 walk samples measured active-contact error 5.66e-16 and maximum foot-joint penetration 0.0020462 scene units (below the 0.005-unit acceptance tolerance).
- Both production export jobs succeeded for revision 10. GLB: 2,097,260 bytes versus 9,686,136 (78.35% reduction); 25 meshes, one 22-joint skin, four animations with 61 channels each rather than 1,130.
- Reopened the actual job artifact with GLTFLoader: all 24 skinned meshes share the bone objects; two morph meshes, UVs, normal and roughness maps remain. Maximum bone-position error against the scene solver over 49 samples: 5.0241e-8.
- GLB SHA-256: `bf66910d07232ed2f7a694cd6809743e0618100dcfd456c0f3abb5730b5140fa`.
- Four-angle job ZIP: 425,364 bytes; front/right/back/left PNGs are 1280×800 with camera/time manifest. Reviewed rendered output. Artifacts remain private and were not attached to this issue.
- The in-app browser did not emit a download-to-disk event. For independent artifact inspection, retrieved bytes from the same authenticated operation result URLs through the tab's developer API; no substitute export was rendered.
- Operations UI after reload displayed the successful save receipt and revision 10.

Limits remain explicit: triangle refinement is not anatomical quad retopology; persistent contacts support an unparented two-bone rig with horizontal ground height; sampled diagnostics do not certify continuous collision freedom. Original private project page remains intact.
