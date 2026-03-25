# RSS to X Bot

把原始 RSS 转换成两个输出：

- `public/feed.xml`: 检查用源文章 RSS，包含标题、摘要、原文正文提取结果
- `public/x-feed.xml`: 真正给 `IFTTT -> X` 使用的 RSS，内容是大模型生成后的可直接发帖文案

## 目录

```text
.
├─ .github/workflows/update-feed.yml
├─ data/sent-items.json
├─ public/feed.xml
├─ public/x-feed.xml
├─ src/build-rss.js
├─ src/extract-article.js
├─ src/fetch-feed.js
├─ src/generate-x-post.js
├─ src/index.js
├─ src/transform-post.js
└─ package.json
```

## 环境变量

必填：

- `RSS_SOURCE_URL`: 原始 RSS 地址
- `LLM_API_KEY`: 大模型 API Key
- `LLM_MODEL`: 模型名，例如 `gpt-4o-mini`、`deepseek-chat`

建议填写：

- `FEED_TITLE`: 检查用源 RSS 标题
- `FEED_LINK`: 检查用源 RSS 地址，例如 `https://<username>.github.io/<repo>/feed.xml`
- `FEED_DESCRIPTION`: 检查用源 RSS 描述
- `X_FEED_TITLE`: 最终发帖 RSS 标题
- `X_FEED_LINK`: 最终发帖 RSS 地址，例如 `https://<username>.github.io/<repo>/x-feed.xml`
- `X_FEED_DESCRIPTION`: 最终发帖 RSS 描述
- `POST_PREFIX`: 检查用源 RSS 的标题前缀
- `POST_SUFFIX`: 检查用源 RSS 的标题后缀
- `POST_MAX_LENGTH`: 检查用源 RSS 标题最大长度，默认 `260`
- `X_POST_PREFIX`: 生成 X 文案时的固定前缀
- `X_POST_SUFFIX`: 生成 X 文案时的固定后缀
- `X_POST_MAX_LENGTH`: X 贴文最大字符数（**含链接与末尾标签**），默认 **`260`**（为免费版约 280 上限留余量）。需要长帖可调高（如 `1200`），并配合 **X Premium** 与更大的 `LLM_MAX_TOKENS`。
- `X_POST_STYLE`: `teaser`（短引流贴）或 `long`（多句展开）。**留空时自动判断**：`X_POST_MAX_LENGTH ≤ 300` 视为 `teaser`，否则 `long`。`teaser` 模式下调用了另一套内置提示词：在极短篇幅内写高密度、强点击欲的英文钩子，再跟 URL 与少量标签（适合 **IFTTT 把 `EntryContent` 填进发帖内容** 的方案）。
- `MAX_X_FEED_ITEMS`: `x-feed.xml` 保留的最新去重贴文数量，默认 `3`
- `LLM_MAX_TOKENS`: 模型单次最多生成 token，默认 `650`；短贴可设约 `300`–`450` 省用量；长贴（`X_POST_MAX_LENGTH` 很大）可试 `800`–`1200`。
- `MAX_NEW_ITEMS`: 每次最多发布多少条新内容，默认 `3`
- `MAX_FEED_ITEMS`: 输出 RSS 最多保留多少条历史，默认 `30`
- `FETCH_ARTICLE_CONTENT`: 是否继续抓取原文页面，默认 `true`
- `ARTICLE_MAX_CHARS`: 抓取正文后最多保留多少字符，默认 `12000`
- `FETCH_TIMEOUT_MS`: 抓取文章页超时时间，默认 `15000`
- `ENABLE_LLM_POST_GENERATION`: 是否启用大模型生成贴文，默认 `true`
- `FORCE_REGENERATE_X_POSTS`: 是否强制重生成历史贴文，默认 `false`
- `LLM_API_URL`: OpenAI 兼容接口地址，默认 `https://api.openai.com/v1/chat/completions`
- `LLM_SYSTEM_PROMPT`: 自定义 system prompt
- `LLM_USER_PROMPT_TEMPLATE`: 自定义 user prompt 模板，支持变量 `{{title}}`、`{{summary}}`、`{{article_text}}`、`{{source_url}}`、`{{pub_date}}`、`{{x_post_max_length}}`、`{{x_post_soft_min_chars}}`、`{{x_post_style}}`（`teaser` / `long`）
- `LLM_TEMPERATURE`: 默认 `0.4`
- `LLM_TIMEOUT_MS`: 默认 `30000`

默认内置提示词分两种（由 `X_POST_STYLE` 或字数自动选择）：

**`teaser`（默认短贴）**：英文；在严格字数内写「爆炸式」引流句（强悬念/强对比/强结论，但仍忠于原文），**禁止**长篇技术分析式 recap；1～2 句钩子 + 链接 + 精简标签；可含 1～2 个 emoji。

**`long`（长预算）**：英文；用满大部分字数，多句展开，具体事实更多。

共性：事实优先、不捏造；带来源链接一次；标签与话题相关。

### 常见问题：`x-feed.xml` 仍是标题摘要拼接

运行后终端里如果出现 `LLM API HTTP 404`，说明 **`LLM_API_URL` 路径不对**。常见写法：

