# Popularity-aware retrieval and native Cars evaluation — October 11, 2026

## Evidence and decision

The real Camping monthly relevance refresh returned 20 new candidates but zero qualified Inspiration/Popular (tools/43). Existing ranking cannot recover useful videos that never enter the retrieved page. The official YouTube adapter did not specify ordering and therefore used relevance.

Reuse research: [official YouTube search.list documentation](https://developers.google.com/youtube/v3/docs/search/list) and [official search implementation examples](https://developers.google.com/youtube/v3/guides/implementation/search) support viewCount ordering together with a publication-date window. The documentation cautions that non-relevance sorting plus dates can return an incomplete set. Use this as a bounded candidate-supply change, never proof of quality or comprehensive coverage. Existing fetcher suffices; no SDK, dependency, new credentials, model inference or paid search provider.

Only the unified category refresh opts into `ytOrder: viewCount`. Its monthly query, result limit, query count, daily allowance and local category/creative/recency filters remain unchanged. Detailed searches, learning and old refill keep their current defaults. Client and Worker caches preserve existing relevance keys exactly and isolate popularity-ordered responses. Worker validation permits only relevance/viewCount. No automatic follow-up searches.

## Native Instagram sample

Observed three native Car edit search results in Chrome and passed the public links through the existing app import review, selecting Cars. This pass used the same import format/review screen as the installed helper, not a new capture/installation test. No preference votes or Saved changes.

- gamilego / Dd9Ua2pRrsH: October1, native27.2K likes; public reader27,257. Caption identifies Mercedes c280 with filmmaker/edit/caredit/colorgrading. One inspected frame shows a low-angle moving Mercedes shot; this is not a whole-video edit assessment.
- jasonp.media + g82rey / DdltV3FsZsw: September22, native422K; public reader422,784, author g82rey, caption credits jasonp.media. Caption alone does not establish its edit techniques.
- quentin._fx / Dbd5ji4uO9z: July31, native731K versus public reader642,054. Record the discrepancy rather than harmonize the counts. Both exceed the minimum, but the old post must not count as currently popular.

The app receipt confirms three retained links. Initial source checks returned available captions/counts, yet all three were absent even from Cars Explore. A pure reproduction confirms category matches and adequate engagement, but all three lacked recognized creative evidence. This is not retention loss. Gamilego explicitly tags #colorgrading: the existing spaced/colorgrade aliases missed this joined spelling. Added only colorgrading/colourgrading to that existing technique. Quentins generic smooth-edit tag and g82reys camera credit remain insufficient without visual evidence; no generic craft, project, engagement, source or recency gate was relaxed. Focused quality336/ranking61 tests verify the real caption plus low-like/indexed-only/old-date and future/negative/resource contrasts. No live AI or paid web search used.

## Verification

Final local gates passed: lint, app/Worker types, **3,722 unit tests /182 files**, fresh production build and **428 browser cases /eight intentional skips /zero failures**. Three semantic tests had assumed joined grading hashtags were unrecognized; the real captions now expect source-backed grading, while a separate synthetic model-only caption preserves uncertainty/mismatch/project-negative rejection. The subsequent full unit rerun is green. Logs: system Temp discover-order-{lint,types,unit,browser}.log. Deployment and live comparison follow this source commit; do not treat simulated results as live supply improvement. Earlier baseline14334e5 CI38142564643 completed successfully.
