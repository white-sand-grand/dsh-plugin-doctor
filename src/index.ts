/**
 * `dsh-plugin-doctor` — three Agent-facing tools over the DSH community
 * plugin ecosystem: `plugin_community_search` (GitHub `dsh-plugin` topic with
 * TTL cache and degraded fallbacks), `plugin_similarity_analyze` (TF-IDF +
 * Jaccard similarity, redundancy clusters, irreplaceability), and
 * `plugin_recommend` (recommend / de-duplicate / generate a Plugin Spec).
 *
 * Adaptation note: DSH plugins are Cordis plugins — module-level `name`,
 * `inject`, schemastery `Config`, and `apply(ctx, config)` with fiber-scoped
 * registration. The `HarnessPlugin`/`on_invoke` model in the original feature
 * brief does not exist in DSH v0.1; this entry follows the real
 * `tool-todo`/`tool-web` consumer pattern instead.
 *
 * @module dsh-plugin-doctor
 */

import type { Context } from '@deepseek-ai/cordis'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { CommunitySource } from './github.ts'
import type { WebFetchLike } from './http.ts'
import { askChoiceFactory } from './interaction.ts'
import type { UserQuestionsLike } from './interaction.ts'
import { readInventory, toPluginRows, resolveDshHome } from './inventory.ts'
import { assignTiers, renderLandscape } from './landscape.ts'
import type { PluginUsageSummary } from './landscape.ts'
import { recommend } from './recommend.ts'
import type { DecisionHooks } from './recommend.ts'
import { analyze } from './similarity.ts'
import type { CommunityPlugin, SearchFilters, SearchResult, SimilarityReport } from './types.ts'
import { auditToolUsage, pluginToolMap } from './usage.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'plugin-doctor'

/** The tool registry is the only hard seam; the web capability is used when present. */
export const inject = ['tools']

const DEFAULT_TOKEN_ENV = 'DSH_PLUGIN_DOCTOR_GITHUB_TOKEN'
const DEFAULT_THRESHOLD = 0.8
const DEFAULT_TTL_MINUTES = 30

/** Plugin configuration; every deployment-varying choice is a validated field. */
export interface Config {
  /** GitHub PAT (optional) raising the API rate limit; prefer {@link githubTokenEnv}. */
  githubToken?: string
  /** Credential reference resolved per request; defaults to `DSH_PLUGIN_DOCTOR_GITHUB_TOKEN`. */
  githubTokenEnv?: string
  /** Overall similarity above which two plugins are redundant. Defaults to 0.8. */
  similarityThreshold?: number
  /** Community-listing cache lifetime in minutes. Defaults to 30. */
  cacheTtlMinutes?: number
  /** Serve the built-in third-party registry snapshot when GitHub is unavailable. */
  enableRegistryFallback?: boolean
  /**
   * Execute confirmed install/remove actions via the `dsh plugin` CLI instead
   * of only printing commands. Off by default; when on, execution still
   * requires the user's explicit interactive confirmation (degraded,
   * non-interactive paths never execute).
   */
  allowExecuteActions?: boolean
}

export const Config: z<Config> = z.object({
  githubToken: z.string().role('secret'),
  githubTokenEnv: z.string().role('credential-ref').default(DEFAULT_TOKEN_ENV),
  similarityThreshold: z.number().min(0).max(1).default(DEFAULT_THRESHOLD),
  cacheTtlMinutes: z.number().step(1).min(1).default(DEFAULT_TTL_MINUTES),
  enableRegistryFallback: z.boolean().default(true),
  allowExecuteActions: z.boolean().default(false),
})

/** Settings namespace carrying the plugin doctor's user-tunable section. */
const SETTINGS_NAMESPACE = settingsNamespace('plugin-doctor')

/**
 * Resolve the GitHub token per operation: literal config secret, then the
 * credentials seam, then nothing (anonymous rate limit).
 * @param ctx - plugin context.
 * @param config - the currently authoritative section.
 */