- OpenAI：`https://api.openai.com/v1/chat/completions`
- DeepSeek：`https://api.deepseek.com/v1/chat/completions`
- **Poe（必须用 api 子域）**：`https://api.poe.com/v1/chat/completions`  
  - 不要填成 `https://api.poe.com/v1/chat`（会 404）；必须是 **`/v1/chat/completions`**。  
  - Base URL 文档写的是 `https://api.poe.com/v1`，本仓库实际请求的是完整路径 `.../chat/completions`。  
  - API Key 在 [poe.com/api/keys](https://poe.com/api/keys)。  
  - `LLM_MODEL` 要填 **Poe 上显示的模型名**（例如 `Claude-Sonnet-4.5`、`Grok-4`），不要填只在 OpenAI 存在的模型 id。  
  - 若误填成网站域名 `https://poe.com` 会得到 **404**；也可在 `.env` 里把 `LLM_API_URL` 写成 `poe`，脚本会展开为上述地址。

若你只填了域名（例如 `https://api.deepseek.com`），程序会自动补上 `/v1/chat/completions`；若仍是 404，请对照该服务商文档把 **完整请求 URL** 填进 `LLM_API_URL`。

本地可将 `.env.example` 复制为项目根目录的 `.env` 并填写 Key；`npm run build` 时会自动加载 `.env`。

## 本地运行

安装依赖：

```bash
npm install
```

PowerShell 示例：

```powershell
$env:RSS_SOURCE_URL="https://hnrss.org/frontpage"
$env:FEED_TITLE="Blockchain News Source Feed"
$env:FEED_LINK="https://example.github.io/rss-to-x-bot/feed.xml"
$env:FEED_DESCRIPTION="Inspection feed with source articles"
$env:X_FEED_TITLE="Blockchain News X Posts"
$env:X_FEED_LINK="https://example.github.io/rss-to-x-bot/x-feed.xml"
$env:X_FEED_DESCRIPTION="Generated X-ready posts"
$env:POST_PREFIX="[News]"
$env:POST_SUFFIX="#crypto #blockchain"
$env:FETCH_ARTICLE_CONTENT="true"
$env:ARTICLE_MAX_CHARS="12000"
$env:FETCH_TIMEOUT_MS="15000"
$env:ENABLE_LLM_POST_GENERATION="true"
$env:LLM_API_URL="https://api.openai.com/v1/chat/completions"
$env:LLM_API_KEY="your_api_key"
$env:LLM_MODEL="gpt-4o-mini"
$env:LLM_TEMPERATURE="0.4"
$env:LLM_MAX_TOKENS="220"
$env:LLM_TIMEOUT_MS="30000"
npm run build
```

运行成功后会更新：

- `public/feed.xml`
- `public/x-feed.xml`
- `data/sent-items.json`

现在生成流程是：

1. 拉取原始 RSS
2. 进入原文链接抓取正文
3. 生成检查用 `public/feed.xml`
4. 调用大模型生成 X 贴文
5. 生成最终用的 `public/x-feed.xml`

`public/feed.xml` 里会尽量写入：

- `description` 中的 `Article text`
- `content:encoded` 字段

`public/x-feed.xml` 里会写入：

- `title`: 可直接发往 X 的贴文文案
- `description`: 与最终贴文一致，不再附带 title/summary 等分层说明
- `content:encoded`: 最终贴文正文
- 仅保留最新 `MAX_X_FEED_ITEMS` 条，并按 source+贴文内容去重（默认最新 3 条）

## GitHub Actions 配置

仓库上传后，在 GitHub 仓库中配置：

1. `Settings -> Secrets and variables -> Actions -> New repository secret`
2. 新建 `RSS_SOURCE_URL`
3. 再新建 `LLM_API_KEY`
4. 在 `Variables` 中按需新增 `FEED_TITLE`、`FEED_LINK`、`FEED_DESCRIPTION`、`X_FEED_TITLE`、`X_FEED_LINK`、`X_FEED_DESCRIPTION`、`POST_PREFIX`、`POST_SUFFIX`、`POST_MAX_LENGTH`、`X_POST_PREFIX`、`X_POST_SUFFIX`、`X_POST_MAX_LENGTH`、`X_POST_STYLE`、`MAX_NEW_ITEMS`、`MAX_FEED_ITEMS`、`FETCH_ARTICLE_CONTENT`、`ARTICLE_MAX_CHARS`、`FETCH_TIMEOUT_MS`、`ENABLE_LLM_POST_GENERATION`、`FORCE_REGENERATE_X_POSTS`、`LLM_API_URL`、`LLM_MODEL`、`LLM_SYSTEM_PROMPT`、`LLM_USER_PROMPT_TEMPLATE`、`LLM_TEMPERATURE`、`LLM_MAX_TOKENS`、`LLM_TIMEOUT_MS`

## GitHub Pages

在仓库中开启 Pages：

1. `Settings -> Pages`
2. `Build and deployment` 选择 `Deploy from a branch`
3. Branch 选择 `main`
4. Folder 选择 `/public`

之后你的 RSS 地址通常会是：

```text
https://<username>.github.io/<repo>/feed.xml
```

真正给 IFTTT 使用的地址应当是：

```text
https://<username>.github.io/<repo>/x-feed.xml
```
