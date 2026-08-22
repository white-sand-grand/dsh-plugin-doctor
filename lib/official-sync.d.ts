/**
 * Official release sync: compares the locally installed DSH version with the
 * latest published release of the official harness repository and, when the
 * local install is older, reports which installed plugins the new release may
 * duplicate or conflict with. Every failure degrades into a note — never a
 * thrown error — and every finding is advisory.
 *
 * @module dsh-plugin-doctor/official-sync
 */
import type { HttpDeps } from './http.ts';
import type { PeerDependencyRow } from './inventory.ts';
import type { CommunityPlugin } from './types.ts';
/** The official harness repository whose releases anchor the comparison. */
export declare const OFFICIAL_REPO = "deepseek-ai/deepseek-harness";
/** Process-lifetime cache lifetime for the releases listing, in minutes. */
export declare const RELEASES_TTL_MINUTES = 30;
/** Release-notes characters rendered before truncation. */
export declare const RELEASE_BODY_CHARS = 2000;
/** Maximum findings rendered across all kinds. */
export declare const SYNC_FINDINGS_CAP = 10;
/** Maximum finding bullets in the install-guard advisory. */
export declare const SYNC_ADVISORY_BULLETS = 5;
/** A parsed semantic version with its prerelease identifiers. */
export interface ParsedVersion {
    readonly major: number;
    readonly minor: number;
    readonly patch: number;
    readonly prerelease: readonly string[];
}
/**
 * Parse a version string, tolerating the official tag (`dsh-v0.1.1-rc.2`),
 * release-name (`v0.1.1-rc.2`), CLI-output, and manifest spellings.
 * @param raw - raw version text; anything unparseable yields `undefined`.
 */
export declare function parseVersion(raw: string | undefined | null): ParsedVersion | undefined;
/**
 * Compare two versions per semver precedence: numeric fields first, then a
 * release outranks its prereleases, then prerelease identifiers pairwise
 * (numeric below alphanumeric, numeric identifiers compared numerically).
 * @param a - left-hand version.
 * @param b - right-hand version.
 * @returns negative when `a` ranks below `b`, zero when equal, positive otherwise.
 */
export declare function compareVersions(a: ParsedVersion, b: ParsedVersion): -1 | 0 | 1;
/** Normalized rendering used in reports (`0.1.1-rc.2`). */
export declare function formatVersion(version: ParsedVersion): string;
/**
 * Whether a dependency range excludes the candidate version. Supports the
 * operators the ecosystem actually declares — `<`, `<=`, `>`, `>=`, `^`, `~`,
 * exact versions, wildcard partials (`1.x`), and `||` alternatives. An
 * exclusive cap (`<M.m.p`) additionally rejects prereleases of that exact
 * tuple. Deliberately omitted: node-semver's general prerelease gate, which
 * would reject every rc candidate against ranges like `>=0.1.0-rc.2 <0.2.0`
 * and flag this all-prerelease ecosystem on every release; the cap rule keeps
 * the one case where that leniency clearly misleads. Ranges outside the
 * supported subset (git URLs, `workspace:*`, hyphen ranges) yield `undefined`;
 * callers count them as skipped instead of guessing.
 * @param range - npm-style range string.
 * @param candidate - the candidate version to test.
 */
export declare function rangeExcludes(range: string, candidate: ParsedVersion): boolean | undefined;
/** The official release selected for comparison. */
export interface ReleaseInfo {
    /** Raw tag, e.g. `dsh-v0.1.1-rc.2`. */
    readonly tag: string;
    /** Release title, falling back to the tag when GitHub omits the name. */
    readonly name: string;
    /** Parsed version; `undefined` when the tag is not recognizable semver. */
    readonly version?: ParsedVersion;
    /** Release-notes markdown body. */
    readonly body: string;
    /** HTML URL of the release page. */
    readonly url: string;
    /** Publication timestamp as returned by GitHub. */
    readonly publishedAt: string;
}
/**
 * Pick the release to compare against: the first non-draft entry of the
 * listing (GitHub orders newest first). All-prerelease repositories have no
 * `/releases/latest`, so the list endpoint is authoritative.
 * @param payload - decoded `/releases` response body.
 * @returns the picked release, or a human-readable cause when none qualifies.
 */
export declare function pickLatestRelease(payload: unknown): {
    release?: ReleaseInfo;
    cause?: string;
};
/**
 * Cached client for the official releases listing, mirroring the community
 * source's degradation posture: fresh-TTL hits skip the network entirely and
 * any failure serves the previous release with an explanatory note.
 */
