# DSH 会话修订

[English](README.md) | 中文

DSH 会话修订是一个专注于历史提示词修正的 DeepSeek Harness 定制版本，让用户无需放弃当前会话即可修改早先的输入。它为 Web UI 增加同会话编辑与回答重新生成功能，并让交互方式与原生对话输入框保持一致。

历史修订同时涉及 Host 服务、事件日志、Client Runtime 和对话 UI，因此本仓库包含完整应用源码。本项目是独立定制版本，不是上游项目的发布渠道。

## 提供的功能

- **编辑用户提示词。** 选择一条已定稿的普通提示词，在原生输入框中修改文本，并从该轮次继续当前会话。
- **重新生成回答。** 选择一条已完成的 assistant 消息，使用原始用户提示词以及当前模型和工具设置重新执行该轮次。
- **保留当前会话。** 会话 ID、工作区、侧栏位置、固定标题、已有草稿和草稿图片均保持原位。
- **保留审计记录。** 可见历史与模型历史排除被替换的后缀，原始会话导出仍保留旧事件和修订记录。

本项目不提供独立撤回或通用撤销操作。编辑和重新生成不会还原已丢弃工具调用产生的文件变更、进程、网络请求或其他外部副作用；提交包含此类工具调用的修订前，UI 会要求用户确认。

## 编辑体验

编辑功能沿用 dsh 普通对话输入框的卡片、字体、间距、按钮和主发送操作。历史提示词的附件会继续保留，但不能在编辑时更换。取消编辑会恢复进入编辑前的草稿；请求被拒绝时，已修改文本会留在输入框中供用户继续修正。

会话正在运行、存在排队输入或目标不支持修订时，操作仍会显示，但处于禁用状态。Subagent 会话、steering（中途引导）、定时或 Goal 输入、合成消息、待处理提示词和中断的 partial 回答不在支持范围内。

## 运行

### 从源码运行

环境要求：

- Node.js `^22.19.0` 或 `>=24.0.0`
- pnpm `11.7.0`
- DeepSeek API key

在仓库根目录创建 `.env` 文件，不要将其提交：

```dotenv
DEEPSEEK_API_KEY=your_key_here
```

安装依赖、构建并启动 Web UI：

```sh
pnpm install
pnpm run build
pnpm dsh web
```

打开 `http://127.0.0.1:3080`。Web profile 默认加载两个会话修订包。

## 插件包

| 包 | 职责 |
| --- | --- |
| [`@deepseek-ai/dsh-session-revision`](packages/session/session-revision/README.md) | 校验修订请求、提交历史切点并提交替换提示词。 |
| [`@deepseek-ai/dsh-client-ui-session-revision`](packages/client/ui-session-revision/README.md) | 添加编辑和重新生成操作，并提供原生样式的编辑输入框。 |

## 开发

修改此功能后，运行针对会话修订的测试：

```sh
pnpm exec vitest run packages/session/session-revision/tests/revision.spec.ts packages/client/ui-session-revision/tests/revision-actions.client.spec.tsx
```

文档改动遵循仓库的双语配对流程。发布范围更大的改动前，通过[推送前检查流程](.agents/skills/dsh-pre-push-checks/SKILL.md)选择相关检查。

本定制版本基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 及其内置的 [Cordis](https://github.com/cordiverse/cordis) 运行时。

## 许可证

[MIT](LICENSE)。第三方许可证信息见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
