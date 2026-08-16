import { describe, expect, it, vi } from 'vitest'
import { askChoiceFactory } from '../src/interaction.ts'
import type { UserQuestionsLike } from '../src/interaction.ts'

const CHOICES = [
  { key: 'keep', label: 'Keep A', description: 'Keeps the winner.' },
  { key: 'integrate', label: 'Consolidate', description: 'Builds one plugin.' },
] as const

/** Provider stub answering with one selected label. */
function providerAnswering(label?: string): UserQuestionsLike {
  return {
    ask: vi.fn(async () => ({
      answers: [{ id: 'choice', selected: label === undefined ? [] : [label] }],
    })),
  }
}

describe('askChoiceFactory', () => {
  it('resolves the key of the selected label', async () => {
    const hook = askChoiceFactory(providerAnswering('Consolidate'))
    await expect(hook('What to do?', 'Decision', CHOICES, undefined)).resolves.toBe('integrate')
  })

  it('resolves undefined without a seam', async () => {
    const hook = askChoiceFactory(undefined)
    await expect(hook('What to do?', 'Decision', CHOICES, undefined)).resolves.toBeUndefined()
  })

  it('resolves undefined when the provider throws (abort, no UI, shutdown)', async () => {
    const throwing: UserQuestionsLike = { ask: vi.fn(async () => { throw new Error('aborted') }) }
    const hook = askChoiceFactory(throwing)
    await expect(hook('What to do?', 'Decision', CHOICES, undefined)).resolves.toBeUndefined()
  })

  it('resolves undefined when the answer names no known label', async () => {
    const hook = askChoiceFactory(providerAnswering('something else'))
    await expect(hook('What to do?', 'Decision', CHOICES, undefined)).resolves.toBeUndefined()
  })

  it('forwards one single-select question with option descriptions', async () => {
    const provider = providerAnswering('Keep A')
    await askChoiceFactory(provider)('What to do?', 'Decision', CHOICES, undefined)
    expect(provider.ask).toHaveBeenCalledWith({
      questions: [{
        id: 'choice',
        question: 'What to do?',
        header: 'Decision',
        options: [
          { label: 'Keep A', description: 'Keeps the winner.' },
          { label: 'Consolidate', description: 'Builds one plugin.' },
        ],
        multiSelect: false,
      }],
      signal: undefined,
    })
  })
})
