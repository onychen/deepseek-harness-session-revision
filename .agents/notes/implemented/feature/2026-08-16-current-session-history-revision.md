# Agent Note: Current-session history revision

Status: implemented

English | [中文](2026-08-16-current-session-history-revision.zh.md)

## Problem

An edit control over a settled user message needs a Host operation that defines what happens to the turn that already consumed it. Reusing the pending-queue editor would give the same gesture two meanings, while a UI-only button would advertise a mutation the product cannot honor. Withdrawal and answer regeneration need the same historical cut, concurrency rule, and audit treatment.

## Decision

`session/retract` records a chronological `SurfaceOp` delete from one raw event sequence. The append-only log and raw export retain every old event, while `projectCurrentBranch()` removes the target through the retract and admits later events as the current branch. Surface replay restores the effective prefix before the target, including append nodes shadowed by a later compaction replacement.

`@deepseek-ai/dsh-session-revision` is the Host Service Definition and default Provider. Its Remote methods withdraw an eligible message, edit a turn-opening ordinary user prompt, or regenerate a finalized assistant message from that turn's first ordinary prompt. Every mutation claims `Agent.runMaintenance()`, compares the caller's raw tail sequence, rechecks idle and empty-inbox state, rejects subagent and synthetic inputs, and asks for explicit acknowledgement when the discarded interval contains a tool call.

The retract append is the commit point. Edit and regeneration then enqueue a newly identified ordinary prompt with current Agent configuration; editing replaces the original text blocks and preserves non-text blocks, while regeneration preserves all original content. A later flush failure returns a committed result with a separate persistence failure instead of claiming rollback.

Web history paginates the current-branch projection and marks pages whose original sequence numbers contain gaps. A live retract causes the Client Runtime to fetch the tail and rebuild its Conversation Assembler. `@deepseek-ai/dsh-client-ui-session-revision` contributes user and assistant actions through the existing message action slots; unavailable lifecycle states remain visibly disabled. Historical prompt editing takes over the Session composer, suspends the user's draft and draft images, restores them on cancel or commit, and retains rejected edit text for correction.

## Alternatives considered

**Fork automatically.** Rejected because editing is expected to keep the current Session identity and sidebar position. A user who wants both versions creates a branch before revision.

**Mutate or delete old log rows.** Rejected because persistence, export, telemetry evidence, and tool-effect auditing depend on the append-only record.

**Reuse the pending queue editor.** Rejected because queued messages have not entered model history. A settled prompt revision must cut durable history and create a new turn.

**Delete only current surface nodes.** Rejected because compaction may have replaced the selected message. Chronological restoration is the operation that can recover the correct prefix.

## Consequences

Current model history, ordinary transcript pages, and current-surface search exclude the withdrawn suffix, while raw export retains it. External file, process, and network effects are never reversed. There is no general undo; preserving the old visible version requires branching first. The edit composer changes text only; the Host preserves original attachments and other non-text blocks.
