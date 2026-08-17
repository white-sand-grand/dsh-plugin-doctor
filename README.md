# dsh-plugin-doctor

**English version: [README.en.md](README.en.md)**

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

`dsh-plugin-doctor` 是 DSH 插件生态的诊断与决策工具。它可以搜索社区插件、比较功能重复、识别聚合 bundle 提供的子插件、检查批量安装冲突、审计实际使用量，并生成插件全景关系图。
灵感来源自 claude code 的命令 "/doctor" 以及无数次下载插件造成的崩溃和冲突。

当前版本：`0.8.0`。插件要求 Node.js `>=22.19`，默认只读，不会自行安装、卸载或启动 Web UI。

## 安装

在运行 DSH 的同一环境中执行：

```sh
dsh plugin --profile web add github:white-sand-grand/dsh-plugin-doctor
```

然后按你自己的方式启动 DSH Web：

```sh
dsh web
```

打开 `http://127.0.0.1:3080` 后直接用自然语言提问。插件不会替你启动 Web，也不会改变已有 profile 的其他插件。

## 更新

使用移除后重新添加的确定性流程：

```sh
dsh plugin --profile web remove dsh-plugin-doctor
dsh plugin --profile web add github:white-sand-grand/dsh-plugin-doctor
```

更新后是否启动 Web 由你决定：

```sh
dsh web
```

## 能做什么

| 用户需求 | 工具行为 |
| --- | --- |
| 找一个插件 | 搜索 GitHub `dsh-plugin` 主题和降级数据源，返回匹配度、功能标签、stars、更新时间和安装引用 |
| 判断功能是否重复 | 比较说明文本、功能标签和依赖，并给出去重或自研建议 |
| 询问插件有什么联系 | 生成相似度关系图；节点带中文功能解释，连线说明相似度及重叠来源 |
| 安装多个仓库前检查风险 | 预检包名、工具名、Cordis patch 行和 peer 依赖；冲突或无法检查时返回 `INSTALL BLOCKED` |
| 检查聚合 bundle | 展开已安装的 DSH 插件形依赖；子插件标记 `providedBy`，不会被建议单独卸载 |
| 查看实际使用情况 | 扫描本地已落盘 session 日志，按 `dsh.tools` 统计调用量、会话数和最近使用时间 |
| 查看插件总体格局 | 生成 Mermaid 关系图，并按 `core`、`active`、`idle`、`review` 分层 |

## 六个工具

- `plugin_community_search`：社区插件搜索与过滤。
- `plugin_similarity_analyze`：相似度、重复组和不可替代性分析。
- `plugin_recommend`：综合搜索和本地库存做安装、去重或自研决策。
- `plugin_install_guard`：批量安装预检，只读不安装。
- `plugin_usage_audit`：本地 session 用量审计，不上传日志。
- `plugin_landscape`：插件全景与关系图，可把社区候选加入图中。

Agent 会根据问题自动选择工具。

## 具体使用例子

### 搜索并检查重复

```text
帮我找一个记忆插件，并检查它是否和 web profile 里已有插件重复。
```

结果会列出候选插件、匹配原因、与本地插件的重叠分数，以及“保留哪个、移除哪个”的命令。需要生成自研规格或执行去重时，Agent 会先请求确认。

### 批量安装前阻止冲突

```text
我要同时安装以下仓库，请先检查它们会不会冲突：
github:owner/plugin-a
github:owner/plugin-b
github:owner/plugin-c
```

如果 GitHub 返回 `403/429`，或仓库元数据无法读取，结果会是 `INSTALL BLOCKED`，并告诉你配置 token 或等待限流重置；它不会因为“暂时查不到”而放行。

### 查看插件关系

```text
之前安装的插件之间有什么联系？哪些功能相似？
```

`plugin_landscape` 会返回关系图。每个节点有中文功能解释，每条连线说明相似度来自说明文本、功能标签还是依赖重叠；传入具体意图时，社区候选会以虚线加入图中。

### 识别聚合 bundle

```text
我想安装任务看板，需要再安装一个 task-board 插件吗？
```

推荐逻辑会读取已安装聚合 bundle 的插件形依赖。如果功能已经由 bundle 提供，会显示 `providedBy` 来源，不会建议把子插件单独卸载或重复安装。

### 审计使用量

```text
列出 web profile 中声明了工具但从未使用的插件。
```

结果来自本地已落盘 session 日志，不上传内容。当前尚未结束或尚未刷盘的会话可能尚未计入，报告会明确提示。

## 直接提问与使用 doctor 的区别

直接对 DSH 说“帮我找个插件”时，模型通常只能根据已有上下文给出一般性建议，不能稳定地搜索社区、读取本地包元数据、量化相似度或检查 Cordis 注册冲突。安装多个仓库时也可能跳过预检。

安装 doctor 后，同样的问题会获得可复核的结构化结果：

| 直接提问 DSH | 使用 `dsh-plugin-doctor` |
| --- | --- |
| 依赖模型记忆或临时搜索 | 使用 GitHub、缓存和 registry 降级链，并注明数据来源 |
| “看起来重复”但没有数值依据 | 返回文本、功能标签、依赖三类相似度和重复组 |
| 可能漏掉聚合 bundle 内的子插件 | 读取已安装 bundle 依赖并标记 `providedBy` |
| 多个仓库直接尝试安装 | 先检查包名、工具名、patch 行和 peer 依赖；无法验证时失败关闭 |
| 很难知道插件是否真正被使用 | 从本地 session 日志统计调用量、会话数和最近使用时间 |
| 只能用文字描述插件关系 | 输出 Mermaid 关系图和逐对中文解释 |

## 安全与降级

`plugin_install_guard` 在检查不到仓库元数据时保持失败关闭。GitHub `403` 或 `429` 会提示配置 token 或等待限流重置，未知状态不会被当作安全。

社区搜索按以下顺序降级：实时 GitHub、进程内缓存、第三方 registry 页面、内置静态快照。结果会注明数据来源。

用量审计只读取已经写入磁盘的 session 文件。当前尚未结束或尚未刷盘的会话可能不会计入，报告会明确提示。损坏文件会跳过并计数；Node 不支持 zstd 时，压缩日志会跳过，但不会阻止其他工具加载。

## 可选配置

| 配置 | 默认值 | 作用 |
| --- | --- | --- |
| `githubTokenEnv` | `DSH_PLUGIN_DOCTOR_GITHUB_TOKEN` | GitHub token 的环境变量名 |
| `githubToken` | 无 | 直接提供 token，不建议写入文件 |
| `similarityThreshold` | `0.8` | 判定功能重复的相似度阈值 |
| `cacheTtlMinutes` | `30` | 社区搜索缓存时长 |
| `enableRegistryFallback` | `true` | GitHub 失败时启用 registry 和静态快照降级 |
| `allowExecuteActions` | `false` | 允许在明确交互确认后执行 add/remove；默认只输出命令 |

推荐只配置 token 环境变量：

```sh
export DSH_PLUGIN_DOCTOR_GITHUB_TOKEN='你的 GitHub token'
```

## 从源码开发

```sh
git clone https://github.com/white-sand-grand/dsh-plugin-doctor.git
cd dsh-plugin-doctor
pnpm install
pnpm test
pnpm run build
node verify-boot.mjs
```

当前验证基线：`56` 个测试通过，TypeScript 构建通过，六个工具注册和冒烟调用通过。算法和数据流见 [ARCHITECTURE.md](ARCHITECTURE.md)，贡献流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。Windows 和 WSL 不要混用同一个 `node_modules`。

## 许可证

MIT。
