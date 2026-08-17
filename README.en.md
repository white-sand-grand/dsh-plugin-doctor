# dsh-plugin-doctor

**Chinese version: [README.md](README.md)**

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

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

## Examples

### Search and check overlap

```text
Find me a memory plugin and check whether it overlaps with plugins in my web profile.
```

The result lists candidates, match reasons, overlap scores against local plugins, and keep/remove commands. Spec generation and dedupe execution require confirmation.

### Guard a multi-plugin install

```text
I want to install these repositories together. Check for conflicts first:
github:owner/plugin-a
github:owner/plugin-b
github:owner/plugin-c
```

If GitHub returns `403/429`, or repository metadata cannot be read, the result is `INSTALL BLOCKED` with token and rate-limit-reset guidance. Unknown metadata is never waved through.

### View plugin relationships

```text
How are the plugins I installed earlier related? Which ones are similar?
```

`plugin_landscape` returns a relation graph. Nodes include Chinese function summaries; edges explain whether similarity comes from descriptions, capabilities, or dependencies. With an intent, community candidates join as dashed nodes.

### Understand an aggregate bundle

```text
I need a task board. Does my installed UI bundle already provide one?
```

The recommendation path reads plugin-shaped dependencies of installed aggregate bundles. When a bundle already supplies the capability, the report shows its `providedBy` owner and avoids recommending an independent child removal or duplicate install.

### Audit usage

```text
List plugins in my web profile that declare tools but have never been used.
```

The result is based on local finalized session logs and never uploads their contents. An active or not-yet-flushed session may not be included and is called out.

## Direct DSH questions versus doctor

When you simply ask DSH to “find a plugin,” the model may offer a general suggestion from context, but it does not consistently search the community, read local package metadata, quantify overlap, or inspect Cordis registration conflicts. A multi-repository install can also proceed without a preflight.

With `dsh-plugin-doctor`, the same requests produce structured, reviewable evidence:

| Direct DSH question | With `dsh-plugin-doctor` |
| --- | --- |
| Relies on model context or an ad-hoc search | Uses GitHub, cache, and registry fallbacks and identifies the source |
| Says plugins “look similar” | Returns text, capability, and dependency similarity plus redundancy groups |
| May miss children inside an aggregate bundle | Reads installed bundle dependencies and marks `providedBy` |
| Installs several repositories immediately | Checks package names, tools, patch rows, and peer dependencies first; unknown state fails closed |
| Gives no reliable usage history | Counts tool calls, sessions, and recency from local session logs |
| Describes relationships only in prose | Renders a Mermaid graph with pair-by-pair explanations |

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
