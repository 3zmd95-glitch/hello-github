import { PLATFORMS } from "../normalize";
import { planSearch, withoutPrograms } from "./plan";
import { normalizeTerm } from "./terms";
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
  return {
    ...baseline,
    topicKey: normalizeTerm(data.summary.en),
    understood: { label: data.summary, exact: false, ai: true, ...metadata },
    alternatives: [],
    topicWords: [],
    needsEditingWord: false,
    requiredGroups: [
      ...data.concepts.map((g) => [...new Set(g.map(normalizeTerm).filter(Boolean))]),
      ...(baseline.requiredGroups ?? []),
    ],
    timeRange: req.timeRange ?? (data.timeRange === "any" ? undefined : data.timeRange),
    ytLength: req.ytLength ?? (data.ytLength === "any" ? undefined : data.ytLength),
    queries: platforms.flatMap((platform) =>
      data.queries.map((q, i) => {
        // The model can miss a filter: preserve owner-selected constraints independently.
        const program = q.intent === "tutorials" ? req.program : undefined;
        const words = program ? withoutPrograms(q.q) : q.q;
        const genreHint = req.genreQuery?.[q.lang];
        const prefix = [
          genreHint && !words.toLowerCase().includes(genreHint.toLowerCase())
            ? genreHint
            : undefined,
          program,
        ]
          .filter(Boolean)
          .join(" ");
        return {
          ...q,
          q: (prefix ? `${prefix} ${words}` : words).slice(0, 200),
          platform,
          id: `${platform}-${q.intent}-${q.lang}-${i}`,
        };
      }),
    ),
  };
}
