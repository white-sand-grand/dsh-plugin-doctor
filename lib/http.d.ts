/**
 * Outbound HTTP for the recommender. Prefers the DSH web capability (`ctx.web`)
 * when composed so its fetch provider's size/redirect/timeout limits apply, and
 * falls back to the platform `fetch` otherwise — the v0.1 developer preview may
 * not compose the seam in every assembly, so presence is detected, never
 * assumed. All errors surface as thrown `Error`s the caller can degrade on.
 *
 * @module dsh-plugin-recommender/http
 */
/** Minimal face of `ctx.web` this module needs; avoids a hard seam dependency. */
export interface WebFetchLike {
    fetch(request: {
        url: string;
    }, signal?: AbortSignal): Promise<{
        statusCode: number;
        body: {
            kind: 'html' | 'text';
            content: string;
        };
    }>;
}
/** Mutable holder for the ambient web capability; `undefined` means fallback. */
export interface HttpDeps {
    /** The web capability when composed, else `undefined`. */
    web?: WebFetchLike;
    /** Bearer token for the GitHub API, when configured. */
    token?: string;
}
/**
 * Fetch one URL and return `{ status, text }`.
 * @param deps - ambient capability/token holders.
 * @param url - absolute URL to retrieve.
 * @param signal - cancellation signal from the tool execution.
 * @param accept - Accept header value for the platform-fetch fallback.
 */
export declare function fetchText(deps: HttpDeps, url: string, signal: AbortSignal | undefined, accept?: string): Promise<{
    status: number;
    text: string;
}>;
/**
 * Fetch and parse JSON, rejecting non-2xx responses with the status code attached.
 * @param deps - ambient capability/token holders.
 * @param url - absolute URL returning JSON.
 * @param signal - cancellation signal from the tool execution.
 * @returns the parsed JSON value.
 */
export declare function fetchJson(deps: HttpDeps, url: string, signal: AbortSignal | undefined): Promise<unknown>;
