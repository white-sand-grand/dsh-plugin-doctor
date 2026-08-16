/**
 * Lightweight similarity analysis: TF-IDF-weighted cosine over text fields,
 * Jaccard overlap over capability tags and dependency lists, redundancy
 * clustering, and irreplaceability scoring. Pure functions over
 * {@link CommunityPlugin}-shaped inputs so tests need no network.
 *
 * @module dsh-plugin-doctor/similarity
 */
import type { CommunityPlugin, Irreplaceability, RedundancyCluster, SimilarityCell, SimilarityReport } from './types.ts';
/**
 * Compute pairwise similarity over a compared set.
 * @param plugins - the compared plugins (community candidates, local installs, or both).
 * @returns every unordered pair's scored cell.
 */
export declare function similarityMatrix(plugins: readonly CommunityPlugin[]): SimilarityCell[];
/**
 * Group plugins whose pairwise overall similarity exceeds the threshold.
 * Clusters are greedy maximal cliques grown from the strongest remaining edge.
 * @param plugins - the compared set.
 * @param matrix - pairwise cells from {@link similarityMatrix}.
 * @param threshold - overall-similarity level above which plugins are redundant.
 */
export declare function redundancyClusters(plugins: readonly CommunityPlugin[], matrix: readonly SimilarityCell[], threshold: number): RedundancyCluster[];
/**
 * Score each plugin's irreplaceability within the compared set: unique
 * capability share, relative stars, and maintenance recency.
 * @param plugins - the compared set.
 */
export declare function irreplaceabilityScores(plugins: readonly CommunityPlugin[]): Irreplaceability[];
/**
 * Run the full similarity analysis over a compared set.
 * @param plugins - community candidates plus local installs, as one set.
 * @param threshold - redundancy-cluster threshold in [0, 1].
 */
export declare function analyze(plugins: readonly CommunityPlugin[], threshold: number): SimilarityReport;
