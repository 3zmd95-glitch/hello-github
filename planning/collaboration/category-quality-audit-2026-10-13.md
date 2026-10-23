# Discover category quality audit — 13 October 2026

Verdict: all twelve categories provide combined Instagram, TikTok and YouTube cards,
but the user's goal of consistently relevant, current, mainstream editing inspiration
is **not yet verified or met by this sample**. Two Popular implementation defects were
repaired and tested during this audit. Native search inclusion alone does not establish
editing quality or a current trend.

## Scope and real Chrome evidence

Codex inspected the first 24 native-order cards in each category at localhost:3000 in
Chrome: 288 card observations, not 288 watched videos. Captions, available dates,
thumbnails and displayed source engagement were inspected. The Coffee music mismatch
was additionally opened on YouTube and visually confirmed. Some categories reuse native
results cached earlier; the UI exposes those timestamps. This is an audit of the actual
user-facing feed, not a claim that all native searches were freshly fetched today.

Each row below contains all three platforms. Dates within 30 days are measured against
that row's observation time. Missing dates are unknown, not evidence that a post is old.
These are diagnostic sample sizes, never limits on platform supply or new UI counters.

| Category | Cards sampled | Known dates | Published within 30 days |
| --- | ---: | ---: | ---: |
| Anime | 24 | 16 | 7 |
| Camping & desert | 24 | 10 | 1 |
| Cars | 24 | 23 | 3 |
| Coffee | 24 | 16 | 0 |
| Fashion | 24 | 18 | 4 |
| Food & restaurants | 24 | 22 | 0 |
| Football | 24 | 24 | 2 |
| Gaming | 24 | 24 | 0 |
| Gym | 24 | 24 | 0 |
| Perfume | 24 | 24 | 2 |
| Travel | 24 | 24 | 0 |
| Weddings | 24 | 24 | 1 |

Only 20 of the 249 dated observations are within 30 days. Older references may be useful
for learning; these samples do not support describing the default feed as current trends.
The native view currently disclaims that inclusion proves a trend, which is appropriate.

Concrete findings:

- Coffee includes [Black Coffee Edit • Isambulo](https://www.youtube.com/watch?v=atXZi2Jkrxk).
  The actual YouTube page identifies an unreleased song; playback shows a music-festival
  performance. It is a subject collision with the musician, not coffee cinematography.
- Perfume includes decant inventory advertising and fragrance recommendations. Other
  cards do show relevant craft, such as Blender fluid simulation/lighting. Captions alone
  cannot establish that every included product video features a worthwhile edit.
- Camping includes survival/lifehack titles with no demonstrated editing technique and
  a travel/LUT promotion. These are relevance concerns from metadata, not claims that
  those videos were watched and proved unedited.
- Strong engagement is often attached to older posts: the first Anime Instagram card is
  dated November 2021, and one early Cars TikTok is dated January 2023.
- The native category path uses one broad first query per category (e.g. `coffee edit`,
  `camping edit`, `perfume edit`) across platforms. Existing more specific alternatives
  are not used by that selection. This makes the Coffee collision readily reproducible.
- Popular uses recent publication, direct source evidence, engagement floors and text
  craft signals. It does not measure repeated adoption of an effect/audio or growth
  velocity. A passing post is a recent popular example, not a verified emerging trend.
- Native order has automatic continuation. Popular currently requires Load more; it
  still does not provide the user's desired continuous scrolling in every view.

The initial Food capture was interrupted by the auditor switching categories before
YouTube finished. It is not evidence of a provider defect. One deliberate retry completed
all three platforms; the table uses that completed retry.

## F6 repair and validation

1. Popular previously requested source details only for already-qualified Popular cards.
   Unchecked Instagram/TikTok candidates could not qualify, producing a circular empty
   result. Source checks now use a finite native-order candidate page before ranking.
   Load more advances candidates even when none currently qualify.
2. Popular used the component's mount time to judge fresh source observations. After five
   minutes, newly read details could be rejected as future-dated. Ranking now uses current
   time when recomputed instead of the frozen mount-time clock.

Five regressions reproduced RED before repair. The final 62 focused Vitest checks pass
(20 real component/hook integration with mocked network, 16 component, 26 legacy hook).
Targeted lint, typecheck and formatting pass. Root reviewed the final delta and ran the
final production build successfully. Existing F5 continuation tests were not rerun or
misrepresented as new evidence.

Real Chrome on the rebuilt app, with no mocked platform responses:

- Entered Anime Popular while candidate details were unchecked. The checking status was
  visible, and two recent qualifying TikToks appeared when details completed.
- Source completions started after 315 seconds on the page, directly exercising the
  former five-minute clock failure. Initial trace: 18 source completions, all HTTP200.
- Clicking Load more checked the next finite page. Four qualifying TikToks appeared;
  trace grew to 34 completions, all HTTP200. HTTP200 proves transport success, not that
  every optional source field is present. No automatic offscreen crawling was introduced.
- Final cards show October 1, 3, 7 and 12, with 4M, 2M, 1.4M and 52.7K displayed views.
  These satisfy the current ranker; this audit does not certify their artistic quality.
- Saved (3) remained intact. No new result totals appeared. Temporary resource observers
  were disconnected and deleted. Developer CDP invoked actual DOM control handlers when
  higher-level browser controls timed out; no fixture responses or fabricated state used.

Only CategoryDiscovery.tsx and CategoryDiscovery.sources.test.tsx changed for F6.
Source/export SHA256 rechecked after live validation:

```text
c44e8589947b6ebe3fd9dcdd837f9c1aeb883f5e2630cb2edb91bfff5c046ad7  components/research/CategoryDiscovery.tsx
64dac36f812bc7a3d67e212d20f554dde903c66506159f616c06158ecf26de1f  components/research/CategoryDiscovery.sources.test.tsx
3d986e1986ca30e964e88d8b5870e0b94ab6e7e38d67b099c008125edaac4deb  out/discover/index.html
```

Managed localhost:3000 serves the rebuilt out/. No paid usage, new helper permissions,
commit, push, merge or deployment occurred. Earlier uncommitted work remains preserved.

## Next bounded repair

Improve native query specificity for Coffee, Camping & desert and Perfume using the
existing category definitions and this evidence. Preserve native ordering and breadth;
do not solve relevance by blanket engagement filtering or by removing useful learning
references. Avoid expanding providers, permissions or paid services. One implementation
writer, focused query regression checks, freeze exact hashes and return for Codex's own
Chrome verification. Popular automatic continuation and genuine effect/audio trend
detection remain separate open tasks; do not claim them complete from this query repair.

## Evidence files

All under C:/Users/AORUS/AppData/Local/Temp/:

- discover-category-quality-audit.json — timestamped native/Popular card captures; Anime
  final native entry has 48 cards, of which only the first 24 are used in this table.
- discover-popular-repair-live.json — bounded source-completion trace before/after more.
- discover-popular-repair-verified.png — final real Chrome Popular view, Saved (3).
- discover-coffee-mismatch.png — actual music performance reached from Coffee.

Do not rerun this complete audit unchanged. Verify new query output against the named
counterexamples and clearly separate code tests, metadata inspection and watched clips.
