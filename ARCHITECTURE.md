# Architecture

## Why TF-IDF + Jaccard instead of LLM embeddings

The similarity core is deliberately dependency-free:

- **Zero extra runtime dependencies.** An embedding model (even a "small" local one) adds tens of megabytes of native/WASM weight to a plugin whose whole job is comparing ~30 short documents. TF-IDF over token bags needs no model, no GPU, and no extra install step.
- **The corpus is tiny and fixed.** A `dsh-plugin` topic listing is at most a few dozen repos; per-query corpus statistics (the IDF part) are exact, not estimated, so the quality gap versus embeddings is small for this scale.
- **Explainability is a feature.** The `dedupe` branch tells the user *why* one plugin should be removed. A decomposed score — text cosine, capability Jaccard, dependency Jaccard, with per-plugin reasons (unique capabilities, stars, update recency) — can be narrated; an embedding distance cannot.
- **Offline by design.** Recommendations must work with the network down (degraded mode); an embedding call would add a second network dependency.

The overall score is `0.6·cosine(TF-IDF of name+description+README excerpt+capabilities) + 0.25·Jaccard(capabilities) + 0.15·Jaccard(dependencies)`. Redundancy clusters are greedy maximal groups grown from the strongest remaining above-threshold edge; the irreplaceability score is `0.5·unique-capability share + 0.3·relative stars + 0.2·freshness`.

## Adapting the original brief to the real DSH plugin model

The feature brief assumed a `HarnessPlugin` base class with `on_register/on_invoke/on_teardown`, a `metadata()` manifest, and a `PluginContext.get/set` store. None of that exists in DSH v0.1. The real model — followed here, with the `tool-todo` and `web-search-deepseek` packages as templates — is:

- A plugin is a **Cordis plugin**: module exports `name`, `inject`, a schemastery `Config`, and `apply(ctx, config)`. Registration happens through `ctx.tools.register(defineTool({...}))`, whose disposer is effect-scoped — teardown is automatic, so no `on_teardown` is needed.
- The "PluginContext" of the brief is a plain closure: the `apply` scope owns the TTL cache and the token holder.
- Metadata (`capabilities`, `dependencies`) is *data about community plugins*, not a manifest of this plugin; it is parsed from community READMEs and carried in `CommunityPlugin` rows.
- Version compatibility is handled by presence checks (`ctx.get('web')`, `ctx.get('credentials')`) with plain-`fetch` fallback, per the brief's own instruction to prefer the local source when APIs differ.

## Data flow

```
plugin_community_search ──► CommunitySource ──► GitHub Search API (topic:dsh-plugin)
                                │  TTL cache (default 30 min)
                                └─ on failure ──► stale cache ──► built-in registry snapshot
plugin_similarity_analyze ──► similarity.ts (pure functions)
plugin_recommend ──► github.ts + inventory.ts ($DSH_HOME/profiles/<p>/package.json) ──► recommend.ts
                                                                                          ├─ branch 1: recommend
                                                                                          ├─ branch 2: dedupe + removal command
                                                                                          └─ branch 3: Plugin Spec (spec.ts)
```

## Secrets

The optional GitHub PAT is a `role('credential-ref')` config field resolved per request through `ctx.credentials` (`.credentials.yaml` / env / `.env` layers). A literal `role('secret')` field exists for edge cases and is redacted in settings descriptors. Nothing is ever hardcoded or logged.
