/**
 * `dsh-plugin-recommender` — three Agent-facing tools over the DSH community
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
 * @module dsh-plugin-recommender
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { CommunitySource } from './github.ts'
import type { WebFetchLike } from './http.ts'
import { readInventory, toPluginRows } from './inventory.ts'
import { recommend } from './recommend.ts'
import { analyze } from './similarity.ts'
import type { CommunityPlugin, SearchFilters, SearchResult, SimilarityReport } from './types.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'plugin-recommender'

/** The tool registry is the only hard seam; the web capability is used when present. */
export const inject = ['tools']

const DEFAULT_TOKEN_ENV = 'DSH_PLUGIN_RECOMMENDER_GITHUB_TOKEN'
const DEFAULT_THRESHOLD = 0.8
const DEFAULT_TTL_MINUTES = 30

/** Plugin configuration; every deployment-varying choice is a validated field. */
export interface Config {
  /** GitHub PAT (optional) raising the API rate limit; prefer {@link githubTokenEnv}. */
  githubToken?: string
  /** Credential reference resolved per request; defaults to `DSH_PLUGIN_RECOMMENDER_GITHUB_TOKEN`. */
  githubTokenEnv?: string
  /** Overall similarity above which two plugins are redundant. Defaults to 0.8. */
  similarityThreshold?: number
  /** Community-listing cache lifetime in minutes. Defaults to 30. */
  cacheTtlMinutes?: number
  /** Serve the built-in third-party registry snapshot when GitHub is unavailable. */
  enableRegistryFallback?: boolean
}

export const Config: z<Config> = z.object({
  githubToken: z.string().role('secret'),
  githubTokenEnv: z.string().role('credential-ref').default(DEFAULT_TOKEN_ENV),
  similarityThreshold: z.number().min(0).max(1).default(DEFAULT_THRESHOLD),
  cacheTtlMinutes: z.number().step(1).min(1).default(DEFAULT_TTL_MINUTES),
  enableRegistryFallback: z.boolean().default(true),
})

/** Settings namespace carrying the recommender's user-tunable section. */
const SETTINGS_NAMESPACE = settingsNamespace('plugin-recommender')

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
  branch: 'recommend' | 'dedupe' | 'spec'
  report: string
  removals: string[]
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
      + 'has nothing suitable, generate a Plugin Spec for building it. Returns a Markdown report.',
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
          branch: { type: 'string', enum: ['recommend', 'dedupe', 'spec'], required: true },
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
      const decision = recommend(args.intent, search, toPluginRows(inventory.names), current().similarityThreshold ?? DEFAULT_THRESHOLD, profile)
      const output: RecommendOutput = {
        branch: decision.branch,
        report: inventory.note === undefined ? decision.report : `> Local inventory: ${inventory.note}\n\n${decision.report}`,
        removals: [...decision.removals],
      }
      return output
    },
    presentCall: args => ({ card: 'generic', title: 'Recommend a plugin decision', kind: 'other', rawInput: args }),
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
