# Agent Card 草稿旁注 — 字段依据与未核实清单

起草时间：2026-11-26（第二阶段）。文件：`buyer-agent-card.json`、`seller-agent-card.json`。
性质：**注册前草稿**，不是最终托管版。最终版必须由 MCP 工具 `build_agent_card` 生成——该工具会自动注入徽章扩展、`registrations` 条目与全部 Concordium 专用字段，并返回 canonical JSON 与其 SHA-256；托管时必须逐字节服务该原文（官方文档 “Agent Card — Building and hosting a card”）。本草稿的作用是把内容（name/description/skills/services）先定稿，届时作为 `build_agent_card` 的入参依据。

## 字段依据（已核实来源）

官方 Agent Card 规范页（2026-11-26 查）：https://docs.concordium.com/en/mainnet/technical-reference/agent-registry/agent-card.html

| 字段 | 依据 |
|---|---|
| `type` | ERC-8004 注册文件固定值 `https://eips.ethereum.org/EIPS/eip-8004#registration-v1`（规范页字段表） |
| `name` / `description` | A2A 与 ERC-8004 共享字段；长度上限 128 / 2048 字符（规范页字段表）。本草稿两项均在限内 |
| `image` | ERC-8004 字段，URI（规范页字段表） |
| `version` | A2A 字段，语义版本（规范页字段表） |
| `provider` | A2A 可选字段，子字段 `organization`、`url`（规范页字段表） |
| `supportedInterfaces` | A2A 字段，每项 `{url, protocolBinding, protocolVersion}`（规范页字段表与示例） |
| `capabilities` | A2A 字段：`streaming`、`pushNotifications`、`extensions`（规范页字段表） |
| `capabilities.extensions[0]` | 徽章扩展：URI 固定为 `https://docs.concordium.com/a2a-extensions/concordium-badge/v1`，`params` 含 `tokenAddress`（CAIP-19）、`owner.account`（CAIP-10）、`contracts.{cis8004,cis8}`（CAIP-10）、`verify`、`verification.{service,verifyUrl,mcp,docs}`（规范页示例卡逐字结构） |
| `defaultInputModes` / `defaultOutputModes` | A2A 字段（规范页字段表） |
| `skills[]` | 每项 `id`、`name`、`description`、`tags`（规范页字段表与示例） |
| `services[]` | ERC-8004 字段，每项 `{name, endpoint, version}`（规范页字段表与示例）；卖方卡额外加了一条 `x402` 服务项——该数组官方口径为开放式（"The list is open-ended"），名称与端点为本项目自定义 |
| `x402Support` / `active` | ERC-8004 布尔字段（规范页字段表） |
| `registrations[]` | 每项数值型 `agentId`（CIS-8004 token id）与 `agentRegistry`（CAIP-10 合约地址）（规范页字段表与示例） |
| 链标识 | testnet CAIP-2 `ccd:4221332d34e1694168c2a0c0b3fd0f27`（findings §2.2，@x402/concordium README 口径） |
| `owner.account` | `ccd:4221332d34e1694168c2a0c0b3fd0f27:34sQTxEssRTT7rDHmsmyf5TPYAcNWV27x3hKsBagu9eKZjmoik`——CAIP-10 拼接形式照规范页示例（示例为主网 genesis，本草稿换 testnet genesis）；owner 账户本体已链上核实（findings §1） |

## 未核实 / 待回填（明确标注，不要按草稿值上链）

1. **`<TOKEN_ADDRESS_PENDING_REGISTRATION>`**：agent 的 CIS-2 canonical token address（Base58Check）只有在 `build_register` 铸造完成后才存在。出现在 `params.tokenAddress` 与 `verification.verifyUrl` 两处，注册后回填。
2. **`<CIS8004_CONTRACT_ADDRESS_UNVERIFIED>` / `<CIS8_CONTRACT_ADDRESS_UNVERIFIED>`**：规范页示例给的是**主网**坐标（cis8004 `…:10082.0`、cis8 `…:10081.0`，挂在主网 genesis 下）；findings §3.2 的 CIS-8 流程也提到 CIS-8 合约 index 10081/subindex 0，但**testnet 上这两个合约的 index 是否同为主网值，未查到明文，未核实**。草稿中出现在 `contracts` 与 `registrations[].agentRegistry`。以 `build_agent_card` 在 testnet 配置下自动注入的输出为准，届时逐项核对替换。
3. **`registrations[].agentId: 0`**：占位。真实 token id 铸造后才有（示例卡为 484）；注册前该条目由 `build_agent_card` 按是否已注册决定注入形态。
4. **端点域名 `agents.neuralclear.example`**：`.example` 为保留 TLD，纯占位。真实端点（A2A/MCP/x402 与卡托管 URL）待公开仓与 demo 服务部署方式定版后替换；卡托管 URL 必须公开可达且逐字节服务原文（findings §3.2 第 2 步）。
5. **`image` 图标文件**：尚不存在，占位 URL，随端点定版一并落实。
6. **徽章扩展的最终形态**：草稿按规范页示例的「扩展内嵌」新形式写；findings §3.3 的实际发放流程是铸造后用 `get_badge_json` 取回徽章块再合并——两步口径一致（最终都落在 `capabilities.extensions`），但徽章块的逐字内容以 `get_badge_json` / `build_agent_badge` 的实际返回为准，草稿中的 `verify` 文案照示例改写了链标识，不作准。
7. `services` 中卖方卡的 `x402` 条目 `version: "2"`：x402 协议版本口径（v2）为本项目按 SDK 版本 2.32.0 的推断标注，**未在 Agent Card 规范中核实该条目的版本写法**，定稿时可改为与 MCP 条目同样的日期式版本或删去。
