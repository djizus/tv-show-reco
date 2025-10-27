import { randomUUID } from "crypto";
import { z } from "zod";
import {
  AgentKitConfig,
  createAgentApp,
  createAxLLMClient,
} from "@lucid-dreams/agent-kit";
import { flow } from "@ax-llm/ax";

type Recommendation = {
  title: string;
  synopsis: string;
  whereToWatch: string[];
  whyItMadeTheList: string;
  metadata: {
    year: number;
    genres: string[];
    moods: string[];
    rating: number;
    tone: string;
  };
};

type NormalisedFilters = {
  genre: string | null;
  mood: string | null;
  platform: string | null;
  includeClassics: boolean;
};

const DEFAULT_RECOMMENDATION_COUNT = safeParseInt(
  process.env.DEFAULT_RECOMMENDATION_COUNT, 5
);
const AGENT_NAMESPACE = "tv-show-recommender";
const AGENT_DISPLAY_NAME = "TV Show Recommender";

const axClient = createAxLLMClient({
  model: process.env.AX_MODEL?.trim() || "gpt-5-mini",
  logger: {
    warn(message, error) {
      if (error) {
        console.warn(`[${AGENT_NAMESPACE}] ${message}`, error);
      } else {
        console.warn(`[${AGENT_NAMESPACE}] ${message}`);
      }
    },
  },
});

if (!axClient.isConfigured()) {
  console.warn(
    `[${AGENT_NAMESPACE}] Ax LLM provider not configured — requests will fail until an LLM key is provided.`
  );
} else {
  console.log(`[${AGENT_NAMESPACE}] Ax LLM provider ready for requests.`);
}

const configOverrides: AgentKitConfig = {
  payments: {
    facilitatorUrl:
      (process.env.FACILITATOR_URL as any) ??
      "https://facilitator.daydreams.systems",
    payTo:
      (process.env.PAY_TO as `0x${string}`) ??
      "0xCD6E8687bd920463cc9E4a28f1998F0B040ab1DC",
    network: (process.env.NETWORK as any) ?? "base",
    defaultPrice: process.env.DEFAULT_PRICE ?? "0.03",
  },
};

const recommendationFlow = flow<{ prompt: string }>()
  .node(
    "recommender",
    'prompt:string -> structuredJson:string "Return only the JSON payload requested in the prompt."'
  )
  .execute("recommender", (state) => ({
    prompt: state.prompt,
  }))
  .returns((state) => ({
    structuredJson:
      typeof state.recommenderResult.structuredJson === "string"
        ? (state.recommenderResult.structuredJson as string)
        : "",
  }));


const inputSchema = z
  .object({
    genre: z
      .string()
      .trim()
      .min(1, "Genre cannot be empty")
      .max(32, "Genre is too long")
      .optional(),
    mood: z
      .string()
      .trim()
      .min(1, "Mood cannot be empty")
      .max(32)
      .optional(),
    platform: z
      .string()
      .trim()
      .min(1, "Platform cannot be empty")
      .max(32)
      .optional(),
    includeClassics: z.boolean().default(true).optional(),
    numberOfRecommendations: z
      .number()
      .int()
      .min(1)
      .max(10)
      .default(DEFAULT_RECOMMENDATION_COUNT)
      .optional(),
  })
  .refine(
    (value) => Boolean(value.genre || value.mood || value.platform),
    {
      message: "Provide at least one of genre, mood, or platform",
      path: ["genre"],
    }
  );

const { app, addEntrypoint } = createAgentApp(
  {
    name: AGENT_DISPLAY_NAME,
    version: "0.0.2",
    description:
      "Curates binge-worthy TV shows that tailors picks to the viewer's vibe.",
  },
  {
    config: configOverrides,
  }
);

addEntrypoint({
  key: "recommend",
  description:
    "Return curated TV show recommendations based on the viewer's vibe.",
  input: inputSchema,
  output: z.object({
    recommendations: z
      .array(
        z.object({
          title: z.string(),
          synopsis: z.string(),
          whereToWatch: z.array(z.string()),
          whyItMadeTheList: z.string(),
          metadata: z.object({
            year: z.number(),
            genres: z.array(z.string()),
            moods: z.array(z.string()),
            rating: z.number(),
            tone: z.string(),
          }),
        })
      )
      .min(1),
    totalMatches: z.number().int().nonnegative(),
    filtersApplied: z.object({
      genre: z.string().nullable(),
      mood: z.string().nullable(),
      platform: z.string().nullable(),
      includeClassics: z.boolean(),
    }),
    fallbackApplied: z.boolean(),
  }),
  async handler({ input }) {
    const requestId = createRequestId();
    try {
      const recommendationCount = clamp(
        input?.numberOfRecommendations ?? DEFAULT_RECOMMENDATION_COUNT,
        1,
        10
      );
      const filters: NormalisedFilters = {
        genre: normalize(input?.genre),
        mood: normalize(input?.mood),
        platform: normalize(input?.platform),
        includeClassics: input?.includeClassics ?? true,
      };

      console.log(
        `[${AGENT_NAMESPACE}] [${requestId}] Incoming recommendation request (filters=${JSON.stringify(
          filters
        )}, numberOfRecommendations=${recommendationCount})`
      );

      const llm = axClient.ax;
      if (!llm) {
        throw new Error(
          "Ax LLM provider not configured. Set OPENAI_API_KEY or provide a custom client."
        );
      }

      const prompt = buildRecommendationPrompt({
        filters,
        recommendationCount,
      });

      console.log(
        `[${AGENT_NAMESPACE}] [${requestId}] Built LLM prompt (length=${prompt.length})`
      );
      console.log(
        `[${AGENT_NAMESPACE}] [${requestId}] Prompt preview: ${summarisePrompt(
          prompt
        )}`
      );

      const { structuredJson } = await recommendationFlow.forward(llm, {
        prompt,
      });

      const usageEntry = recommendationFlow.getUsage().at(-1);
      recommendationFlow.resetUsage();

      console.log(
        `[${AGENT_NAMESPACE}] [${requestId}] Received structured JSON response (length=${structuredJson.length})`
      );

      const recommendations = parseLlmRecommendations(
        structuredJson,
        recommendationCount
      );

      console.log(
        `[${AGENT_NAMESPACE}] [${requestId}] Parsed ${recommendations.length} recommendations from LLM response.`
      );

      if (usageEntry) {
        console.log(
          `[${AGENT_NAMESPACE}] [${requestId}] LLM usage metadata: ${JSON.stringify(
            usageEntry
          )}`
        );
      }

      if (recommendations.length === 0) {
        throw new Error(
          "Ax LLM returned no recommendations—try broadening the filters."
        );
      }

      return {
        output: {
          recommendations: recommendations.slice(0, recommendationCount),
          totalMatches: recommendations.length,
          filtersApplied: {
            genre: filters.genre,
            mood: filters.mood,
            platform: filters.platform,
            includeClassics: filters.includeClassics,
          },
          fallbackApplied: false,
        },
        ...(usageEntry?.model ? { model: usageEntry.model } : {}),
        usage: {
          total_tokens: recommendations.length,
        },
      };
    } catch (error) {
      console.error(
        `[${AGENT_NAMESPACE}] [${requestId}] Recommendation handler failed.`,
        error
      );
      throw error;
    }
  },
});

