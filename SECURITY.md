# 安全策略（Security Policy）

## 报告漏洞

请勿在公开 issue 中披露细节。请通过 GitHub Security Advisory（仓库 Security 页 → Report a vulnerability）报告；
我们会尽力在 7 天内确认、30 天内修复。

## 支持范围

- 各文件解析器（pdf / ooxml / legacy / archive）对不可信输入的健壮性
- 会话鉴权与附件隔离（附件仅归属会话可读）
- 依赖供应链（本仓库以 `pnpm audit` 保持 0 已知漏洞）

## 已知限制

- 旧版 .ppt（CFB PowerPoint）暂不支持读取，请转换为 .pptx
- 文本输出脱敏为行级启发式规则，不构成保密承诺
- 解析超时/体积上限为工程防护，不保证抵抗无限资源攻击
