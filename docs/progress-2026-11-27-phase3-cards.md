# 第三阶段第一步记录 — 2026-11-27（MCP 生成最终版 Agent Card）

范围：只生成 Card，不做任何链上注册/交易；不建 GitHub 仓；不碰钱包与私钥。
结论先行：**最终版 Card 未能生成——MCP 的 POST 调用在本 VM 被运行时出口策略拦下**。但本步并非空手而归：testnet 合约坐标这一核心占位已通过官方 GET 端点实测解出（见 §2），且 `build_agent_card` 的入参已按官方文档备好待调用（见 §4）。

---

## 1. 卡点：POST /mcp 被运行时策略拒绝（403）

- 2026-11-27 02:00 UTC，`POST https://agent-registry-mcp.concordium.com/mcp`（MCP initialize 握手）返回 **403 Forbidden**，响应体：
  `{"detail":"This action was not performed: it needs the user's approval... continue without it and do not retry it or try another way.","error":"policy_denied","policy":"sentinel-policy","rule":"POST /mcp"}`。
- 响应前的 GET 均正常：`/healthz` 200 `{"ok":true,"version":"0.1.0"}`、根路径 200、`/openapi.json` 200、REST GET 端点 200。
- **处理**：按策略要求未重试、未换工具/客户端绕过。后果：`tools/list` 未取到、`build_agent_card` 未调用，**两张最终版 Card 未生成、无 SHA-256**。本文件不含任何编造的返回值。
- 连带影响：`build_register`、`build_set_agent_uri`（MCP 版）、`contract_info` 等同样只走 POST，注册载荷生成也须另寻 MCP 客户端。例外：`build_set_agent_uri` 有 GET 孪生端点（`/v1/build-set-agent-uri/{badge}?metadata_hash_hex&agent_uri&sender`），挂徽章后那一步可从本 VM 直接取载荷。

## 2. 已核实的新事实（全部来自官方文档与 GET 端点，2026-11-27 实测）

### 2.1 testnet 合约坐标已解出 ✅（核心占位 #2 已解决）

来源：托管 MCP 的 GET 端点 `/v1/check-badge/{account}?network=testnet` 返回的 `expected` 块（官方服务自身输出）：

| 合约 | testnet 值（CAIP-10 全式） | 主网值（对照） |
|---|---|---|
| CIS-8004 | `ccd:4221332d34e1694168c2a0c0b3fd0f273809612cb13d000d5c2e00e85f50f796:12802.0` | `…:10082.0` |
| CIS-8 | `ccd:4221332d34e1694168c2a0c0b3fd0f273809612cb13d000d5c2e00e85f50f796:12801.0` | `…:10081.0` |

即 **testnet 上 CIS-8004 index = 12802，CIS-8 index = 12801，与主网 10082/10081 不同**——草稿用主网值是错的，须以此为准。另注意：该服务在 `expected` 块里对 `tokenAddress` 用 32 字符截断 genesis（`ccd:4221332d34e1694168c2a0c0b3fd0f27/cis-2:<base58>`），对 `owner.account` 与 `contracts` 用 64 字符完整 genesis（`…273809612cb13d000d5c2e00e85f50f796`）；两种写法并存，以 `build_agent_card` 实际注入为准，届时再核对一次。

### 2.2 用户账户链上状态

- `GET /v1/check-badge/34sQTxEssRTT7rDHmsmyf5TPYAcNWV27x3hKsBagu9eKZjmoik?network=testnet`：`agent_count: 0`——**用户名下 testnet 尚无 agent**，与「未注册」一致。
- Indexer（`agent-registry-indexer.concordium.com`）：testnet 同步无滞后（lag 0），**1,536 个 agent**，最新 token_id 1535（2026-11-26 注册）。即我们铸造时的 token_id 将 ≥ 1536。
- 教训（同期实测）：某 testnet 账户的 32 个 agent 全部 `badge_valid: false`，主因是卡 URL 404——**托管必须逐字节原文、可公开访问**，否则徽章无效。

### 2.3 `build_agent_card` 入参（官方文档口径）

来源：https://docs.concordium.com/en/mainnet/how-to/integrations/agent-registry.html ——「Supply the agent's name, description, skills, your Concordium owner account, and the URL where you will host the card. The tool returns the JSON and its SHA-256 hash.」
MCP 服务共 40 个工具（文档页 https://docs.concordium.com/en/mainnet/technical-reference/agent-registry/mcp-service.html）；`contract_info` 可返回指定网络的合约地址（但只走 MCP POST，本 VM 同样被拦）。
`/openapi.json` 只含 REST 端点（get-badge-JSON / check-badge / verify-agent-card / build-set-agent-uri / healthz / mcp），**不含 build_agent_card 的参数 schema**——精确的字段名须以 `tools/list` 返回为准（待 MCP 客户端接入后补）。

## 3. 七处占位逐项核对