function buildRecommendationPrompt({
  filters,
  recommendationCount,
}: {
  filters: NormalisedFilters;
  recommendationCount: number;
}): string {
  const filterSummary = [
    `genre: ${filters.genre ?? "any"}`,
    `mood: ${filters.mood ?? "any"}`,
    `platform: ${filters.platform ?? "any"}`,
    `includeClassics: ${filters.includeClassics}`,
  ].join(", ");

  const schemaPreview = {
    recommendations: [
      {
        title: "Show Title",
        synopsis: "A short synopsis tailored to the viewer.",
        whereToWatch: ["Platform"],
        whyItMadeTheList: "One punchy sentence referencing the request.",
        metadata: {
          year: 2022,
          genres: ["Genre"],
          moods: ["Mood"],
          rating: 8.5,
          tone: "balanced",
        },
      },
    ],
  };

  return [
    "You are an expert TV curator helping a viewer.",
    `Filters to respect (normalised): ${filterSummary}.`,
    `Return exactly ${recommendationCount} compelling TV recommendations when possible (never exceed this number).`,
    "Recommendations must be current (no obvious errors) and feel hand-picked for the viewer.",
    "For each title include platforms, relevant genres/moods, and a short 'why it made the list' blurb.",
    "Keep explanations concise (<= 2 sentences) and connect them directly to the viewer's filters.",
    "Your reply MUST be JSON that matches this TypeScript shape exactly:",
    JSON.stringify(schemaPreview, null, 2),
    "If you truly cannot form any recommendation, respond with {\"recommendations\": []}.",
    "Return JSON only with no additional commentary.",
  ].join("\n\n");
}

function parseLlmRecommendations(
  raw: string,
  recommendationCount: number
): Recommendation[] {
  const schema = z.object({
    recommendations: z
      .array(
        z.object({
          title: z.string().min(1),
          synopsis: z.string().min(1),
          whereToWatch: z.array(z.string().min(1)).max(10),
          whyItMadeTheList: z.string().min(1).max(400),
          metadata: z.object({
            year: z
              .number()
              .int()
              .min(1950, { message: "Year must be 1950 or later." })
              .max(new Date().getFullYear() + 1),
            genres: z.array(z.string().min(1)).max(10),
            moods: z.array(z.string().min(1)).max(10),
            rating: z.number().min(0).max(10),
            tone: z.string().min(1).max(32),
          }),
        })
      )
      .min(1)
      .max(recommendationCount),
  });

  try {
    const json = JSON.parse(raw);
    const parsed = schema.parse(json);
    return parsed.recommendations.map((item) => ({
      title: item.title.trim(),
      synopsis: item.synopsis.trim(),
      whereToWatch: item.whereToWatch
        .map((entry) => entry.trim())
        .filter(Boolean),
      whyItMadeTheList: item.whyItMadeTheList.trim(),
      metadata: {
        year: item.metadata.year,
        genres: item.metadata.genres
          .map((entry) => entry.trim())
          .filter(Boolean),
        moods: item.metadata.moods
          .map((entry) => entry.trim())
          .filter(Boolean),
        rating: Number(item.metadata.rating.toFixed(1)),
        tone: item.metadata.tone.trim() || "balanced",
      },
    }));
  } catch (error) {
    throw new Error(
      `Failed to parse Ax LLM JSON response. Received: ${raw}`,
      { cause: error instanceof Error ? error : undefined }
    );
  }
}

function normalize(value?: string | null): string | null {
  if (!value) return null;
  const clean = value.trim().toLowerCase();
  if (!clean) return null;
  return clean;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function safeParseInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function summarisePrompt(prompt: string): string {
  const flattened = prompt.replace(/\s+/g, " ").trim();
  if (!flattened) {
    return "(empty prompt)";
  }
  return flattened.length > 160
    ? `${flattened.slice(0, 160)}…`
    : flattened;
}

function createRequestId(): string {
  try {
    return randomUUID();
  } catch {
    return Math.random().toString(36).slice(2, 10);
  }
}

export { app, AGENT_NAMESPACE };
