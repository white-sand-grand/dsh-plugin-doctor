/**
 * Community data source: GitHub repositories under the `dsh-plugin` topic, with
 * a TTL cache and a degradation chain (live GitHub → stale cache → built-in
 * registry snapshot). GitHub rate-limit responses (403/429) and network errors
 * never propagate to the caller; they step down the chain instead.
 *
 * @module dsh-plugin-doctor/github
 */
import { fetchJson, fetchText } from "./http.js";
/** GitHub Search API topic every discovery query narrows to. */
const DSH_PLUGIN_TOPIC = 'dsh-plugin';
/** Third-party registry pages scraped in the degradation chain. */
const REGISTRY_URLS = ['https://dshplugin.world/', 'https://dsh.pub/en/plugins/'];
/** README excerpt length kept for similarity scoring. */
const README_EXCERPT_CHARS = 500;
/**
 * Static snapshot of third-party registries (dshplugin.world, dsh.pub) used
 * only when both the live API and the cache are unavailable. Kept inline so
 * the plugin stays a single installable package with no extra fetch targets.
 */
const REGISTRY_SNAPSHOT = [
    {
        name: 'dsh-plugin-memory',
        repo: 'community/dsh-plugin-memory',
        installRef: 'github:community/dsh-plugin-memory',
        description: 'Persistent conversation memory with recall and summarization.',
        readmeExcerpt: 'Persistent conversation memory for DSH agents: recall prior sessions, summarize long histories, and inject relevant context. capabilities: memory, context, session',
        capabilities: ['memory', 'context', 'session'],
        dependencies: [],
        stars: 0,
        updatedAt: '',
        source: 'registry',
    },
    {
        name: 'dsh-plugin-market',
        repo: 'community/dsh-plugin-market',
        installRef: 'github:community/dsh-plugin-market',
        description: 'Browse and install community plugins from the registry.',
        readmeExcerpt: 'Marketplace browser for DSH community plugins: search the registry, show install commands, manage installed plugins. capabilities: catalog, install',
        capabilities: ['catalog', 'install'],
        dependencies: [],
        stars: 0,
        updatedAt: '',
        source: 'registry',
    },
];
/**
 * Extract capability tags and dependencies from a README excerpt. Recognizes
 * explicit `capabilities:` / `dependencies:` lines and bracketed tag lists;
 * missing sections yield empty arrays rather than guesses.
 * @param excerpt - README head text.
 */
function parseReadmeMetadata(excerpt) {
    const capabilities = [];
    const dependencies = [];
    for (const line of excerpt.split(/\r?\n/)) {
        const cap = /^[-*>\s]*capabilities?\s*[:=]\s*(.+)$/i.exec(line);
        if (cap !== null) {
            capabilities.push(...cap[1].split(/[,;|]/).map(tag => tag.trim().toLowerCase()).filter(tag => tag.length > 0));
            continue;
        }
        const dep = /^[-*>\s]*dependencies?\s*[:=]\s*(.+)$/i.exec(line);
        if (dep !== null) {
            dependencies.push(...dep[1].split(/[,;|]/).map(dep2 => dep2.trim()).filter(dep2 => dep2.length > 0));
        }
    }
    return { capabilities: [...new Set(capabilities)], dependencies: [...new Set(dependencies)] };
}
/**
 * Client for the community data source with TTL caching and degradation.
 * One instance lives in the plugin's `apply` scope; its cache is the
 * process-lifetime equivalent of the shared plugin context.
 */
