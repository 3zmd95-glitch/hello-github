# Select one native reference for visual review

The Food native sample retained three posts but only one qualified from captions. A restaurant offer can accompany a carefully edited film; conversely, a proposed camera treatment does not prove the uploaded footage. The existing sampled-frame reviewer is the appropriate next source of evidence, with its full-video/audio limitations intact.

The previous category button selected its own batch from all stored candidates. Even after importing a specific native result, the owner could not direct the assessment toward it or guarantee a single model call. This made bounded quality evaluation and usage control unnecessarily difficult.

## Decision

Reuse the existing source, eligibility, frame sampling, cache, persistence and cancellation pipeline. Add a native select inside the existing collapsed visual panel: either the existing small batch, or one named eligible Instagram post. A selected post is the entire cohort; source failure, an existing assessment or lost eligibility never substitutes another post. An unavailable selection disables the button until the owner chooses again. Opening the panel, changing selection and importing links do not start inference.

The existing batch still allows at most two model calls. Explicit single-post review allows at most one. The optional after-lookup batch remains separate. Stored applicable assessments are reused rather than rechecked automatically.

Searched existing implementations before building: [Radix Select](https://www.radix-ui.com/primitives/docs/components/select) provides a maintained accessible alternative. Rejected adding a dependency because this is a simple single selection and the app already uses native labelled selects, including model and category controls. Read the installed Next.js client-boundary guide; use the existing client component and hook.

## Verification

Hook tests verify exact target selection, a maximum of one request, source-failure behavior, rejected/unknown targets and assessment reuse. The existing phone/desktop Coffee browser flow now chooses two posts independently, proves the selected URL is requested, and confirms the completed selection cannot silently start a new batch. Anime retains coverage of the original bounded batch. Full code gates and actual Chrome results are recorded below after execution.

All code gates passed: lint, app/Worker types, **3,725 unit tests across182files**, fresh production build, and **428 browser passes /8intentional skips /0failures**. Logs: Temp `discover-selected-gates.log`, `discover-selected-browser.log`. The isolated3101 test server was stopped after completion. The managed export was copied to the existing localhost3000 server; matching discover/index.html hashes verified the copy. No server restart or Worker deployment.

Actual Chrome: chose only astro_fries/DdO2KGQNDKX and GPT-6-Astra at its displayed highest supported effort, `max`. One attempt saved one assessment on October11 at17:22:09 Riyadh. The completed selection became disabled rather than widening to a batch. Sampled frames supported Food, uploader-added display typography at13.9/16.7seconds, and concrete composition/shot-variety observations. The record explicitly leaves motion, audio and authorship unverified.

Food Instagram Inspiration **1→2** (combined9→10), Popular **0→1**. The September13 source post has approximately6.6K source-checked likes; those separate age/engagement gates support Popular. This is one recently popular reference, not evidence of effect/audio adoption across creators. Reload retained the same17:22:09 assessment and Popular card; Saved remains3. No paid searches. Proof: Temp `discover-selected-food-2026-10-11.png`. The sparse-caption burger post and wider genre/platform supply remain unresolved; no other model checks were initiated.
