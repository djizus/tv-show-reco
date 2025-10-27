# TV Show Recommender

An Ax-powered refresh of the Lucid TV recommender. Instead of a local catalogue, the agent now leans entirely on the Ax LLM to pick and justify shows that fit the viewer's vibe. If the LLM is not configured the entrypoint will abort with a clear error.

## Highlights
- AxFlow prompt wrapper with JSON-validated output for dependable responses.
- Bun-native runtime via `@lucid-dreams/agent-kit`.
- Optional x402 payments via `paymentsFromEnv`.

## Getting Started

Prerequisites:
- [Bun](https://bun.sh) `>= 1.1.5`
- `OPENAI_API_KEY` for Ax (plus `PRIVATE_KEY` if you require paid access)

```bash
bun install
bun run dev
```

Once the server prints the ready message, exercise the `recommend` entrypoint:

```bash
curl -s http://localhost:8787/entrypoints/recommend/invoke \
  -H "content-type: application/json" \
  -d '{
        "input": {
          "genre": "sci-fi",
          "mood": "cerebral",
          "numberOfRecommendations": 3
        }
      }' | jq
```

The Ax LLM crafts the recommendations on demand. Missing credentials will result in an explicit error.

### Environment Variables

| Variable              | Default | Purpose |
| --------------------- | ------- | ------- |
| `PORT`                | `8787`  | HTTP port for Bun. |
| `OPENAI_API_KEY`      | –       | Required for Ax LLM re-ranking. |
| `PRIVATE_KEY`         | –       | Optional x402 signing key. |
| `DEFAULT_RECOMMENDATION_COUNT` | `5`     | Baseline number of recommendations when a request omits `numberOfRecommendations`. Legacy `DEFAULT_MAX_RESULTS` is still honoured as a fallback. |
| `DEFAULT_PRICE`       | –       | Optional x402 price string (e.g. `$0.001`). |

## Project Structure

```
.
├── src/
│   ├── agent.ts   # Agent manifest + Ax-powered recommend entrypoint
│   └── index.ts   # Bun HTTP bootstrap
├── package.json
├── bun.lock
└── tsconfig.json
```

## Prompt Customisation

Tune the prompt in `buildRecommendationPrompt` inside `src/agent.ts` to shape tone, guardrails, or metadata requirements. Because there is no static dataset, richer instructions (e.g. preferred release window, platform hints) help the LLM stay on track.
