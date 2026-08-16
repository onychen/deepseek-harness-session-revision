import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { SessionRevisionEditRequest, SessionRevisionRequest, SessionRevisionResult } from '@deepseek-ai/dsh-session-revision/client'
import type { DraftAttachmentId } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { AssistantRevisionActions, RevisionComposer, UserRevisionActions } from './RevisionActions.tsx'
import { en, zh } from './locales.ts'

const NS = 'revision'
export const inject = ['slots', 'remote', 'remote.sessionRevision', 'locale']

interface RevisionRemote {
  withdraw(sessionId: string, request: SessionRevisionRequest): Promise<RevisionRpcResult>
  edit(sessionId: string, request: SessionRevisionEditRequest): Promise<RevisionRpcResult>
  regenerate(sessionId: string, request: SessionRevisionRequest): Promise<RevisionRpcResult>
}

type RevisionRpcResult = { ok: boolean; value?: SessionRevisionResult; error?: { message: string } }

/** One session's suspended draft and active historical prompt edit. */
export interface RevisionEditState {
  readonly targetSeq: number
  readonly text: string
  readonly savedDraft: string
  readonly savedImages: readonly DraftAttachmentId[]
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-session-revision: dictionaries')
  const remote = (ctx.remote as unknown as { sessionRevision: RevisionRemote }).sessionRevision
  const edits = new Map<SessionId, RevisionEditState>()
  const revise = async (
    sessionId: SessionId,
    operation: 'withdraw' | 'edit' | 'regenerate',
    request: SessionRevisionRequest | SessionRevisionEditRequest,
  ) => {
    const result = operation === 'edit'
      ? await remote.edit(sessionId, request as SessionRevisionEditRequest)
      : operation === 'regenerate'
        ? await remote.regenerate(sessionId, request)
        : await remote.withdraw(sessionId, request)
    return result.ok && result.value !== undefined
      ? result.value
      : { kind: 'transport-failed' as const, message: result.error?.message ?? 'Session revision failed' }
  }
  const register = (name: 'conversation.chat.user-actions' | 'conversation.chat.assistant-actions', id: string, Component: typeof UserRevisionActions | typeof AssistantRevisionActions) => ctx.slots.inject(name, () => ctx.slots.register({
    name,
    id,
    order: 20,
    locale: NS,
    inject: (sessionId: SessionId) => ({
      revise: (operation: 'withdraw' | 'edit' | 'regenerate', request: SessionRevisionRequest | SessionRevisionEditRequest) => revise(sessionId, operation, request),
      beginEdit: (state: RevisionEditState) => { edits.set(sessionId, state) },
    }),
  }, Component as never))
  register('conversation.chat.user-actions', 'revision-user', UserRevisionActions)
  register('conversation.chat.assistant-actions', 'revision-assistant', AssistantRevisionActions)
  ctx.slots.inject('conversation.composer', () => ctx.slots.register({
    name: 'conversation.composer',
    priority: 20,
    locale: NS,
    select: ({ session }) => session === undefined ? null : edits.get(session.sessionId) ?? null,
    inject: (sessionId: SessionId) => ({
      revise: (operation: 'withdraw' | 'edit' | 'regenerate', request: SessionRevisionRequest | SessionRevisionEditRequest) => revise(sessionId, operation, request),
      closeEdit: () => { edits.delete(sessionId) },
    }),
  }, RevisionComposer as never))
}
