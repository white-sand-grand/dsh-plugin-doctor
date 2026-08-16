/**
 * Plugin Spec generation for the "community has nothing suitable" branch: a
 * Markdown specification the user can hand to a plugin developer (or an agent)
 * to build the missing plugin. Pseudocode follows the real DSH plugin model
 * (Cordis `apply(ctx, config)` + `defineTool`), not the lifecycle-hook sketch
 * in the original feature request.
 *
 * @module dsh-plugin-doctor/spec
 */
import type { CommunityPlugin } from './types.ts';
/**
 * Suggest a package name for the missing plugin from the user intent.
 * Derives the most prominent hyphen-joinable tokens, else falls back to a
 * generic stem, always under the `dsh-plugin-` prefix used by the community
 * topic.
 * @param intent - natural-language requirement.
 */
export declare function suggestPluginName(intent: string): string;
/**
 * Derive plausible capability tags from the intent's salient words.
 * @param intent - natural-language requirement.
 */
export declare function suggestCapabilities(intent: string): string[];
/**
 * Render the full Plugin Spec as Markdown.
 * @param intent - the user requirement the spec answers.
 * @param comparedAgainst - community plugins already considered and rejected, cited for differentiation.
 */
export declare function renderPluginSpec(intent: string, comparedAgainst: readonly CommunityPlugin[]): string;
/**
 * Render the integration spec: the design for a new plugin consolidating a
 * redundancy cluster, absorbing every member's unique capabilities. Generated
 * only after the user explicitly chose this route.
 * @param intent - the requirement that surfaced the cluster.
 * @param members - the redundant plugins to consolidate.
 */
export declare function renderIntegrationSpec(intent: string, members: readonly CommunityPlugin[]): string;
