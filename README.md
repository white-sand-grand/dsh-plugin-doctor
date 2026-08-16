# dsh-plugin-doctor

**English version: [README.en.md](README.en.md)**

**Compatible with DSH v0.1.x (developer preview).** DSH 尚处预发布阶段；本插件在调用前检测能力存在性，但仍可能随 DSH 演进需要调整。

DSH（[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)）社区插件"医生"——灵感来自 Claude Code 的 `/doctor` 命令：给插件生态做体检。它搜索 DSH 社区生态（GitHub `dsh-plugin` topic），分析插件间的相似度与功能冗余，并给出安装 / 去重 / 自己动手开发的三选一决策。

## 暴露给 Agent 的工具

| 工具 | 用途 |
| --- | --- |
| `plugin_community_search` | 按自然语言意图搜索 `dsh-plugin` GitHub topic；返回名称、描述、capabilities、依赖、stars、更新时间。 |
| `plugin_similarity_analyze` | TF-IDF + Jaccard 相似度矩阵、冗余簇（默认阈值 0.8）、每个插件的不可替代性评分。 |
| `plugin_recommend` | 三分支决策：推荐最佳社区匹配；建议卸载冗余的已装插件（附 `dsh plugin remove` 命令）；社区没有合适的就生成一份 Plugin Spec。 |

试一试：“帮我找一个记忆插件，并检查是否和已安装的重复”。

## 安装

```sh
dsh plugin --profile web add github:white-sand-grand/dsh-plugin-doctor
# 或从本地检出目录：
dsh plugin --profile web add /absolute/path/to/dsh-plugin-doctor
```

然后启动 DSH（`dsh web`），在对话里让 Agent 使用上述工具即可。

## 配置

所有字段位于 `plugin-doctor` 设置命名空间 / 插件条目的 `config` 块：

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `githubTokenEnv` | `DSH_PLUGIN_DOCTOR_GITHUB_TOKEN` | GitHub PAT 凭据引用（可选，提升 API 限额）。经 DSH credentials seam 解析——绝不硬编码 token。 |
| `githubToken` | – | 字面量 secret；优先用 `githubTokenEnv`。 |
| `similarityThreshold` | `0.8` | 判定两个插件构成冗余簇的总体相似度门槛。 |
| `cacheTtlMinutes` | `30` | 社区清单缓存寿命；保护 GitHub API 限额。 |
| `enableRegistryFallback` | `true` | GitHub 不可达时是否使用内置第三方 registry 静态快照。 |

**Web UI 设置卡片**：插件已向宿主设置服务注册命名空间（secret 字段在描述符中脱敏），但 DSH 的 Web 设置页只渲染宿主 API 代理白名单（`WEB_SETTINGS_NAMESPACES`）内的命名空间。本插件刻意不去改核心代码——在 DSH 向插件开放该入口之前，请通过 profile patch 层或设置文件配置。

## 降级行为

1. 实时 GitHub API（前置 30 分钟 TTL 缓存）。
2. 失败时（限流 403/429、网络错误）：有旧缓存则用旧缓存。
3. 否则：内置 registry 静态快照（来自 dshplugin.world / dsh.pub 清单）；`enableRegistryFallback: false` 可关闭。

降级会在工具输出中明确注明；任何错误都不会阻塞 DSH 宿主。

## 架构

相似度算法选型（为何用 TF-IDF + Jaccard 而非 LLM embedding）与从最初 `HarnessPlugin` 草案到真实 Cordis 插件模型的适配说明，见 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 开发

```sh
pnpm install
pnpm run build
pnpm test
node verify-boot.mjs   # 冒烟：把构建产物挂到真实 Cordis Context + ToolRuntime 上
```

`verify-boot.mjs` 会通过发布版 `@deepseek-ai/dsh-tools` 运行时注册三个工具，并端到端执行一次 `plugin_recommend`（实时 GitHub，限流时走降级链）。`node_modules` 请保持在同一个环境里创建（Windows 与 WSL 的 pnpm 布局不可互换）。

## 许可证

MIT。给你的 fork 加上 `dsh-plugin` topic，社区（以及本插件自己）就能发现它。
