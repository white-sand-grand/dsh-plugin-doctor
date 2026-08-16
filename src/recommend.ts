/**
 * Three-branch recommendation decision with an interactive confirmation
 * funnel: (1) community matches — recommend the best; (2) matches overlap
 * installed plugins — present the facts and let the user pick keep-remove /
 * consolidate-into-a-new-plugin / leave-as-is; (3) nothing matches — list
 * near-miss competitors and ask before generating a build-it-yourself spec.
 * Every spec-producing path runs only after the user explicitly opts in via
 * the {@link DecisionHooks.askChoice} hook; without the hook (no
 * user-questions seam) each path degrades to its non-interactive behavior.
 *
 * @module dsh-plugin-doctor/recommend
 */

import { analyze } from './similarity.ts'
import { renderIntegrationSpec, renderPluginSpec } from './spec.ts'
import type { AskChoiceHook } from './interaction.ts'
import type { CommunityPlugin, RecommendResult, SearchResult } from './types.ts'

/**
 * Consider a candidate relevant to the intent when its keyword-overlap score
 * against the tokenized intent reaches this level; below it, branch 3 applies.
 */
const RELEVANCE_FLOOR = 0.5

/**
 * Loose floor for the near-miss competitor list shown before asking whether
 * to self-develop: candidates scoring between this and {@link RELEVANCE_FLOOR}
 * are "similar but missing something".
 */
const RELEVANCE_FLOOR_LOOSE = 0.3

/** Interaction hooks; omit to force the degraded (non-interactive) paths. */
export interface DecisionHooks {
  /** One-choice prompt over the user-questions seam; `undefined` = degrade. */
  readonly askChoice?: AskChoiceHook
}

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

