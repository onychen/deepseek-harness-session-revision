/** Same-session withdrawal, prompt editing, and answer regeneration service. */

import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { readModelSelection } from '@deepseek-ai/dsh-agent'
import { contentHasImage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm'
import { projectCurrentBranch } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  SessionRevisionCommittedResult,
  SessionRevisionEditRequest,
  SessionRevisionRequest,
  SessionRevisionResult,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** User prompt resubmitted by an authenticated same-session revision request. */
    'session-revision': { kind: 'user'; rpcId: string; clientTimeZone: string }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionRevision: SessionRevisionService
  }
}

interface RevisionTarget {
  readonly from: number
  readonly replacement?: UserMessage
}

const IANA_TIME_ZONE = /^[A-Za-z][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+)+$/

/** Validate and canonicalize the browser time zone carried by a revision request. */
function canonicalTimeZone(value: string): string | undefined {
  if (value.length === 0 || value.trim() !== value
    || (value !== 'UTC' && !IANA_TIME_ZONE.test(value))) return undefined
  try {
    const canonical = new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone
    return canonical === 'UTC' || IANA_TIME_ZONE.test(canonical) ? canonical : undefined
  } catch {
    return undefined
  }
}

/** Replace every text block with one edited block while retaining non-text blocks in order. */
function editedContent(content: readonly ContentBlock[], text: string): ContentBlock[] {
  const firstText = content.findIndex(block => block.type === 'text')
  if (firstText === -1) return [{ type: 'text', text }, ...content]
  const edited: ContentBlock[] = []
  for (const [index, block] of content.entries()) {
    if (block.type !== 'text') edited.push(block)
    else if (index === firstText) edited.push({ type: 'text', text })
  }
  return edited
}

/** Resolve the ordinary first prompt and turn identity for current-branch events. */
function turnIndex(events: readonly SessionEvent[]): {
  turnBySeq: Map<number, number>
  firstPromptByTurn: Map<number, SessionEvent<'user/message'>>
} {
  const turnBySeq = new Map<number, number>()
  const firstPromptByTurn = new Map<number, SessionEvent<'user/message'>>()
  let turn: number | undefined
  for (const event of events) {
    if (event.type === 'turn/start') turn = event.data.turn
    if (turn === undefined) continue
    turnBySeq.set(event.seq, turn)
    if (event.type === 'user/message'
      && event.data.source.kind === 'user'
      && !firstPromptByTurn.has(turn)) {
      firstPromptByTurn.set(turn, event)
    }
    if (event.type === 'turn/end' && event.data.turn === turn) turn = undefined
  }
  return { turnBySeq, firstPromptByTurn }
}

/** Default Host provider for same-session history revision. */
export class SessionRevisionService extends TypertRemoteService {
  static inject = ['agents', 'sessions', 'llm']

  constructor(ctx: Context) {
    super(ctx, 'sessionRevision')
  }

  /**
   * Withdraw an eligible prompt or finalized assistant message and its current suffix.
   * @param agent - live top-level agent selected by the Remote lookup.
   * @param request - target, compare-and-set tail, timezone, and effect acknowledgement.
   * @returns refusal, confirmation request, or committed revision state.
   */
  @Remote('withdraw')
  withdraw(agent: Agent, request: SessionRevisionRequest): Promise<SessionRevisionResult> {
    return this.revise(agent, request, 'withdraw')
  }

  /**
   * Replace one eligible ordinary prompt and start a new answer turn.
   * @param agent - live top-level agent selected by the Remote lookup.
   * @param request - target, replacement text, and concurrency fields.
   * @returns refusal, confirmation request, or committed revision state.
   */
  @Remote('edit')
  edit(agent: Agent, request: SessionRevisionEditRequest): Promise<SessionRevisionResult> {
    return this.revise(agent, request, 'edit')
  }

  /**
   * Re-submit the first ordinary prompt of a finalized assistant message's turn.
   * @param agent - live top-level agent selected by the Remote lookup.
   * @param request - assistant target and concurrency fields.
   * @returns refusal, confirmation request, or committed revision state.
   */
  @Remote('regenerate')
  regenerate(agent: Agent, request: SessionRevisionRequest): Promise<SessionRevisionResult> {
    return this.revise(agent, request, 'regenerate')
  }

