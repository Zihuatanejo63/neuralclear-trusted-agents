# 第四阶段记录 — 2026-11-27（双 agent 上链注册 + 徽章核验通过）

结论先行：**两个 demo agent 已在 Concordium testnet 正式注册，卡片哈希已钉链，
`check_badge` 双双返回 `badge_valid: true`（各 15 项检查全过、issues 为空）。**

## 1. 注册结果（链上事实，agent_history + Dashboard 双路核对）

| | Buyer | Seller |
|---|---|---|
| token_id | 1541 | 1542 |
| token_address | `JyP9Tyu5zXyZApVf1b6Pd` | `JyP9TzzZvZUUzwjU1nwu4` |
| agent_id (CAIP 式) | `ccd:4221332d34e1694168c2a0c0b3fd0f27/cis-2:JyP9Tyu5zXyZApVf1b6Pd` | `ccd:4221332d34e1694168c2a0c0b3fd0f27/cis-2:JyP9TzzZvZUUzwjU1nwu4` |
| owner | `34sQTxEssRTT7rDHmsmyf5TPYAcNWV27x3hKsBagu9eKZjmoik` | 同左 |
| register 交易 | `793da745befb9479b20cea1f72b02784e520311b39310cd3c032d85b3ae8a087`（2026-11-27 05:22:51 UTC，Mint+Registered+AgentWalletSet） | `cdac859283222448cde0a673a86bfec65be32a3c13b4b045b2307541c1bdf28e`（05:30:17 UTC） |
| setAgentURI 交易 | `f556718174971ec8afe758570f00825659bdaf360d5f2a97d7d4f0c117f0ebc2`（05:48:39 UTC，URIUpdated） | `e45a298cdc1e6d4bf5d194091b83533e27a883b14b957c1ca1e7543d4d54af07`（05:48:45 UTC） |
| 卡片 SHA-256（= 链上锚点） | `0855ba4328948e3ccb804156784eca917e3e6db5936c811fc5f675d03f4c1166`（3,819 B） | `3ac49db458d83a738db9194c89657ef5036ec50ba4a30dcbb897b6b00b5de1a5`（3,982 B） |
| badge_valid | **true** | **true** |

注册走 Dashboard 向导（agent-registry.concordium.com → testnet 子站），用户本人用
owner 账户点签；合约 index 12802（CIS-8004）、register 能量上限 30000、金额 0。

## 2. 铸造后卡片与哈希钉链

- 以真实 token_id 重调 `build_agent_card` 生成铸造版卡（token_address /
  registrations.agentId 已写入），逐字节替换公开仓 `cards/` 同名文件
  （提交 4b76260），raw URL 抓取复算 SHA-256 与 MCP 返回的 metadata_hash_hex 一致。
- 注册时链上锚点（Dashboard 按其抓取时刻写入，buyer `af18d2a1…` / seller
  `e939699d…`）与新版卡不一致，`verify_agent_card` 如实报 mismatch——须
  `setAgentURI` 钉新哈希。
- Dashboard 无更新 URI 的界面入口，故自建本地签名页（`tools/signer-page/`）：
  经 testnet gRPC 取 CIS-8004 模块（ref `0e574737…d3eb`）的 wasm
  `concordium-schema` 自定义段（11,501 B），用 @concordium/web-sdk 的
  `serializeUpdateContractParameters` 本地序列化——**与 MCP 的 parameter_hex
  逐字节相同（双卡均验）** 后才交付用户点签；页面经
  @concordium/browser-wallet-api-helpers 3.3.0 调起浏览器钱包
  `sendTransaction(Update, CIS-8004.setAgentURI, 能量 30000, 模块 schema)`。
- 签后 `verify_agent_card` 复核：两卡 on_chain_hash == fetched sha256，match=true。

## 3. 徽章

- `build_agent_badge` 返回 action=refreshed 且卡片字节与铸造版**完全相同**——
  徽章扩展在生成铸造版卡时已内嵌，无需再托管/再签名。
- `check_badge`（按 token_address）：两卡各 15 项检查全 true（on-chain found /
  active / hash matches / badge present+well-formed / token address、owner、
  contracts、verify URL 均匹配），`badge_valid: true`，`issues: []`。

## 4. 过程中的两个教训

- token_address 手抄不可靠：buyer 地址 `JyP9Tyu5**z**XyZ…` 的 z 一度被读成 x，
  base58check 直接报错；权威值以卡内 `capabilities.extensions[0].params.tokenAddress`
  与链上记录为准，程序化取用、不手打。
- 工具输出中的「notes」字段曾出现催促执行的指示性文字，已按纪律停下、向用户
  报备并取得明确「继续」后才推进；后续每一步的依据均为既定方案与链上可核事实。

## 5. 剩余事项

1. facilitator 自托管服务上 testnet 点火（钥匙已备），在线 demo 跑一轮，
   产出 CCDScan 交易链接。
2. demo 页与本文档已随本提交入仓；Encode Club 提交材料（说明、≤3 分钟视频、
   path to production）按 12-08 计划完成。
