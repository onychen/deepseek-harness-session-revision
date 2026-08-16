# DSH Session Revision

English | [中文](README.zh.md)

DSH Session Revision is a focused DeepSeek Harness customization for correcting an earlier prompt without abandoning the current Session. It adds same-session editing and answer regeneration to the Web UI while keeping the interaction consistent with the native chat composer.

This repository carries the complete application source because historical revision crosses the Host service, event log, Client Runtime, and conversation UI. It is an independent customization, not the upstream project's release channel.

## What it provides

- **Edit a user prompt.** Select an ordinary settled prompt, revise its text in the native composer, and continue the Session from that turn.
- **Regenerate an answer.** Select a finalized assistant message to rerun its turn from the original user prompt under the current model and tool settings.
- **Keep the current Session.** The Session ID, workspace, sidebar position, pinned title, saved draft, and draft images remain in place.
- **Retain an audit trail.** The visible and model-facing branch excludes the replaced suffix, while raw Session export retains the original events and the revision record.

There is no standalone Withdraw or general Undo action. Editing and regeneration do not reverse file changes, processes, network requests, or other external effects from discarded tool calls; the UI asks for confirmation before committing such a revision.

## Editing experience

Edit uses the same card, typography, spacing, buttons, and primary send action as the normal dsh conversation composer. The historical prompt's attachments remain attached but are not editable. Cancel restores the draft that was present before editing, and a rejected request leaves the edited text available for correction.

Actions stay visible but disabled while the Session is running, has queued input, or contains a target that cannot be revised. Subagent Sessions, steering, scheduled or goal input, synthetic messages, pending prompts, and interrupted partial answers are outside the supported revision set.

## Run

### Run from source

Requirements:

- Node.js `^22.19.0` or `>=24.0.0`
- pnpm `11.7.0`
- A DeepSeek API key

Create a root `.env` file without committing it:

```dotenv
DEEPSEEK_API_KEY=your_key_here
```

Install, build, and start the Web UI:

```sh
pnpm install
pnpm run build
pnpm dsh web
```

Open `http://127.0.0.1:3080`. The Web profile loads both revision packages by default.

## Plugin packages

| Package | Responsibility |
| --- | --- |
| [`@deepseek-ai/dsh-session-revision`](packages/session/session-revision/README.md) | Validates revision requests, commits the history cut, and submits the replacement prompt. |
| [`@deepseek-ai/dsh-client-ui-session-revision`](packages/client/ui-session-revision/README.md) | Adds Edit and Regenerate actions and supplies the native-style editing composer. |

## Development

Run the focused revision tests after changing the feature:

```sh
pnpm exec vitest run packages/session/session-revision/tests/revision.spec.ts packages/client/ui-session-revision/tests/revision-actions.client.spec.tsx
```

Documentation changes use the repository's bilingual pairing workflow. Before publishing a broader change, select the relevant checks using [the pre-push workflow](.agents/skills/dsh-pre-push-checks/SKILL.md).

The customization builds on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and its vendored [Cordis](https://github.com/cordiverse/cordis) runtime.

## License

[MIT](LICENSE). Third-party notices are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