async function resolveToken(ctx: Context, config: Config): Promise<string | undefined> {
  if (config.githubToken !== undefined && config.githubToken.length > 0) return config.githubToken
  const ref = credentialRef(config.githubTokenEnv ?? DEFAULT_TOKEN_ENV)
  const credentials = ctx.get('credentials')
  return (await credentials?.resolve(ref))?.value
}

/** Wire payload of one community-search hit. */
interface SearchHit {
  name: string
  installRef: string
  description: string
  capabilities: string[]
  dependencies: string[]
  stars: number
  updatedAt: string
  source: 'github' | 'cache' | 'registry'
}

/** Wire payload of `plugin_community_search`. */
interface SearchOutput {
  plugins: SearchHit[]
  degraded?: string
}

/** Wire payload of `plugin_similarity_analyze`. */
interface SimilarityOutput {
  report: string
  clusters: { members: string[]; cohesion: number }[]
  irreplaceability: { name: string; score: number; reasons: string[] }[]
}

/** Wire payload of `plugin_recommend`. */
interface RecommendOutput {
  branch: 'recommend' | 'dedupe' | 'integrate' | 'spec' | 'none'
  report: string
  removals: string[]
}

/** One `dsh plugin` invocation outcome for the execution log. */
interface ActionOutcome {
  readonly ok: boolean
  readonly detail: string
}

/**
 * Run one `dsh plugin --profile <p> <add|remove> <spec>` via the CLI. The
 * `dsh` binary must be on the server process's PATH; a missing binary or
 * non-zero exit is reported, never thrown — the surrounding report stays
 * intact either way.
 * @param profile - target profile.
 * @param action - the confirmed mutation to run.
 */
