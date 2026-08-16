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
import { suggestPluginName } from './spec.ts';
import type { AskChoiceHook } from './interaction.ts';
import type { CommunityPlugin, RecommendResult, SearchResult } from './types.ts';
/** Interaction hooks; omit to force the degraded (non-interactive) paths. */
export interface DecisionHooks {
    /** One-choice prompt over the user-questions seam; `undefined` = degrade. */
    readonly askChoice?: AskChoiceHook;
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
export declare function recommend(intent: string, search: SearchResult, installedPlugins: readonly CommunityPlugin[], threshold: number, profile: string, hooks?: DecisionHooks, signal?: AbortSignal | undefined): Promise<RecommendResult>;
export { suggestPluginName };
