# NeuralClear for Trusted Agents

**Concordium Trusted Agents Hackathon（Encode Club）参赛项目骨架** — 本地预研版，尚未建公开仓。

> ⚠️ **这是一个跑在 Concordium testnet 上的演示（demo），不是生产支付产品。**
> escrow 在本 demo 中是 testnet 账本实现；不声称有客户、交易量或生产上线状态。
> 所有金额均为 testnet 测试 CCD，无真实价值。

## 一句话

只与持有 **Verified by Concordium** 徽章的 agent 做账的托管清算台：多笔微交易先净额抵消，只对净额走一次 x402 付款。

## 最小闭环（定版方案）

1. 两个 demo agent（买方 / 卖方）在 **Agent Registry** 注册，各持 ERC-8004 格式 **Agent Card** 与 Verified by Concordium 徽章；
2. 交易前互相校验对方徽章（`check_badge`），无徽章 / 已撤销不接单；
3. 买方下单 → 资金进 **escrow**（testnet CCD）；
4. 卖方交付，交付过程记**哈希链**（链下计量 + 审计轨迹，对应 record-keeping 要求）；
5. 多笔微交易**净额抵消**，只对净额走一次 **x402** 付款（`@x402/concordium`，exact 方案 + sponsored V1，facilitator 赞助手续费）；
6. 结算完成出一张 **Ed25519 签名收据**，收据哈希与 CCDExplorer 交易链接互相对应。

使用的 Concordium 组件：Concordium ID（testnet 身份锚定）、Agent Registry + Verified by Concordium 徽章、x402 支付、赞助交易（sponsored transactions）、Agent Registry MCP Server。

## 技术路线（预研定版，详见 docs/findings-2026-11-26.md）

- **单体 TypeScript** 实现最小闭环（x402 的 Concordium 实现仅有 TS SDK，Python/Go 均不支持 ccd 网络）。
- x402 facilitator **自托管**（无官方公共端点）：独立赞助账户，与买/卖双方分离（协议 verify 规则要求）。
- Agent 注册走托管 MCP（`agent-registry-mcp.concordium.com`）生成载荷，**owner 钱包签名提交**；助手不持有用户私钥。
- 结算核心的生产形态（链下 stdlib 引擎 + 法币上下车）只写进 path-to-production 文档，本仓不含 NeuralClear 私有协议代码。

## 当前状态（2026-11-26）

- ✅ 用户 Encode Club 已建项；testnet 身份（Concordium testnet IP）已签发并链上核实
- ✅ Owner 账户已建、faucet 20,000 test CCD 已到账（链上实测，见 findings §1）
  - Owner（testnet）：`34sQTxEssRTT7rDHmsmyf5TPYAcNWV27x3hKsBagu9eKZjmoik`
- ✅ 第一阶段预研完成：账户核查 / x402 路线 / 注册路线 → `docs/findings-2026-11-26.md`
- ⬜ 账户拓扑补齐（买方/卖方/facilitator 三个 testnet 账户 + 各自先领 faucet）
- ✅ TS 闭环骨架代码（第二阶段，2026-11-26）：escrow/哈希链/净额/Ed25519 收据/facilitator 骨架 + 离线端到端 demo 跑通，`npm run build` 零错误、`npm run demo` 审计链与收据双验签通过 → `docs/progress-2026-11-26-phase2.md`
- ⬜ 两个 demo agent 的 Agent Card 草稿已成稿（`cards/`，注册前须经 `build_agent_card` 生成最终版）
- ⬜ 跑通官方 x402 示例（待密钥：买方/facilitator 私钥导出后进行）
- ⬜ 两个 agent 注册 + 挂徽章（需用户在场点签名 ×4）
- ⬜ 演示页、demo 视频（≤3 分钟）、path to production、12-08 提交

## 目录

```
src/    闭环实现（待建：escrow 账本 / 哈希链计量 / 净额结算 / x402 付款腿 / 签名收据）
docs/   findings-2026-11-26.md — 第一阶段预研结论与来源
```

## 时间线

投稿截止 **2026-12-09 23:59 UTC**（北京时间 12-10 07:59），计划 12-08 提前提交。
完整方案与缺口清单：`~/workspace/your_files/concordium-trusted-agents/Concordium参赛方案与缺口清单.md`（本地文件，不随公开仓发布）。
