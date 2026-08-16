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
                                                                                          ├─ branch 2: dedupe ──► ask (keep / integrate / skip) ──┬─ keep: removal command
                                                                                          │                                                    ├─ integrate: Integration Spec (spec.ts)
                                                                                          │                                                    └─ skip: record only
                                                                                          └─ branch 3: near-miss competitors ──► ask (build / abort) ──┬─ build: Plugin Spec (spec.ts)
                                                                                                                                                       └─ abort: competitor list only
plugin_usage_audit ──► usage.ts ──► sessions/<cwd-slug>/session-<id>/session.jsonl.zstd (node:zlib zstd, Node ≥22.19)
                              └─► profile node_modules manifests (dsh.tools attribution) ──► zero-call plugins ──► removal suggestion
```

## Usage audit (v0.3)

`auditToolUsage` walks the durable session logs under the DSH home and aggregates `tool/call` events per tool name. Events carry no wall clock, so `lastUsed` is the mtime of the newest log containing the call. The JSONL persistence format is concatenated zstd frames; a torn final frame still decodes its complete leading frames via one-shot `zstdDecompress`, so torn-tail logs count as scanned with partial data, while garbage files throw and are skipped-and-counted — the audit never aborts on one bad artifact. Tool→plugin attribution is opt-in: a package declares its tools as `dsh.tools` in package.json (this plugin does); undeclared plugins read as `(unattributed)` rather than being misclassified as unused.

**zstd is resolved lazily** (v0.4.1): a static top-level `import { zstdDecompress } from 'node:zlib'` fails at ESM link time on Node without zstd (added 22.15) — which took down the whole plugin tree for users running dsh via `npx` on older Node. `usage.ts` now probes the export through a dynamic import per first use; when absent, compressed logs are skipped with an explanatory note and every other tool keeps working. `tests/usage-old-node.spec.ts` pins this by mocking `node:zlib` without the zstd exports.

## Execution gate and live registries (v0.5)

Confirmed outcomes may execute: `plugin_recommend` returns `actions` (add keeper / remove duplicates) marked `confirmed` **only** when the user picked the keep-remove option through the interactive prompt. The tool layer executes them via the `dsh plugin` CLI under a double gate — `allowExecuteActions` config (default off) **and** `confirmed` — so degraded non-interactive paths and the integrate branch (whose replacement plugin does not exist yet) never mutate the profile. Execution failures surface per-action in the report; a missing `dsh` binary on the server PATH reports instead of throwing. The degradation chain gained a live-registry step: when GitHub fails and no cache exists, dshplugin.world and dsh.pub are scraped for repository links before the static snapshot; pages without repositories fall through.

The periodic health check promised by the roadmap is `plugin_landscape` itself (redundancy clusters + usage tiers + community metadata in one report) — deliberately no separate session-start automation, which would couple the plugin to agent-loop scheduling for no new information.

## Landscape tiers and graph (v0.4)

`plugin_landscape` joins three sources: installed inventory, the usage audit above, and — when an intent is given — community candidates (installed plugins that also exist as community rows keep the richer metadata for tiering). Tiers combine usage volume/recency with irreplaceability from the same similarity analysis that powers dedupe: `core` (≥10 calls, or used with irreplaceability ≥0.7), `active` (some calls), `idle` (declared tools, zero calls), `review` (idle plus stale-or-redundant), `unattributed` (no measurable usage). The relation graph renders as Mermaid (`graph LR`, edges capped strongest-first at 15) with an indented text fallback in the same report, so non-Mermaid surfaces stay readable. All logic lives in `landscape.ts` as pure functions.

## Interactive confirmation funnel (v0.2)

Every spec-producing or removal-producing outcome goes through one prompt: `askChoiceFactory` (`interaction.ts`) wraps the DSH `ctx.userQuestions` seam — the same service `tool-ask-user` consumes — into a one-choice hook. The seam is detected per execution (`ctx.get('userQuestions')`), structural-typed locally so the plugin carries no extra peer dependency. Prompt dismissed, seam absent, or execution aborted → the hook resolves `undefined` and the caller degrades: branch 2 falls back to keep/remove plus a "say the word to consolidate" hint, branch 3 falls back to emitting the spec directly (the pre-v0.2 behavior). Tests inject stub hooks; `verify-boot.mjs` runs seam-less and thereby exercises the degraded paths.

## Secrets

The optional GitHub PAT is a `role('credential-ref')` config field resolved per request through `ctx.credentials` (`.credentials.yaml` / env / `.env` layers). A literal `role('secret')` field exists for edge cases and is redacted in settings descriptors. Nothing is ever hardcoded or logged.
