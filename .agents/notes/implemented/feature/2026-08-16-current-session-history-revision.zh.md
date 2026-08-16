# Agent Note: 当前 Session 历史修订

Status: implemented

[English](2026-08-16-current-session-history-revision.md) | 中文

## 问题

用户需要在不创建新 Session 的前提下撤回已定稿消息、编辑历史 prompt 后从该位置继续，或重新生成已经完成的回答。这些操作不能只是界面上的视觉删除：所选后缀可能已经影响模型历史、compaction、工具、持久化、搜索、分页和其他已打开的 Client。

实现既要保留仅追加的审计记录，又要呈现一条连贯的当前历史。它还必须阻止修订与正在运行的任务或排队输入竞态，说明外部工具副作用无法撤销，并区分日志已经提交与之后持久化失败两种状态。

## 决策

修订表示为追加的 `session/retract` 事件，其中 `SurfaceOp.delete.from` 指向从当前分支移除的第一条原始事件。该操作恢复到目标事件之前的有效 surface。原始日志与原始导出保留被舍弃后缀和 retract 证据；模型历史、普通对话历史和当前消息搜索改为消费当前分支投影。

功能通过两个默认插件交付。`@deepseek-ai/dsh-session-revision` 负责 Host 服务、校验、提交和可选替换 prompt；`@deepseek-ai/dsh-client-ui-session-revision` 负责消息操作与历史编辑 composer 状态。Core、持久化、API、Client Runtime、对话 UI、搜索、bundle 组合和生成的 Remote 接入则提供插件依赖的原生支持。

## 事件与投影模型

`SurfaceOp.delete` 是时间顺序切点，而不是只删除请求发生时仍可见的节点。重放时，surface 从 `from` 之前的有效前缀恢复；retract 之后追加的事件仍可构成新的当前后缀。即使原 prompt 的 surface 节点已被之后的 compaction replacement 遮蔽，这个定义也能恢复它之前的正确状态。

`projectCurrentBranch()` 把同一规则应用到更完整的 Session 事件流。每遇到一次 retract，它会移除当前有效目标以及目标至 retract 之间的 user、assistant、工具、命令和生命周期事件，保留更早的前缀，再接纳之后的新事件。因此，连续多次修订可以组合，而不必改写旧行。

历史 API 对投影结果分页，无须装载和传输整段原始日志。返回事件继续使用原始 `seq`，所以投影页可能是稀疏的。Consumer 必须把序号间隙视为正常的分支证据，而不是传输丢失。原始导出有意绕过该投影。

## Host 插件

`@deepseek-ai/dsh-session-revision` 包含 `SessionRevisionService` 定义和默认 Provider。生成的 `sessionRevision` Remote 暴露 `withdraw`、`edit` 和 `regenerate`。请求携带 `targetSeq`、`expectedLastSeq`、调用方时区和 `acknowledgeToolEffects`；`edit` 还携带替换文本。结果给出 retract 事件、可选的新消息，以及提交后持久化是否成功。

只有当前投影分支上的目标可以修订。user 目标必须是某轮的第一条普通 prompt，assistant 目标必须已经 finalized。Steering、插件注入、Goal 或定时任务输入、合成消息、工具节点、中断的 partial 回答、待处理输入和 subagent Session 都会被拒绝，不为它们定义含糊的修订语义。

### 撤回

`withdraw(targetSeq)` 从合格目标开始追加 retract，不排入替换消息。因此，撤回第一条 prompt 可以让当前对话变为空，同时保留 Session ID、workspace、lineage 和用户固定标题。

### 编辑

`edit(targetSeq, text)` 撤回选中的轮次首条 user prompt 及其后缀，再提交一条新的普通 prompt。原消息的全部文本块由新文本替换；非文本块保持原顺序。若原消息没有文本块，新文本块插在首位。附件在提交前完成校验，包括当前所选模型是否支持对应媒体类型。

### 重新生成

`regenerate(targetSeq)` 找到已 finalized assistant 回答所属轮次的第一条普通 user prompt，从该 prompt 开始撤回，并原样重新提交其内容和附件。它不会复用旧回答或旧工具结果。新执行采用修订时有效的模型、preset、工具和推理配置。

## 并发、副作用与持久化

每次变更都通过 `Agent.runMaintenance()` 执行，以获得独占维护区间。提交前，Provider 会再次确认 Agent 空闲、输入队列为空、目标仍在当前分支，并且原始日志尾仍等于 `expectedLastSeq`。Agent 正在运行、已有排队输入、调用方状态过期或并发标签变化都会在修改日志之前被拒绝。

如果被移除区间包含工具调用，未确认的请求会返回 confirmation-required 结果。确认说明文件变更、进程、网络请求和其他已经发生的外部工具副作用不会回滚。Client 可以用确认标记和最新观察到的尾序号重试一次；无关的并发冲突必须由用户重新发起操作。

追加 `session/retract` 是提交点。替换内容会在该 append 之前完成构造和校验。append 之后的 flush 失败返回 `committed: true` 和失败的持久化状态；Client 保留新的内存状态并显示不可重试警告，不能暗示已经回滚或盲目重复变更。

## Client Runtime 与 UI 插件

Client Runtime 区分从 Host 收到的原始事件窗口和 Conversation Assembler 使用的当前分支窗口。历史 replace、prepend 分页、实时 retract、跨标签页更新和重新连接恢复都经过同一折叠函数。retract 会移除旧后缀的已组装节点，之后的新事件则正常追加到重建后的尾部。

