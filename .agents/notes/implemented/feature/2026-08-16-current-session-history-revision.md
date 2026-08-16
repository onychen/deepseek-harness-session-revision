# Agent Note: Current-session history revision

Status: implemented

English | [中文](2026-08-16-current-session-history-revision.zh.md)

## Problem

Users need to withdraw a settled message, edit a historical prompt and continue from that point, or regenerate a completed answer without creating another Session. These operations cannot be implemented as visual deletion: the selected suffix may already have affected model history, compaction, tools, persistence, search, pagination, and other open clients.

The implementation must preserve the append-only audit record while presenting one coherent current history. It must also prevent a revision from racing an active run or queued input, explain that external tool effects are not reversible, and distinguish a committed log change from a later persistence failure.

## Decision

Represent a revision as an appended `session/retract` event whose `SurfaceOp.delete.from` identifies the first raw event removed from the current branch. The operation restores the effective surface immediately before that event. The raw log and raw export retain the discarded suffix and the retract evidence; model history, ordinary conversation history, and current-message search consume the projected current branch instead.

Ship the operation through two default plugins. `@deepseek-ai/dsh-session-revision` owns the Host service, validation, commit, and optional replacement prompt. `@deepseek-ai/dsh-client-ui-session-revision` owns message actions and historical-edit composer state. Core, persistence, API, Client Runtime, conversation UI, search, bundle composition, and generated Remote integration provide the native support that the plugins rely on.

## Event and projection model

`SurfaceOp.delete` is a chronological cut rather than a request to delete only nodes visible at the moment of the request. During replay, the surface is reconstructed from the effective prefix before `from`; events appended after the retract remain eligible for the new current suffix. This definition also recovers a prompt whose original surface nodes were shadowed by a later compaction replacement.

`projectCurrentBranch()` applies the same rule to the broader Session event stream. On each retract it removes the active target and every active user, assistant, tool, command, and lifecycle event up to that retract, retains the earlier prefix, and then admits subsequent events. Repeated revisions therefore compose without rewriting earlier rows.

History APIs paginate the projection rather than loading and transporting the complete raw log. Returned events keep their original `seq` values, so a projected page may be sparse. Consumers must treat sequence gaps as expected branch evidence, not missing transport data. Raw export deliberately bypasses this projection.

## Host plugin

`@deepseek-ai/dsh-session-revision` contains the `SessionRevisionService` definition and its default Provider. The generated `sessionRevision` Remote exposes `withdraw`, `edit`, and `regenerate`. Requests carry `targetSeq`, `expectedLastSeq`, the caller timezone, and `acknowledgeToolEffects`; `edit` also carries replacement text. Results identify the retract event, an optional new message, and whether persistence succeeded after commit.

Only targets on the current projected branch are eligible. A user target must be the first ordinary prompt of a turn. An assistant target must be finalized. Steering, plugin injection, Goal or schedule input, synthetic messages, tool nodes, interrupted partial answers, pending input, and subagent Sessions are rejected rather than assigned ambiguous semantics.

### Withdraw

`withdraw(targetSeq)` appends a retract starting at the eligible target and does not enqueue a replacement. Withdrawing the first prompt can therefore leave the current conversation empty while preserving the Session ID, workspace, lineage, and user-pinned title.

### Edit

`edit(targetSeq, text)` retracts the selected turn-opening user prompt and its suffix, then submits a new ordinary prompt. All original text blocks are replaced by the supplied text. Non-text blocks retain their original order; if the source has no text block, the new text block is inserted first. Attachments are checked before commit, including whether the currently selected model accepts their media type.

### Regenerate

`regenerate(targetSeq)` resolves the first ordinary user prompt in the finalized assistant answer's turn, retracts from that prompt, and resubmits its original content and attachments. It does not reuse the old answer or old tool results. The new run uses the model, preset, tools, and reasoning configuration active at revision time.

## Concurrency, effects, and durability

Every mutation executes through `Agent.runMaintenance()`, which provides an exclusive maintenance interval. Immediately before commit the Provider rechecks that the Agent is idle, its input queue is empty, the target is still active, and the raw log tail still equals `expectedLastSeq`. A running Agent, queued input, stale caller, or concurrent label change is rejected before the log is modified.

If the removed interval contains a tool call, an unacknowledged request returns a confirmation-required result. The confirmation states that file changes, processes, network requests, and other external effects already performed by tools are not rolled back. A Client may retry once with acknowledgement and a freshly observed tail; unrelated concurrency conflicts require a new user action.

Appending `session/retract` is the commit point. Replacement content is fully prepared and validated before that append. A flush failure after the append returns `committed: true` with failed persistence status; clients retain the new in-memory state and show a non-retry warning instead of implying rollback or blindly applying the mutation twice.

## Client runtime and UI plugin

The Client Runtime distinguishes the raw event window received from the Host from the active branch window used by the Conversation Assembler. History replacement, prepend pagination, realtime retracts, cross-tab updates, and reconnect recovery all pass through the same folding function. A retract removes assembled nodes in the old suffix, and later events append normally to the rebuilt tail.

