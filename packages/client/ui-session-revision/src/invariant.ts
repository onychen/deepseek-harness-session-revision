import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
export const name = 'client-ui-session-revision-invariant'
export const inject = ['invariants']
/** No runtime invariant: slot registrations are owned by the plugin fiber and contain no independent state. */
const install: InvariantInstaller = () => {}
/** Register the package invariant companion. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-client-ui-session-revision', install))