function runDshPlugin(profile: string, action: { kind: 'add' | 'remove'; spec: string }): ActionOutcome {
  const result = spawnSync('dsh', ['plugin', '--profile', profile, action.kind, action.spec], {
    encoding: 'utf8',
    timeout: 180_000,
    // Windows resolves dsh through a shim that spawn() refuses without a
    // shell since the CVE-2024-27980 hardening (same choice as dsh's own
    // plugin forwarder).
    shell: process.platform === 'win32',
  })
  if (result.error !== undefined) {
    const code = (result.error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { ok: false, detail: 'dsh not found on the server PATH' }
    if (code === 'ETIMEDOUT') return { ok: false, detail: 'timed out after 180s' }
    return { ok: false, detail: result.error.message }
  }
  if (result.status !== 0) {
    return { ok: false, detail: `exit ${result.status}: ${(result.stderr ?? '').trim().split('\n').slice(-2).join(' ').slice(0, 160)}` }
  }
  return { ok: true, detail: '' }
}

/** Wire payload of `plugin_usage_audit`. */
interface UsageAuditOutput {
  report: string
  usage: { tool: string; plugin: string; calls: number; sessions: number; lastUsed?: string }[]
  unusedPlugins: string[]
  inventoryNote?: string
}

/** Wire payload of `plugin_landscape`. */
interface LandscapeOutput {
  report: string
  tiers: { name: string; tier: 'core' | 'active' | 'idle' | 'review' | 'unattributed'; reason: string }[]
}

/**
 * Install the three tools and the settings section.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - deployment configuration.
 */
export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  installSettingsSection(ctx, SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => {
      current = source
    },
    onChange: () => {},
  })
  // The token lives behind a getter so every listing fetch reads the value
  // last resolved from the settings section / credentials seam.
  let token: string | undefined
  const source = new CommunitySource(
    { web: ctx.get('web') as WebFetchLike | undefined, get token() { return token } },
    config.cacheTtlMinutes ?? DEFAULT_TTL_MINUTES,
  )
  // Token re-resolution before each listing fetch (cheap, cacheable by the
  // credentials provider) makes settings changes take effect without restart.
  const refreshToken = async (): Promise<void> => {
    token = await resolveToken(ctx, current())
  }
  const searchWithToken = async (intent: string, filters: SearchFilters, signal: AbortSignal | undefined): Promise<SearchResult> => {
    await refreshToken()
    const result = await source.search(intent, filters, signal)
    if (!current().enableRegistryFallback && result.degraded !== undefined && result.plugins.some(plugin => plugin.source === 'registry')) {
      return { plugins: [], degraded: `${result.degraded}; registry fallback disabled` }
    }
    return result
  }

  ctx.tools.register(defineTool({
    name: 'plugin_community_search',
    description:
      'Search the DSH community plugin ecosystem (GitHub `dsh-plugin` topic) for plugins matching a '
      + 'natural-language need. Returns name, description, capabilities, dependencies, stars, and '
      + 'recency for each match. Results are cached for the configured TTL; when GitHub is '
      + 'unreachable a stale cache or built-in registry snapshot is served and the degradation is noted.',
    parameters: {
      intent: {
        type: 'string',
        required: true,
        description: 'What the user needs, in natural language (e.g. "automatically approve sandbox permissions").',
      },
      minStars: {
        type: 'integer',
        description: 'Exclude repositories with fewer stars.',
      },
      updatedWithinDays: {
        type: 'integer',
        description: 'Exclude repositories not updated within this many days.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          plugins: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                installRef: { type: 'string', required: true },
                description: { type: 'string', required: true },
                capabilities: { type: 'array', items: { type: 'string' } },
                dependencies: { type: 'array', items: { type: 'string' } },
                stars: { type: 'integer', required: true },
                updatedAt: { type: 'string' },
                source: { type: 'string', enum: ['github', 'cache', 'registry'], required: true },
              },
            },
          },
          degraded: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderSearch(value as SearchOutput) }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const result = await searchWithToken(args.intent, {
        minStars: args.minStars,
        updatedWithinDays: args.updatedWithinDays,
      }, exec.signal)
      const output: SearchOutput = {
        plugins: result.plugins.map(plugin => ({
          name: plugin.name,
          installRef: plugin.installRef,
          description: plugin.description,
          capabilities: [...plugin.capabilities],
          dependencies: [...plugin.dependencies],
          stars: plugin.stars,
          updatedAt: plugin.updatedAt,
          source: plugin.source,
        })),
        ...(result.degraded === undefined ? {} : { degraded: result.degraded }),
      }
      return output
    },
    presentCall: args => ({ card: 'generic', title: 'Search community plugins', kind: 'search', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'plugin_similarity_analyze',
    description:
      'Analyze functional similarity between plugins: TF-IDF cosine over text, Jaccard overlap of '
      + 'capabilities and dependencies, redundancy clusters above the configured threshold, and an '
      + 'irreplaceability score (unique capabilities, stars, maintenance recency) per plugin. Pass '
      + 'community candidates, local installs, or both.',
    parameters: {
      intent: {
        type: 'string',
        required: true,
        description: 'The requirement the compared plugins should serve; used to fetch community candidates when plugin lists are omitted.',
      },
      plugins: {
        type: 'array',
        description: 'Explicit plugin list to compare. Omit to compare community candidates for the intent against local installs.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', required: true, description: 'Plugin or package name.' },
            description: { type: 'string' },
            capabilities: { type: 'array', items: { type: 'string' } },
            dependencies: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      profile: {
        type: 'string',
        description: 'Local profile whose installs join the comparison. Defaults to "web".',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          report: { type: 'string', required: true },
          clusters: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                members: { type: 'array', items: { type: 'string' }, required: true },
                cohesion: { type: 'number', required: true },
              },
            },
          },
          irreplaceability: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                score: { type: 'number', required: true },
                reasons: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: (value as SimilarityOutput).report }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const set: readonly CommunityPlugin[] = args.plugins !== undefined && args.plugins.length > 0
        ? args.plugins.map(plugin => ({
          name: plugin.name,
          repo: plugin.name,
          installRef: plugin.name,
          description: plugin.description ?? '',
          readmeExcerpt: '',
          capabilities: plugin.capabilities ?? [],
          dependencies: plugin.dependencies ?? [],
          stars: 0,
          updatedAt: '',
          source: 'cache' as const,
        }))
        : await comparedSet(args.intent, args.profile ?? 'web', exec)
      const threshold = current().similarityThreshold ?? DEFAULT_THRESHOLD
      const analysis = analyze(set, threshold)
      const output: SimilarityOutput = {
        report: renderAnalysis(analysis, threshold),
        clusters: analysis.clusters.map(cluster => ({ members: [...cluster.members], cohesion: cluster.cohesion })),
        irreplaceability: analysis.irreplaceability.map(score => ({
          name: score.name,
          score: score.score,
          reasons: [...score.reasons],
        })),
      }
      return output
    },
    presentCall: args => ({ card: 'generic', title: 'Analyze plugin similarity', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'plugin_recommend',
    description:
      'Recommend what to do about a plugin need: install the best community match; de-duplicate when '
      + 'matches overlap heavily with installed plugins (with removal commands); or, when the community '
      + 'has nothing suitable, generate a Plugin Spec for building it. Specs and removals are gated on '
      + 'your explicit choice via an interactive prompt when the user-questions capability is available. '
      + 'Returns a Markdown report.',
    parameters: {
      intent: {
        type: 'string',
        required: true,
        description: 'What the user needs, in natural language.',
      },
      profile: {
        type: 'string',
        description: 'Profile used for local inventory and rendered install/remove commands. Defaults to "web".',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          branch: { type: 'string', enum: ['recommend', 'dedupe', 'integrate', 'spec', 'none'], required: true },
          report: { type: 'string', required: true },
          removals: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: (value as RecommendOutput).report }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const profile = args.profile ?? 'web'
      const search = await searchWithToken(args.intent, {}, exec.signal)
      const inventory = await readInventory(profile)
      const hooks: DecisionHooks = {
        askChoice: askChoiceFactory(ctx.get('userQuestions') as UserQuestionsLike | undefined),
      }
      const decision = await recommend(
        args.intent,
        search,
        toPluginRows(inventory.names),
        current().similarityThreshold ?? DEFAULT_THRESHOLD,
        profile,
        hooks,
        exec.signal,
      )
      let report = inventory.note === undefined ? decision.report : `> Local inventory: ${inventory.note}\n\n${decision.report}`
      const executed: string[] = []
      if (current().allowExecuteActions === true && decision.confirmed && decision.actions.length > 0) {
        for (const action of decision.actions) {
          const outcome = runDshPlugin(profile, action)
          executed.push(`${outcome.ok ? 'done' : 'FAILED'}: dsh plugin --profile ${profile} ${action.kind} ${action.spec}${outcome.ok ? '' : ` — ${outcome.detail}`}`)
        }
        report += `\n\nExecuted (allowExecuteActions on, confirmed by you):\n${executed.map(line => `- ${line}`).join('\n')}`
      }
      const output: RecommendOutput = {
        branch: decision.branch,
        report,
        removals: [...decision.removals],
      }
      return output
    },
    presentCall: args => ({ card: 'generic', title: 'Recommend a plugin decision', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'plugin_usage_audit',
    description:
      'Audit which plugins you actually use: scans local DSH session logs for real tool calls and '
      + 'reports per-tool call counts, recency, and the owning plugin. Installed plugins whose '
      + 'declared tools were never called are flagged with a removal suggestion. Attribution uses '
      + "each package's `dsh.tools` declaration; undeclared plugins read as unattributed. Purely "
      + 'local — no network.',
    parameters: {
      profile: {
        type: 'string',
        description: 'Profile whose installs are audited. Defaults to "web".',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          report: { type: 'string', required: true },
          usage: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                tool: { type: 'string', required: true },
                plugin: { type: 'string', required: true },
                calls: { type: 'integer', required: true },
                sessions: { type: 'integer', required: true },
                lastUsed: { type: 'string' },
              },
            },
          },
          unusedPlugins: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: (value as UsageAuditOutput).report }],
    },
    isConcurrencySafe: () => true,
    async execute(args) {
      const profile = args.profile ?? 'web'
      const inventory = await readInventory(profile)
      const audit = await auditToolUsage(join(resolveDshHome(), 'sessions'))
      const attribution = await pluginToolMap(join(resolveDshHome(), 'profiles', profile), inventory.names)
      const attributedPlugins = new Set(attribution.values())
      const unusedPlugins = inventory.names.filter(name => attributedPlugins.has(name)
        && !audit.tools.some(tool => attribution.get(tool.tool) === name))
      const usage = audit.tools.map(tool => ({
        tool: tool.tool,
        plugin: attribution.get(tool.tool) ?? '(unattributed)',
        calls: tool.calls,
        sessions: tool.sessions,
        lastUsed: tool.lastUsed,
      }))
      const output: UsageAuditOutput = {
        report: renderUsageAudit(usage, unusedPlugins, audit.sessionsScanned, audit.skipped, profile, audit.note),
        usage,
        unusedPlugins,
        ...(inventory.note === undefined ? {} : { inventoryNote: inventory.note }),
      }
      return output
    },
    presentCall: args => ({ card: 'generic', title: 'Audit plugin usage', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'plugin_landscape',
    description:
      'Visualize the plugin landscape: a similarity relation graph (Mermaid, with a text fallback) '
      + 'and a tier classification of installed plugins — core / active / idle / review — combining '
      + 'real usage from session logs with irreplaceability from similarity analysis. Pass an intent '
      + 'to include community candidates in the graph; without one the view covers installed plugins.',
    parameters: {
      intent: {
        type: 'string',
        description: 'Optional natural-language need; matching community plugins join the relation graph.',
      },
      profile: {
        type: 'string',
        description: 'Profile whose installs are analyzed. Defaults to "web".',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          report: { type: 'string', required: true },
          tiers: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                tier: { type: 'string', enum: ['core', 'active', 'idle', 'review', 'unattributed'], required: true },
                reason: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: (value as LandscapeOutput).report }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const profile = args.profile ?? 'web'
      const threshold = current().similarityThreshold ?? DEFAULT_THRESHOLD
      const inventory = await readInventory(profile)
      const installedRows = toPluginRows(inventory.names)
      const candidates = args.intent === undefined ? [] : (await searchWithToken(args.intent, {}, exec.signal)).plugins
      const combined = [...candidates, ...installedRows.filter(plugin => !candidates.some(candidate => candidate.name === plugin.name))]
      const report = analyze(combined, threshold)
      const audit = await auditToolUsage(join(resolveDshHome(), 'sessions'))
      const attribution = await pluginToolMap(join(resolveDshHome(), 'profiles', profile), inventory.names)
      const usage: PluginUsageSummary[] = inventory.names.map(name => {
        const tools = [...attribution.entries()].filter(([, owner]) => owner === name).map(([tool]) => tool)
        if (tools.length === 0) return { name }
        const entries = audit.tools.filter(tool => tools.includes(tool.tool))
        const calls = entries.reduce((sum, entry) => sum + entry.calls, 0)
        const newest = entries.reduce((max, entry) => Math.max(max, Date.parse(entry.lastUsed)), 0)
        return { name, calls, daysSinceUse: Number.isNaN(newest) ? undefined : Math.max(0, Math.round((Date.now() - newest) / 86_400_000)) }
      })
      // Installed plugins that also exist as community rows keep the richer
      // metadata (capabilities, stars, update time) for tiering.
      const installedWithMetadata = inventory.names
        .map(name => combined.find(plugin => plugin.name === name) ?? installedRows.find(plugin => plugin.name === name)!)
        .filter((plugin): plugin is CommunityPlugin => plugin !== undefined)
      const tiers = assignTiers(installedWithMetadata, usage, report)
      const output: LandscapeOutput = {
        report: renderLandscape(tiers, report, threshold, inventory.names, audit.sessionsScanned),
        tiers: tiers.map(tier => ({ name: tier.name, tier: tier.tier, reason: tier.reason })),
      }
      return output
    },
    presentCall: args => ({ card: 'generic', title: 'Visualize plugin landscape', kind: 'other', rawInput: args }),
  }))

  /**
   * Build the compared set for the similarity tool when no explicit list is
   * given: community candidates for the intent plus the profile's installs.
   */
  async function comparedSet(intent: string, profile: string, exec: ToolRunContext): Promise<CommunityPlugin[]> {
    const search = await searchWithToken(intent, {}, exec.signal)
    const inventory = await readInventory(profile)
    const installed = toPluginRows(inventory.names)
    return [...search.plugins, ...installed.filter(plugin => !search.plugins.some(candidate => candidate.name === plugin.name))]
  }
}

