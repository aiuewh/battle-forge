# Battle Forge ⚔ —— D&D 2024 战斗前端（结算权威版）

SillyTavern（酒馆）D&D 2024 跑团的**前端战斗界面**：战斗的规则结算（命中 / 伤害 / 豁免 /
状态 / 回合 / 移动）全部在本面板内完成，AI DM 只负责**战前设计敌情 → 触发战斗 → 战后
按战报叙述剧情**。本仓库部署到 GitHub Pages 后，作为酒馆内的嵌入式战斗面板使用。

## 架构

```
酒馆消息（AI 输出）                      GitHub Pages（本仓库）
┌──────────────────────────┐            ┌──────────────────────────┐
│ <encounter> 敌卡  ──暂存──┼── 数据岛 ──▶│  完整战斗引擎（React）    │
│ <battle> 开战    ──配装──┼────────────▶│  · 2.5D 等距地图         │
│ <UpdateVariable> ─名单──┼────────────▶│  · 先攻/行动经济/规则结算 │
└──────────────────────────┘   postMessage│  · 敌我 AI（8 战术档案） │
                                           │  · 战报 <battleresult>   │
        ▲                                   └───────────┬──────────────┘
        │  玩家粘贴战报                                │ localStorage
        └────────────── AI 叙述战后 + 应用变量补丁 ◀─────┘
```

- **酒馆侧**：一个 14KB 正则脚本（`download/battle-forge-st-pack/battle-forge-panel.json`）
  把消息里的协议块渲染为 bootstrap 面板（离线降级轻量模式），在线时内嵌本应用
- **世界书条目**（`battle-protocol-worldbook-entry.txt`）教 AI DM 三阶段协议
- **结算权威 = 前端**：AI 战时不掷骰、不结算、不叙事战斗过程

## 部署到 GitHub Pages

1. 新建 GitHub 仓库（如 `battle-forge`），把本目录内容推上去
2. 仓库 Settings → Pages → Source 选 **GitHub Actions**
3. 推送 main 分支后 Actions 自动构建部署
   （workflow 会移除 `/api` 演示路由并静态导出，`BASE_PATH` 自动适配仓库名）
4. 部署完成后应用地址为 `https://<你的用户名>.github.io/<仓库名>/`

## 本地开发

```bash
npm install
npm run dev                  # http://localhost:3000
npm run build && npm start   # 生产模式

# 测试
bun scripts/engine-tests.ts            # 228 项引擎单元测试
bun scripts/adversarial-tests.ts       # 85 项反例测试（畸形协议/极端数值/ReDoS/原型污染）
bun scripts/semantics-tests.ts         # 60 项通用语义测试（全角/中文字段/同义词/别名）
node scripts/st-pipeline-sim.mjs       # 酒馆正则管线模拟（BF_CARD_PATH 指向你的角色卡）
```

## 酒馆接入（完整手册见 download/battle-forge-st-pack/README.md）

1. 扩展 → Regex：**禁用旧的 `dnnd-battle-panel`**（必须）
2. 导入 `battle-forge-panel.json`，并把它**拖到正则列表最顶部**
3. 导入 `battle-forge-hide-legacy.json`（隐藏 4 楼以前的原始协议文本）
4. 角色卡世界书添加 `battle-protocol-worldbook-entry.txt` 内容
5. 面板右上角 ⚙ 填入 GitHub Pages 地址（或改正则脚本里的 APP_URL）

## 目录

- `src/lib/engine/` 战斗引擎（规则/几何/AI/协议/战报/敌卡/角色桥/嵌入同步）
- `src/components/battle/` UI 组件（2.5D 地图/行动栏/敌情简报/详情卡…）
- `src/store/battleStore.ts` 状态仓库（哈希链导入门控/领导者选举/持久化）
- `st-integration/` 酒馆 bootstrap 模板；`scripts/generate_st_package.py` 生成正则包
- `download/battle-forge-st-pack/` 交付包（正则 JSON ×3 + 世界书条目 + 部署 workflow）
