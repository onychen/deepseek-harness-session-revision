/** Simplified Chinese session-revision UI strings. */
export const zh = {
  withdraw: '撤回', edit: '编辑', regenerate: '重新生成',
  editing: '正在编辑历史消息', attachmentsRetained: '原附件将保留',
  cancel: '取消', save: '保存并重新回答',
  busy: '会话运行中或队列非空，暂时无法修订',
  failed: '修订失败', persistence: '修订已提交，但持久化失败；请勿重复操作',
} as const satisfies Record<string, string>

/** Stable keys shared by every session-revision locale. */
export type SessionRevisionLocaleKey = keyof typeof zh

/** English session-revision UI strings. */
export const en = {
  withdraw: 'Withdraw', edit: 'Edit', regenerate: 'Regenerate',
  editing: 'Editing a historical message', attachmentsRetained: 'Original attachments will be retained',
  cancel: 'Cancel', save: 'Save and answer again',
  busy: 'Revision is unavailable while the session is running or queued',
  failed: 'Revision failed', persistence: 'Revision committed, but persistence failed. Do not retry.',
} as const satisfies Record<SessionRevisionLocaleKey, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { revision: SessionRevisionLocaleKey }
}
