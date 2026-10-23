# Finish checking imported links

## Observed gap

Native import accepts 24 links. `useFeedSources` checks at most 18 per platform with two concurrent public reads. After that batch settles, unchanged membership never advances the queue. Existing tests showed 22 candidates stopping at 18 even after persisted rerenders. Changing feed mode or feedback does not change membership, so useful unchecked links can remain absent without an explanation. This limitation is separate from the previously measured caption-poor TikTok batch, whose reads did not demonstrate editing relevance.

## Reuse decision

Reviewed [p-queue](https://github.com/sindresorhus/p-queue), which provides promise concurrency and cancellation. Keep the existing two-reader hook: the defect is missing user-controlled continuation, not missing queue machinery. Adding a general queue dependency would not determine which retained posts have already been attempted or preserve React membership/cancellation behavior. No new dependency, provider or model.

## Behavior

- Browse and the category view within Search expose the count of still-unattempted Instagram/TikTok links, plus an explicit **Check remaining links** action in English and Arabic.
- One action schedules at most 18 additional URLs per platform, with two public reads at a time. It never drains the whole library automatically, performs paid search or starts AI review.
- Stable membership retains earlier results and does not repeat attempted URLs. Failed/null reads count as attempted; retrying failed sources is a separate concern. The button does not imply that the previous batch was successfully verified.
- Changing modes, feedback, or updated source evidence does not continue the queue. Duplicate clicks while checking, inactive/cancelled work and a zero remainder do not start a batch.
- Existing date, engagement, relevance and creative-evidence rules decide whether newly checked links qualify. A completed read or an imported link is not proof of a good edit or a current trend.

## Verification

Hook regression: 24 Instagram links stop at 18, show six remaining, then explicitly finish exactly six distinct additional reads while preserving the first batch and the two-read concurrency limit. Additional guards cover membership changes, cancellation and both platforms.

Browser regression on phone/desktop imports 24 neutral links, lets the first 18 low-engagement source responses settle, and verifies no new reads on a feed-mode switch. The remaining action works in Arabic and English, is disabled while checking, and admits six later qualifying responses to Popular. Saved remains zero and no search/model endpoint is used. These are controlled regressions, not claims about 24 real native posts or the helper's installation.

Final gate counts and actual Chrome observations are recorded in `planning/handovers/discover-resume-2026-10-11.md` after validation.
