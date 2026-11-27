# 第二阶段记录 — 2026-11-26（Agent Card 草稿 + TS 工程骨架）

范围：只做本地文件与离线代码；未做任何链上交易或注册、未建 GitHub 仓、未生成或索要任何私钥、未动用户钱包。
路线：定版路线 B —— TypeScript 单体最小闭环，不搬 NeuralClear 私有 Python 代码。

---

## 1. Agent Card 草稿 —— ✅ 成稿（注册前草稿，非最终托管版）

文件：
- `cards/buyer-agent-card.json` —— NeuralClear Buyer Agent（下单/托管、确认交付、请求净额结算三个 skills）
- `cards/seller-agent-card.json` —— NeuralClear Seller Agent（CCD/EUR 价格、日报摘要两个计量服务 skills + 接受净额结算；services 含一条 x402 端点占位）
- `cards/NOTES.md` —— 字段依据与未核实清单

字段口径来源（2026-11-26 实查官方文档）：
- Agent Card 规范页 https://docs.concordium.com/en/mainnet/technical-reference/agent-registry/agent-card.html —— 顶层字段表（ERC-8004 的 `type/services/x402Support/active/registrations` + A2A 的 `name/description/version/provider/supportedInterfaces/capabilities/defaultInputModes/defaultOutputModes/skills`）与示例卡逐字结构，徽章扩展位于 `capabilities.extensions`（URI `https://docs.concordium.com/a2a-extensions/concordium-badge/v1`，params 含 CAIP-19 `tokenAddress`、CAIP-10 `owner.account`、`contracts`、`verify`、`verification`）。
- owner 指向用户 testnet 账户 `34sQTxEssRTT7rDHmsmyf5TPYAcNWV27x3hKsBagu9eKZjmoik`，链标识用 testnet CAIP-2 `ccd:4221332d34e1694168c2a0c0b3fd0f27`（findings §2.2）。

明确未核实/待回填（详见 `cards/NOTES.md`，未编造）：
1. token address（`cis-2:` 后）与徽章 `verifyUrl` 中的 badge id——铸造后才存在；
2. testnet 上 CIS-8004 / CIS-8 合约 index——文档示例是主网值（10082.0 / 10081.0），testnet 是否相同**未查到明文**，草稿中以 `<…UNVERIFIED>` 占位；
3. `registrations[].agentId` 占位 0；端点域名 `agents.neuralclear.example` 为保留 TLD 占位；`image` 文件尚不存在；
4. 卖方卡 x402 服务条目的 `version: "2"` 写法未在 Card 规范中核实。
最终版必须由 MCP `build_agent_card` 生成（自动注入上述 Concordium 字段并返回 canonical JSON + SHA-256），草稿只作内容定稿与入参依据。

## 2. TS 工程骨架 —— ✅ 编译零错误，离线 demo 端到端跑通

依赖（版本均为 2026-11-26 `npm view` 实查并写入 package.json 精确版本）：
`@x402/concordium 2.32.0`、`@x402/core 2.32.0`、`@concordium/web-sdk 12.1.0`；dev：`typescript 7.0.2`、`@types/node 26.6.11`。`npm install` 成功（64 packages，18s，仅一条 uuid 弃用警告）。

模块清单（`src/`，均为可运行真实代码）：
| 模块 | 内容 |
|---|---|
| `canonical.ts` | 确定性 JSON 序列化（键排序、bigint 编码），哈希/签名的稳定性基础 |
| `types.ts` | Obligation / NetTransfer / NettingResult 等领域类型（金额一律 microCCD bigint） |
| `escrow.ts` | 内存版 escrow 账本：credit/openHold/releaseHold（支持部分释放）/refundHold，状态机 OPEN→RELEASED/REFUNDED，余额不为负、不变量以异常强制 |
| `audit-chain.ts` | 哈希链审计日志：append（交付/托管/结算/收据事件）+ SHA-256 链式哈希 + `verify()` 全链复算 + `headHash()` |
| `netting.ts` | 净额抵消引擎：多笔双向义务 → 净头寸 → 确定性贪心撮合出最小转账集（同输入必同输出） |
| `receipt.ts` | Ed25519 签名收据：canonical 载荷签名、JWK 重建公钥验签、`receiptHash`；载荷绑定 gross/net、义务笔数、审计链 head、txHash、CCDExplorer URL |
| `facilitator.ts` | 自托管 facilitator 骨架：①env 工厂（按 SDK 真实类型 `toConcordiumFacilitatorSigner` + `ExactConcordiumScheme`，缺密钥即抛错，属待密钥步骤）；②**9 条 verify 规则的离线预校验** `validateSponsoredTxOffline`（逐条 pass/fail/requires-chain，PLT 收款方/金额与规则 2、8 等需链上数据的明确标 requires-chain，不猜）；③node:http 最小服务（GET /supported、POST /verify、POST /settle，委托 SDK scheme；settle 的 sponsor 联签/提交/最终确定由 SDK 实现） |
| `payment-client.ts` | PaymentLeg 接口（结算引擎只依赖接口）：`OfflinePaymentLeg`（确定性伪 txHash，明确标注 offline）+ `X402ConcordiumPaymentLeg`（按 SDK 2.32.0 类型写明 6 步接法，pay() 在缺密钥时抛错拒绝假结算） |
| `demo.ts` | 端到端场景脚本（见下） |

