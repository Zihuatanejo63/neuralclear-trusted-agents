# Mac 会话执行单（Concordium Card 生成 + Tripo 补贴图）

前置条件：SSH 通道恢复（用户在 Muse 设置 → Permissions → Direct network protocols
把 other_tcp 改为 Ask，助手重试时用户点批准）。通道一通，一趟办完下面两件事。

## A. Concordium：生成两张最终版 Agent Card（用户已选「Mac 上用 MCP 客户端」）

顺序不能乱：Card 与托管 URL 绑定，先定 URL、再生成、再逐字节托管。

1. 建公开仓（用户 GitHub 已登录的浏览器或 gh CLI）：
   - 仓库名：`neuralclear-trusted-agents`（公开、干净仓，不搬 NeuralClear 私有代码）
   - Card 托管 URL（raw）：
     - `https://raw.githubusercontent.com/<账号>/neuralclear-trusted-agents/main/cards/buyer-agent-card.json`
     - `https://raw.githubusercontent.com/<账号>/neuralclear-trusted-agents/main/cards/seller-agent-card.json`
2. 把上面两个 URL 分别填进 `cards/final-inputs/buyer-build-agent-card-args.json` 与
   `seller-build-agent-card-args.json` 的 `hosting_url`（占位替换，改完校验 JSON）。
3. 把 `tools/mcp_call.py` 与两个 args 文件拷到 Mac，先跑一遍探活：
   - `python3 mcp_call.py list` → 确认 tools/list 里有 build_agent_card，核对精确参数名，
     与 args 文件字段对齐（字段名以 schema 为准，不符就改 args 文件）。
   - 顺带核对占位 #7：卖方卡 x402 服务 `version: "2"` 写法以 schema 为准。
4. 生成（输出原文保存，不格式化）：
   - `python3 mcp_call.py call build_agent_card --args buyer-...json --out buyer-agent-card.raw.json`
   - `python3 mcp_call.py call build_agent_card --args seller-...json --out seller-agent-card.raw.json`
   - 记录两个 SHA-256（脚本会打印），与 MCP 返回里自带的哈希对照。
5. 把两个 raw 文件逐字节提交进公开仓的 cards/ 路径（文件名与 URL 对应），
   再用 curl 拉 raw URL 验一遍哈希与本地一致（托管必须逐字节原文，URL 404 是徽章失效头号原因）。
6. 回报用户：两张卡已生成 + 哈希 + 已托管。后续 build_register 点签 2 次等，
   按 progress-2026-11-27-phase3-cards.md §后续步骤 走，攒到用户出场时一趟办。

注：官方 Claude Desktop 配置片段（备选，若脚本路线不通）：
`{"mcpServers":{"concordium-agent-registry":{"url":"https://agent-registry-mcp.concordium.com/mcp"}}}`

## B. Tripo：塔楼贴图（用户已点头，余额 310 已确认）

1. agent-desktop 打开 Tripo Studio 中的《Pocket Oasis Factory》项目画布
   （提交链接 https://studio.tripo3d.ai/canvas/share/01a20366-aaf0-7ee5-85e0-cad37014b37c ）。
2. 给塔楼补 2K 贴图（10 积分）。Pro 试用已过期，若贴图功能被付费墙拦，立即停手回报，不硬闯。
3. 需要降级 --headed 物理模式动鼠标时，先提醒用户、等点头。
4. 截止：2026-11-28 07:59 北京时间。贴完确认提交状态无误即收口。
