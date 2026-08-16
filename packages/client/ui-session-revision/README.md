# @deepseek-ai/dsh-client-ui-session-revision

English | [中文](README.zh.md)

Adds Edit actions to ordinary user messages and Regenerate actions to finalized assistant messages. Controls call the `sessionRevision` Host Remote, disable while the Session is running or queued, and confirm before discarding a range containing tool calls.

Editing temporarily takes over the Session composer with the native composer card, typography, and primary action. It preserves the user's existing draft and draft images, restores them after cancel or commit, keeps rejected edit text in place, and states that the historical prompt's original attachments remain attached.

## Model Experience

Indirectly, through the `sessionRevision` Host Remote, Edit and Regenerate enqueue a fresh ordinary prompt after committing the revision so the next model request uses current Session settings.

#### KV Cache effect

Editing or regenerating invalidates reuse from the revised prompt onward; the effective prefix before it remains unchanged.

## Known Limitations and Deferred Work

- Historical attachments are retained rather than editable; changing them requires a new prompt.
