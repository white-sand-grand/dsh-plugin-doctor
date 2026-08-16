/**
 * `dsh-plugin-doctor` — three Agent-facing tools over the DSH community
 * plugin ecosystem: `plugin_community_search` (GitHub `dsh-plugin` topic with
 * TTL cache and degraded fallbacks), `plugin_similarity_analyze` (TF-IDF +
 * Jaccard similarity, redundancy clusters, irreplaceability), and
 * `plugin_recommend` (recommend / de-duplicate / generate a Plugin Spec).
 *
 * Adaptation note: DSH plugins are Cordis plugins — module-level `name`,
 * `inject`, schemastery `Config`, and `apply(ctx, config)` with fiber-scoped
 * registration. The `HarnessPlugin`/`on_invoke` model in the original feature
 * brief does not exist in DSH v0.1; this entry follows the real
 * `tool-todo`/`tool-web` consumer pattern instead.
 *
 * @module dsh-plugin-doctor
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
/** Cordis plugin name used by loader diagnostics. */
export declare const name = "plugin-doctor";
/** The tool registry is the only hard seam; the web capability is used when present. */
export declare const inject: string[];
/** Plugin configuration; every deployment-varying choice is a validated field. */
export interface Config {
    /** GitHub PAT (optional) raising the API rate limit; prefer {@link githubTokenEnv}. */
    githubToken?: string;
    /** Credential reference resolved per request; defaults to `DSH_PLUGIN_DOCTOR_GITHUB_TOKEN`. */
    githubTokenEnv?: string;
    /** Overall similarity above which two plugins are redundant. Defaults to 0.8. */
    similarityThreshold?: number;
    /** Community-listing cache lifetime in minutes. Defaults to 30. */
    cacheTtlMinutes?: number;
    /** Serve the built-in third-party registry snapshot when GitHub is unavailable. */
    enableRegistryFallback?: boolean;
}
export declare const Config: z<Config>;
/**
 * Install the three tools and the settings section.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - deployment configuration.
 */
export declare function apply(ctx: Context, config: Config): void;