`@deepseek-ai/dsh-client-ui-session-revision` 在 `conversation.chat.user-actions` 注册 `revision-user`，在 `conversation.chat.assistant-actions` 注册 `revision-assistant`，并在 `conversation.composer` 注册编辑体验。user 消息提供撤回和编辑，assistant 消息提供撤回和重新生成。Session 正在运行、存在排队工作或目标不合格时，控件仍保持可见，但会禁用并解释原因。

历史编辑状态属于单个 Session。进入编辑时会保存当前草稿和草稿图片，把历史文本载入 composer，并说明原附件会被保留。取消会恢复已保存草稿；RPC 成功后清除编辑态并滚动到新的有效尾部；RPC 被拒绝时保留编辑文本，便于用户修正或复制。当前 Session 和侧栏位置始终不变。

## 两个插件之外的原生改动

两个插件提供策略与 UI contribution，但该功能还需要现有应用各层的一等支持。

| 区域 | 原生改动 |
| --- | --- |
| `core/session` | 增加格式 v1 的 delete surface operation、retract 事件约定、当前分支投影、恢复到某条原始事件之前的 surface，以及连续切点和 compaction 覆盖。 |
| `core/agent` | 增加独占 `runMaintenance()` 执行，以及安全提交历史变更所需的空闲、队列、日志尾和生命周期检查。 |
| Session 持久化与 JSONL | 持久化并重放 retract 事件而不删除旧行；投影读取可以返回稀疏原始序号，原始导出仍保留完整审计流。 |
| Host API proxy | 暴露经过投影的 Session 历史，并把已提交与是否已持久化两种结果分别传给 Client。 |
| Client Runtime | 维护原始事件与当前事件两种概念，让所有历史入口使用同一投影，并在 retract 后重建 Conversation Assembler。 |
| 对话 UI | 增加稳定的 user/assistant 消息操作 contribution slot 和 composer contribution point，使 UI 插件不必直接修改消息组件。 |
| `api/remotes` | 显式挂载 `@deepseek-ai/dsh-session-revision/remote`；Typert 代码生成会产生 Remote 实现，但仅靠生成不会让它可调用。 |
| 搜索与 Session 引用 | 当前消息路径消费投影分支，审计和导出路径继续使用原始事件；token 与引用 consumer 可以处理投影序号间隙。 |
| Web bundle 与 manifest | 把两个包加入 dependencies、patch roster 和 Client aggregate，使普通 Web profile 默认加载它们。源码工作区增加 workspace 后必须运行 `pnpm install`，Client 插件扫描器才能解析新包。 |

## 端到端工作流程

1. 消息操作从 Client 状态读取目标原始 `seq`、已观察到的原始日志尾、生命周期资格和工具副作用状态。
2. UI 通过既有 API gateway 调用生成的 `sessionRevision` Remote。
3. Host Provider 进入 `runMaintenance()`，根据投影分支解析目标，校验可能存在的替换 payload，并重复全部并发检查。
4. Provider 追加 `session/retract`，新的分支立即在内存 Session 中生效。
5. 编辑和重新生成通过 `followup()` 排入准备好的普通 prompt；撤回在切断后结束。
6. 持久层 flush 新增事件，其结果与 retract 是否已经提交分别报告。
7. 实时传输或下一次历史读取更新所有 Client。每个 Client 折叠原始窗口、重建当前 Conversation Assembler、移除旧后缀，并显示可能新生成的轮次。

## 验证

Core 测试覆盖普通后缀删除、删除第一条 prompt、连续修订、修订后继续、跨 compaction 恢复、非法或已撤回目标、格式 v1 重放，以及 JSONL/SQLite 持久化。Host 测试覆盖维护独占、运行中和队列拒绝、过期日志尾、目标分类、工具确认、附件保留、当前模型图片能力、下一次真实模型请求，以及已经提交后的 flush 失败。

Client 与历史测试覆盖稀疏分页、prepend、刷新、跨标签页 retract、Assembler 节点移除、后续 append、投影搜索和原始导出证据。UI 测试覆盖草稿暂存与恢复、编辑提交、撤回、重新生成、禁用态、确认、错误保留和中英文文案。Bundle 测试验证真实 Loader/Web 组合，keyless assembled snapshot 则覆盖可运行应用路径。

对于源码构建，仅有 package 测试通过不足以证明控件已经启用。还应确认依赖已安装、Web bundle 已加载两个插件包、`api/remotes` 已包含生成 Remote 的挂载，并在真实浏览器 Session 中看到消息操作。产品可见的改动应从真实 Web 服务和模型流程录制演示。

## 考虑过的替代方案

**自动创建分支。** 未采用，因为编辑应保持当前 Session 标识和侧栏位置。需要同时保留两个版本时，用户应在修订前创建分支。

**修改或删除旧日志行。** 未采用，因为持久化、导出、遥测证据和工具副作用审计都依赖仅追加记录。

**复用待处理队列编辑器。** 未采用，因为队列消息尚未进入模型历史。已定稿 prompt 的修订必须切断持久历史并创建新轮次。

**只删除当前 surface 节点。** 未采用，因为 compaction 可能已经替换所选消息；只有按时间顺序恢复才能得到正确前缀。

**只实现两个插件包。** 未采用，因为插件可以贡献行为，却不能在所属子系统之外安全模拟 Session 重放、投影分页、Assembler 重建、Remote 挂载或生命周期独占。

## 结果与限制

当前模型历史、普通 transcript 分页和当前消息搜索会排除被修订后缀，原始导出仍保留它。外部文件、进程、网络、feedback sidecar 和审计副作用永不回滚。系统不提供通用撤销；若要保留可见旧版本，必须先创建分支。

自动标题继续服从既有标题插件，用户固定标题保持不变。重新生成是基于当前配置的新执行。历史编辑 composer 只修改文本，Host 则保留原附件和其他非文本内容。
