# @deepseek-ai/dsh-client-ui-session-revision

[English](README.md) | 中文

为普通用户消息增加“编辑”，为已完成的助手消息增加“重新生成”。控件调用 Host 的 `sessionRevision` Remote；Session 运行中或队列非空时禁用；待丢弃范围包含工具调用时先确认。

编辑期间会使用原生 composer 的卡片、排版与主操作临时接管该 Session 的 composer。用户已有草稿及草稿图片会被保存，取消或提交后恢复；RPC 拒绝时保留编辑文本；界面同时说明历史 prompt 的原附件会继续保留。

## 模型体验

通过 `sessionRevision` Host Remote 间接影响模型：编辑与重新生成会在提交修订后排入一条新的普通 prompt，因此下一次模型请求使用 Session 当前设置。

#### KV Cache 影响

编辑或重新生成会使修订 prompt 之后的缓存复用失效；它之前的有效前缀保持不变。

## 已知限制与延期工作

- 历史附件只会保留，不能在编辑时替换；若要更换附件，需要发送新 prompt。
