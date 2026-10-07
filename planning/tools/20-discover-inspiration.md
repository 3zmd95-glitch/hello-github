# Discover: inspiration that leads to practice — 7 October 2026

## Purpose

The owner asked for a substantive rework so Discover helps them get inspired and learn. They authorized reviewing their Instagram and TikTok. Both public profiles identify `3z.prod` as an iPhone filmmaker/editor interested in color, creative cuts, city films and product work. This informs starter topics and achievable practice suggestions; private saved collections, credentials and account statistics are not imported into the app.

## Observed baseline

On localhost:3000, Food's “Timelapse Kitchen Prep” lesson recommended food processors and stainless-steel prep tables. Generic food/trial-reel posts appeared beside actual restaurant filmmaking. The implementation also allowed unrelated trending hashtags to fill TikTok to 50; a test explicitly required that behavior. Generated lesson settings were not supported by video analysis.

## Decisions

- A category recommendation needs subject evidence and creative/filmmaking evidence from its title, caption or description. Repeated retrieval and popularity cannot substitute for relevance. Show fewer useful candidates instead of filling a quota.
- Deduplicate canonical links and diversify known creators. Preserve snippets and show metadata evidence honestly; this is not a claim that the app watched or judged the visuals.
- Keep the six-query scan budget: four focused Instagram and two focused TikTok queries. Supplement TikTok Discovery with bounded, cached official public oEmbed caption lookups. Never send Business access tokens to oEmbed. Connected-but-no-matching-results must differ from a missing connection.
- A lesson needs a real category/technique example. Whole-phrase technique matching replaces loose half-word overlap. Curated “watch for / try it” suggestions replace AI-generated exact settings. Existing search, API connections and players remain useful foundations.
- Add **My practice**: save a reference without choosing a skill, write one thing to try, and move it through To try / Practising / Tried it. Keep existing skill attachments. Store the library in the existing validated/persisted dashboard state, including export/import, with canonical URL deduplication and old-backup compatibility.
- Keep the user's app on localhost:3000. Automated browser tests use an isolated port and synthetic providers, never paid live searches or personal account modifications.

## Existing projects and source research

- [Karakeep](https://github.com/karakeep-app/karakeep) and its [tags workflow](https://docs.karakeep.app/using-karakeep/tags/): useful save/organize/revisit interaction, but adopting its full server stack would duplicate the existing static app's player, state and references.
- [Linkwarden](https://github.com/linkwarden/linkwarden) and [usage overview](https://docs.linkwarden.app/usage/overview): collections and saved references informed the library. No new bookmarking backend/dependency is needed for this scope.
- [Tavily query guidance](https://help.tavily.com/articles/7879881576-optimizing-your-query-parameters): use focused queries and domains; a larger result limit alone is not a quality measure.
- [TikTok Business official SDK](https://github.com/tiktok/tiktok-business-api-sdk/blob/main/python_sdk/docs/CreativeManagementApi.md): Discovery endpoints provide trend candidates; this is not evidence of a general-purpose video keyword-search API. Existing authorized providers remain the retrieval layer.
- [Apple Camera modes](https://support.apple.com/en-gb/guide/iphone/iph61f49e4bb/26/ios/26), [DaVinci editing](https://www.blackmagicdesign.com/ae/products/davinciresolve/edit/) and [training](https://www.blackmagicdesign.com/au/products/davinciresolve/training): support the available practice tools. Exercises are original suggestions, not copied course instructions or analyses of linked videos.

## Validation

- `pnpm lint`, `pnpm typecheck`, and `pnpm build` passed.
- App tests: **2,443 passed**, 124 files.
- Worker tests: **1,044 passed**, 39 files (`--maxWorkers=2`; an initial unconstrained run hit an existing 5-second performance-test timeout under concurrent browser/build load; no test timeout or assertion was weakened).
- Full browser suite on port 3100: **380 passed**, eight existing viewport-specific skips, zero failures. New cases cover category save, Saved only inclusion, notes/status across reload, English/Arabic layouts, and legacy lesson suppression. Existing offline coverage also passed.
- Root visually reviewed desktop and phone screenshots of the new lesson and practice screens. These screenshots use synthetic fixtures and unavailable preview images; they establish layout, not live provider quality.
- The compiled build was copied to the existing port-3000 server's `out/` and its new Discover header/navigation/starter topics were verified in the user's Chrome. The primary tracked source stays unchanged until the branch is integrated.
- Live provider filtering, refreshed category lessons and external source coverage still require Worker rollout. Mocked tests do not establish visual quality; no claim that every recommended video has been watched.
