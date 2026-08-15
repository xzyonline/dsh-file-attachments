# 第三方组件归因声明（THIRD-PARTY NOTICES）

本文件覆盖两个拟开源项目：`dsh-vision`（识图）与 `dsh-file-attachments`（文件识别/读取）。
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
| fast-xml-parser | MIT | XML 解析 | [NaturalIntelligence/fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser) |
| schemastery | MIT | 工具参数 schema | @deepseek-ai/schemastery（源自 [koishi/schemastery](https://github.com/koishijs/schemastery)） |
| react | MIT | 客户端 UI（peer） | Meta [facebook/react](https://github.com/facebook/react) |

框架 peer 依赖（运行宿主提供）：@deepseek-ai/cordis、dsh-* 系列（DeepSeek Harness，MIT）。

## dsh-vision（识图）

| 依赖 | 许可证 | 用途 | 上游项目 |
|---|---|---|---|
| schemastery | MIT | 工具参数 schema | @deepseek-ai/schemastery（源自 koishi/schemastery） |
| （无其他运行时依赖） | — | 调用任意 OpenAI 兼容 VLM 端点（原生 fetch），无 SDK | — |

说明：识图能力转发到用户自备的 VLM 服务（智谱 GLM-4.6V / 通义 qwen3-vl / Ollama 本地模型等），
本项目不内置、不捆绑任何模型权重或第三方服务密钥。

---

*以上版权与许可归各上游项目及其作者所有。生成日期：2026-08-15。*
