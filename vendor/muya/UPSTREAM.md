# Muya 来源记录

- 包名：`@muyajs/core`
- 版本：`0.2.0`
- 来源目录：`D:\Code\Project\marktext-develop\packages\muya`
- 快照日期：`2026-09-15`
- 许可证：MIT，见同目录 `LICENSE`
- 文件范围：上游 `src/`、`package.json`，以及 MarkText 根目录 `LICENSE`
- 排除项：`node_modules/`、`lib/`、测试缓存和构建产物

来源目录不是 Git 工作树，因此没有可核验的 commit hash，禁止编造。快照通过内容清单指纹核验：按相对路径排序，每行记录“路径 + 文件 SHA-256”，再对 UTF-8 清单整体计算 SHA-256。

- 原始来源 SHA-256: `c53f4170b9b11b595061fe9f3e3a46740a9fd0f8e65585b70470d8027b329a4a`
- Trace 安全补丁后 SHA-256: `071e104ccf557d1bfac0c972cc2ee31385f3952fab39854430194f4595feb6d0`（文本源文件换行统一为 LF 后计算）

Trace 集成补丁包括：默认 PlantUML 服务器由公共服务改为空值，未配置服务器时拒绝创建远程图片请求；本地 `file:` 依赖的打包清单由上游构建产物 `lib/` 改为当前快照实际包含的 `src/`、许可证和来源记录，并移除仅供上游仓库开发使用的开发依赖（源码编译所需类型依赖由 Trace 根项目锁定）；源码入口显式引用上游全局声明；Prism 语言模块改由 Vite 静态 glob 收集，兼容依赖提升后的目录结构，其并行加载回调收窄为 TypeScript 5/Trace 合约要求的 `Promise<void>`；插件注册合约改为泛型选项并为段落前置按钮补齐稳定名称；图片编辑插件的宿主覆盖项改为可选，以匹配其运行时默认值。其余编辑器源码保持来源快照内容。
