import { useCallback, useState } from 'react'
import { IconEditOutline16, IconRefreshOutline16, IconTrashOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionRevisionEditRequest, SessionRevisionRequest, SessionRevisionResult } from '@deepseek-ai/dsh-session-revision/client'
import type { RevisionEditState } from './index.ts'
import type {} from './locales.ts'
import css from './RevisionActions.module.css'

type RevisionOutcome = SessionRevisionResult | { kind: 'transport-failed'; message: string }

interface RevisionInjected {
  revise: (
    operation: 'withdraw' | 'edit' | 'regenerate',
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
  operation: 'withdraw' | 'edit' | 'regenerate',
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

function useRevision(props: UserProps | AssistantProps) {
  const { revise, useSession, t } = props
  const running = useSession(snapshot => snapshot.running)
  const queued = useSession(snapshot => snapshot.queue.length > 0)
  const lastSeq = useSession(snapshot => snapshot.lastSeq)
  const subagent = useSession(snapshot => snapshot.subagent !== null)
  const removed = useSession(snapshot => snapshot.removed)
  const disabled = running || queued || subagent || removed || lastSeq === undefined
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const run = useCallback(async (operation: 'withdraw' | 'regenerate') => {
    if (disabled || pending) return
    setPending(true)
    setFailure(null)
    const result = await withEffectConfirmation(revise, operation, {
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
  }, [disabled, lastSeq, pending, props.seq, revise, t])
  return { disabled: disabled || pending, failure, run, disabledReason: disabled ? t('busy') : undefined }
}

export function UserRevisionActions(props: UserProps) {
  const action = useRevision(props)
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
    <Tooltip label={action.disabledReason ?? props.t('withdraw')}><button type="button" className={css.action} aria-label={props.t('withdraw')} disabled={action.disabled} onClick={() => { void action.run('withdraw') }}><IconTrashOutline16 /></button></Tooltip>
    {action.failure !== null && <span className={css.failure} role="status">{action.failure}</span>}
  </>
}

export function AssistantRevisionActions(props: AssistantProps) {
  const action = useRevision(props)
  return <>
    <Tooltip label={action.disabledReason ?? props.t('regenerate')}><button type="button" className={css.action} aria-label={props.t('regenerate')} disabled={action.disabled} onClick={() => { void action.run('regenerate') }}><IconRefreshOutline16 /></button></Tooltip>
    <Tooltip label={action.disabledReason ?? props.t('withdraw')}><button type="button" className={css.action} aria-label={props.t('withdraw')} disabled={action.disabled} onClick={() => { void action.run('withdraw') }}><IconTrashOutline16 /></button></Tooltip>
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
      <textarea
        className={css.editorInput}
        aria-label={t('editing')}
        value={draft}
        disabled={pending}
        onChange={(event) => { inputActions.setDraft(event.currentTarget.value) }}
      />
      {failure !== null && <div className={css.failure} role="status">{failure}</div>}
      <div className={css.editorActions}>
        <button type="button" disabled={pending} onClick={restore}>{t('cancel')}</button>
        <button type="button" disabled={pending} onClick={() => { void save() }}>{t('save')}</button>
      </div>
    </div>
  )
}
