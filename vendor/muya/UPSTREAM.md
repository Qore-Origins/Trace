# Muya 来源记录

- 包名：`@muyajs/core`
- 版本：`0.2.0`
- 来源目录：`D:\Code\Project\marktext-develop\packages\muya`
- 快照日期：`2026-09-15`
- 许可证：MIT，见同目录 `LICENSE`
- 文件范围：上游 `src/`、`package.json`，以及 MarkText 根目录 `LICENSE`
- 排除项：`node_modules/`、`lib/`、测试缓存和构建产物

来源目录不是 Git 工作树，因此没有可核验的 commit hash，禁止编造。快照通过内容清单指纹核验：按相对路径排序，每行记录“路径 + 文件 SHA-256”，再对 UTF-8 清单整体计算 SHA-256。

- 原始来源 SHA-256: `4a00f38aeb78ed9de98d0ab722c4ec9c125e0312ef1437919bae10d06872d8e2`
- Trace 安全补丁后 SHA-256: `1c30d9389a35b8e24fc7374efa1fac6a4cc4467618743b6a11eec135dbbca788`

Trace 安全补丁仅改变 PlantUML 默认联网行为：默认服务器由公共 PlantUML 服务改为空值；未配置服务器时拒绝创建远程图片请求。其余编辑器源码保持来源快照内容。
