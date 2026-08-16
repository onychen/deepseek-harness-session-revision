// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { AssistantRevisionActions, RevisionComposer, UserRevisionActions } from '../src/client/RevisionActions.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const inputActions = () => ({
  setDraft: vi.fn(),
  addImages: vi.fn(() => true),
  removeImage: vi.fn(),
  pruneImages: vi.fn(),
  submit: vi.fn(),
})

describe('session revision UI', () => {
  it('suspends the current draft and images when historical editing starts', () => {
    const actions = inputActions()
    const beginEdit = vi.fn()
    const props = {
      seq: 4,
      text: 'historical prompt',
      t: (key: string) => key,
      useInput: (select: (value: unknown) => unknown) => select({ draft: 'new draft', imageIds: ['image-1'] }),
      useSession: (select: (value: unknown) => unknown) => select({
        running: false, queue: [], lastSeq: 9, subagent: null, removed: false,
      }),
      inputActions: actions,
      beginEdit,
      revise: vi.fn(),
    } as unknown as ComponentProps<typeof UserRevisionActions>
    render(<UserRevisionActions {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'edit' }))
    expect(beginEdit).toHaveBeenCalledWith({
      targetSeq: 4,
      text: 'historical prompt',
      savedDraft: 'new draft',
      savedImages: ['image-1'],
    })
    expect(actions.removeImage).toHaveBeenCalledWith('image-1')
    expect(actions.setDraft).toHaveBeenCalledWith('historical prompt')
  })

  it('restores the suspended draft on cancel', () => {
    const actions = inputActions()
    const closeEdit = vi.fn()
    const props = {
      matched: { targetSeq: 4, text: 'old', savedDraft: 'new draft', savedImages: ['image-1'] },
      t: (key: string) => key,
      useInput: (select: (value: unknown) => unknown) => select({ draft: 'edited text' }),
      useSession: (select: (value: unknown) => unknown) => select({ lastSeq: 9 }),
      inputActions: actions,
      closeEdit,
      revise: vi.fn(),
    } as unknown as ComponentProps<typeof RevisionComposer>
    render(<RevisionComposer {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'cancel' }))
    expect(closeEdit).toHaveBeenCalledOnce()
    expect(actions.setDraft).toHaveBeenCalledWith('new draft')
    expect(actions.addImages).toHaveBeenCalledWith(['image-1'])
  })

  it('keeps edited text visible when Host rejects the revision', async () => {
    const actions = inputActions()
    const closeEdit = vi.fn()
    const revise = vi.fn().mockResolvedValue({ kind: 'rejected', code: 'stale', message: 'tail changed' })
    const props = {
      matched: { targetSeq: 4, text: 'old', savedDraft: 'new draft', savedImages: [] },
      t: (key: string) => key,
      useInput: (select: (value: unknown) => unknown) => select({ draft: 'edited text' }),
      useSession: (select: (value: unknown) => unknown) => select({ lastSeq: 9 }),
      inputActions: actions,
      closeEdit,
      revise,
    } as unknown as ComponentProps<typeof RevisionComposer>
    render(<RevisionComposer {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    await waitFor(() => { expect(screen.getByRole('status').textContent).toBe('tail changed') })
    expect(revise).toHaveBeenCalledWith('edit', expect.objectContaining({ targetSeq: 4, text: 'edited text' }))
    expect(closeEdit).not.toHaveBeenCalled()
  })

  it('confirms tool effects once before regenerating with the refreshed tail', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true))
    const revise = vi.fn()
      .mockResolvedValueOnce({ kind: 'confirmation-required', expectedLastSeq: 11, message: 'effects remain' })
      .mockResolvedValueOnce({ kind: 'committed', retractSeq: 12, persistence: 'persisted' })
    const props = {
      seq: 7,
      t: (key: string) => key,
      useSession: (select: (value: unknown) => unknown) => select({
        running: false, queue: [], lastSeq: 9, subagent: null, removed: false,
      }),
      beginEdit: vi.fn(),
      revise,
    } as unknown as ComponentProps<typeof AssistantRevisionActions>
    render(<AssistantRevisionActions {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'regenerate' }))
    await waitFor(() => { expect(revise).toHaveBeenCalledTimes(2) })
    expect(window.confirm).toHaveBeenCalledWith('effects remain')
    expect(revise).toHaveBeenLastCalledWith('regenerate', expect.objectContaining({
      targetSeq: 7,
      expectedLastSeq: 11,
      acknowledgeToolEffects: true,
    }))
  })

  it('disables history actions while the session is running', () => {
    const props = {
      seq: 7,
      t: (key: string) => key,
      useSession: (select: (value: unknown) => unknown) => select({
        running: true, queue: [], lastSeq: 9, subagent: null, removed: false,
      }),
      beginEdit: vi.fn(),
      revise: vi.fn(),
    } as unknown as ComponentProps<typeof AssistantRevisionActions>
    render(<AssistantRevisionActions {...props} />)

    expect(screen.getByRole('button', { name: 'regenerate' }).hasAttribute('disabled')).toBe(true)
  })

  it('restores the suspended draft after a successful edit commit', async () => {
    const actions = inputActions()
    const closeEdit = vi.fn()
    const props = {
      matched: { targetSeq: 4, text: 'old', savedDraft: 'new draft', savedImages: ['image-1'] },
      t: (key: string) => key,
      useInput: (select: (value: unknown) => unknown) => select({ draft: 'edited text' }),
      useSession: (select: (value: unknown) => unknown) => select({ lastSeq: 9 }),
      inputActions: actions,
      closeEdit,
      revise: vi.fn().mockResolvedValue({ kind: 'committed', retractSeq: 10, persistence: 'persisted' }),
    } as unknown as ComponentProps<typeof RevisionComposer>
    render(<RevisionComposer {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    await waitFor(() => { expect(closeEdit).toHaveBeenCalledOnce() })
    expect(actions.setDraft).toHaveBeenCalledWith('new draft')
    expect(actions.addImages).toHaveBeenCalledWith(['image-1'])
  })
})