构建实测：
- 首轮 `npm run build` 失败，两类问题：TS 7 未自动纳入 `@types/node`（tsconfig 显式加 `"types": ["node"]` 修复）；facilitator 规则 4/5 用布尔变量判断导致判别联合未收窄（改为直接判 `payload.type` 修复）。
- 修复后 `npm run build`（tsc -p tsconfig.json）**零错误通过**，dist/ 全量产出。

离线 demo 实测（`node dist/demo.js`，退出码 0）：
- 场景：买方（用户 owner 账户地址）托管 0.71 CCD → 卖方交付 12 笔义务（7×价格查询 0.05 + 3×日报 0.12 + 2×卖方返利 0.03 反向）→ 净额：**gross 0.77 CCD → net 0.65 CCD、1 笔转账** → 离线付款腿 → escrow 释放 0.65、退款 0.06 → 出收据。
- 验真：审计链 18 条 `verify = true`；收据 `verify = true`，hash `bc7a4698…`；余额对账一致（买方 5 − 0.65 = 4.35 CCD，卖方 0.65 CCD）。
- 与 findings 的一处出入（如实记录）：findings §2.2 记付款载荷为 `{ signedTransaction, sender }`，而安装到的 2.32.0 类型定义 `ExactConcordiumPayloadV2` 只有 `{ signedTransaction }`——代码以实装类型为准。

## 3. 待用户出场的事项（卡点清单）

以下均为助手无法代办、需要用户在钱包/Encode 侧操作的事项，按依赖顺序：

1. **建 3 个 testnet 账户**（卡点：findings §3.5 拓扑未建）：在 Concordium Wallet for Web 里从 Identity 1 派生买方、卖方、facilitator 三个账户。**每个账户建好后第一件事先领 20,000 test CCD faucet**（规则：账户有任何入账后不可领，顺序不能错）。→ 卡在：等用户操作钱包（约几分钟/个）。
2. **导出买方与 facilitator 的测试私钥**（卡点：x402 客户端签名与 facilitator 赞助签名需要 `CCD_PRIVATE_KEY` / `CCD_FACILITATOR_PRIVATE_KEY` 环境变量）：用户在钱包里对这两个 testnet 专用账户做密钥导出，交给 demo 运行环境。**owner 账户私钥不导出**（注册签名走钱包点签）。→ 卡在：等用户导出；未导出前 `X402ConcordiumPaymentLeg` 与 facilitator 工厂均按设计抛错，不假跑。
3. **4 次钱包签名**（卡点：Agent Registry 注册流程，MCP 只产载荷不持私钥）：两个 agent 各 1 次 `build_register` 提交 + 各 1 次挂徽章后的 `build_set_agent_uri` 提交，须 owner 在钱包里逐次确认。→ 卡在：等 Card 最终版生成（`build_agent_card`，助手可先备入参）与托管 URL 定版（依赖公开仓建立），且须约用户在场点签。
4. （前置小项）**公开仓建立**：Card 托管（GitHub Pages/raw，须逐字节原文）与 services 端点定版都依赖它；建仓动作本身等主线安排，本阶段按边界未建。

## 4. 下一步（助手侧可独立推进的）

- 用托管 MCP 的 `build_agent_card` 以草稿内容为入参生成两张最终版 Card 与 SHA-256（无签名步骤，可先行），核对 testnet 合约 index 等占位项的真实注入值；
- facilitator 服务与卖方 x402 端点的本地联调骨架（离线规则预校验先行，链上 settle 等密钥到位）；
- 演示页与 path-to-production 文档初稿。