`@deepseek-ai/dsh-client-ui-session-revision` registers `revision-user` in `conversation.chat.user-actions`, `revision-assistant` in `conversation.chat.assistant-actions`, and the editing experience in `conversation.composer`. User messages offer withdraw and edit; assistant messages offer withdraw and regenerate. Controls remain visible but disabled with a reason while the Session is running, has queued work, or contains an ineligible target.

Historical editing is Session-scoped. Entering it saves the current draft and draft images, loads the historical text into the composer, and explains that original attachments will be retained. Cancel restores the saved draft. A successful RPC clears editing state and scrolls to the new effective tail. A rejected RPC keeps the edited text so the user can correct or copy it. The current Session and sidebar position never change.

## Native changes outside the plugins

The two plugins supply policy and UI contributions, but the feature also required first-class support across the existing application.

| Area | Native change |
| --- | --- |
| `core/session` | Added the v1 delete surface operation, retract event contract, current-branch projection, surface restoration before a raw event, and coverage for repeated cuts and compaction. |
| `core/agent` | Added exclusive `runMaintenance()` execution and the idle, queue, tail, and lifecycle checks used to commit a historical mutation safely. |
| Session persistence and JSONL | Persist and replay retract events without deleting old rows; projected reads can return sparse original sequence numbers while raw exports retain the full audit stream. |
| Host API proxy | Exposes projected Session history and propagates committed-versus-persisted results to clients. |
| Client Runtime | Maintains raw and active event concepts, folds all history ingress through the same projection, and rebuilds the Conversation Assembler after retracts. |
| Conversation UI | Added stable user and assistant action contribution slots plus a composer contribution point so the UI plugin does not patch message components directly. |
| `api/remotes` | Explicitly mounts `@deepseek-ai/dsh-session-revision/remote`; Typert code generation creates the Remote implementation but does not make it reachable by itself. |
| Search and Session references | Current-message paths consume the projected branch, while audit and export paths continue to use raw events. Token and reference consumers tolerate projected sequence gaps. |
| Web bundle and manifests | Added both packages to dependencies, patch roster, and the Client aggregate so a normal Web profile loads them by default. A source checkout must run `pnpm install` after adding the workspaces so the Client plugin scanner can resolve them. |

## End-to-end operation

1. A message action reads its raw `seq`, the observed raw tail, lifecycle eligibility, and tool-effect status from Client state.
2. The UI calls the generated `sessionRevision` Remote through the existing API gateway.
3. The Host Provider enters `runMaintenance()`, resolves the target against the projected branch, validates the replacement payload if any, and repeats all concurrency checks.
4. The Provider appends `session/retract`. This immediately establishes the new branch in the in-memory Session.
5. Edit and regenerate enqueue the prepared ordinary prompt through `followup()`; withdraw stops after the cut.
6. Persistence flushes the appended events. Its outcome is reported separately from whether the retract committed.
7. Realtime delivery or the next history fetch updates every client. Each client folds its raw window, rebuilds the active Conversation Assembler, removes the old suffix, and displays any newly generated turn.

## Verification

Core tests cover suffix deletion, deleting the first prompt, repeated revisions, continuing after a revision, compaction recovery, invalid or already retracted targets, format-v1 replay, and JSONL/SQLite persistence. Host tests cover maintenance exclusivity, running and queued rejection, stale tails, target classification, tool confirmation, attachment retention, current-model image capability, the next real model request, and committed flush failure.

Client and history tests cover sparse pagination, prepend, refresh, cross-tab retract delivery, assembler node removal, subsequent append, projected search, and raw export evidence. UI tests cover draft suspension and restoration, edit submission, withdraw, regenerate, disabled states, confirmation, error retention, and English and Chinese copy. Bundle tests prove real Loader/Web composition, and the keyless assembled snapshot exercises the runnable application path.

For a source build, successful package tests are not sufficient evidence that the controls are active. Verify that dependencies are installed, the Web bundle loads both plugin packages, `api/remotes` contains the generated Remote mount, and a real browser Session shows the message actions. Product-visible changes should be demonstrated from the real Web server and model flow.

## Alternatives considered

**Fork automatically.** Rejected because editing is expected to keep the current Session identity and sidebar position. A user who wants both versions creates a branch before revision.

**Mutate or delete old log rows.** Rejected because persistence, export, telemetry evidence, and tool-effect auditing depend on the append-only record.

**Reuse the pending queue editor.** Rejected because queued messages have not entered model history. A settled prompt revision must cut durable history and create a new turn.

**Delete only current surface nodes.** Rejected because compaction may have replaced the selected message. Chronological restoration is the operation that can recover the correct prefix.

**Implement only the two plugin packages.** Rejected because plugins can contribute behavior but cannot safely emulate Session replay, projected pagination, assembler rebuilding, Remote mounting, or lifecycle exclusivity outside their owning subsystems.

## Consequences

Current model history, ordinary transcript pages, and current-message search exclude the revised suffix, while raw export retains it. External file, process, network, feedback-sidecar, and audit effects are never reversed. There is no general undo; preserving the old visible version requires branching first.

Automatic titles continue to follow the existing title plugin, and user-pinned titles are unchanged. Regeneration is a fresh execution under current configuration. The historical edit composer changes text only, while the Host preserves original attachments and other non-text content.