export class CommunitySource {
    deps;
    ttlMinutes;
    cache;
    /**
     * @param deps - HTTP dependencies (web capability, token).
     * @param ttlMinutes - cache lifetime in minutes; listings older than this are refreshed.
     */
    constructor(deps, ttlMinutes) {
        this.deps = deps;
        this.ttlMinutes = ttlMinutes;
    }
    /**
     * List community plugins matching a natural-language intent. The live GitHub
     * topic listing is fetched at most once per TTL window; keyword ranking and
     * filters run locally against the cached listing.
     * @param intent - natural-language description of what the user needs.
     * @param filters - optional star/recency filters.
     * @param signal - cancellation signal from the tool execution.
     * @returns ranked plugins plus a degradation note when a fallback served them.
     */
    async search(intent, filters, signal) {
        const listing = await this.listing(signal);
        const keywords = tokenizeIntent(intent);
        const now = Date.now();
        const ranked = listing.plugins
            .filter(plugin => (filters.minStars === undefined || plugin.stars >= filters.minStars)
            && (filters.updatedWithinDays === undefined
                || plugin.updatedAt.length === 0
                || now - Date.parse(plugin.updatedAt) <= filters.updatedWithinDays * 86_400_000))
            .map(plugin => ({ plugin, score: keywords.length === 0 ? 0 : overlapScore(keywords, plugin) }))
            .filter(entry => entry.score > 0 || keywords.length === 0)
            .sort((x, y) => y.score - x.score || y.plugin.stars - x.plugin.stars)
            .map(entry => entry.plugin);
        return { plugins: ranked, degraded: listing.degraded };
    }
    /**
     * Fetch (or serve from cache) the full topic listing with README excerpts.
     * Errors step down: live API → stale cache → live registry pages → built-in
     * registry snapshot.
     */
    async listing(signal) {
        const fresh = this.cache !== undefined && Date.now() - this.cache.fetchedAt < this.ttlMinutes * 60_000;
        if (fresh)
            return { plugins: this.cache.plugins };
        try {
            const plugins = await this.fetchTopic(signal);
            this.cache = { fetchedAt: Date.now(), plugins };
            return { plugins };
        }
        catch (error) {
            const cause = errorMessage(error);
            if (this.cache !== undefined) {
                return { plugins: this.cache.plugins, degraded: `GitHub API unavailable (${cause}); serving stale cache` };
            }
            const live = await this.fetchRegistries(signal);
            if (live !== undefined && live.length > 0) {
                return { plugins: live, degraded: `GitHub API unavailable (${cause}); serving live third-party registry data` };
            }
            return {
                plugins: REGISTRY_SNAPSHOT,
                degraded: `GitHub API unavailable (${cause}); serving built-in registry snapshot`,
            };
        }
    }
    /**
     * Scrape the third-party plugin registries (dshplugin.world, dsh.pub) for
     * GitHub repository references. Returns `undefined` when every page fails;
     * an empty array means the pages loaded but exposed no repositories — the
     * caller then falls through to the static snapshot.
     * @param signal - cancellation signal from the tool execution.
     */
    async fetchRegistries(signal) {
        const plugins = new Map();
        let anyPageLoaded = false;
        for (const url of REGISTRY_URLS) {
            try {
                const { status, text } = await fetchText(this.deps, url, signal, 'text/html');
                if (!(status >= 200 && status < 300))
                    continue;
                anyPageLoaded = true;
                for (const match of text.matchAll(/github\.com\/([A-Za-z0-9][A-Za-z0-9_.-]*)\/([A-Za-z0-9][A-Za-z0-9_.-]*)/g)) {
                    const repo = `${match[1]}/${match[2]}`;
                    if (plugins.has(repo))
                        continue;
                    plugins.set(repo, {
                        name: match[2],
                        repo,
                        installRef: `github:${repo}`,
                        description: `Listed on ${new URL(url).hostname}`,
                        readmeExcerpt: '',
                        capabilities: [],
                        dependencies: [],
                        stars: 0,
                        updatedAt: '',
                        source: 'registry',
                    });
                }
            }
            catch {
                // One unreachable registry must not block the other or the fallback.
            }
        }
        return anyPageLoaded ? [...plugins.values()] : undefined;
    }
    /**
     * Query the GitHub Search API for the topic and enrich each hit with its
     * README head. Per-repository README failures degrade to the repo description.
     */
    async fetchTopic(signal) {
        const url = `https://api.github.com/search/repositories?q=topic:${DSH_PLUGIN_TOPIC}&sort=stars&order=desc&per_page=30`;
        const payload = await fetchJson(this.deps, url, signal);
        const items = payload.items ?? [];
        const plugins = [];
        for (const item of items) {
            const repo = item.full_name;
            if (repo === undefined)
                continue;
            const excerpt = await this.readmeExcerpt(repo, signal);
            const metadata = parseReadmeMetadata(excerpt);
            plugins.push({
                name: item.name ?? repo,
                repo,
                installRef: `github:${repo}`,
                description: item.description ?? '',
                readmeExcerpt: excerpt,
                capabilities: metadata.capabilities,
                dependencies: metadata.dependencies,
                stars: item.stargazers_count ?? 0,
                updatedAt: item.pushed_at ?? '',
                source: 'github',
            });
        }
        return plugins;
    }
    /** First {@link README_EXCERPT_CHARS} characters of the repository README. */
    async readmeExcerpt(repo, signal) {
        try {
            const { status, text } = await fetchText(this.deps, `https://api.github.com/repos/${repo}/readme`, signal, 'application/vnd.github.raw');
            if (status >= 200 && status < 300)
                return text.slice(0, README_EXCERPT_CHARS);
        }
        catch {
            // README enrichment is best-effort; similarity falls back to description.
        }
        return '';
    }
}
/**
 * Lowercase word tokens of an intent, minus stopwords; also keeps hyphenated
 * compound fragments so "sandbox approval" matches `sandbox-approval`.
 * @param intent - natural-language text.
 */
function tokenizeIntent(intent) {
    const stopwords = new Set(['a', 'an', 'the', 'i', 'need', 'want', 'plugin', 'for', 'that', 'can', 'to', 'of', 'and', 'with', 'me', 'my', 'dsh']);
    return intent
        .toLowerCase()
        .split(/[^a-z0-9+#-]+/)
        .flatMap(token => token.split('-'))
        .filter(token => token.length > 1 && !stopwords.has(token));
}
/**
 * Fraction of intent keywords appearing in the plugin's text fields.
 * @param keywords - tokenized intent.
 * @param plugin - candidate plugin.
 */
function overlapScore(keywords, plugin) {
    const haystack = `${plugin.name} ${plugin.description} ${plugin.readmeExcerpt} ${plugin.capabilities.join(' ')}`.toLowerCase();
    const hits = keywords.filter(keyword => haystack.includes(keyword)).length;
    return keywords.length === 0 ? 0 : hits / keywords.length;
}
/**
 * Normalize an unknown thrown value into a short message.
 * @param error - thrown value.
 */
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
