# Visible craft and attribution — October 11, 2026

## Measured problem

The explicit Travel frame check attempted three already-imported Instagram posts. Two returned eight sampled frames and concrete live-action cinematography observations; Elliott's media was unavailable. The two valid assessments were excluded solely because neither caption claimed filming authorship. This is a relevance defect: a reference can demonstrate visible craft without proving who filmed it.

| Post | Observed source | Sampled evidence | Authorship |
| --- | --- | --- | --- |
| `DeMmkqLSBcp`, tashidelekp | About 175K native likes; shortcode date October 7; `#soulsearching #travel` | Eight samples across 14.67 seconds; two distinct landscape composition observations citing frames 0, 4, 5 and 6 | Unattributed |
| `DUz12gUD8bu`, ferry.kch | About 33.6K native likes; February 2026 | Eight samples across 18.16 seconds; composition, directional lighting and shot variety | Unattributed |
| `DNypS7j2NkJ`, elliottsauvage | About 95.7K likes; August 25, 2025 | `source_frames_source_unavailable`; zero inference for this attempt | No new visual claim |

Exactly two live GPT-6.1-Sol / medium visual calls were made in one bounded UI action. Three later `allowModel:false` reads made zero model calls; the two successful results were cached. Receipt: system Temp `discover-travel-visual-2026-10-11.json`, excluding account IDs. No paid searches or further inference are required for the policy correction.

## Decision and reuse

Separate visual craft from attribution in the existing shared predicate. Require schema-valid, category-supported live-action evidence, at least two distinct observation descriptions, at least one composition/lighting/staging observation, and at least two distinct cited frame hashes. Empty, repeated, single-observation and shot-variety-only scenery do not suffice. Caption quotations remain exact-source validated; attribution status is preserved and displayed independently.

Source/media binding, freshness, source engagement, film/TV/animation/gameplay exclusions and Popular/Learn requirements remain in force. Existing assessment meanings and prompt are unchanged, so no rubric bump or re-assessment is appropriate. EN/AR status text now describes visible filming choices separately from attribution. Neither a caption claim nor sampled pixels independently verify authorship, complete motion, transitions or audio.

Search before building: considered [TransNet V2](https://github.com/soCzech/TransNetV2/), an existing shot-boundary detection model. Shot detection could support future motion analysis, but it does not resolve this attribution gate. Reuse the current typed frame evidence and provenance; add no dependency or additional model for this correction.

## Verification scope

Focused core tests cover all four attribution states, invalid quotations/citations, uncertain category, other footage, insufficient evidence, low source engagement and old-post Popular rejection. Component coverage checks both languages, separate source claims and insufficient samples. The existing phone/desktop Coffee browser cases now use a sparse hashtag-only caption with unattributed but concrete visual craft; they verify admission, persistence and no additional requests while Learn/Popular stay empty.

Full gates passed: lint, app/Worker types, **3,675 tests / 181 files**, fresh production build and **426 browser cases / eight intentional skips / zero failures**. Logs: system Temp `discover-visual-policy-{lint,types,unit,browser}.log`. Both phone and desktop exercised sparse-caption Coffee recovery and persistence without additional requests.

The tested export was copied to primary `out/`; localhost:3000 still runs on PID 37380. Actual Chrome reload retained the original 15:40:41 sampled-frame assessment and recovered Travel Instagram Inspiration **1 → 3** (combined Travel **9 → 11**). The latest source read shows tashidelekp at **175.9K likes**, October 7. Only that recent post appears in Instagram Popular (**0 → 1**); the February and 2025 posts remain excluded. Instagram Learn stays **0**, Saved stays **3**. The evidence panel explicitly supports visible filming choices while saying the source does not identify who filmed the post. No additional inference was triggered for this verification. Proof: system Temp `discover-travel-visual-policy-2026-10-11.png`; Chrome remains on the three Instagram Inspiration posts.

No Worker code or server change is required. Fresh supply across all category/platform pairs and multi-post effect/audio momentum remain unfinished; this bounded recovery is not proof of native-equivalent recommendations.

The actual model observations include a few clipped sentences and stray trailing characters near their length limit. Preserve the recorded evidence, do not silently rewrite its meaning, and treat presentation/structured-output quality as a separate follow-up if it recurs.