/** Intent keywords absent from a plugin — the "what it lacks" signal. */
function missingKeywords(intent: string, plugin: CommunityPlugin): string[] {
  const tokens = intentTokens(intent)
  const haystack = `${plugin.name} ${plugin.description} ${plugin.readmeExcerpt} ${plugin.capabilities.join(' ')}`.toLowerCase()
  return tokens.filter(token => !haystack.includes(token))
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
 * Run the interactive recommendation decision.
 * @param intent - the user requirement.
 * @param search - community search result for the intent.
 * @param installedPlugins - local installs projected into plugin rows.
 * @param threshold - redundancy similarity threshold in [0, 1].
 * @param profile - profile name used in rendered removal commands.
 * @param hooks - interaction hooks; omitted or lacking `askChoice` degrades.
 * @param signal - cancellation signal forwarded to user prompts.
 */
export async function recommend(
  intent: string,
  search: SearchResult,
  installedPlugins: readonly CommunityPlugin[],
  threshold: number,
  profile: string,
  hooks: DecisionHooks = {},
  signal: AbortSignal | undefined = undefined,
): Promise<RecommendResult> {
  const header = search.degraded === undefined ? '' : `> Note: ${search.degraded}\n\n`
  const relevant = search.plugins.filter(plugin => plugin.description.length > 0 || plugin.capabilities.length > 0)
  const matching = relevant
    .map(plugin => ({ plugin, score: relevance(intent, plugin) }))
    .filter(entry => entry.score >= RELEVANCE_FLOOR)
    .sort((x, y) => y.score - x.score || y.plugin.stars - x.plugin.stars)

  if (matching.length === 0) {
    return emptyCommunityBranch(intent, relevant, header, hooks, signal)
  }

  const candidates = matching.map(entry => entry.plugin)
  const combined = [...candidates, ...installedPlugins.filter(plugin => !candidates.some(candidate => candidate.name === plugin.name))]
  const report = analyze(combined, threshold)
  const installedNames = new Set(installedPlugins.map(plugin => plugin.name))
  const overlappingClusters = report.clusters.flatMap(cluster => {
    const keeper = pickKeeper(cluster.members, report.irreplaceability, installedNames)
    return keeper === undefined ? [] : [{ cluster, keeper }]
  })

  if (overlappingClusters.length > 0) {
    return dedupeBranch(intent, header, profile, hooks, signal, overlappingClusters, combined, report, installedNames, threshold)
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
    confirmed: false,
    actions: [],
    report: header
      + `Community has well-matching plugins for **${intent.trim()}**:\n\n${lines.join('\n\n')}\n\n`
      + `Install the top pick:\n\n\`\`\`sh\ndsh plugin --profile ${profile} add ${best[0]!.plugin.installRef}\n\`\`\``,
  }
}

/**
 * Branch 2: present redundancy facts, then ask the user to choose
 * keep-remove / consolidate / leave-as-is before any spec or command is
 * emitted. Without interaction the keep-remove outcome stands plus a hint.
 */
async function dedupeBranch(
  intent: string,
  header: string,
  profile: string,
  hooks: DecisionHooks,
  signal: AbortSignal | undefined,
  overlappingClusters: { cluster: { members: readonly string[]; cohesion: number }; keeper: { keep: string; remove: string } }[],
  combined: readonly CommunityPlugin[],
  report: { irreplaceability: readonly { name: string; score: number; reasons: readonly string[] }[] },
  installedNames: ReadonlySet<string>,
  threshold: number,
): Promise<RecommendResult> {
  const facts = overlappingClusters.map(({ cluster, keeper }) => {
    const overlapPct = Math.round(cluster.cohesion * 100)
    const loserReasons = report.irreplaceability.find(score => score.name === keeper.remove)?.reasons.join('; ') ?? ''
    const winner = combined.find(plugin => plugin.name === keeper.keep)
    const loser = combined.find(plugin => plugin.name === keeper.remove)
    return [
      `### Redundancy: ${cluster.members.join(' ⇄ ')}`,
      '',
      `Overlap is **${overlapPct}%** (threshold ${Math.round(threshold * 100)}%).`,
      `**${keeper.keep}** — ⭐ ${winner?.stars ?? 0}, updated ${winner?.updatedAt || 'unknown'}.`,
      `**${keeper.remove}** — ⭐ ${loser?.stars ?? 0}, updated ${loser?.updatedAt || 'unknown'}${loserReasons.length > 0 ? `; removal rationale: ${loserReasons}` : ''}.`,
      `Keep: \`${keeper.keep}\`; redundant: \`${keeper.remove}\`.`,
    ].join('\n')
  }).join('\n\n')

  const primary = overlappingClusters[0]!
  const choice = hooks.askChoice === undefined
    ? undefined
    : await hooks.askChoice(
      `Plugins overlap ${Math.round(primary.cluster.cohesion * 100)}%. Keep ${primary.keeper.keep} and remove ${primary.keeper.remove}, consolidate all of them into one new plugin, or leave as-is?`,
      'Plugin dedupe decision',
      [
        {
          key: 'keep',
          label: `Keep ${primary.keeper.keep}, remove ${primary.keeper.remove} (Recommended)`,
          description: 'Removes the weaker duplicate; the install ref is already known.',
        },
        {
          key: 'integrate',
          label: 'Consolidate into a new plugin',
          description: "Remove the duplicates and generate an integration spec absorbing every member's unique capabilities.",
        },
        {
          key: 'skip',
          label: 'Leave as-is',
          description: 'Record the finding, change nothing.',
        },
      ],
      signal,
    )

  if (choice === 'skip') {
    return {
      branch: 'dedupe',
      removals: [],
      confirmed: false,
      actions: [],
      report: header + `Redundancy found — you chose to leave it as-is. No changes made.\n\n${facts}`,
    }
  }

  if (choice === 'integrate') {
    const clusterPlugins = overlappingClusters
      .flatMap(({ cluster }) => cluster.members.map(member => combined.find(plugin => plugin.name === member)))
      .filter((plugin): plugin is CommunityPlugin => plugin !== undefined)
    const installedMembers = clusterPlugins.filter(plugin => installedNames.has(plugin.name))
    const removals = installedMembers.map(plugin => plugin.name)
    const removalBlock = removals.length === 0 ? ''
      : `Remove every installed member once the new plugin is ready:\n\n\`\`\`sh\n${
        removals.map(name => `dsh plugin --profile ${profile} remove ${name}`).join('\n')
      }\n\`\`\`\n`
    return {
      branch: 'integrate',
      removals,
      // Not execution-eligible: the consolidating replacement does not exist
      // yet, so members must stay until it does.
      confirmed: false,
      actions: [],
      report: header + `You chose to consolidate.\n\n${facts}\n\n${renderIntegrationSpec(intent, clusterPlugins)}\n\n${removalBlock}`,
    }
  }

  // 'keep' confirmed by the user, or interaction unavailable → same outcome,
  // differing in the hint and in whether the host may execute the mutations.
  const removals = overlappingClusters.map(({ keeper }) => keeper.remove)
  const keeperAdds = overlappingClusters
    .map(({ keeper }) => keeper.keep)
    .filter(name => !installedNames.has(name))
    .map(name => combined.find(plugin => plugin.name === name)?.installRef ?? name)
  const commands = removals.map(name => `dsh plugin --profile ${profile} remove ${name}`).join('\n')
  const installBlock = keeperAdds.length === 0 ? '' : `\n\nThe keeper is not installed yet:\n\n\`\`\`sh\n${
    keeperAdds.map(spec => `dsh plugin --profile ${profile} add ${spec}`).join('\n')
  }\n\`\`\``
  const hint = choice === 'keep' ? '' : '\nTo consolidate these into one purpose-built plugin instead, just say so.\n'
  return {
    branch: 'dedupe',
    removals,
    confirmed: choice === 'keep',
    actions: choice === 'keep'
      ? [
          ...keeperAdds.map(spec => ({ kind: 'add' as const, spec })),
          ...removals.map(name => ({ kind: 'remove' as const, spec: name })),
        ]
      : [],
    report: header
      + (choice === 'keep' ? 'Confirmed by you: de-duplicate.\n\n' : 'Community matches exist but overlap heavily with your setup. Recommendation: de-duplicate.\n\n')
      + `${facts}\n\nKeep the winner, remove the rest:\n\n\`\`\`sh\n${commands}\n\`\`\`${installBlock}${hint}`,
  }
}

/**
 * Branch 3: list near-miss competitors (similar but missing intent keywords),
 * ask whether to self-develop, and only then emit the Plugin Spec. Without
 * interaction the spec is emitted directly (the pre-v0.2 behavior).
 */
async function emptyCommunityBranch(
  intent: string,
  relevant: readonly CommunityPlugin[],
  header: string,
  hooks: DecisionHooks,
  signal: AbortSignal | undefined,
): Promise<RecommendResult> {
  const nearMisses = relevant
    .map(plugin => ({ plugin, score: relevance(intent, plugin) }))
    .filter(entry => entry.score >= RELEVANCE_FLOOR_LOOSE && entry.score < RELEVANCE_FLOOR)
    .sort((x, y) => y.score - x.score)
    .slice(0, 5)
  const competitorList = nearMisses.map(({ plugin }) => {
    const missing = missingKeywords(intent, plugin)
    return `- \`${plugin.name}\` — ${plugin.description || '(no description)'}${missing.length > 0 ? `; missing from it: ${missing.join(', ')}` : ''}`
  })

  const choice = hooks.askChoice === undefined || nearMisses.length === 0
    ? undefined
    : await hooks.askChoice(
      'No community plugin matches. The closest competitors miss part of what you need. Develop a new plugin yourself?',
      'Self-development decision',
      [
        {
          key: 'build',
          label: 'Yes, generate the development spec (Recommended)',
          description: 'Produces a complete Plugin Spec: name, capabilities, dependencies, pseudocode.',
        },
        {
          key: 'abort',
          label: 'No, keep the competitor list only',
          description: 'No spec is generated; the near-miss list stays for reference.',
        },
      ],
      signal,
    )

  if (choice === 'abort') {
    return {
      branch: 'none',
      removals: [],
      confirmed: false,
      actions: [],
      report: header
        + `No community plugin matched **${intent.trim()}** — you chose not to self-develop.\n\n`
        + (competitorList.length > 0 ? `Closest competitors kept for reference:\n${competitorList.join('\n')}` : 'No near-miss competitors exist either.'),
    }
  }

  const spec = renderPluginSpec(intent, relevant)
  const prelude = choice === 'build'
    ? `No community plugin matched **${intent.trim()}** — confirmed by you, here is the development spec.`
    : `No community plugin matched **${intent.trim()}**. The recommendation is to develop a new plugin. Suggested specification:`
  const nearMissBlock = competitorList.length > 0 ? `Closest competitors (and what they lack):\n${competitorList.join('\n')}\n\n` : ''
  return {
    branch: 'spec',
    removals: [],
    confirmed: false,
    actions: [],
    report: header + `${prelude}\n\n${nearMissBlock}${spec}`,
  }
}
