# Agent Note: 当前 Session 历史修订

Status: implemented

[English](2026-08-16-current-session-history-revision.md) | 中文

## Problem

对已定稿 user 消息提供编辑控件，需要 Host 操作定义已经消费过它的轮次如何处理。复用待处理队列编辑器会让同一手势表达两种含义，只有 UI 的按钮则会宣告产品无法兑现的变更。回答重新生成也需要相同的历史切点、并发规则与审计处理。

## Decision

`session/retract` 记录从一个原始事件序号开始的时间顺序 `SurfaceOp` 删除。仅追加日志和原始导出保留全部旧事件，`projectCurrentBranch()` 则移除目标至 retract 的区间，并把之后的事件作为当前分支。Surface 重放会恢复目标之前的有效前缀，包括被后续 compaction replacement 遮蔽的 append 节点。

`@deepseek-ai/dsh-session-revision` 同时是 Host Service Definition 和默认 Provider。它的 Remote 方法可以编辑轮次开头的普通 user prompt，或从已完成 assistant 消息所属轮次的首条普通 prompt 重新生成。每次变更都会占用 `Agent.runMaintenance()`，比较调用方观察到的原始尾序号，复验空闲状态与空 inbox，拒绝 subagent 和合成输入，并在待丢弃区间包含工具调用时要求明确确认。

retract append 是提交点。编辑和重新生成随后用 Agent 当前配置排入一条新标识的普通 prompt；编辑会替换原文本块并保留非文本块，重新生成则保留全部原内容。之后的 flush 失败会返回已提交结果和独立的持久化失败，而不会声称已经回滚。

Web 历史按当前分支投影分页，并标记保留原始序号后出现间隙的页面。Client Runtime 收到实时 retract 后会重新读取尾页并重建 Conversation Assembler。`@deepseek-ai/dsh-client-ui-session-revision` 通过既有消息操作 slot 提供 user 与 assistant 操作；生命周期状态不允许时，控件保持可见并禁用。编辑历史 prompt 时会以原生卡片和主操作接管该 Session 的 composer，暂存用户草稿与草稿图片，在取消或提交后恢复，并在 RPC 拒绝时保留编辑文本供用户修正。

## Alternatives considered

**自动创建分支。** 未采用，因为编辑应保持当前 Session 标识和侧栏位置。需要同时保留两个版本时，用户应在修订前创建分支。

**修改或删除旧日志行。** 未采用，因为持久化、导出、遥测证据和工具副作用审计都依赖仅追加记录。

**复用待处理队列编辑器。** 未采用，因为队列消息尚未进入模型历史。已定稿 prompt 的修订必须切断持久历史并创建新轮次。

**只删除当前 surface 节点。** 未采用，因为 compaction 可能已经替换所选消息；只有按时间顺序恢复才能得到正确前缀。

## Consequences

当前模型历史、普通 transcript 分页和 current-surface 搜索会排除被修订后缀，原始导出仍保留它。外部文件、进程和网络副作用永不回滚。系统不提供通用撤销或独立撤回；若要保留可见旧版本，必须先创建分支。编辑 composer 只修改文本；Host 保留原附件与其他非文本块。