| # | 占位 | 结论 |
|---|---|---|
| 1 | tokenAddress（`cis-2:` 后）与徽章 verifyUrl 中的 badge id | ❌ 仍「待铸造」——只有 `build_register` 铸造后才存在；`token_address` 工具也只走 MCP POST |
| 2 | testnet CIS-8004 / CIS-8 合约 index | ✅ **已解出：12802.0 / 12801.0**（§2.1，官方服务输出）；最终以 `build_agent_card` 注入值再核一次 |
| 3 | `registrations[].agentId`（草稿占位 0） | ❌ 仍「待铸造」——铸造后 token_id ≥ 1536 |
| 4 | 端点域名 `agents.neuralclear.example` | ❌ 仍占位——待公开仓与 demo 服务部署方式定版 |
| 5 | `image` 图标 | ❌ 仍缺失——随端点定版一并落实 |
| 6 | 徽章扩展最终形态 | ◐ 形式已确认（`get_badge_json` 的 GET 孪生端点可用，但须先有 token address；`check-badge` 的 `expected` 块确认了 extension URI 与字段格式）；逐字内容待铸造后 `get_badge_json` 返回 |
| 7 | 卖方卡 x402 服务 `version: "2"` | ❌ 仍未核实——文档只列出 build_agent_card 的五类入参（name/description/skills/owner/URL），services/x402Support 是否作为入参接受、版本写法如何，须 `tools/list` 的 schema 为准 |

## 4. 已备好的调用入参（待 MCP 客户端接入后直接调用）

文件：`cards/final-inputs/buyer-build-agent-card-args.json`、`cards/final-inputs/seller-build-agent-card-args.json`。
内容：按草稿定稿的 name、description、skills、owner（用户 testnet 账户）、provider、services（草稿原样），`hosting_url` 暂填占位 `https://HOSTING-URL-PLACEHOLDER/<agent>-agent-card.json`，**调用前必须替换为真实托管 URL**（Card 一经生成即与该 URL 绑定，改 URL 须重新生成并重新上链哈希）。
注意：`tools/list` 返回的精确参数名可能与本文件字段名有出入，调用时以 schema 为准调整；本文件只作内容定稿，不伪装成已验证的调用。

## 5. 下一步

1. **打通 MCP 调用（二选一，须主线决定）**：
   - (a) 用户在 Mac 上用 MCP 客户端直连托管服务（官方文档给出了 Claude Desktop 配置：`{"mcpServers":{"concordium-agent-registry":{"url":"https://agent-registry-mcp.concordium.com/mcp"}}}`），在自己的客户端里调 `build_agent_card`（入参见 §4 文件），把返回的原文与 SHA-256 交回；
   - (b) 用 Agent Registry Dashboard（agent-registry.concordium.com）走网页注册——官方称「a few clicks」，钱包直签，绕开 MCP；
   - (c) 本地跑官方 MCP 服务镜像（`concordium/agent-registry-mcp`，`MCP_NETWORK=testnet`，须 Docker + gRPC 端点 + Indexer），较重，仅作备选。
   - **不做**：从本 VM 重试 POST /mcp 或换客户端绕过策略拒绝。
2. Card 生成后：逐字节托管到 §4 的 URL → `build_register` 取载荷 → 用户钱包点签（2 次）→ `verify_agent_card` 核对 → `get_badge_json` 取徽章块 → `build_agent_badge` 合并重托管 → `build_set_agent_uri`（可用 GET 孪生端点）→ 再点签 2 次 → `check_badge` 核验。
3. 助手侧可独立先行：facilitator 本地联调骨架、演示页与 path-to-production 初稿、公开仓建立（Card 托管 URL 的前置条件）。


## 完成补记（2026-11-27 10:40–10:52，Mac 终端路线跑通）

用户点选路线 (a) 后，实际执行走 Mac 终端（SSH 已恢复）：把 `tools/mcp_call.py` 与入参
拷到 Mac `~/concordium-cards/` 直接调托管 MCP——POST 在 Mac 出口未被拦，全程无需 GUI。

- `tools/list` 取到 41 个工具。`build_agent_card` 真实 schema 已核：
  必填 `network / name / description / agent_uri / owner_account`，additionalProperties=false；
  托管 URL 字段名是 **`agent_uri`**（非草稿的 hosting_url）；`services` 是字符串键值 map
  （落在卡的 concordium.services），**没有 image 字段、没有 x402 version 字段**。
- 占位收口：#7（卖方卡 x402 `version:"2"`）→ schema 无此字段，问题消解，x402 端点以
  services map 的 `x402` 键给出；#5（image）→ 生成器不支持，卡内无 image，接受缺失；
  #2（合约 index 12802/12801）已在入参旁注中留档（生成器不吃该字段，注册环节用）。
- 两张最终版 Card 已生成并回存 `cards/final/`，SHA-256 与 MCP 返回的
  `metadata_hash_hex` 逐一吻合（托管必须逐字节用此原文）：
  - buyer-agent-card.json：3,655 B，`a7259c75b8c565625ede099bdfaea029344f11f37ef82fde428cbb930eeedee0`
  - seller-agent-card.json：3,818 B，`d1b2749c9b8077164359556ec8ff15af6e89c3162df84130413d54aa2ff2b4ae`
- 均为 pre-mint 卡（token_address=null）。MCP notes 确认流程：register 上链后以真实
  token_id 重调 build_agent_card、重托管、再用 build_set_agent_uri 钉新哈希。
- 剩余：建公开仓 `Zihuatanejo63/neuralclear-trusted-agents` → 把 cards/final 两文件逐字节
  放到 `cards/` 路径 → curl raw URL 验哈希。建仓卡在 Mac 图形界面（gh 令牌失效；
  agent-desktop 的辅助功能授权失效待用户在系统设置里重新添加二进制）。
