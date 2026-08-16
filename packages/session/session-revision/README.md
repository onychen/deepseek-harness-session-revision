# @deepseek-ai/dsh-session-revision

English | [中文](README.zh.md)

Host service for withdrawing the current history suffix, editing an ordinary prompt, and regenerating a finalized answer in the same Session. Raw events remain available for audit and export; current model history follows the latest revision branch.

The `sessionRevision` Remote exposes `withdraw`, `edit`, and `regenerate`. Every request compares `expectedLastSeq`, runs only while the Agent is idle with an empty inbox, and requires explicit acknowledgement when the discarded range contains tool calls. A committed retract is never reported as rolled back: flush failure returns `persistence: 'failed'` beside the committed sequence.

## Model Experience

### Revised turn

#### What the model sees

Edit and Regenerate keep the effective history before the selected turn and enqueue one fresh ordinary `user/message` prompt. Edit replaces its text while retaining original non-text blocks; Regenerate retains the original prompt. The removed answer, tool calls, and tool results are absent. Withdraw alone sends no model input.

#### Token effect

The next request contains the retained prefix plus the replacement prompt under current model, tool, preset, and reasoning settings. Tokens from the removed suffix leave that request; the new answer is generated and billed normally.

#### KV Cache effect

The retained prefix before the revision may remain reusable. The replacement prompt and everything generated after it form a new suffix.

## Known Limitations and Deferred Work

- External effects from discarded tool calls are not reversed.
- Subagent sessions, steering, plugin inputs, goal or schedule inputs, pending messages, and interrupted partial assistant output are not revisable.
