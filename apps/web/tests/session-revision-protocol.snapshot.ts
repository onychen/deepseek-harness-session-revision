import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  assertFixtureInventory,
  compareOrRefreshGolden,
  launchWebScaffold,
  seedSession,
  type WebScaffold,
} from './scaffold.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/session-revision-protocol', import.meta.url))
const SESSION_FIXTURE = join(SNAPSHOT_DIR, 'session.jsonl')
const PROTOCOL_EXPECTED = join(SNAPSHOT_DIR, 'protocol.expected.json')
const SESSION_ID = 'session-revision-protocol'

interface ProtocolExchange {
  readonly endpoint: string
  readonly request: unknown
  readonly status: number
  readonly response: unknown
}

describe('session revision Host Remote protocol', () => {
  let scaffold: WebScaffold

  beforeAll(async () => {
    scaffold = await launchWebScaffold()
    await seedSession(scaffold, await readFile(SESSION_FIXTURE, 'utf8'), SESSION_ID)
  })

  afterAll(async () => {
    await scaffold?.close()
  })

  it('snapshots stale, committed, and revised-target calls through the shipped Web Host', async () => {
    const exchanges: ProtocolExchange[] = []
    const invoke = async (rpcId: string, request: unknown): Promise<void> => {
      const payload = { args: { agentId: SESSION_ID, request } }
      const endpoint = 'sessionRevision/edit'
      const response = await fetch(`${scaffold.baseUrl}/api/${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload }),
      })
      exchanges.push({
        endpoint: `/api/${endpoint}`,
        request: payload,
        status: response.status,
        response: await response.json(),
      })
    }

    await invoke('revision-stale', {
      targetSeq: 1, expectedLastSeq: 4, timezone: 'Asia/Shanghai', text: 'A more useful question.',
    })
    await invoke('revision-commit', {
      targetSeq: 1, expectedLastSeq: 9, timezone: 'Asia/Shanghai', text: 'A more useful question.',
    })
    await invoke('revision-revised', {
      targetSeq: 1, expectedLastSeq: 10, timezone: 'Asia/Shanghai', text: 'A more useful question.',
    })

    expect(exchanges.every(exchange => exchange.status === 200)).toBe(true)
    await compareOrRefreshGolden(PROTOCOL_EXPECTED, JSON.stringify(exchanges, null, 2), scaffold.mode)
    await assertFixtureInventory(SNAPSHOT_DIR, ['protocol.expected.json', 'session.jsonl'])
  })
})
