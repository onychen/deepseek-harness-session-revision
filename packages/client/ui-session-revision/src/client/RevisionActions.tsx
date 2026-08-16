import { useCallback, useState } from 'react'
import {
  Button, IconEditOutline16, IconRefreshOutline16, IconSendOutline16, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionRevisionEditRequest, SessionRevisionRequest, SessionRevisionResult } from '@deepseek-ai/dsh-session-revision/client'
import type { RevisionEditState } from './index.ts'
import type {} from './locales.ts'
import css from './RevisionActions.module.css'

type RevisionOutcome = SessionRevisionResult | { kind: 'transport-failed'; message: string }

interface RevisionInjected {
  revise: (
    operation: 'edit' | 'regenerate',
    request: SessionRevisionRequest | SessionRevisionEditRequest,
  ) => Promise<RevisionOutcome>
}

interface RevisionActionInjected extends RevisionInjected {
  beginEdit: (state: RevisionEditState) => void
}

interface RevisionComposerInjected extends RevisionInjected {
  closeEdit: () => void
}

type UserProps = PropsRuntime<'conversation.chat.user-actions'> & InjectFace<RevisionActionInjected> & PropsLocale<'revision'>
type AssistantProps = PropsRuntime<'conversation.chat.assistant-actions'> & InjectFace<RevisionActionInjected> & PropsLocale<'revision'>
type ComposerProps = PropsRuntime<'conversation.composer'> & { matched: RevisionEditState } & InjectFace<RevisionComposerInjected> & PropsLocale<'revision'>

function timezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

/** Repeat only an explicitly confirmed request against the tail returned by Host. */
async function withEffectConfirmation(
  revise: RevisionInjected['revise'],
  operation: 'edit' | 'regenerate',
  request: SessionRevisionRequest | SessionRevisionEditRequest,
): Promise<RevisionOutcome> {
  const result = await revise(operation, request)
  if (result.kind !== 'confirmation-required' || !window.confirm(result.message)) return result
  return revise(operation, {
    ...request,
    expectedLastSeq: result.expectedLastSeq,
    acknowledgeToolEffects: true,
  })
}

function useRevisionAvailability(props: UserProps | AssistantProps) {
  const { useSession, t } = props
  const running = useSession(snapshot => snapshot.running)
  const queued = useSession(snapshot => snapshot.queue.length > 0)
  const lastSeq = useSession(snapshot => snapshot.lastSeq)
  const subagent = useSession(snapshot => snapshot.subagent !== null)
  const removed = useSession(snapshot => snapshot.removed)
  const disabled = running || queued || subagent || removed || lastSeq === undefined
  return { disabled, disabledReason: disabled ? t('busy') : undefined }
}

function useRegeneration(props: AssistantProps) {
  const { revise, t } = props
  const availability = useRevisionAvailability(props)
  const lastSeq = props.useSession(snapshot => snapshot.lastSeq)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const run = useCallback(async () => {
    if (availability.disabled || pending || lastSeq === undefined) return
    setPending(true)
    setFailure(null)
    const result = await withEffectConfirmation(revise, 'regenerate', {
      targetSeq: props.seq,
      expectedLastSeq: lastSeq,
      timezone: timezone(),
    })
    setPending(false)
    if (result.kind === 'committed') {
      if (result.persistence === 'failed') window.alert(t('persistence'))
      return
    }
    if (result.kind !== 'confirmation-required') setFailure(result.message)
  }, [availability.disabled, lastSeq, pending, props.seq, revise, t])
  return { ...availability, disabled: availability.disabled || pending, failure, run }
}

export function UserRevisionActions(props: UserProps) {
  const action = useRevisionAvailability(props)
  const input = props.useInput(state => state)
  const edit = () => {
    if (action.disabled) return
    props.beginEdit({
      targetSeq: props.seq,
      text: props.text,
      savedDraft: input.draft,
      savedImages: input.imageIds,
    })
    for (const id of input.imageIds) props.inputActions.removeImage(id)
    props.inputActions.setDraft(props.text)
  }
  return <>
    <Tooltip label={action.disabledReason ?? props.t('edit')}><button type="button" className={css.action} aria-label={props.t('edit')} disabled={action.disabled} onClick={edit}><IconEditOutline16 /></button></Tooltip>
  </>
}

export function AssistantRevisionActions(props: AssistantProps) {
  const action = useRegeneration(props)
  return <>
    <Tooltip label={action.disabledReason ?? props.t('regenerate')}><button type="button" className={css.action} aria-label={props.t('regenerate')} disabled={action.disabled} onClick={() => { void action.run() }}><IconRefreshOutline16 /></button></Tooltip>
    {action.failure !== null && <span className={css.failure} role="status">{action.failure}</span>}
  </>
}

/** Session-scoped composer takeover for one historical prompt edit. */
export function RevisionComposer(props: ComposerProps) {
  const { matched, inputActions, revise, closeEdit, t } = props
  const draft = props.useInput(state => state.draft)
  const lastSeq = props.useSession(snapshot => snapshot.lastSeq)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const restore = () => {
    closeEdit()
    inputActions.setDraft(matched.savedDraft)
    inputActions.addImages(matched.savedImages)
  }
  const save = async () => {
    if (pending || lastSeq === undefined) return
    setPending(true)
    setFailure(null)
    const result = await withEffectConfirmation(revise, 'edit', {
      targetSeq: matched.targetSeq,
      expectedLastSeq: lastSeq,
      timezone: timezone(),
      text: draft,
    })
    setPending(false)
    if (result.kind === 'committed') {
      restore()
      if (result.persistence === 'failed') window.alert(t('persistence'))
      return
    }
    if (result.kind !== 'confirmation-required') setFailure(result.message)
  }
  return (
    <div className={css.editor} data-session-revision-editor="">
      <div className={css.editorBanner}>
        <strong>{t('editing')}</strong>
        <span>{t('attachmentsRetained')}</span>
      </div>
      <div className={css.editorCard}>
        <textarea
          autoFocus
          className={css.editorInput}
          aria-label={t('editing')}
          value={draft}
          disabled={pending}
          onChange={(event) => { inputActions.setDraft(event.currentTarget.value) }}
        />
        {failure !== null && <div className={css.failure} role="status">{failure}</div>}
        <div className={css.editorActions}>
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={restore}>{t('cancel')}</Button>
          <Tooltip label={t('save')}>
            <button className={css.primary} type="button" aria-label={t('save')} disabled={pending || draft.trim() === ''} onClick={() => { void save() }}>
              <IconSendOutline16 />
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}
