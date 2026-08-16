/**
 * One-choice user interaction primitive over the `ctx.userQuestions` seam —
 * the same service `tool-ask-user` consumes. When the seam (or its UI
 * provider) is unavailable, or the user aborts, the hook resolves
 * `undefined` and callers degrade to their non-interactive behavior; asking
 * never throws into the tool execution.
 *
 * @module dsh-plugin-doctor/interaction
 */
/**
 * Build an {@link AskChoiceHook} over the user-questions seam.
 * @param userQuestions - the seam when composed, else `undefined`.
 * @returns a hook resolving the chosen {@link AskChoice.key}, or `undefined`
 * when the seam is absent, the user dismissed/aborted the prompt, or the
 * answer carried no recognizable selection.
 */
export function askChoiceFactory(userQuestions) {
    return async (question, header, choices, signal) => {
        if (userQuestions === undefined || choices.length === 0)
            return undefined;
        try {
            const result = await userQuestions.ask({
                questions: [{
                        id: 'choice',
                        question,
                        header,
                        options: choices.map(choice => ({ label: choice.label, description: choice.description })),
                        multiSelect: false,
                    }],
                signal,
            });
            const selected = result.answers.find(answer => answer.id === 'choice')?.selected[0];
            if (selected === undefined)
                return undefined;
            return choices.find(choice => choice.label === selected)?.key;
        }
        catch {
            // Aborted prompts, missing UI providers, and shutdown races all mean
            // "no answer"; the caller's degraded path is the correct continuation.
            return undefined;
        }
    };
}
