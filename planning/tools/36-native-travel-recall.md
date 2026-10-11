# Native Travel recall benchmark — October 11, 2026

## Measured result

Actual Chrome native TikTok search for `travel cinematic` exposed strong mainstream references. Three observed links were added through the existing explicit localhost:3000 review, with Travel selected and no Saved/preference changes. Source checks completed with no remaining links. Travel Inspiration stayed **8 = 8 YouTube + 0 TikTok + 0 Instagram**; TikTok Explore stayed three older existing posts. The three new references did not appear. This was neutral candidate intake, not improved retrieval or current-trend coverage.

| Native post | Public source observation | Current classifier |
| --- | --- | --- |
| [Alvaro, New York](https://www.tiktok.com/@alvarovaliente_/video/7672800453221944589) | Available; 584,100 likes / 2.4M views; August 11, 2026. Caption describes showing the city through the creator's camera, inspired by Spider-Man. | Creative true; category false; project false; no exclusions. |
| [Lewis, flight](https://www.tiktok.com/@lewisonfilm/video/7490121492424903958) | Available; 15,900 likes / 164,300 views; April 6, 2025. “Made a little something during my flight.” followed by filmmaking/cinematography tags. | Creative true; category false; project false; no exclusions. |
| [Alessandro, Nice](https://www.tiktok.com/@alessvisuals/video/7677300576404770069) | Available; 27,600 likes / 131,800 views; August 23, 2026. “Cinematic frames from Nice” with France/colorgrading/DaVinci Resolve tags. | Creative true; category false; project false; no exclusions. |

These exact public-source reads were already cached from the app checks. The diagnostic called the existing local source reader and actual `applyTikTokEvidence`, `categoryCreativeEvidence`, and `discoverEvidence`; no simulated metrics or browser credentials were used. Each result has `source-caption`, `strong-engagement`, `old-post`, and `outside-category`. Availability and source metrics are **not** the failure here.

The native New York page independently displayed 584.1K likes, August 11 and a 30-second video. One sampled playback frame showed a composed waterfront sunset silhouette; the search poster showed a city train shot. This is limited visual inspection of one reference, not complete audiovisual verification of all three.

## Root cause and next implementation

`workers/scout/src/discover/category-profiles.ts` defines Travel using only travel/destination/vacation/tourism and their Arabic equivalents. `categoryCreativeEvidence` requires one of those literals. Native captions often name a location, trip activity or filming context instead. A source read therefore does not repair this semantic false negative. More acquisition requests and city-by-city keyword patches will not solve the general all-category recall problem.

Next material change should provide a bounded, source-caption-grounded semantic assessment using the existing connected model path. Reuse exact source binding/versioning from `lib/discoverVisual.ts` and existing provider adapters; keep this text-only decision separate from footage inspection. A category judgment must cite source text, use the selected category's definition, retain uncertainty and stale-source protections, and never manufacture techniques, counts or dates. Independent engagement, exclusions, recency and teaching gates still apply. Named locations alone must not admit news, shopping offers, flight simulators or an adjective such as “nice”; filming context must establish a creative project separately.

Do not hardcode these three posts, treat the import's chosen category as proof, change their old dates, mark them currently trending, or infer preference votes. Start with a small explicit batch and measure these real caption failures plus cross-category negatives. No new model call or paid query was made in this benchmark. The subsequent optional source-caption implementation and its separate verification are documented in tools/37; the observations above describe the pre-change baseline.

The Search native-acquisition wiring in tools/35 is a separate access improvement. It must not be reported as solving this measured recall failure.
