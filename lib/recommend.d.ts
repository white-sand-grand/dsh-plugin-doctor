/**
 * Three-branch recommendation decision: (1) community has well-matching
 * plugins — recommend the best; (2) matches exist but overlap heavily with
 * local installs — suggest which to keep and which to remove; (3) nothing
 * matches — emit a Plugin Spec for building it yourself.
 *
 * @module dsh-plugin-recommender/recommend
 */
import { suggestPluginName } from './spec.ts';
import type { CommunityPlugin, RecommendResult, SearchResult } from './types.ts';
/**
 * Run the three-branch decision.
 * @param intent - the user requirement.
 * @param search - community search result for the intent.
 * @param installedPlugins - local installs projected into plugin rows.
 * @param threshold - redundancy similarity threshold in [0, 1].
 * @param profile - profile name used in rendered removal commands.
 */
export declare function recommend(intent: string, search: SearchResult, installedPlugins: readonly CommunityPlugin[], threshold: number, profile: string): RecommendResult;
export { suggestPluginName };
