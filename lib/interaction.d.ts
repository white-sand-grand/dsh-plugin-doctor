/**
 * One-choice user interaction primitive over the `ctx.userQuestions` seam —
 * the same service `tool-ask-user` consumes. When the seam (or its UI
 * provider) is unavailable, or the user aborts, the hook resolves
 * `undefined` and callers degrade to their non-interactive behavior; asking
 * never throws into the tool execution.
 *
 * @module dsh-plugin-doctor/interaction
 */
/** One selectable choice of an {@link askChoice} prompt. */
export interface AskChoice {
    /** Stable key returned to the caller when this choice is picked. */
    readonly key: string;
    /** User-facing short label. */
    readonly label: string;
    /** One sentence on the tradeoff or impact of this choice. */
    readonly description: string;
}
/**
 * Minimal structural face of `ctx.userQuestions`; avoids a hard dependency on
 * the service package while staying type-compatible with its `ask()`.
 */
export interface UserQuestionsLike {
    ask(request: {
        questions: {
            id: string;
            question: string;
            header?: string;
            options?: {
                label: string;
                description?: string;
            }[];
            multiSelect?: boolean;
        }[];
        signal?: AbortSignal;
    }): Promise<{
        answers: {
            id: string;
            selected: string[];
            custom?: string;
        }[];
    }>;
}
/** Interactive hook injected into the decision core; `undefined` = degrade. */
export type AskChoiceHook = (question: string, header: string, choices: readonly AskChoice[], signal: AbortSignal | undefined) => Promise<string | undefined>;
/**
 * Build an {@link AskChoiceHook} over the user-questions seam.
 * @param userQuestions - the seam when composed, else `undefined`.
 * @returns a hook resolving the chosen {@link AskChoice.key}, or `undefined`
 * when the seam is absent, the user dismissed/aborted the prompt, or the
 * answer carried no recognizable selection.
 */
export declare function askChoiceFactory(userQuestions: UserQuestionsLike | undefined): AskChoiceHook;
