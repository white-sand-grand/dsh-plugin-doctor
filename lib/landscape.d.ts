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
import type { CommunityPlugin, RedundancyCluster, SimilarityCell, SimilarityReport } from './types.ts';
/** Landscape tier of one installed plugin. */
export type LandscapeTier = 'core' | 'active' | 'idle' | 'review' | 'unattributed';
/** One installed plugin's tier verdict. */
export interface TieredPlugin {
    readonly name: string;
    readonly tier: LandscapeTier;
    /** Human-readable driver of the tier. */
    readonly reason: string;
}
/** Usage numbers relevant to tiering, per plugin. */
export interface PluginUsageSummary {
    readonly name: string;
    /** Total recorded tool calls, or `undefined` when usage cannot be measured. */
    readonly calls?: number;
    /** Days since the newest recorded call; `undefined` alongside `calls`. */
    readonly daysSinceUse?: number;
}
/**
 * Assign landscape tiers to installed plugins.
 * @param installed - installed plugin rows (community metadata merged where known).
 * @param usage - per-plugin usage summaries keyed by name.
 * @param report - similarity analysis over installed plus community rows.
 */
export declare function assignTiers(installed: readonly CommunityPlugin[], usage: readonly PluginUsageSummary[], report: SimilarityReport): TieredPlugin[];
/**
 * Render the similarity relation graph as a Mermaid block: installed plugins
 * as plain nodes, community candidates as dashed nodes, edges labeled with
 * the overall similarity percent. Edges are capped strongest-first so large
 * landscapes stay readable.
 * @param installedNames - names of locally installed plugins.
 * @param matrix - pairwise similarity cells.
 * @param threshold - only edges above this overall similarity are drawn.
 */
export declare function renderMermaidGraph(installedNames: readonly string[], matrix: readonly SimilarityCell[], threshold: number, plugins?: readonly CommunityPlugin[]): string;
/** Render a Chinese, scan-friendly explanation for the strongest relations. */
export declare function renderSimilarityDetails(matrix: readonly SimilarityCell[], plugins: readonly CommunityPlugin[], threshold: number): string;
/**
 * Render redundancy clusters as an indented text list — the fallback view for
 * surfaces that do not render Mermaid.
 * @param clusters - redundancy clusters from the similarity analysis.
 */
export declare function renderClusterTree(clusters: readonly RedundancyCluster[]): string;
/**
 * Compose the full landscape report.
 * @param tiers - tiered installed plugins.
 * @param report - similarity analysis over installed plus community rows.
 * @param threshold - redundancy threshold used.
 * @param sessionsScanned - session logs the usage numbers came from.
 */
export declare function renderLandscape(tiers: readonly TieredPlugin[], report: SimilarityReport, threshold: number, installedNames: readonly string[], plugins: readonly CommunityPlugin[], sessionsScanned: number): string;
