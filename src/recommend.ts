/**
 * Three-branch recommendation decision: (1) community has well-matching
 * plugins — recommend the best; (2) matches exist but overlap heavily with
 * local installs — suggest which to keep and which to remove; (3) nothing
 * matches — emit a Plugin Spec for building it yourself.
 *
 * @module dsh-plugin-recommender/recommend
 */

import { analyze } from './similarity.ts'
import { renderPluginSpec, suggestPluginName } from './spec.ts'
import type { CommunityPlugin, RecommendResult, SearchResult } from './types.ts'

/**
 * Consider a candidate relevant to the intent when its keyword-overlap score
 * against the tokenized intent reaches this level; below it, branch 3 applies.
 */
const RELEVANCE_FLOOR = 0.5

/** Tokens of the intent used for the relevance gate. */
function intentTokens(intent: string): string[] {
  const stopwords = new Set(['a', 'an', 'the', 'i', 'need', 'want', 'plugin', 'for', 'that', 'can', 'to', 'of', 'and', 'with', 'me', 'my', 'dsh'])
  return intent.toLowerCase().split(/[^a-z0-9+#-]+/).flatMap(token => token.split('-'))
    .filter(token => token.length > 1 && !stopwords.has(token))
}

/** Keyword-overlap relevance of one plugin to the intent, in [0, 1]. */
function relevance(intent: string, plugin: CommunityPlugin): number {
  const tokens = intentTokens(intent)
  if (tokens.length === 0) return 0
  const haystack = `${plugin.name} ${plugin.description} ${plugin.readmeExcerpt} ${plugin.capabilities.join(' ')}`.toLowerCase()
  const hits = tokens.filter(token => haystack.includes(token)).length
  return hits / tokens.length
}

/**
 * Pick the cluster member to keep: highest irreplaceability (unique
 * capabilities, stars, freshness); already-installed wins only exact ties so
 * a clearly better candidate displaces a stale install.
 */
function pickKeeper(cluster: readonly string[], scores: readonly { name: string; score: number }[], installed: ReadonlySet<string>): { keep: string; remove: string } | undefined {
  const ranked = [...cluster].sort((x, y) => {
    const scoreDelta = (scores.find(score => score.name === y)?.score ?? 0) - (scores.find(score => score.name === x)?.score ?? 0)
    if (scoreDelta !== 0) return scoreDelta
    return Number(installed.has(y)) - Number(installed.has(x))
  })
  if (ranked.length < 2) return undefined
  return { keep: ranked[0]!, remove: ranked[1]! }
}

/**
 * Run the three-branch decision.
 * @param intent - the user requirement.
 * @param search - community search result for the intent.
 * @param installedPlugins - local installs projected into plugin rows.
 * @param threshold - redundancy similarity threshold in [0, 1].
 * @param profile - profile name used in rendered removal commands.
 */
export function recommend(
  intent: string,
  search: SearchResult,
  installedPlugins: readonly CommunityPlugin[],
  threshold: number,
  profile: string,
): RecommendResult {
  const header = search.degraded === undefined ? '' : `> Note: ${search.degraded}\n\n`
  const relevant = search.plugins.filter(plugin => plugin.description.length > 0 || plugin.capabilities.length > 0)
  const matching = relevant
    .map(plugin => ({ plugin, score: relevance(intent, plugin) }))
    .filter(entry => entry.score >= RELEVANCE_FLOOR)
    .sort((x, y) => y.score - x.score || y.plugin.stars - x.plugin.stars)

  if (matching.length === 0) {
    return {
      branch: 'spec',
      removals: [],
      report: header + renderPluginSpec(intent, relevant),
    }
  }

  const candidates = matching.map(entry => entry.plugin)
  const combined = [...candidates, ...installedPlugins.filter(plugin => !candidates.some(candidate => candidate.name === plugin.name))]
  const report = analyze(combined, threshold)
  const installedNames = new Set(installedPlugins.map(plugin => plugin.name))
  const overlappingClusters = report.clusters
    .map(cluster => ({ cluster, keeper: pickKeeper(cluster.members, report.irreplaceability, installedNames) }))
    .filter(entry => entry.keeper !== undefined)

  if (overlappingClusters.length > 0) {
    const removals: string[] = []
    const sections = overlappingClusters.map(({ cluster, keeper }) => {
      const overlapPct = Math.round(cluster.cohesion * 100)
      removals.push(keeper!.remove)
      const loser = combined.find(plugin => plugin.name === keeper!.remove)
      const winner = combined.find(plugin => plugin.name === keeper!.keep)
      const loserReasons = report.irreplaceability.find(score => score.name === keeper!.remove)?.reasons.join('; ') ?? ''
      const installLine = installedNames.has(keeper!.keep) || winner === undefined
        ? ''
        : `The keeper is not installed yet:\n\n\`\`\`sh\ndsh plugin --profile ${profile} add ${winner.installRef}\n\`\`\`\n`
      return [
        `### Redundancy: ${cluster.members.join(' ⇄ ')}`,
        '',
        `Overlap is **${overlapPct}%** (threshold ${Math.round(threshold * 100)}%). Keep **${keeper!.keep}**; remove **${keeper!.remove}**.`,
        loserReasons.length > 0 ? `Removal rationale: ${loserReasons}.` : '',
        `Install ref of the removal target: \`${loser?.installRef ?? keeper!.remove}\``,
        '',
        installLine,
        '```sh',
        `dsh plugin --profile ${profile} remove ${keeper!.remove}`,
        '```',
      ].filter(line => line !== '').join('\n')
    })
    return {
      branch: 'dedupe',
      removals,
      report: header + `Community matches exist but overlap heavily with your setup. Recommendation: de-duplicate.\n\n${sections.join('\n\n')}`,
    }
  }

  const best = matching.slice(0, 3)
  const lines = best.map((entry, index) => {
    const reasons = report.irreplaceability.find(score => score.name === entry.plugin.name)?.reasons.join('; ') ?? ''
    return [
      `### ${index + 1}. \`${entry.plugin.name}\` — match ${(entry.score * 100).toFixed(0)}%`,
      '',
      `- ${entry.plugin.description || '(no description)'}`,
      `- Install: \`${entry.plugin.installRef}\` · ⭐ ${entry.plugin.stars} · updated ${entry.plugin.updatedAt || 'unknown'}`,
      reasons.length > 0 ? `- Strengths: ${reasons}` : '',
    ].filter(line => line !== '').join('\n')
  })
  return {
    branch: 'recommend',
    removals: [],
    report: header
      + `Community has well-matching plugins for **${intent.trim()}**:\n\n${lines.join('\n\n')}\n\n`
      + `Install the top pick:\n\n\`\`\`sh\ndsh plugin --profile ${profile} add ${best[0]!.plugin.installRef}\n\`\`\``,
  }
}

export { suggestPluginName }