  /** Claim idle maintenance and commit one validated revision. */
  private revise(
    agent: Agent,
    request: SessionRevisionRequest | SessionRevisionEditRequest,
    operation: 'withdraw' | 'edit' | 'regenerate',
  ): Promise<SessionRevisionResult> {
    if (agent.status !== 'idle' || agent.inbox.hasPending) {
      return Promise.resolve(this.rejected('busy', 'The session must be idle with an empty queue.'))
    }
    try {
      return agent.runMaintenance(async (signal) => {
        if (agent.status !== 'idle' || agent.inbox.hasPending) {
          return this.rejected('busy', 'The session changed before revision could start.')
        }
        if (agent.session.header.origin === 'subagent') {
          return this.rejected('subagent-session', 'Subagent sessions do not support history revision.')
        }
        const timeZone = canonicalTimeZone(request.timezone)
        if (!Number.isSafeInteger(request.targetSeq) || request.targetSeq < 0
          || !Number.isSafeInteger(request.expectedLastSeq)
          || timeZone === undefined) {
          return this.rejected('invalid-target', 'The revision request is malformed.')
        }
        const lastSeq = agent.session.seq - 1
        if (request.expectedLastSeq !== lastSeq) {
          return this.rejected('stale', `The session tail changed from ${request.expectedLastSeq} to ${lastSeq}.`)
        }
        const active = projectCurrentBranch(agent.session.events)
        const target = this.resolveTarget(active, request, operation, timeZone)
        if (target === undefined) {
          return this.rejected('invalid-target', 'The selected message is not eligible on the current branch.')
        }
        const discarded = active.filter(event => event.seq >= target.from)
        if (discarded.some(event => event.type === 'tool/call') && request.acknowledgeToolEffects !== true) {
          return {
            kind: 'confirmation-required',
            expectedLastSeq: lastSeq,
            message: 'Tool effects on files, processes, and networks are not rolled back. Continue anyway?',
          }
        }
        if (target.replacement !== undefined && contentHasImage(target.replacement.content)) {
          const validation = await this.validateImages(agent, target.replacement, signal)
          if (validation !== undefined) return validation
        }
        const retract = agent.session.append('session/retract', {}, {
          surfaceOp: { op: 'delete', from: target.from },
        })
        if (target.replacement !== undefined) agent.followup(target.replacement)
        const committed: SessionRevisionCommittedResult = {
          kind: 'committed',
          retractSeq: retract.seq,
          ...target.replacement === undefined ? {} : { newMessageId: target.replacement.id },
          persistence: 'persisted',
        }
        try {
          await this.ctx.sessions.flush(agent.session)
          return committed
        } catch (error: unknown) {
          return {
            ...committed,
            persistence: 'failed',
            persistenceError: error instanceof Error ? error.message : String(error),
          }
        }
      })
    } catch (error: unknown) {
      return Promise.resolve(this.rejected('busy', error instanceof Error ? error.message : String(error)))
    }
  }

  /** Verify retained image objects and the currently selected model before commit. */
  private async validateImages(
    agent: Agent,
    message: UserMessage,
    signal: AbortSignal,
  ): Promise<SessionRevisionResult | undefined> {
    const attachments = this.ctx.get('attachments')
    if (attachments === undefined) {
      return this.rejected('attachment-unavailable', 'The session attachment service is unavailable.')
    }
    try {
      await Promise.all(message.content
        .filter(block => block.type === 'image')
        .map(block => attachments.readImage(block.attachment, signal)))
    } catch (error: unknown) {
      return this.rejected(
        'attachment-unavailable',
        `One or more original attachments are unavailable: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    const installed = readModelSelection(agent.ctx)?.current
    const logged = agent.session.requestHeader()?.config
    const provider = installed?.provider ?? logged?.provider ?? agent.options.provider
    const model = installed?.model ?? logged?.model ?? agent.options.model
    if (provider === undefined || model === undefined) return undefined
    try {
      const info = await this.ctx.llm.resolveModelInfo(provider, model, signal)
      if (info.inputModalities !== undefined && !info.inputModalities.includes('image')) {
        return this.rejected('model-incompatible', `Model "${model}" does not support image input.`)
      }
    } catch (error: unknown) {
      return this.rejected(
        'model-incompatible',
        `The selected model could not be validated: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    return undefined
  }

  /** Resolve an operation without mutating live state. */
  private resolveTarget(
    active: readonly SessionEvent[],
    request: SessionRevisionRequest | SessionRevisionEditRequest,
    operation: 'withdraw' | 'edit' | 'regenerate',
    timeZone: string,
  ): RevisionTarget | undefined {
    const event = active.find(candidate => candidate.seq === request.targetSeq)
    if (event === undefined) return undefined
    const index = turnIndex(active)
    const turn = index.turnBySeq.get(event.seq)
    if (operation === 'regenerate') {
      if (event.type !== 'assistant/message' || turn === undefined) return undefined
      const prompt = index.firstPromptByTurn.get(turn)
      if (prompt === undefined) return undefined
      return { from: prompt.seq, replacement: this.copyPrompt(prompt.data, timeZone) }
    }
    if (event.type === 'assistant/message') {
      return operation === 'withdraw' ? { from: event.seq } : undefined
    }
    if (event.type !== 'user/message' || event.data.source.kind !== 'user' || turn === undefined
      || index.firstPromptByTurn.get(turn)?.seq !== event.seq) return undefined
    if (operation === 'withdraw') return { from: event.seq }
    const edit = request as SessionRevisionEditRequest
    return {
      from: event.seq,
      replacement: createUserMessage({
        content: editedContent(event.data.content, edit.text),
        source: this.revisionSource(event.data, timeZone),
      }),
    }
  }

  /** Copy a prompt with a fresh identity while retaining all blocks and source fields. */
  private copyPrompt(message: UserMessage, timeZone: string): UserMessage {
    return createUserMessage({ content: message.content, source: this.revisionSource(message, timeZone) })
  }

  /** Bind the current revision request's browser zone to the replacement prompt. */
  private revisionSource(message: UserMessage, timeZone: string): UserMessage['source'] {
    return { kind: 'user', rpcId: message.id, clientTimeZone: timeZone }
  }

  /** Build a non-committing refusal. */
  private rejected(
    code: 'busy' | 'stale' | 'invalid-target' | 'subagent-session' | 'attachment-unavailable' | 'model-incompatible',
    message: string,
  ): SessionRevisionResult {
    return { kind: 'rejected', code, message }
  }
}

export default SessionRevisionService
