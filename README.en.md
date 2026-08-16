# dsh-plugin-doctor

**中文版：[README.md](README.md)**

**Compatible with DSH v0.1.x (developer preview).** DSH is pre-release; this plugin detects capability presence before use and may need adjustment as DSH evolves.

Community-plugin doctor for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — inspired by Claude Code's `/doctor` command, applied to the plugin ecosystem: it searches the DSH community (GitHub `dsh-plugin` topic), analyzes similarity and redundancy between plugins, and makes an install / de-duplicate / build-it-yourself decision.

## Tools exposed to the Agent

| Tool | Purpose |
| --- | --- |
| `plugin_community_search` | Search the `dsh-plugin` GitHub topic by natural-language intent; returns name, description, capabilities, dependencies, stars, recency. |
| `plugin_similarity_analyze` | TF-IDF + Jaccard similarity matrix, redundancy clusters (default threshold 0.8), and an irreplaceability score per plugin. |
| `plugin_recommend` | Three-branch decision: recommend the best community match; suggest removing a redundant installed plugin (with the `dsh plugin remove` command); or generate a Plugin Spec when the community has nothing suitable. |

Try: “帮我找一个记忆插件，并检查是否和已安装的重复”.

## Install

```sh
dsh plugin --profile web add github:white-sand-grand/dsh-plugin-doctor
# or from a local checkout:
dsh plugin --profile web add /absolute/path/to/dsh-plugin-doctor
```

Then start DSH (`dsh web`) and ask the agent to use the tools above.

## Configuration

All fields live in the `plugin-doctor` settings namespace / the plugin entry's `config` block:

| Field | Default | Meaning |
| --- | --- | --- |
| `githubTokenEnv` | `DSH_PLUGIN_DOCTOR_GITHUB_TOKEN` | Credential reference for an optional GitHub PAT (raises the API rate limit). Resolved through the DSH credentials seam — never hardcode the token. |
| `githubToken` | – | Literal secret; prefer `githubTokenEnv`. |
| `similarityThreshold` | `0.8` | Overall similarity above which plugins form a redundancy cluster. |
| `cacheTtlMinutes` | `30` | Community-listing cache lifetime; guards the GitHub rate limit. |
| `enableRegistryFallback` | `true` | Serve the built-in third-party registry snapshot when GitHub is unreachable. |

**Web UI settings card:** the plugin registers its settings namespace with the host settings service (secret fields are redacted in descriptors), but DSH's web settings page only renders namespaces allowlisted in the host API proxy. Surfacing this plugin's card there requires a DSH-side allowlist entry (`WEB_SETTINGS_NAMESPACES` in `packages/host/apiproxy`), which this plugin deliberately does not patch — configure via the profile patch layer or settings file until DSH opens that surface to plugins.

## Degradation behavior

1. Live GitHub API (30-minute TTL cache in front).
2. On failure (rate limit 403/429, network error): stale cache if present.
3. Else: built-in static registry snapshot (from dshplugin.world / dsh.pub listings), disabled by `enableRegistryFallback: false`.

Degradation is reported in tool output; no error ever blocks the DSH host.

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the similarity-algorithm choice and the adaptation from the original `HarnessPlugin` sketch to the real Cordis plugin model.

## Development

```sh
pnpm install
pnpm run build
pnpm test
node verify-boot.mjs   # smoke: mounts the built plugin on a real Cordis Context + ToolRuntime
```

`verify-boot.mjs` registers the three tools through the published `@deepseek-ai/dsh-tools` runtime and executes `plugin_recommend` end-to-end (live GitHub, degraded chain on rate limit). Use one environment consistently for `node_modules` (Windows and WSL pnpm layouts are not interchangeable).

## License

MIT. Add the `dsh-plugin` topic to your fork so the community (and this plugin) can find it.
