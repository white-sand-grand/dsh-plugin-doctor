/**
 * Shared vocabulary of the plugin-recommender tools.
 *
 * @module dsh-plugin-recommender/types
 */

/** Where a community plugin record came from; drives degradation reporting. */
export type PluginSource = 'github' | 'cache' | 'registry'

/** One community plugin as seen by the recommender. */
export interface CommunityPlugin {
  /** Package or repository short name, e.g. `dsh-plugin-memory`. */
  readonly name: string
  /** Full repository slug (`owner/repo`) or registry id when not on GitHub. */
  readonly repo: string
  /** Canonical install reference usable with `dsh plugin --profile <p> add <ref>`. */
  readonly installRef: string
  /** One-line functional description (repo description or README head). */
  readonly description: string
  /** First ~500 characters of the README, used for text similarity. */
  readonly readmeExcerpt: string
  /** Capability tags extracted from the README/repo metadata. */
  readonly capabilities: readonly string[]
  /** Declared plugin dependencies, when the README or metadata carries them. */
  readonly dependencies: readonly string[]
  /** GitHub stars, when known; registry records carry 0. */
  readonly stars: number
  /** Last-update ISO-8601 timestamp, when known. */
  readonly updatedAt: string
  /** Provenance of this record. */
  readonly source: PluginSource
}

/** Filters accepted by community search. */
export interface SearchFilters {
  /** Exclude repositories with fewer stars. */
  readonly minStars?: number
  /** Exclude repositories not updated within this many days. */
  readonly updatedWithinDays?: number
}

/** Result of one community search. */
export interface SearchResult {
  readonly plugins: readonly CommunityPlugin[]
  /** Set when the live GitHub API was unavailable and a fallback served data. */
  readonly degraded?: string
}

/** One cell of the similarity matrix. */
export interface SimilarityCell {
  readonly a: string
  readonly b: string
  /** Overall similarity in [0, 1]; weighted blend of text, capabilities, dependencies. */
  readonly overall: number
  /** TF-IDF cosine similarity over name + description + README excerpt. */
  readonly textCosine: number
  /** Jaccard overlap of capability tags. */
  readonly capabilityJaccard: number
  /** Jaccard overlap of dependency lists (shared dependencies pull plugins together). */
  readonly dependencyJaccard: number
}

/** A group of plugins whose pairwise similarity exceeds the threshold. */
export interface RedundancyCluster {
  readonly members: readonly string[]
  /** Minimum pairwise overall similarity inside the cluster. */
  readonly cohesion: number
}

/** Irreplaceability assessment of one plugin within a compared set. */
export interface Irreplaceability {
  readonly name: string
  /** Score in [0, 1]: unique capabilities, stars, maintenance recency. */
  readonly score: number
  /** Human-readable drivers of the score. */
  readonly reasons: readonly string[]
}

/** Full similarity-analysis report. */
export interface SimilarityReport {
  readonly matrix: readonly SimilarityCell[]
  readonly clusters: readonly RedundancyCluster[]
  readonly irreplaceability: readonly Irreplaceability[]
}

/** Which decision branch `plugin_recommend` took. */
export type RecommendBranch = 'recommend' | 'dedupe' | 'spec'

/** The `plugin_recommend` tool's structured result. */
export interface RecommendResult {
  readonly branch: RecommendBranch
  /** Markdown report suitable for rendering in the DSH Web UI. */
  readonly report: string
  /** Plugins suggested for removal in the `dedupe` branch. */
  readonly removals: readonly string[]
}