/** Markdown rendering of a community-search result. */
function renderSearch(value: SearchOutput): string {
  const lines = value.plugins.map(plugin =>
    `- **${plugin.name}** — ${plugin.description || '(no description)'} · ⭐ ${plugin.stars} · \`${plugin.installRef}\``)
  return [
    value.degraded === undefined ? '' : `> ${value.degraded}\n`,
    lines.length === 0 ? 'No community plugins matched.' : `Community plugins:\n${lines.join('\n')}`,
  ].filter(line => line !== '').join('\n')
}

/** Markdown rendering of a usage audit. */
function renderUsageAudit(
  usage: { tool: string; plugin: string; calls: number; sessions: number; lastUsed?: string }[],
  unusedPlugins: readonly string[],
  sessionsScanned: number,
  skipped: number,
  profile: string,
  note?: string,
): string {
  const lines = usage.map(entry =>
    `- \`${entry.tool}\` (${entry.plugin}) — ${entry.calls} call${entry.calls === 1 ? '' : 's'} in ${entry.sessions} session${entry.sessions === 1 ? '' : 's'}${entry.lastUsed !== undefined ? ` · last used ${entry.lastUsed.slice(0, 10)}` : ''}`)
  const unused = unusedPlugins.length === 0
    ? 'Every attributed plugin has recorded usage.'
    : unusedPlugins.map(name => `- \`${name}\` — its declared tools were never called:\n\n\`\`\`sh\ndsh plugin --profile ${profile} remove ${name}\n\`\`\``).join('\n')
  return [
    note ?? `Scanned ${sessionsScanned} session log${sessionsScanned === 1 ? '' : 's'}${skipped > 0 ? ` (skipped ${skipped} unreadable)` : ''}.`,
    '',
    usage.length > 0 ? `Tool usage:\n${lines.join('\n')}` : 'No tool calls recorded yet.',
    '',
    `Plugins with zero recorded usage:\n${unused}`,
    '',
    'Attribution follows each package\'s `dsh.tools` declaration; tools reading "(unattributed)" belong to plugins that have not declared it yet.',
  ].join('\n')
}

/** Markdown rendering of a similarity analysis. */
function renderAnalysis(analysis: SimilarityReport, threshold: number): string {
  const top = [...analysis.matrix].sort((x, y) => y.overall - x.overall).slice(0, 10)
    .map(cell => `- ${cell.a} ⇄ ${cell.b}: ${(cell.overall * 100).toFixed(0)}%`)
  const clusters = analysis.clusters.map(cluster =>
    `- ${cluster.members.join(', ')} (cohesion ${(cluster.cohesion * 100).toFixed(0)}%)`)
  const scores = analysis.irreplaceability.map(score =>
    `- ${score.name}: ${(score.score * 100).toFixed(0)}${score.reasons.length > 0 ? ` (${score.reasons.join('; ')})` : ''}`)
  return [
    `Similarity report (redundancy threshold ${Math.round(threshold * 100)}%):`,
    '',
    top.length > 0 ? `Top pairs:\n${top.join('\n')}` : 'No comparable pairs.',
    '',
    clusters.length > 0 ? `Redundancy clusters:\n${clusters.join('\n')}` : 'No redundancy clusters above threshold.',
    '',
    `Irreplaceability:\n${scores.join('\n')}`,
  ].join('\n')
}
