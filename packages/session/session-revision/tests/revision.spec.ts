import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import LlmRuntime, { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionRevisionService from '@deepseek-ai/dsh-session-revision'
import { describe, expect, it, vi } from 'vitest'

async function harness(options: { flushError?: Error } = {}) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionRevisionService)
  const session = ctx.sessions.create(SessionId(`revision-${Math.random()}`))
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  const followups: import('@deepseek-ai/dsh-session').UserMessage[] = []
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    inbox,
    ctx: new Context(),
    status: 'idle',
    cancel() {},
    whenIdle: () => Promise.resolve(),
    runMaintenance: task => task(new AbortController().signal),
    send() {},
    followup(message) { followups.push(message) },
    steer() {},
    inject() {},
  }
  ctx.agents.register(agent)
  ;(ctx.sessions as unknown as { flush(session: unknown): Promise<boolean> }).flush = vi.fn(async () => {
    if (options.flushError !== undefined) throw options.flushError
    return true
  })
  return { ctx, agent, session, followups }
}

function appendTurn(session: Awaited<ReturnType<typeof harness>>['session'], text = 'original') {
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  const prompt = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }, { type: 'text', text: 'second block' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  const answer = session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: 'text', text: 'answer' }],
      source: { provider: 'test', model: 'test' },
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  return { prompt, answer }
}

describe('SessionRevisionService', () => {
  it('edits the first ordinary prompt and commits a fresh follow-up', async () => {
    const test = await harness()
    const { prompt } = appendTurn(test.session)
    const result = await test.ctx.sessionRevision.edit(test.agent, {
      targetSeq: prompt.seq,
      expectedLastSeq: test.session.seq - 1,
      timezone: 'Asia/Shanghai',
      text: 'edited',
    })
    expect(result).toMatchObject({ kind: 'committed', retractSeq: 6, persistence: 'persisted' })
    expect(test.session.deriveMessages()).toEqual([])
    expect(test.followups[0]?.content).toEqual([{ type: 'text', text: 'edited' }])
    expect(test.followups[0]?.source).toMatchObject({ kind: 'user', clientTimeZone: 'Asia/Shanghai' })
  })

  it('requires confirmation when regeneration discards a tool call', async () => {
    const test = await harness()
    const { answer } = appendTurn(test.session)
    test.session.append('tool/call', {
      turn: 1,
      step: 1,
      callId: 'call-1' as never,
      name: 'bash',
      arguments: '{}',
    })
    const result = await test.ctx.sessionRevision.regenerate(test.agent, {
      targetSeq: answer.seq,
      expectedLastSeq: test.session.seq - 1,
      timezone: 'UTC',
    })
    expect(result).toMatchObject({ kind: 'confirmation-required' })
    expect(test.session.events.some(event => event.type === 'session/retract')).toBe(false)
  })

  it('reports flush failure without disguising the committed revision', async () => {
    const test = await harness({ flushError: new Error('disk full') })
    const { answer } = appendTurn(test.session)
    const result = await test.ctx.sessionRevision.regenerate(test.agent, {
      targetSeq: answer.seq,
      expectedLastSeq: test.session.seq - 1,
      timezone: 'UTC',
    })
    expect(result).toMatchObject({
      kind: 'committed',
      retractSeq: 6,
      persistence: 'failed',
      persistenceError: 'disk full',
    })
  })

  it('rejects a stale tail without mutation', async () => {
    const test = await harness()
    const { prompt } = appendTurn(test.session)
    const result = await test.ctx.sessionRevision.edit(test.agent, {
      targetSeq: prompt.seq,
      expectedLastSeq: 0,
      timezone: 'UTC',
      text: 'edited',
    })
    expect(result).toMatchObject({ kind: 'rejected', code: 'stale' })
  })

  it('rejects an invalid browser time zone before mutation', async () => {
    const test = await harness()
    const { prompt } = appendTurn(test.session)
    const result = await test.ctx.sessionRevision.edit(test.agent, {
      targetSeq: prompt.seq,
      expectedLastSeq: test.session.seq - 1,
      timezone: 'Not/A_Real_Zone',
      text: 'edited',
    })
    expect(result).toMatchObject({ kind: 'rejected', code: 'invalid-target' })
    expect(test.session.events.some(event => event.type === 'session/retract')).toBe(false)
  })

  it('validates retained historical attachments before committing an edit', async () => {
    const test = await harness()
    test.session.append('turn/start', { turn: 1 })
    const prompt = test.session.append('user/message', createUserMessage({
      content: [
        { type: 'text', text: 'describe' },
        {
          type: 'image',
          attachment: {
            attachmentId: 'missing-image', mediaType: 'image/png', bytes: 1, width: 1, height: 1,
          },
        },
      ] as never,
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const result = await test.ctx.sessionRevision.edit(test.agent, {
      targetSeq: prompt.seq,
      expectedLastSeq: test.session.seq - 1,
      timezone: 'UTC',
      text: 'edited',
    })
    expect(result).toMatchObject({ kind: 'rejected', code: 'attachment-unavailable' })
    expect(test.session.events.some(event => event.type === 'session/retract')).toBe(false)
  })
})