export declare class OfficialReleaseSource {
    private readonly deps;
    private readonly ttlMinutes;
    private cache?;
    /**
     * @param deps - ambient web capability / token holders.
     * @param ttlMinutes - cache lifetime in minutes.
     */
    constructor(deps: HttpDeps, ttlMinutes?: number);
    /**
     * Fetch (or serve cached) latest official release data. Never throws.
     * @param signal - cancellation signal from the tool execution.
     */
    latest(signal?: AbortSignal): Promise<{
        release?: ReleaseInfo;
        degraded?: string;
    }>;
    private fail;
}
/** Where the detected local version came from. */
export type LocalVersionSource = 'cli' | 'manifest';
/** Result of detecting the locally installed DSH version. */
export interface LocalVersion {
    /** Raw version text as read, e.g. `0.1.1-rc.1`. */
    readonly raw?: string;
    readonly version?: ParsedVersion;
    readonly source?: LocalVersionSource;
    /** Why detection failed; present only when nothing was detected. */
    readonly note?: string;
}
/** Injectable `dsh --version` probe so tests and smoke runs stay deterministic. */
export type DshVersionProbe = () => {
    readonly ok: boolean;
    readonly output?: string;
    readonly detail?: string;
};
/**
 * Detect the local DSH version: CLI probe first (runtime truth), then the
 * profile's installed `@deepseek-ai/dsh` manifest. When both fail, returns a
 * combined explanatory note — never throws.
 * @param profile - profile whose node_modules tree holds the harness manifest.
 * @param probe - CLI probe implementation; `undefined` skips the CLI step.
 * @param env - environment mapping for home resolution (tests inject here).
 */
export declare function detectLocalVersion(profile: string, probe: DshVersionProbe | undefined, env?: Record<string, string | undefined>): Promise<LocalVersion>;
/** One advisory finding about the new release versus installed plugins. */
export interface SyncFinding {
    readonly kind: 'peer-exclusion' | 'tool-takeover' | 'capability-overlap';
    readonly severity: 'warning' | 'info';
    readonly refs: readonly string[];
    readonly detail: string;
}
/**
 * Flag installed packages whose peer range on the DSH core packages excludes
 * the official release version. Cordis peers are not checked: the cordis
 * version is not derivable from the release tag.
 * @param peers - installed peer-dependency rows.
 * @param release - the official release to test against.
 */
export declare function analyzePeerConflicts(peers: readonly PeerDependencyRow[], release: ReleaseInfo): SyncFinding[];
/**
 * Flag declared tools whose names appear verbatim (identifier-bounded) in the
 * release notes — the harness may now ship a native tool under the same name.
 * @param toolOwners - declared tool name to owning package map.
 * @param release - the official release whose notes are scanned.
 */
export declare function analyzeToolTakeovers(toolOwners: ReadonlyMap<string, string>, release: ReleaseInfo): SyncFinding[];
/**
 * Flag installed plugins whose name/description/capabilities vocabulary
 * overlaps the release notes: at least two distinct shared keywords, or one
 * keyword of five-plus characters. ASCII-only by design, matching the
 * similarity core's tokenizer.
 * @param installed - installed plugin rows with metadata.
 * @param release - the official release whose notes are scanned.
 */
export declare function analyzeCapabilityOverlaps(installed: readonly CommunityPlugin[], release: ReleaseInfo): SyncFinding[];
/** Comparison outcome of one sync run. */
export type SyncStatus = 'up-to-date' | 'behind' | 'ahead' | 'unknown';
/** Complete result carried by the wire payload and rendered reports. */
export interface OfficialSyncResult {
    readonly status: SyncStatus;
    readonly localRaw?: string;
    readonly localSource?: LocalVersionSource;
    readonly latestTag?: string;
    readonly latestVersion?: string;
    readonly publishedAt?: string;
    readonly releaseUrl?: string;
    readonly findings: readonly SyncFinding[];
    /** Truncated release notes; present only when behind. */
    readonly releaseNotes?: string;
    readonly report: string;
    readonly note?: string;
}
/**
 * Build the sync result up to the status decision; behind-results get their
 * findings and full report filled in by {@link appendBehindContent}.
 * @param local - detected local version.
 * @param fetched - fetched (or cached) official release data.
 */
export declare function assembleSyncStatus(local: LocalVersion, fetched: {
    release?: ReleaseInfo;
    degraded?: string;
}): OfficialSyncResult;
/** Inputs required to enrich a behind-status result with findings. */
export interface BehindInput {
    readonly profile: string;
    readonly releaseBody: string;
    readonly installedRows: readonly CommunityPlugin[];
    readonly peers: readonly PeerDependencyRow[];
    readonly toolOwners: ReadonlyMap<string, string>;
    readonly inventoryNote?: string;
}
/**
 * Fill a behind-status result with the three finding kinds and render the
 * full report. Findings are capped across all kinds after per-kind ordering
 * (peer exclusions, then takeovers, then overlaps).
 * @param result - the behind-status result from {@link assembleSyncStatus}.
 * @param input - release body plus installed-plugin data the analyzers consume.
 */
export declare function appendBehindContent(result: OfficialSyncResult, input: BehindInput): OfficialSyncResult;
/**
 * Render the install-guard advisory: empty unless the sync concluded the
 * local install is behind. Deliberately silent on unknown/failed checks —
 * those surface through `plugin_official_sync`, keeping guard reports clean.
 * @param sync - the sync result, or `undefined` when the advisory path failed.
 */
export declare function renderSyncAdvisory(sync: OfficialSyncResult | undefined): string;
