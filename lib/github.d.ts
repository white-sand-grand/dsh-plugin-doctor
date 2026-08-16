/**
 * Community data source: GitHub repositories under the `dsh-plugin` topic, with
 * a TTL cache and a degradation chain (live GitHub → stale cache → built-in
 * registry snapshot). GitHub rate-limit responses (403/429) and network errors
 * never propagate to the caller; they step down the chain instead.
 *
 * @module dsh-plugin-doctor/github
 */
import type { HttpDeps } from './http.ts';
import type { SearchFilters, SearchResult } from './types.ts';
/**
 * Client for the community data source with TTL caching and degradation.
 * One instance lives in the plugin's `apply` scope; its cache is the
 * process-lifetime equivalent of the shared plugin context.
 */
export declare class CommunitySource {
    private readonly deps;
    private readonly ttlMinutes;
    private cache?;
    /**
     * @param deps - HTTP dependencies (web capability, token).
     * @param ttlMinutes - cache lifetime in minutes; listings older than this are refreshed.
     */
    constructor(deps: HttpDeps, ttlMinutes: number);
    /**
     * List community plugins matching a natural-language intent. The live GitHub
     * topic listing is fetched at most once per TTL window; keyword ranking and
     * filters run locally against the cached listing.
     * @param intent - natural-language description of what the user needs.
     * @param filters - optional star/recency filters.
     * @param signal - cancellation signal from the tool execution.
     * @returns ranked plugins plus a degradation note when a fallback served them.
     */
    search(intent: string, filters: SearchFilters, signal: AbortSignal | undefined): Promise<SearchResult>;
    /**
     * Fetch (or serve from cache) the full topic listing with README excerpts.
     * Errors step down: live API → stale cache → live registry pages → built-in
     * registry snapshot.
     */
    private listing;
    /**
     * Scrape the third-party plugin registries (dshplugin.world, dsh.pub) for
     * GitHub repository references. Returns `undefined` when every page fails;
     * an empty array means the pages loaded but exposed no repositories — the
     * caller then falls through to the static snapshot.
     * @param signal - cancellation signal from the tool execution.
     */
    private fetchRegistries;
    /**
     * Query the GitHub Search API for the topic and enrich each hit with its
     * README head. Per-repository README failures degrade to the repo description.
     */
    private fetchTopic;
    /** First {@link README_EXCERPT_CHARS} characters of the repository README. */
    private readmeExcerpt;
}
