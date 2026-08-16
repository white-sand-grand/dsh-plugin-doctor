/**
 * Outbound HTTP for the recommender. Prefers the DSH web capability (`ctx.web`)
 * when composed so its fetch provider's size/redirect/timeout limits apply, and
 * falls back to the platform `fetch` otherwise — the v0.1 developer preview may
 * not compose the seam in every assembly, so presence is detected, never
 * assumed. All errors surface as thrown `Error`s the caller can degrade on.
 *
 * @module dsh-plugin-recommender/http
 */
/**
 * Fetch one URL and return `{ status, text }`.
 * @param deps - ambient capability/token holders.
 * @param url - absolute URL to retrieve.
 * @param signal - cancellation signal from the tool execution.
 * @param accept - Accept header value for the platform-fetch fallback.
 */
export async function fetchText(deps, url, signal, accept = 'application/vnd.github+json') {
    const headers = { Accept: accept, 'User-Agent': 'dsh-plugin-recommender' };
    if (deps.token !== undefined)
        headers.Authorization = `Bearer ${deps.token}`;
    if (deps.web !== undefined) {
        try {
            const result = await deps.web.fetch({ url }, signal);
            return { status: result.statusCode, text: result.body.content };
        }
        catch {
            // The capability's fetch provider may reject API endpoints or content
            // types it does not handle; the platform fallback below still serves it.
        }
    }
    const response = await fetch(url, { headers, signal });
    return { status: response.status, text: await response.text() };
}
/**
 * Fetch and parse JSON, rejecting non-2xx responses with the status code attached.
 * @param deps - ambient capability/token holders.
 * @param url - absolute URL returning JSON.
 * @param signal - cancellation signal from the tool execution.
 * @returns the parsed JSON value.
 */
export async function fetchJson(deps, url, signal) {
    const { status, text } = await fetchText(deps, url, signal);
    if (!(status >= 200 && status < 300)) {
        throw new Error(`GET ${url} failed with HTTP ${status}`);
    }
    return JSON.parse(text);
}
