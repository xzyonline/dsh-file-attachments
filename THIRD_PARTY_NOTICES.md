# 第三方组件归因声明（THIRD-PARTY NOTICES）

本文件覆盖两个开源项目：`dsh-vision`（识图）与 `dsh-file-attachments`（文件识别/读取）。
所有依赖均为 OSI 批准的许可证（MIT / Apache-2.0 / BSD-3-Clause），与本项目许可证兼容。

## dsh-file-attachments（文件识别/读取）

| 依赖 | 许可证 | 用途 | 上游项目 |
|---|---|---|---|
| @keep-lts/xlsx | Apache-2.0 | 读取旧版 .xls（BIFF8） | SheetJS Community Edition © SheetJS LLC（Apache-2.0）之安全补丁 fork [keep-lts/xlsx](https://github.com/keep-lts/xlsx)；修复 CVE-2023-30533、CVE-2024-22363 |
| cfb | Apache-2.0 | OLE/CFB 容器判定（.doc/.xls/.ppt 区分） | SheetJS LLC [sheetjs/cfb](https://git.sheetjs.com/sheetjs/js-cfb) |
| pdfjs-dist | Apache-2.0 | PDF 文本提取 | Mozilla [mozilla/pdf.js](https://github.com/mozilla/pdf.js) |
| word-extractor | MIT | 读取 Word 97-2003（.doc/.wps） | [morungos/word-extractor](https://github.com/morungos/word-extractor) |
| fflate | MIT | zip 解压（OOXML/ODF/EPUB） | [101arrowz/fflate](https://github.com/101arrowz/fflate) |
| file-type | MIT | 文件魔数检测 | [sindresorhus/file-type](https://github.com/sindresorhus/file-type) |
| schemastery | MIT | 工具参数 schema | @deepseek-ai/schemastery（源自 [koishi/schemastery](https://github.com/koishijs/schemastery)） |
| react | MIT | 客户端 UI（peer） | Meta [facebook/react](https://github.com/facebook/react) |

框架 peer 依赖（运行宿主提供）：@deepseek-ai/cordis、dsh-* 系列（DeepSeek Harness，MIT）。

注：`fast-xml-parser` 曾为依赖，因零引用（死依赖）已于 2026-08-15 移除。

## 复刻与参考声明（非依赖，仅引用/借鉴，不据为己有）

| 对象 | 许可证 | 用途 | 上游 |
|---|---|---|---|
| DeepSeek Harness 官方客户端包 `@deepseek-ai/dsh-client-ui-conversation` 的 UserMessageNodeView（contentParts / projectText 正文与引用高亮逻辑） | MIT（同仓库） | `src/client/UserMessageWithReceipt.tsx` 复刻其用户消息渲染，以在气泡下方附加附件回执；已在源码头注释归因 | [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) |
| `@linxin666/dsh-client-ui-skin-center` 的 ensureSymlink（Windows 目录联接回退与链接校验策略） | Apache-2.0 | `scripts/install.mjs` 参考其链接策略；已在脚本头注释归因 | [zhu1090093659/dsh-web-ui](https://github.com/zhu1090093659/dsh-web-ui) |
| 「深海女仆工坊 maid-atelier」皮肤（仅出现在 README 演示截图中，不随本插件分发） | CC BY-NC-SA 4.0 | 界面演示皮肤；署名链：角色原作 **上善**（[Pixiv](https://www.pixiv.net/users/62155430) / [Bilibili](https://b23.tv/8h5L4xz)）→ 二创 **ZipZipPipe**（[Pixiv](https://www.pixiv.net/users/18604994) / [Bilibili](https://b23.tv/Pnw6nG8)）→ 三创 **Small-tailqwq** | [Small-tailqwq/dsh-deep-whale](https://github.com/Small-tailqwq/dsh-deep-whale) |

## dsh-vision（识图）

| 依赖 | 许可证 | 用途 | 上游项目 |
|---|---|---|---|
| schemastery | MIT | 工具参数 schema | @deepseek-ai/schemastery（源自 koishi/schemastery） |
| （无其他运行时依赖） | — | 调用任意 OpenAI 兼容 VLM 端点（原生 fetch），无 SDK | — |

说明：识图能力转发到用户自备的 VLM 服务（智谱 GLM-4.6V / 通义 qwen3-vl / Ollama 本地模型等），
本项目不内置、不捆绑任何模型权重或第三方服务密钥。

---

*以上版权与许可归各上游项目及其作者所有。生成日期：2026-08-15。*
