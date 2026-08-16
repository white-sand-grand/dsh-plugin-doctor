# dsh-plugin-doctor

**English version: [README.en.md](README.en.md)**

DSH 插件生态的"体检医生"——灵感来自 Claude Code 的 `/doctor` 命令。你告诉它想要什么功能，它去社区找到合适的插件；如果发现你装的东西功能重复，它告诉你留哪个删哪个；如果社区根本没有，它直接给你一份"自己动手开发"的规格书。

> ✅ **当前状态：完整可用。** 已在 DSH v0.1.0-rc.6 上通过全部验证：构建、19 个单元测试、真实工具注册与调用、以及 Web UI 中的真实对话测试。装上即用。
>
> ⚠️ DSH 目前是 v0.1 开发者预览版，API 可能变化。插件已做了兼容保护（能力缺失时自动降级），但如果未来 DSH 大改，可能需要小调整。

## 它能帮你做三件事

| 你说 | 它做 |
| --- | --- |
| "帮我找一个记忆插件" | 去社区搜索，给你最匹配的几个，附安装命令 |
| "这个和我装的那个功能重复吗" | 分析功能重叠度，明确说"留 A 删 B"，附卸载命令 |
| "我想要一个 XXX，但找不到" | 确认社区没有之后，生成一份完整的开发规格书，照着写就行 |

## 一分钟上手

```sh
dsh plugin --profile web add github:white-sand-grand/dsh-plugin-doctor
dsh web
```

打开 `http://127.0.0.1:3080`，直接在对话里说人话即可，比如：

> 帮我找一个记忆插件，并检查是否和已安装的重复

Agent 会自动调用插件完成搜索、比对和建议，你只需要看结果。

## 装好之后多了哪三个工具

不需要记它们——Agent 会自己挑。列在这里只是方便你了解边界：

- **`plugin_community_search`**：搜索社区插件（GitHub 上带 `dsh-plugin` 标签的仓库），返回简介、功能标签、star 数、更新时间。
- **`plugin_similarity_analyze`**：把若干插件放在一起比对功能重叠度，找出"重复组"。
- **`plugin_recommend`**：综合以上两步，给出最终建议（推荐安装 / 建议卸载 / 建议自研 + 规格书）。

## 配置（可选，不配也能用）

所有配置都有合理默认值，跳过本节完全没问题。想调整时改 profile 的 patch 层即可：

| 配置项 | 默认值 | 大白话 |
| --- | --- | --- |
| `githubTokenEnv` | `DSH_PLUGIN_DOCTOR_GITHUB_TOKEN` | GitHub 访问令牌的环境变量名。配上令牌后搜索额度从每小时 60 次涨到 5000 次 |
| `githubToken` | 无 | 直接填令牌（不推荐写进文件，优先用上面的环境变量方式） |
| `similarityThreshold` | `0.8` | 重叠度超过多少算"功能重复"。调低会更激进地建议去重 |
| `cacheTtlMinutes` | `30` | 搜索结果缓存多久，避免反复请求 GitHub |
| `enableRegistryFallback` | `true` | GitHub 彻底连不上时，是否用内置的静态插件清单兜底 |

**令牌怎么配**（推荐方式）：去 GitHub → Settings → Developer settings → Personal access tokens 生成一个（不用勾任何权限），然后：

```bash
echo "DSH_PLUGIN_DOCTOR_GITHUB_TOKEN: ghp_你的令牌" > ~/.dsh/.credentials.yaml
chmod 600 ~/.dsh/.credentials.yaml
```

## 网络不好 / 被限流时会怎样

不用担心崩掉，插件有三层退路，按顺序降级：

1. 正常情况：实时查 GitHub（结果缓存 30 分钟）。
2. GitHub 限流或连不上：先用上次缓存的结果。
3. 连缓存都没有：用内置的社区插件清单（来自 dshplugin.world / dsh.pub 的快照）。

无论走到哪一层，回复里都会注明当前用的是哪层数据——你看到"降级"字样只是提示，不是故障，DSH 本体不受任何影响。

## 想参与开发

```sh
git clone git@github.com:white-sand-grand/dsh-plugin-doctor.git
cd dsh-plugin-doctor
pnpm install
pnpm run build     # 编译
pnpm test          # 跑测试
node verify-boot.mjs   # 冒烟：在真实 DSH 运行时里注册并调用一次
```

算法选型理由（为什么不用大模型算相似度）、代码结构、与 DSH 插件规范的对应关系，都在 [ARCHITECTURE.md](ARCHITECTURE.md)。提交代码前请看 [CONTRIBUTING.md](CONTRIBUTING.md)，发布前过一遍 [RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md)。

注意：`node_modules` 请固定在同一个环境里创建（Windows 或 WSL 二选一），两边混用会坏。

## 许可证

MIT。欢迎 fork——记得给你自己的仓库也打上 `dsh-plugin` 标签，这样这个插件（和整个社区）就能发现你。
