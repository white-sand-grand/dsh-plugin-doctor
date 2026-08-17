/** Official GitHub issue lookup used before plugin installation decisions. */
import type { HttpDeps } from './http.ts';
/** One open issue that may explain an installation risk. */
export interface OfficialIssue {
    readonly repo: string;
    readonly title: string;
    readonly url: string;
    readonly updatedAt: string;
    readonly matches: readonly string[];
}
/** Search open issues in the supplied official repositories. */
export declare function searchOfficialIssues(deps: HttpDeps, refs: readonly string[], intent: string, signal: AbortSignal | undefined): Promise<{
    issues: readonly OfficialIssue[];
    degraded?: string;
}>;
