# Timeline videos and motion

Read [shared layout and quality](layout-and-quality.md) first. Use this for `kind: "video"`; inspect the `motion-title` template and the live timeline schema.

## Sequence and supported motion

Define the intended audience, aspect ratio, duration, message, and sound requirement before animation. Build a short sequence of readable beats: orient, develop, and resolve. Honor the requested duration and content. Use explicit page dimensions for the delivery frame, leaving sufficient room for text and meaningful imagery.

The document `timeline` contains `duration`, `fps`, and tracks with an actual `nodeId` and `keyframes`. Each keyframe has `time`, `values`, and optional `easing`; times must be unique within each track and within the duration. Supported easing includes linear, easeIn, easeOut, easeInOut, bounce, spring, step, or a cubic-bezier tuple. `muted` suppresses a track; `locked` is an editing affordance, not a visibility switch.

Use implemented animated values: `x`, `y`, `width`, `height`, `rotation`, `opacity`, and supported style values such as `fontSize`. Scene transforms use keys such as `scene.rotation.y`; bone transforms use keys such as `scene.bones.0.rotation.z`. Numeric values interpolate; strings such as colors hold between keyed values rather than smoothly blend. Do not assume every accepted key is animated or that arbitrary CSS/video-editing properties work.

Use asset-backed `video` and `audio` nodes for imported media. Uploading an asset does not place it in the document. Inspect media and timeline controls for real behavior; do not invent trim, subtitle, compositing, or transition fields absent from the implementation.

## Layout and taste

Use Flex for stable title/caption groups and related labels, with consistent spacing. For intentional coordinate animation, use absolute positioning within a known container: flow layout can determine positions regardless of animated x/y. Keep a clear focal point per beat. Prefer a limited family of motion curves, enough hold time to read text, and restrained entrances/exits. Sound should support the meaning without masking speech.

Preserve typography, brand, and approved words. Review text at the actual delivery size; larger canvas dimensions do not guarantee readability on a phone. Avoid rapid flashing and gratuitous motion, and provide the agreed static alternative when the audience needs it.

## Review and delivery

Play the whole timeline, then inspect the first/last frames and movement extremes. Check overshoot, clipping, text overflow, layer order, unintended blank frames, long-word fitting, caption dwell time, and the exact point of audio/video changes. Review with sound and without sound where comprehension matters. Design preflight inspects static geometry, not all animated positions.

The schema can store longer timelines, but cloud motion export is limited to 60 seconds. Split into shorter deliverables only within the agreed scope. MP4 requires an available encoder; WebM is another output choice. Cloud recording mixes imported audio/video while the browser fallback is silent. Verify the actual exported duration, dimensions, playback, and audible tracks. Static PNG/SVG frames and successful queued provider jobs do not establish completed video delivery.
