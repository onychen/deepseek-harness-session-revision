/** Runtime invariant companion for session revision. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

export const name = 'session-revision-invariant'
export const inject = ['invariants']

// No runtime invariant: Session validates every retract transition before publication, and this service owns no durable state.
const install: InvariantInstaller = Object.assign(() => {}, {
  inject: [] as string[],
  reason: 'Session validates every retract transition before publication; the service owns no independent durable state.',
})

/** Register the package invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-session-revision', install))
