/**
 * Plugin landscape: tier classification and relationship visualization.
 * Tiers combine real usage (from the session-log audit) with irreplaceability
 * (from similarity analysis over installed + community metadata): `core`
 * (heavily used or used-and-unique), `active` (some usage), `idle` (declared
 * tools, zero calls), `review` (idle plus weak community standing — stale or
 * redundant). The relation graph renders as Mermaid with a text fallback
 * tree, so reports stay readable in surfaces that do not render Mermaid.
 * Pure functions over data passed in; no I/O.
 *
 * @module dsh-plugin-doctor/landscape
 */

import type { CommunityPlugin, RedundancyCluster, SimilarityCell, SimilarityReport } from './types.ts'

/** Landscape tier of one installed plugin. */
export type LandscapeTier = 'core' | 'active' | 'idle' | 'review' | 'unattributed'

/** One installed plugin's tier verdict. */
export interface TieredPlugin {
  readonly name: string
  readonly tier: LandscapeTier
  /** Human-readable driver of the tier. */
  readonly reason: string
}

/** Usage numbers relevant to tiering, per plugin. */
export interface PluginUsageSummary {
  readonly name: string
  /** Total recorded tool calls, or `undefined` when usage cannot be measured. */
  readonly calls?: number
  /** Days since the newest recorded call; `undefined` alongside `calls`. */
  readonly daysSinceUse?: number
}

/** Calls at or above this level marks a plugin core on volume alone. */
const CORE_CALLS = 10

/** Irreplaceability at or above this level makes a used plugin core. */
const CORE_IRREPLACEABILITY = 0.7

/** Days after which a used plugin reads as stale. */
const STALE_DAYS = 90

/** Maximum edges drawn in the Mermaid graph, strongest first. */
const MAX_GRAPH_EDGES = 15

/**
 * Assign landscape tiers to installed plugins.
 * @param installed - installed plugin rows (community metadata merged where known).
 * @param usage - per-plugin usage summaries keyed by name.
 * @param report - similarity analysis over installed plus community rows.
 */
export function assignTiers(
  installed: readonly CommunityPlugin[],
  usage: readonly PluginUsageSummary[],
  report: SimilarityReport,
): TieredPlugin[] {
  const usageByName = new Map(usage.map(entry => [entry.name, entry]))
  const irreplaceabilityByName = new Map(report.irreplaceability.map(entry => [entry.name, entry.score]))
  const clustered = new Set(report.clusters.flatMap(cluster => cluster.members))
  return installed.map((plugin): TieredPlugin => {
    const use = usageByName.get(plugin.name)
    if (use === undefined || use.calls === undefined) {
      return { name: plugin.name, tier: 'unattributed', reason: 'no `dsh.tools` declaration — usage cannot be measured' }
    }
    const irreplaceability = irreplaceabilityByName.get(plugin.name) ?? 0
    if (use.calls === 0) {
      const reasons = ['declared tools never called']
      const stale = plugin.updatedAt.length > 0 && Date.now() - Date.parse(plugin.updatedAt) > 365 * 86_400_000
      if (stale) reasons.push('not updated for over a year')
      if (clustered.has(plugin.name)) reasons.push('redundant with another plugin')
      const tier = stale || clustered.has(plugin.name) ? 'review' : 'idle'
      return { name: plugin.name, tier, reason: reasons.join('; ') }
    }
    if (use.calls >= CORE_CALLS) {
      return { name: plugin.name, tier: 'core', reason: `${use.calls} recorded calls` }
    }
    if (irreplaceability >= CORE_IRREPLACEABILITY) {
      return { name: plugin.name, tier: 'core', reason: `used and hard to replace (irreplaceability ${(irreplaceability * 100).toFixed(0)}%)` }
    }
    const staleness = use.daysSinceUse !== undefined && use.daysSinceUse > STALE_DAYS ? ` · last used ${use.daysSinceUse} days ago` : ''
    return { name: plugin.name, tier: 'active', reason: `${use.calls} recorded calls${staleness}` }
  }).sort((x, y) => tierRank(x.tier) - tierRank(y.tier) || x.name.localeCompare(y.name))
}

