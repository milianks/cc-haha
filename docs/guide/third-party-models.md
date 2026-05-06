# 使用第三方模型（OpenAI / DeepSeek / OpenRouter / 本地模型）

本项目的 CLI 侧仍使用 Anthropic Messages 协议。Provider 可以分三类接入：

- Anthropic Messages 兼容端点：直连，例如 MiniMax、Kimi、DeepSeek、智谱 GLM。
- OpenAI Chat Completions / Responses 端点：走 yuanclaw 内置协议转换代理，不需要 LiteLLM。
- 其他不兼容服务：再用 LiteLLM 或其他外部代理兜底。

## 原理

```
yuanclaw CLI ──Anthropic Messages──▶ yuanclaw provider/proxy ──目标协议──▶ 目标模型 API
```

yuanclaw 内置 provider 支持 `anthropic`、`openai_chat` 和 `openai_responses` 三种 API 格式。激活 `openai_*` provider 后，CLI 会连接本地 `/proxy/v1/messages`，由 server 把 Anthropic 请求转换到 OpenAI 协议，再把响应转换回来。

---

## 方式一：使用内置 provider（推荐）

内置 provider 会写入 `~/.claude/yuanclaw/settings.json`，不会污染原版 `~/.claude/settings.json`。通过界面或 API 添加 provider 时选择对应 preset 即可。

### OpenAI Responses

Provider preset：

```json
{
  "presetId": "openai",
  "baseUrl": "https://api.openai.com",
  "apiFormat": "openai_responses",
  "authStrategy": "auth_token",
  "models": {
    "main": "gpt-5.2",
    "haiku": "gpt-5-mini",
    "sonnet": "gpt-5.2",
    "opus": "gpt-5.2"
  }
}
```

激活后实际写入类似：

```env
ANTHROPIC_BASE_URL=http://127.0.0.1:3456/proxy
ANTHROPIC_API_KEY=proxy-managed
ANTHROPIC_MODEL=gpt-5.2
ANTHROPIC_DEFAULT_HAIKU_MODEL=gpt-5-mini
ANTHROPIC_DEFAULT_SONNET_MODEL=gpt-5.2
ANTHROPIC_DEFAULT_OPUS_MODEL=gpt-5.2
API_TIMEOUT_MS=3000000
CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
```

真正的 OpenAI key 保存在 yuanclaw provider 记录里，由 server 访问上游 `/v1/responses`。

### OpenRouter / OpenAI Chat Completions

```json
{
  "presetId": "openrouter",
  "baseUrl": "https://openrouter.ai/api",
  "apiFormat": "openai_chat",
  "authStrategy": "auth_token",
  "models": {
    "main": "openai/gpt-4o",
    "haiku": "openai/gpt-4o-mini",
    "sonnet": "openai/gpt-4o",
    "opus": "openai/gpt-4o"
  }
}
```

`openai_chat` 会转发到 `${baseUrl}/v1/chat/completions`。OpenRouter 的 model 使用 `provider/model` 格式。

### 自定义 OpenAI 兼容 provider

如果服务支持 OpenAI 协议但没有内置 preset，新增 Custom provider：

- `apiFormat=openai_chat`：目标服务支持 `/v1/chat/completions`。
- `apiFormat=openai_responses`：目标服务支持 `/v1/responses`。
- `baseUrl` 填到 API 根地址，不要追加 `/v1/chat/completions` 或 `/v1/responses`。

---

## 方式二：直连兼容 Anthropic 协议的第三方服务

部分第三方服务直接兼容 Anthropic Messages API，无需协议转换：

### MiniMax

```env
ANTHROPIC_AUTH_TOKEN=your_minimax_api_key_here
# 海外用户使用 api.minimax.io，国内用户可改为 api.minimaxi.com
ANTHROPIC_BASE_URL=https://api.minimax.io/anthropic
ANTHROPIC_MODEL=MiniMax-M2.7
ANTHROPIC_DEFAULT_SONNET_MODEL=MiniMax-M2.7
ANTHROPIC_DEFAULT_HAIKU_MODEL=MiniMax-M2.7-highspeed
ANTHROPIC_DEFAULT_OPUS_MODEL=MiniMax-M2.7
API_TIMEOUT_MS=3000000
DISABLE_TELEMETRY=1
CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
```

