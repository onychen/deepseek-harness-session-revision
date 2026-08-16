# @deepseek-ai/dsh-session-revision

[English](README.md) | 中文

Host 服务，用于在同一 Session 中编辑普通 prompt，以及重新生成已完成回答。原始事件继续用于审计和导出；当前模型历史只跟随最新修订分支。

`sessionRevision` Remote 暴露 `edit` 和 `regenerate`。每个请求都会比较 `expectedLastSeq`，仅在 Agent 空闲且 inbox 为空时执行；待丢弃范围包含工具调用时必须明确确认。修订一旦提交就不会伪装成回滚：flush 失败会与已提交序号一起返回 `persistence: 'failed'`。

## 模型体验

### 修订后的轮次

#### 模型看到什么

编辑与重新生成会保留所选轮次之前的有效历史，并排入一条新的普通 `user/message` prompt。编辑替换文本并保留原有非文本块；重新生成保留原 prompt。被移除的回答、工具调用和工具结果均不可见。

#### Token 影响

下一次请求包含保留前缀与替换 prompt，并使用当前模型、工具、preset 与推理设置。被移除后缀的 token 不再进入该请求；新回答按常规方式生成和计费。

#### KV Cache 影响

修订位置之前的保留前缀仍可能复用。替换 prompt 及其后生成的全部内容构成新后缀。

## 已知限制与延期工作

- 已丢弃工具调用造成的外部副作用不会回滚。
- subagent Session、steering、插件输入、Goal 或计划任务输入、待处理消息以及中断的 partial 助手输出不可修订。
