# dsh-plugin-doctor

**English version: [README.en.md](README.en.md)**

`dsh-plugin-doctor` 是 DSH 插件生态的诊断与决策工具。它可以搜索社区插件、比较功能重复、识别聚合 bundle 提供的子插件、检查批量安装冲突、审计实际使用量，并生成插件全景关系图。

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
