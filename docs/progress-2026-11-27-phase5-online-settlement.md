# 第五阶段记录 — 2026-11-27（facilitator 点火 + 在线结算跑通）

结论先行：**同一批演示义务已在 Concordium testnet 真实结算**——12 笔义务
gross 0.77 CCD 净额为一笔 0.65 CCD，经自托管 x402 facilitator 以赞助 V1 交易
上链、finalized，链上余额独立复核分毫不差。

## 1. 结算证据（链上复核值，非程序自报）

| 项 | 值 |
|---|---|
| 交易哈希 | `d07bc4637b81ffab7114d31b545eb84305ed62b5e2cee5b716cd8d6f17405cfd` |
| 状态 | finalized（区块 `5acd05a8…af73c`） |
| 类型 | accountTransaction / transfer（V1 赞助） |
| 付款 | 买方 agent `4AyXSvvT…c454` → 卖方 agent `4f4i45cB…vLHm`，650,000 microCCD |
| 赞助 | facilitator `4VzgocUC…62aR`，sender cost 0，**sponsor cost 4,997,954 microCCD** |
| 余额（事后链上读） | 买方 19,999.35 CCD（nonce 2）· 卖方 20,000.65 CCD · facilitator 19,995.002046 CCD |
| 收据 | `rcpt-batch-demo-001`，Ed25519 verify=true，hash `c27e61e3…2181b`，审计链 18 条 verify=true，audit head `3dc17425…a65a8` |
| 浏览器 | https://ccdexplorer.io/testnet/transaction/d07bc4637b81ffab7114d31b545eb84305ed62b5e2cee5b716cd8d6f17405cfd |

## 2. 本轮实现

- `X402ConcordiumPaymentLeg` 由占位改为真实现（payment-client.ts）：取
  facilitator `/supported` 的 feePayer → 组 PaymentRequirements → 客户端
  scheme 建 V1 赞助 SimpleTransfer 并签 sender 侧 → `/verify` → `/settle`。
- 结算循环抽为 `src/settlement-loop.ts`，离线（demo.ts）与在线
  （demo-online.ts，`npm run demo:online`）共用同一条链：托管→计量→净额
  →支付腿→释放/退款→签名收据→双验真。demo 与 dry-run 的账户常量同步为
  已注册的买方/卖方 agent 账户（owner 是注册表所有者、不是付款方）。
- facilitator 以 live 模式在本机点火（钥匙只从文件读），/supported 正常。

## 3. 两个实测发现（已回写代码注释）

1. **原生 CCD 的 asset 必须写 `"CCD"`**：SDK facilitator 的 verify 只认
   `asset.toUpperCase() === "CCD"` 为原生币；写空串会被当成 PLT token id，
   以 `asset_type_mismatch: expected TokenUpdate for , got transfer` 拒绝
   （首跑实测）。客户端 scheme 对空串宽容、facilitator 不宽容——以
   facilitator 口径为准，三处（支付腿、离线九规则、dry-run 场景）已对齐。
2. **赞助费观察值**：本笔赞助交易 sponsor cost 为 4.997954 CCD（energyCost
   635 NRG）——testnet 上赞助一笔 0.65 CCD 转账的链上实价已达转账额的约
   7.7 倍。此为单笔观察值、机制以链上记录为准；它说明 x402 赞助模式的
   生产经济性必须认真测算（见 path-to-production 的费用项）。

## 4. 剩余事项

1. ≤3 分钟 demo 视频（离线闭环 + 在线结算证据 + 徽章核验）。
2. Encode Club 正式提交（说明、公开仓、视频、CCDExplorer/CCDScan 链接、
   path to production），计划 12-08。
3. facilitator 演示后已停服；再跑在线轮次时按 runbook 重启即可。
