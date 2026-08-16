# dsh-plugin-doctor

**中文版：[README.md](README.md)**

A "doctor" for the DSH plugin ecosystem — inspired by Claude Code's `/doctor` command. Tell it what you need: it finds a matching community plugin; if something you installed overlaps with it, it tells you which one to keep and which to remove; and if the community has nothing, it hands you a ready-to-follow spec for building it yourself.

> ✅ **Status: fully working.** Verified end-to-end on DSH v0.1.0-rc.6: build, 19 unit tests, real tool registration and execution, and a live Web-UI conversation test. Install and go.
>
> ⚠️ DSH is a v0.1 developer preview and its API may change. The plugin guards itself (degrades gracefully when a capability is missing), but small adjustments may be needed if DSH changes significantly.

## What it does for you

| You say | It does |
| --- | --- |
| "Find me a memory plugin" | Searches the community and returns the best matches, with install commands |
| "Does this overlap with what I installed?" | Lays out the overlap facts, then **asks how to proceed**: keep A remove B (with commands) / consolidate the duplicates into one new plugin you build (integration spec) / leave as-is |
| "I need X but can't find it" | Lists near-miss competitors and what each lacks, **asks whether you want to self-develop**, and only after you confirm generates the build-it-yourself spec |

## Up and running in one minute

```sh
dsh plugin --profile web add github:white-sand-grand/dsh-plugin-doctor
dsh web
```

Open `http://127.0.0.1:3080` and just talk to it, e.g.:

> 帮我找一个记忆插件，并检查是否和已安装的重复

The agent picks the right tool automatically — you just read the answer.

## The three tools it adds

You don't need to memorize these — the agent chooses. Listed so you know the boundaries:

- **`plugin_community_search`** — searches community plugins (GitHub repos tagged `dsh-plugin`); returns description, capability tags, stars, last update.
- **`plugin_similarity_analyze`** — compares a set of plugins for functional overlap and finds redundancy groups.
- **`plugin_recommend`** — combines the two above into a final decision. Anything that would emit a spec or remove a plugin is gated on your explicit choice (a choice card in the Web UI); non-interactive environments fall back to plain recommendations.

## Configuration (optional — defaults just work)

Every setting has a sensible default; feel free to skip this section. To change one, edit your profile's patch layer:

| Field | Default | In plain words |
| --- | --- | --- |
| `githubTokenEnv` | `DSH_PLUGIN_DOCTOR_GITHUB_TOKEN` | Name of the env var holding your GitHub token. With a token, the search quota rises from 60 to 5000 requests/hour |
| `githubToken` | none | Paste the token literally (not recommended in files — prefer the env-var way above) |
| `similarityThreshold` | `0.8` | How much overlap counts as "redundant". Lower it to get more aggressive dedupe advice |
| `cacheTtlMinutes` | `30` | How long search results are cached, to spare the GitHub quota |
| `enableRegistryFallback` | `true` | Whether to fall back to a built-in static plugin list when GitHub is unreachable |

**Adding a token** (recommended): GitHub → Settings → Developer settings → Personal access tokens, generate one (no scopes needed), then:

```bash
echo "DSH_PLUGIN_DOCTOR_GITHUB_TOKEN: ghp_yourtoken" > ~/.dsh/.credentials.yaml
chmod 600 ~/.dsh/.credentials.yaml
```

## What happens on bad networks / rate limits

Nothing crashes. The plugin falls back in three layers, in order:

1. Normal: live GitHub queries (cached for 30 minutes).
2. Rate-limited or unreachable: serve the last cached results.
3. No cache at all: serve a built-in snapshot of the community list (from dshplugin.world / dsh.pub).

Whichever layer serves you, the answer says so — seeing a "degraded" note is informational, not a failure, and DSH itself is never affected.

## Contributing

```sh
git clone git@github.com:white-sand-grand/dsh-plugin-doctor.git
cd dsh-plugin-doctor
pnpm install
pnpm run build     # compile
pnpm test          # run tests
node verify-boot.mjs   # smoke: register and invoke once on a real DSH runtime
```

Why the similarity algorithm avoids LLM embeddings, how the code is organized, and how it maps onto the DSH plugin conventions live in [ARCHITECTURE.md](ARCHITECTURE.md). See [CONTRIBUTING.md](CONTRIBUTING.md) before sending changes and [RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md) before publishing.

Note: create `node_modules` in one environment only (Windows or WSL — mixing them breaks it).

## License

MIT. Forks welcome — tag your repo with `dsh-plugin` so this plugin (and the community) can find you.