/** Display order: core first, review last. */
function tierRank(tier: LandscapeTier): number {
  return { core: 0, active: 1, idle: 2, unattributed: 3, review: 4 }[tier]
}

/**
 * Render the similarity relation graph as a Mermaid block: installed plugins
 * as plain nodes, community candidates as dashed nodes, edges labeled with
 * the overall similarity percent. Edges are capped strongest-first so large
 * landscapes stay readable.
 * @param installedNames - names of locally installed plugins.
 * @param matrix - pairwise similarity cells.
 * @param threshold - only edges above this overall similarity are drawn.
 */
export function renderMermaidGraph(
  installedNames: readonly string[],
  matrix: readonly SimilarityCell[],
  threshold: number,
): string {
  const installed = new Set(installedNames)
  const nodes = [...new Set(matrix.flatMap(cell => [cell.a, cell.b]))]
    .concat(installedNames.filter(name => !matrix.some(cell => cell.a === name || cell.b === name)))
  const ids = new Map(nodes.map((name, index) => [name, `n${index}`]))
  const edges = matrix
    .filter(cell => cell.overall > threshold)
    .sort((x, y) => y.overall - x.overall)
    .slice(0, MAX_GRAPH_EDGES)
  const lines = ['graph LR']
  for (const name of nodes) {
    const id = ids.get(name)!
    lines.push(installed.has(name) ? `  ${id}["${name}"]` : `  ${id}("${name}")`)
  }
  for (const cell of edges) {
    lines.push(`  ${ids.get(cell.a)!} ---|"${Math.round(cell.overall * 100)}%"| ${ids.get(cell.b)!}`)
  }
  return ['```mermaid', ...lines, '```'].join('\n')
}

/**
 * Render redundancy clusters as an indented text list — the fallback view for
 * surfaces that do not render Mermaid.
 * @param clusters - redundancy clusters from the similarity analysis.
 */
export function renderClusterTree(clusters: readonly RedundancyCluster[]): string {
  if (clusters.length === 0) return 'No redundancy clusters above the threshold.'
  return clusters.map(cluster =>
    `- cluster (${(cluster.cohesion * 100).toFixed(0)}% cohesion)\n${cluster.members.map(member => `  - ${member}`).join('\n')}`).join('\n')
}

/**
 * Compose the full landscape report.
 * @param tiers - tiered installed plugins.
 * @param report - similarity analysis over installed plus community rows.
 * @param threshold - redundancy threshold used.
 * @param sessionsScanned - session logs the usage numbers came from.
 */
export function renderLandscape(
  tiers: readonly TieredPlugin[],
  report: SimilarityReport,
  threshold: number,
  installedNames: readonly string[],
  sessionsScanned: number,
): string {
  const tierLines = tiers.map(entry => `- **${entry.name}** — ${entry.tier} (${entry.reason})`)
  const strongest = [...report.matrix].sort((x, y) => y.overall - x.overall).slice(0, 5)
    .map(cell => `- ${cell.a} ⇄ ${cell.b}: ${(cell.overall * 100).toFixed(0)}%`)
  return [
    `Plugin landscape (usage from ${sessionsScanned} session log${sessionsScanned === 1 ? '' : 's'}, redundancy threshold ${Math.round(threshold * 100)}%):`,
    '',
    '## Tiers',
    '',
    ...tierLines,
    '',
    '## Relation graph (Mermaid)',
    '',
    renderMermaidGraph(installedNames, report.matrix, threshold),
    '',
    '## Redundancy clusters (text fallback)',
    '',
    renderClusterTree(report.clusters),
    '',
    strongest.length > 0 ? `Top similarity pairs:\n${strongest.join('\n')}` : '',
  ].filter(line => line !== '').join('\n')
}
