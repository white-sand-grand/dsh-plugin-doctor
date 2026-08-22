/**
 * `dsh-plugin-doctor` — seven Agent-facing tools over the DSH community plugin
 * ecosystem: community search, similarity analysis, recommendation, multi-repo
 * install preflight, usage audit, an installed-plugin landscape, and official
 * release sync.
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
/** Tool and prompt registries are required; the web capability is used when present. */
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
    /**
     * Execute confirmed install/remove actions via the `dsh plugin` CLI instead
     * of only printing commands. Off by default; when on, execution still
     * requires the user's explicit interactive confirmation (degraded,
     * non-interactive paths never execute).
     */
    allowExecuteActions?: boolean;
}
export declare const Config: z<Config>;
/**
 * Install the seven tools, install-preflight guidance, and the settings section.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - deployment configuration.
 */
export declare function apply(ctx: Context, config: Config): void;