### Kimi for Coding

```env
ANTHROPIC_AUTH_TOKEN=your_kimi_key
ANTHROPIC_BASE_URL=https://api.kimi.com/coding
ANTHROPIC_MODEL=kimi-k2.6
ANTHROPIC_DEFAULT_SONNET_MODEL=kimi-k2.6
ANTHROPIC_DEFAULT_HAIKU_MODEL=kimi-k2.6
ANTHROPIC_DEFAULT_OPUS_MODEL=kimi-k2.6
YUANCLAW_SEND_DISABLED_THINKING=1
```

### DeepSeek Anthropic 兼容端点

```env
ANTHROPIC_AUTH_TOKEN=your_deepseek_key
ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
ANTHROPIC_MODEL=deepseek-v4-pro
ANTHROPIC_DEFAULT_SONNET_MODEL=deepseek-v4-pro
ANTHROPIC_DEFAULT_HAIKU_MODEL=deepseek-v4-flash
ANTHROPIC_DEFAULT_OPUS_MODEL=deepseek-v4-pro
YUANCLAW_SEND_DISABLED_THINKING=1
```

---

## 方式三：LiteLLM 代理（兜底）

[LiteLLM](https://github.com/BerriAI/litellm) 是一个支持 100+ LLM 的统一代理网关（41k+ GitHub Stars），原生支持接收 Anthropic 协议请求。

### 1. 安装 LiteLLM

```bash
pip install 'litellm[proxy]'
```

### 2. 创建配置文件

新建 `litellm_config.yaml`：

#### 使用 OpenAI 模型

```yaml
model_list:
  - model_name: gpt-4o
    litellm_params:
      model: openai/gpt-4o
      api_key: os.environ/OPENAI_API_KEY

litellm_settings:
  drop_params: true  # 丢弃 Anthropic 专有参数（thinking 等）
```

#### 使用 DeepSeek 模型

```yaml
model_list:
  - model_name: deepseek-chat
    litellm_params:
      model: deepseek/deepseek-chat
      api_key: os.environ/DEEPSEEK_API_KEY
      api_base: https://api.deepseek.com

litellm_settings:
  drop_params: true
```

#### 使用 Ollama 本地模型

```yaml
model_list:
  - model_name: llama3
    litellm_params:
      model: ollama/llama3
      api_base: http://localhost:11434

litellm_settings:
  drop_params: true
```

#### 使用多个模型（可在启动后切换）

```yaml
model_list:
  - model_name: gpt-4o
    litellm_params:
      model: openai/gpt-4o
      api_key: os.environ/OPENAI_API_KEY

  - model_name: deepseek-chat
    litellm_params:
      model: deepseek/deepseek-chat
      api_key: os.environ/DEEPSEEK_API_KEY
      api_base: https://api.deepseek.com

  - model_name: llama3
    litellm_params:
      model: ollama/llama3
      api_base: http://localhost:11434

litellm_settings:
  drop_params: true
```

### 3. 启动代理

```bash
# 设置目标模型的 API Key
export OPENAI_API_KEY=sk-xxx
# 或
export DEEPSEEK_API_KEY=sk-xxx

# 启动代理
litellm --config litellm_config.yaml --port 4000
```

代理启动后会在 `http://localhost:4000` 监听，并暴露 Anthropic 兼容的 `/v1/messages` 端点。

### 4. 配置本项目

有两种配置方式，任选其一：

#### 方式 A：通过 `.env` 文件

```env
ANTHROPIC_AUTH_TOKEN=sk-anything
ANTHROPIC_BASE_URL=http://localhost:4000
ANTHROPIC_MODEL=gpt-4o
ANTHROPIC_DEFAULT_SONNET_MODEL=gpt-4o
ANTHROPIC_DEFAULT_HAIKU_MODEL=gpt-4o
ANTHROPIC_DEFAULT_OPUS_MODEL=gpt-4o
API_TIMEOUT_MS=3000000
DISABLE_TELEMETRY=1
CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
```

#### 方式 B：通过 `~/.claude/settings.json`

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "sk-anything",
    "ANTHROPIC_BASE_URL": "http://localhost:4000",
    "ANTHROPIC_MODEL": "gpt-4o",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "gpt-4o",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "gpt-4o",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "gpt-4o",
    "API_TIMEOUT_MS": "3000000",
    "DISABLE_TELEMETRY": "1",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"
  }
}
```

> **说明**：`ANTHROPIC_AUTH_TOKEN` 的值在使用 LiteLLM 代理时可以是任意字符串（LiteLLM 会用自己配置的 key 转发），除非你在 LiteLLM 端设置了 `master_key` 校验。

### 5. 启动并验证

```bash
./bin/yuanclaw
```

如果一切正常，你应该能看到正常的对话界面，实际调用的是你配置的目标模型。

---

## 方式四：其他代理工具

社区还有一些专门为 Claude Code 做的代理工具：

| 工具 | 说明 | 链接 |
|------|------|------|
| **a2o** | Anthropic → OpenAI 单二进制文件，零依赖 | [Twitter](https://x.com/mantou543/status/2018846154855940200) |
| **Empero Proxy** | 完整的 Anthropic Messages API 转 OpenAI 代理 | [Twitter](https://x.com/EmperoAI/status/2036840854065762551) |
| **Alma** | 内置 OpenAI → Anthropic 转换代理的客户端 | [Twitter](https://x.com/yetone/status/2003508782127833332) |
| **Chutes** | Docker 容器，支持 60+ 开源模型 | [Twitter](https://x.com/chutes_ai/status/2027039742915662232) |

---

## 注意事项与已知限制

### 1. 内置 OpenAI proxy 不需要 LiteLLM

如果目标服务支持 OpenAI Chat Completions 或 Responses API，优先使用 `openai_chat` / `openai_responses` provider。LiteLLM 只作为目标服务不兼容内置 proxy 时的兜底。

### 2. `drop_params: true` 只对 LiteLLM 重要

本项目会发送 Anthropic 专有参数（如 `thinking`、`cache_control`）。使用 LiteLLM 时必须设置 `drop_params: true`，否则请求可能报错。使用 yuanclaw 内置 provider 时不需要配置 LiteLLM。

### 3. Extended Thinking 不可用

Anthropic 的 Extended Thinking 功能是专有特性，其他模型不支持。使用第三方模型时此功能自动失效。

### 4. Prompt Caching 取决于上游

`cache_control` 是 Anthropic 专有功能。使用 OpenAI 兼容 provider 时，prompt caching 通常不会生效。

### 5. 工具调用兼容性

本项目大量使用工具调用。yuanclaw 内置 proxy 会转换 Anthropic `tool_use` 与 OpenAI function calling；大部分情况下可以正常工作，但弱模型或非标准兼容服务可能存在工具调用缺失、参数 JSON 不完整等问题。

### 6. 遥测和非必要网络请求

建议配置以下环境变量以避免不必要的网络请求：
```
DISABLE_TELEMETRY=1
CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
```

---

## FAQ

### Q: LiteLLM 代理报错 `/v1/responses` 找不到？

部分 OpenAI 兼容服务只支持 `/v1/chat/completions`。在 LiteLLM 配置中添加：

```yaml
litellm_settings:
  use_chat_completions_url_for_anthropic_messages: true
```

### Q: `ANTHROPIC_API_KEY` 和 `ANTHROPIC_AUTH_TOKEN` 有什么区别？

- `ANTHROPIC_API_KEY` → 通过 `x-api-key` 请求头发送
- `ANTHROPIC_AUTH_TOKEN` → 通过 `Authorization: Bearer` 请求头发送

LiteLLM 代理默认接受 Bearer Token 格式，建议使用 `ANTHROPIC_AUTH_TOKEN`。

### Q: 可以同时配置多个模型吗？

可以。在 `litellm_config.yaml` 中配置多个 `model_name`，然后通过修改 `ANTHROPIC_MODEL` 切换。

### Q: 本地 Ollama 模型效果不好怎么办？

本项目的系统提示和工具调用对模型能力要求较高。建议使用参数量较大的模型（如 Llama 3 70B+, Qwen 72B+），小模型可能无法正确处理工具调用。
