# NeuralClear for Trusted Agents — Demo 视频分镜稿（≤3 分钟）

> 用途：Encode Club × Concordium Trusted Agents 黑客松提交视频。
> 形式：真实画面（终端 + 浏览器）截图序列 + 缓慢推近（Ken Burns）+ 英文旁白（edge-tts 合成）。
> 旁白总量约 400 词 ≈ 2 分 50 秒。所有画面均为真实运行/链上页面，不做动画造假。
> 诚实口径：全片标注 testnet demo；费用数字用自测实数，不虚构客户与交易量。

---

## 第 1 段 · 问题与方案（0:00–0:25）

**画面**：标题卡（暖纸风）：「NeuralClear for Trusted Agents」→ 切 CCDExplorer 交易页局部（sponsor cost 一行高亮）。

**旁白（EN）**：
> "When agents pay each other, the amounts are tiny — but the fees are not.
> On Concordium testnet, sponsoring one single payment cost us 4.998 CCD in fees.
> Pay twelve micro-invoices one by one, and the fees bury the work.
> NeuralClear meters every micro-service, nets the batch, and settles exactly once."

**屏幕字**：`12 invoices → 1 settlement` · `fees paid once, not 12 times`

**素材**：标题卡（生成图）；CCDExplorer 交易页截图（见第 3 段素材，一图两用）。

---

## 第 2 段 · 结算闭环（0:25–1:20）

**画面**：终端运行 `npm run demo`，输出逐段滚动/分屏定格六步：
托管存入 0.71 → 12 笔计量交付 → 审计哈希链 → 净额 0.77→0.65 → 一次支付 → 释放 0.65 / 退款 0.06 → 签名收据 verify = true。
后半切演示页六步卡片页（demo/index.html）快速扫过。

**旁白（EN）**：
> "Here is the loop. A buyer deposits escrow for an order.
> The seller agent delivers twelve metered micro-services — price fetches and summaries —
> and every delivery is written into a hash-chained audit log.
> NeuralClear nets both directions: a gross of 0.77 CCD collapses to a single net of 0.65.
> Escrow releases the net, refunds the remainder, and the engine issues an Ed25519-signed
> receipt bound to the audit chain's head. Chain verifies. Receipt verifies."

**屏幕字**：`escrow → metering → hash-chain audit → netting → 1 payment → signed receipt`

**素材**：Mac 终端录屏/截图（命令现成，离线跑）；演示页本地打开截图。

---

## 第 3 段 · Testnet 在线结算（1:20–2:15）

**画面**：终端启动 facilitator（live）→ 运行 `npm run demo:online` → 定格 tx hash 与 explorer 行 →
切浏览器 CCDExplorer 交易页：status finalized、transfer 650,000 microCCD、sponsor 一行 →
（可选）CCDScan 同页一闪。

**旁白（EN）**：
> "And it is live on testnet. There is no public x402 facilitator for Concordium,
> so we host our own. The buyer agent signs a sponsored transaction; our facilitator
> verifies it against the chain and settles it.
> One net payment of 0.65 CCD — finalized. The sponsor paid the fee, once, for the
> whole batch. Balances re-read from the chain match the net to the micro-CCD."

**屏幕字**：`tx d07bc463…05cfd · finalized` · `buyer 19,999.35 · seller 20,000.65`

**素材**：Mac 终端（facilitator 已停服，录制前按 runbook 重启，买方钥文件在本机）；
浏览器打开 https://ccdexplorer.io/testnet/transaction/d07bc4637b81ffab7114d31b545eb84305ed62b5e2cee5b716cd8d6f17405cfd

---

## 第 4 段 · 可信身份（2:15–2:50）

**画面**：注册表仪表盘 agent 列表（总数与两条记录）→ 买方 #1541 详情页（METADATA HASH）→
终端/MCP `check_badge` 输出定格 `badge_valid: true` → GitHub 公开仓页面一扫（cards/ 与 docs/）。

**旁白（EN）**：
> "Both agents are registered on the CIS-8004 identity registry — token 1541 and 1542.
> Their ERC-8004 agent cards are hosted publicly, and their hashes are pinned on-chain.
> The official badge check reports both badges valid: every pass-fail check green,
> and no issues. Verified by Concordium."

**屏幕字**：`CIS-8004 #1541 / #1542` · `check_badge: badge_valid = true (all boolean checks pass, issues: none)`

**素材**：浏览器 testnet-agent-registry.concordium.com 仪表盘（钱包连接状态现成）；
check_badge 输出截图（Mac 上 MCP 结果文件已有，或录制时重跑一次）。

---

## 第 5 段 · 收尾（2:50–3:00）

**画面**：结束卡：仓库地址 + 「Path to production」文档一帧。

**旁白（EN）**：
> "NeuralClear: the settlement layer for the agent economy — metered, netted,
> auditable. Testnet today; the path to production is in the repo."

**屏幕字**：`github.com/Zihuatanejo63/neuralclear-trusted-agents`

---

## 录制清单（Mac，一次抓全）

| # | 素材 | 来源 | 备注 |
|---|---|---|---|
| 1 | 标题卡/结束卡 | 本地生成图 | 暖纸风，与演示页同视觉 |
| 2 | 离线 demo 终端输出 | `cd ~/concordium-cards/online-run && npm run demo` | 输出约 40 行，分 3 屏截 |
| 3 | facilitator 启动 + 在线 demo 输出 | 先 `npm run facilitator`（另开终端，钥文件已备），再 `npm run demo:online` | ⚠️ 在线再跑会**再结算一笔 0.65 CCD**（余额充足、无碍），且新 tx 与文档记录的那笔不同；若不想多一笔，改用已有运行输出的截图/日志代替实跑 |
| 4 | CCDExplorer 交易页 | 上表 URL | 整页 + sponsor 行特写 |
| 5 | 注册表仪表盘 + #1541 详情 | testnet-agent-registry.concordium.com/dashboard | 需钱包扩展在场（只看不签） |
| 6 | check_badge 输出 | Mac `~/concordium-cards/check-{buyer,seller}.raw.json` 打开截图，或重跑 MCP | 重跑约 10 秒/个 |
| 7 | GitHub 仓库页 | github.com/Zihuatanejo63/neuralclear-trusted-agents | 首页 + cards/ 目录 |

## 合成

- 旁白：edge-tts 英文男声/女声各试一条 10 秒样音，用户选定后整篇合成（免费）。
- 剪辑：截图序列 + 推近/平移，段间 0.3 秒淡入；总时长以旁白为准（约 2:50）。
- 导出：1080p MP4，≤3 分钟，文件名 `neuralclear-trusted-agents-demo.mp4`。
