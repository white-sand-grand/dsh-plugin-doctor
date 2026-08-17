# dsh-plugin-doctor

**Chinese version: [README.md](README.md)**

`dsh-plugin-doctor` is a diagnostics and decision tool for the DSH plugin ecosystem. It searches community plugins, compares overlap, understands aggregate bundles, guards multi-plugin installs, audits real usage, and renders a plugin landscape graph.

Current version: `0.8.0`. Requires Node.js `>=22.19`. The plugin is read-only by default: it does not start Web UI or mutate a profile on its own.

## Install

Run this in the same environment that runs DSH:

```sh
dsh plugin --profile web add github:white-sand-grand/dsh-plugin-doctor
```

Start DSH Web yourself when needed:

```sh
dsh web
```

Open `http://127.0.0.1:3080` and ask questions in natural language. The plugin does not start Web UI or change other profile plugins.

## Update

Use this deterministic refresh sequence:

```sh
dsh plugin --profile web remove dsh-plugin-doctor
dsh plugin --profile web add github:white-sand-grand/dsh-plugin-doctor
```

Start Web yourself after updating if needed:

```sh
dsh web
```

## Capabilities

| Need | Behavior |
| --- | --- |
| Find a plugin | Searches GitHub `dsh-plugin` repositories and fallback sources; returns match, capabilities, stars, update time, and install reference |
| Check functional overlap | Compares description text, capability tags, and dependencies, then recommends dedupe or self-development |
| Ask how installs relate | Renders a similarity graph with Chinese function summaries and edge explanations |
| Check several repositories before installing | Inspects package names, tools, Cordis patch rows, and peer dependencies; conflicts or unknown metadata return `INSTALL BLOCKED` |
| Understand an aggregate bundle | Expands installed DSH-shaped dependencies; child plugins carry `providedBy` and are not recommended for independent removal |
| Audit actual usage | Scans finalized local session logs and attributes tool calls through `dsh.tools` |
| See the overall plugin landscape | Renders a Mermaid relation graph and `core` / `active` / `idle` / `review` tiers |

## Tools

- `plugin_community_search`: community search and filters.
- `plugin_similarity_analyze`: similarity, redundancy groups, and irreplaceability.
- `plugin_recommend`: install, dedupe, or self-development decisions with aggregate-bundle awareness.
- `plugin_install_guard`: read-only preflight for multi-repository installs.
- `plugin_usage_audit`: local session usage audit.
- `plugin_landscape`: installed/community relation graph and usage tiers.

The agent selects the appropriate tool automatically.

## Safety and degradation

`plugin_install_guard` fails closed when repository metadata cannot be verified. GitHub `403` and `429` responses include token and rate-limit-reset guidance; unknown metadata is never treated as conflict-free.

Community search falls back in order: live GitHub, process cache, third-party registry pages, then a built-in snapshot. The response identifies the data source used.

The usage audit reads only session files already flushed to disk. An active or not-yet-flushed session may be absent and is called out in the report. Corrupt artifacts are skipped and counted; runtimes without zstd support skip compressed logs without preventing the other tools from loading.

## Optional configuration

| Field | Default | Purpose |
| --- | --- | --- |
| `githubTokenEnv` | `DSH_PLUGIN_DOCTOR_GITHUB_TOKEN` | Environment variable containing a GitHub token |
| `githubToken` | none | Literal token; prefer the environment variable |
| `similarityThreshold` | `0.8` | Similarity threshold for redundancy |
| `cacheTtlMinutes` | `30` | Community search cache lifetime |
| `enableRegistryFallback` | `true` | Enable registry and snapshot fallbacks |
| `allowExecuteActions` | `false` | Permit confirmed interactive add/remove actions; default is report-only |

Prefer an environment variable and keep tokens out of repositories:

```sh
export DSH_PLUGIN_DOCTOR_GITHUB_TOKEN='your GitHub token'
```

## Development

```sh
git clone https://github.com/white-sand-grand/dsh-plugin-doctor.git
cd dsh-plugin-doctor
pnpm install
pnpm test
pnpm run build
node verify-boot.mjs
```

Current verification baseline: `56` tests pass, TypeScript builds, and all six tools register and pass the smoke invocation. See [ARCHITECTURE.md](ARCHITECTURE.md) for the algorithm and data flow, and [CONTRIBUTING.md](CONTRIBUTING.md) for contribution rules. Do not share one `node_modules` between Windows and WSL.

## License

MIT.
