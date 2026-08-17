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
  plugins: readonly CommunityPlugin[] = [],
): string {
  const installed = new Set(installedNames)
  const metadata = new Map(plugins.map(plugin => [plugin.name, plugin]))
  const nodes = [...new Set(matrix.flatMap(cell => [cell.a, cell.b]))]
    .concat(installedNames.filter(name => !matrix.some(cell => cell.a === name || cell.b === name)))
  const ids = new Map(nodes.map((name, index) => [name, `n${index}`]))
  const edges = matrix
    .filter(cell => cell.overall > threshold)
    .sort((x, y) => y.overall - x.overall)
    .slice(0, MAX_GRAPH_EDGES)
  const lines = [
    'graph LR',
    '  %% DSH plugin relation map: installed nodes are filled; candidates are outlined',
  ]
  for (const name of nodes) {
    const id = ids.get(name)!
    const plugin = metadata.get(name)
    const summary = functionSummaryZh(plugin)
    const label = `${escapeMermaid(name)}<br/>${escapeMermaid(summary.slice(0, 54))}`
    lines.push(installed.has(name) ? `  ${id}["${label}"]` : `  ${id}("${label}")`)
  }
  for (const cell of edges) {
    const reasons = similarityReasons(cell)
    lines.push(`  ${ids.get(cell.a)!} ---|"${Math.round(cell.overall * 100)}% · ${reasons}"| ${ids.get(cell.b)!}`)
  }
  lines.push(
    '  classDef installed fill:#183a52,stroke:#57c7d4,color:#f4fbff,stroke-width:2px',
    '  classDef candidate fill:#202735,stroke:#8492a6,color:#e7edf5,stroke-dasharray:5 4',
  )
  for (const name of nodes) lines.push(`  class ${ids.get(name)!} ${installed.has(name) ? 'installed' : 'candidate'}`)
  return ['```mermaid', ...lines, '```'].join('\n')
}

/** Escape text embedded in a quoted Mermaid node label. */
function escapeMermaid(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/[\r\n]+/g, ' ')
}

/** Convert common plugin metadata into a short Chinese function summary. */
function functionSummaryZh(plugin: CommunityPlugin | undefined): string {
  if (plugin === undefined) return '功能说明暂缺'
  const text = `${plugin.name} ${plugin.description} ${plugin.capabilities.join(' ')}`.toLowerCase()
  const labels = [
    [/doctor|diagnos|health|guard/, '插件诊断、冲突检查与安装预检'],
    [/web.ui|frontend|skin|theme/, '扩展 Web 界面、主题与交互功能'],
    [/ssh|sftp|remote/, '远程连接、命令执行与文件传输'],
    [/genui|generative.ui|chart|mermaid/, '生成并展示图表、表单和交互式界面'],
    [/modlens|module|dependency/, '分析模块结构与依赖关系'],
    [/at.file|file.reference|attachment/, '识别并引用工作区文件'],
    [/search|fetch|browser/, '联网搜索与网页内容读取'],
    [/session|history|memory/, '会话历史、记忆与上下文管理'],
    [/task|todo|board/, '任务、待办和进度管理'],
    [/base|core|harness/, '提供 DSH 核心运行能力'],
  ].filter(([pattern]) => (pattern as RegExp).test(text)).map(([, label]) => label as string)
  if (labels.length > 0) return [...new Set(labels)].slice(0, 2).join('；')
  if (plugin.description.length > 0) return `功能：${plugin.description}`
  return '功能说明暂缺'
}

/** Explain the weighted dimensions that make one edge strong. */
function similarityReasons(cell: SimilarityCell): string {
  const reasons: string[] = []
  if (cell.textCosine >= 0.35) reasons.push('说明相近')
  if (cell.capabilityJaccard > 0) reasons.push(`功能重叠${Math.round(cell.capabilityJaccard * 100)}%`)
  if (cell.dependencyJaccard > 0) reasons.push(`依赖重叠${Math.round(cell.dependencyJaccard * 100)}%`)
  return reasons.length > 0 ? reasons.join('、') : '综合相似'
}

/** Render a Chinese, scan-friendly explanation for the strongest relations. */
export function renderSimilarityDetails(
  matrix: readonly SimilarityCell[],
  plugins: readonly CommunityPlugin[],
  threshold: number,
): string {
  const metadata = new Map(plugins.map(plugin => [plugin.name, plugin]))
  const pairs = [...matrix].filter(cell => cell.overall > threshold).sort((a, b) => b.overall - a.overall).slice(0, MAX_GRAPH_EDGES)
  if (pairs.length === 0) return '当前没有超过阈值的插件关系。'
  return pairs.map(cell => {
    const left = metadata.get(cell.a)
    const right = metadata.get(cell.b)
    const leftDescription = functionSummaryZh(left)
    const rightDescription = functionSummaryZh(right)
    return `- **${cell.a}**：${leftDescription}；**${cell.b}**：${rightDescription}。相似度 **${Math.round(cell.overall * 100)}%**，${similarityReasons(cell)}。`
  }).join('\n')
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
  plugins: readonly CommunityPlugin[],
  sessionsScanned: number,
): string {
  const tierLines = tiers.map(entry => `- **${entry.name}** — ${entry.tier} (${entry.reason})`)
  const strongest = [...report.matrix].sort((x, y) => y.overall - x.overall).slice(0, 5)
    .map(cell => `- ${cell.a} ⇄ ${cell.b}: ${(cell.overall * 100).toFixed(0)}%`)
  return [
    `插件关系总览（扫描 ${sessionsScanned} 个会话日志，关系阈值 ${Math.round(threshold * 100)}%）`,
    '',
    '## Tiers',
    '',
    ...tierLines,
    '',
    '## 插件相似度关系图',
    '',
    renderMermaidGraph(installedNames, report.matrix, threshold, plugins),
    '',
    '## 为什么相似',
    '',
    renderClusterTree(report.clusters),
    '',
    renderSimilarityDetails(report.matrix, plugins, threshold),
    '',
    strongest.length > 0 ? `Top similarity pairs:\n${strongest.join('\n')}` : '',
  ].filter(line => line !== '').join('\n')
}
