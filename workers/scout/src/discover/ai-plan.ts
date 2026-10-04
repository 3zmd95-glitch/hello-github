import { PLATFORMS } from "../normalize";
import { planSearch, withoutPrograms } from "./plan";
import { normalizeTerm } from "./terms";
import { categoryHint, genreWords, isCategoryOnly, mentions, selectedGenre } from "./relevance";
import type { DiscoverRequest, SearchPlan } from "./types";
import { AiPlanSchema, type AiPlanMetadata } from "./ai-schema";
export {
  AI_SYSTEM,
  AiPlanSchema,
  ExternalAiPlanSchema,
  type AiPlan,
  type AiPlanMetadata,
  type ExternalAiPlan,
} from "./ai-schema";

/** Apply exactly the same relevance rules and owner-selected constraints to every AI provider. */
export function searchPlanFromAi(
  req: DiscoverRequest,
  rawPlan: unknown,
  metadata?: AiPlanMetadata,
): SearchPlan {
  const data = AiPlanSchema.parse(rawPlan);
  const platforms = req.platforms ?? PLATFORMS.filter((p) => data.platforms.includes(p));
  const baseline = planSearch(req);
  const category = selectedGenre(req);
  const typedCategory = selectedGenre({ q: req.q });
  const categorySubjects = genreWords(req);
  // A curated retry must not erase constraints from a detailed, free-form brief.
  const categoryRetry = !!category && (isCategoryOnly(req) || !!baseline.termId);
  return {
    ...baseline,
    topicKey: normalizeTerm(data.summary.en),
    understood: { label: data.summary, exact: false, ai: true, ...metadata },
    alternatives: [],
    topicWords: [],
    needsEditingWord: false,
    requiredGroups: [
      ...data.concepts.map((g) => [...new Set(g.map(normalizeTerm).filter(Boolean))]),
      ...(baseline.topicWords.length &&
      (baseline.termId || (typedCategory && category && typedCategory.id !== category.id))
        ? [baseline.topicWords]
        : []),
      ...(baseline.requiredGroups ?? []),
    ],
    timeRange: req.timeRange ?? (data.timeRange === "any" ? undefined : data.timeRange),
    ytLength: req.ytLength ?? (data.ytLength === "any" ? undefined : data.ytLength),
    queries: platforms.flatMap((platform) => {
      const primary = data.queries.map((q, i) => {
        // The model can miss a filter: preserve owner-selected constraints independently.
        const program = q.intent === "tutorials" ? req.program : undefined;
        const words = program ? withoutPrograms(q.q) : q.q;
        const genreHint = categoryHint(req, q.lang);
        const hasCategory = category
          ? categorySubjects.some((word) => mentions(normalizeTerm(words), word))
          : !!genreHint && mentions(normalizeTerm(words), normalizeTerm(genreHint));
        const prefix = [genreHint && !hasCategory ? genreHint : undefined, program]
          .filter(Boolean)
          .join(" ");
        const text = (prefix ? `${prefix} ${words}` : words).slice(0, 200);
        return { ...q, q: text, platform, id: `${platform}-${q.intent}-${q.lang}-${i}` };
      });
      const asked = new Set(primary.map((q) => normalizeTerm(q.q)));
      return primary.map((q) => {
        const fallback =
          categoryRetry && platform !== "yt"
            ? baseline.queries.find(
                (candidate) =>
                  candidate.platform === platform &&
                  candidate.intent === q.intent &&
                  candidate.lang === q.lang,
              )
            : undefined;
        const retryQ = [fallback?.q, fallback?.retryQ].find(
          (candidate) => candidate && !asked.has(normalizeTerm(candidate)),
        );
        if (retryQ) asked.add(normalizeTerm(retryQ));
        return {
          ...q,
          ...(retryQ ? { retryQ } : {}),
        };
      });
    }),
  };
}
