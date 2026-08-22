# dsh-plugin-doctor

**Chinese version: [README.md](README.md)**

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

`dsh-plugin-doctor` is a diagnostics and decision tool for the DSH plugin ecosystem. It searches community plugins, compares overlap, understands aggregate bundles, guards multi-plugin installs, audits real usage, renders a plugin landscape graph, and checks the local install against official releases.
Inspired by Claude Code's `/doctor` command and repeated plugin conflicts and crashes caused by installing incompatible extensions.

Current version: `1.1.0`. Requires Node.js `>=22.19`. The plugin is read-only by default: it does not start Web UI or mutate a profile on its own.

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
| Learn about known official issues before installing | Before search, recommendation, or supplied repository links lead to an install, asks whether to inspect open issues and shows relevant official links |
| Check how far behind the official release you are | Compares the local DSH version with the latest official release; when older, reports the release changes plus installed plugins that may be duplicated or conflicted |

## Tools

- `plugin_community_search`: community search and filters.
- `plugin_similarity_analyze`: similarity, redundancy groups, and irreplaceability.
- `plugin_recommend`: install, dedupe, or self-development decisions with aggregate-bundle awareness.
- `plugin_install_guard`: read-only preflight for multi-repository installs.
- `plugin_usage_audit`: local session usage audit.
- `plugin_landscape`: installed/community relation graph and usage tiers.
- `plugin_official_sync`: official release sync check; reports changes and duplicate/conflict findings when the local DSH is older.

The agent selects the appropriate tool automatically.

## Official issue check before installation

When a user searches for an installable plugin, asks for a recommendation, or sends repository links to install, the plugin first asks whether to inspect open issues in the official repositories. It matches issue titles and bodies against the requested capability or symptom and shows official links, such as an unresolved report about recursive file watching causing Web UI stalls.

If the user explicitly chooses “do not check this session,” the prompt is suppressed for the rest of that session and returns in a new session. Dismissed prompts or unavailable interaction are reported as incomplete checks, never as proof that no known issue exists. An unavailable Issue API affects only the warning; it never bypasses the install guard's fail-closed behavior.

## Examples

### Ask about official issues before installing (real incident pattern)

```text
I want to install a Web UI plugin. Check the official repository for unresolved issues first so we do not repeat history-load failures, unavailable model selection, or stuck file operations.
```

The plugin first asks whether to check official open issues. In the real incident pattern, an official repository contained an open issue closely matching “right-side file panel stalls and history loading fails”: the root cause was not the remote Web plugin, but a file-panel plugin whose recursive watcher consumed resources. The report uses a blurred plugin name such as `@example-org/ui-panel-plugin` and links to the official [Issue #119](https://github.com/zhu1090093659/dsh-web-ui/issues/119) for verification. After an explicit refusal in the current session, later install requests do not repeat the prompt.

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

### Check official release sync

```text
How far behind the official DSH am I? Will upgrading affect my installed plugins?
```

`plugin_official_sync` compares the local DSH version with the latest official release. Matching versions answer with a one-liner. When the local install is older, the report shows the release changes plus installed plugins that may be duplicated or conflicted: peer ranges excluding the new version, declared tool names appearing in the official notes, or capability keywords overlapping the changes. Findings are advisory only and never replace the install guard's verdict.

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

The official release check reads the releases list with a process cache; when GitHub is unavailable it degrades to a stale cache or an explicit note. That degradation is advisory — it never affects `plugin_install_guard`'s fail-closed verdict.

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

Current verification baseline: `84` tests pass, TypeScript builds, and all seven tools register and pass the smoke invocation. See [ARCHITECTURE.md](ARCHITECTURE.md) for the algorithm and data flow, and [CONTRIBUTING.md](CONTRIBUTING.md) for contribution rules. Do not share one `node_modules` between Windows and WSL.

## License

MIT.
