/**
 * Lightweight similarity analysis: TF-IDF-weighted cosine over text fields,
 * Jaccard overlap over capability tags and dependency lists, redundancy
 * clustering, and irreplaceability scoring. Pure functions over
 * {@link CommunityPlugin}-shaped inputs so tests need no network.
 *
 * @module dsh-plugin-recommender/similarity
 */

import type {
  CommunityPlugin,
  Irreplaceability,
  RedundancyCluster,
  SimilarityCell,
  SimilarityReport,
} from './types.ts'

/** Weight of TF-IDF text cosine in the overall score. */
const TEXT_WEIGHT = 0.6
/** Weight of capability-tag Jaccard in the overall score. */
const CAPABILITY_WEIGHT = 0.25
/** Weight of dependency Jaccard in the overall score. */
const DEPENDENCY_WEIGHT = 0.15

/** Text fields of a plugin merged into the similarity document. */
function documentOf(plugin: CommunityPlugin): string {
  return `${plugin.name} ${plugin.description} ${plugin.readmeExcerpt} ${plugin.capabilities.join(' ')}`
}

/**
 * Term frequencies of a lowercased, stopword-filtered token bag.
 * @param text - free-form text.
 */
function termFrequency(text: string): Map<string, number> {
  const stopwords = new Set(['a', 'an', 'the', 'and', 'or', 'for', 'with', 'that', 'this', 'to', 'of', 'in', 'on', 'it', 'is', 'are'])
  const counts = new Map<string, number>()
  for (const token of text.toLowerCase().split(/[^a-z0-9+#]+/)) {
    if (token.length <= 1 || stopwords.has(token)) continue
    counts.set(token, (counts.get(token) ?? 0) + 1)
  }
  return counts
}

/**
 * Inverse document frequency of one term across all documents.
 * @param term - the term.
 * @param documents - token bags of the compared set.
 */
function idf(term: string, documents: readonly Map<string, number>[]): number {
  const df = documents.filter(doc => doc.has(term)).length
  return Math.log((documents.length + 1) / (df + 1)) + 1
}

/**
 * TF-IDF cosine similarity of two documents within a corpus.
 * @param docs - token bags of both plugins.
 * @returns similarity in [0, 1].
 */
function tfidfCosine(docs: readonly [Map<string, number>, Map<string, number>], corpus: readonly Map<string, number>[]): number {
  const weight = (doc: Map<string, number>, term: string): number => (doc.get(term) ?? 0) * idf(term, corpus)
  let dot = 0
  let normA = 0
  let normB = 0
  for (const [term, count] of docs[0]) {
    const w = count * idf(term, corpus)
    normA += w * w
    dot += w * weight(docs[1], term)
  }
  for (const [term, count] of docs[1]) {
    const w = count * idf(term, corpus)
    normB += w * w
  }
  return normA === 0 || normB === 0 ? 0 : dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * Jaccard overlap of two string sets.
 * @param a - first set.
 * @param b - second set.
 * @returns |a ∩ b| / |a ∪ b|, or 0 when both sets are empty.
 */
function jaccard(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 0
  const setA = new Set(a)
  const setB = new Set(b)
  let intersection = 0
  for (const item of setA) if (setB.has(item)) intersection++
  const union = setA.size + setB.size - intersection
  return union === 0 ? 0 : intersection / union
}

/**
 * Compute pairwise similarity over a compared set.
 * @param plugins - the compared plugins (community candidates, local installs, or both).
 * @returns every unordered pair's scored cell.
 */
export function similarityMatrix(plugins: readonly CommunityPlugin[]): SimilarityCell[] {
  const corpus = plugins.map(plugin => termFrequency(documentOf(plugin)))
  const cells: SimilarityCell[] = []
  for (let i = 0; i < plugins.length; i++) {
    for (let j = i + 1; j < plugins.length; j++) {
      const textCosine = tfidfCosine([corpus[i]!, corpus[j]!], corpus)
      const capabilityJaccard = jaccard(plugins[i]!.capabilities, plugins[j]!.capabilities)
      const dependencyJaccard = jaccard(plugins[i]!.dependencies, plugins[j]!.dependencies)
      cells.push({
        a: plugins[i]!.name,
        b: plugins[j]!.name,
        overall: TEXT_WEIGHT * textCosine + CAPABILITY_WEIGHT * capabilityJaccard + DEPENDENCY_WEIGHT * dependencyJaccard,
        textCosine,
        capabilityJaccard,
        dependencyJaccard,
      })
    }
  }
  return cells
}

/**
 * Group plugins whose pairwise overall similarity exceeds the threshold.
 * Clusters are greedy maximal cliques grown from the strongest remaining edge.
 * @param plugins - the compared set.
 * @param matrix - pairwise cells from {@link similarityMatrix}.
 * @param threshold - overall-similarity level above which plugins are redundant.
 */
export function redundancyClusters(
  plugins: readonly CommunityPlugin[],
  matrix: readonly SimilarityCell[],
  threshold: number,
): RedundancyCluster[] {
  const edges = matrix.filter(cell => cell.overall > threshold).sort((x, y) => y.overall - x.overall)
  const clustered = new Set<string>()
  const clusters: RedundancyCluster[] = []
  for (const edge of edges) {
    if (clustered.has(edge.a) || clustered.has(edge.b)) continue
    const members = new Set<string>([edge.a, edge.b])
    let cohesion = edge.overall
    for (const plugin of plugins) {
      if (clustered.has(plugin.name) || members.has(plugin.name)) continue
      const linked = edges.some(link =>
        (link.a === plugin.name && members.has(link.b)) || (link.b === plugin.name && members.has(link.a)))
      if (linked) members.add(plugin.name)
    }
    for (const member of members) clustered.add(member)
    clusters.push({ members: [...members], cohesion })
  }
  return clusters
}

/**
 * Score each plugin's irreplaceability within the compared set: unique
 * capability share, relative stars, and maintenance recency.
 * @param plugins - the compared set.
 */
export function irreplaceabilityScores(plugins: readonly CommunityPlugin[]): Irreplaceability[] {
  const maxStars = Math.max(0, ...plugins.map(plugin => plugin.stars))
  const now = Date.now()
  return plugins.map(plugin => {
    const reasons: string[] = []
    const allCapabilities = new Set(plugins.flatMap(other => other.capabilities))
    const unique = plugin.capabilities.filter(capability => capability.length > 0
      && !plugins.some(other => other !== plugin && other.capabilities.includes(capability)))
    const uniqueShare = allCapabilities.size === 0 ? 0.5 : unique.length / allCapabilities.size
    if (unique.length > 0) reasons.push(`unique capabilities: ${unique.join(', ')}`)
    const starScore = maxStars === 0 ? 0.5 : plugin.stars / maxStars
    if (plugin.stars > 0) reasons.push(`${plugin.stars} stars`)
    const ageDays = plugin.updatedAt.length === 0 ? Number.NaN : (now - Date.parse(plugin.updatedAt)) / 86_400_000
    const freshness = Number.isNaN(ageDays) ? 0.5 : Math.max(0, 1 - ageDays / 365)
    if (!Number.isNaN(ageDays) && ageDays <= 90) reasons.push(`updated ${Math.round(ageDays)} days ago`)
    if (!Number.isNaN(ageDays) && ageDays > 365) reasons.push(`not updated for over a year`)
    const score = 0.5 * uniqueShare + 0.3 * starScore + 0.2 * freshness
    return { name: plugin.name, score, reasons }
  }).sort((x, y) => y.score - x.score)
}

/**
 * Run the full similarity analysis over a compared set.
 * @param plugins - community candidates plus local installs, as one set.
 * @param threshold - redundancy-cluster threshold in [0, 1].
 */
export function analyze(plugins: readonly CommunityPlugin[], threshold: number): SimilarityReport {
  const matrix = similarityMatrix(plugins)
  return {
    matrix,
    clusters: redundancyClusters(plugins, matrix, threshold),
    irreplaceability: irreplaceabilityScores(plugins),
  }
}
