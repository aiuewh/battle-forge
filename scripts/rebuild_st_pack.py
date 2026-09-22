#!/usr/bin/env python3
"""重建酒馆交付包（st 集成包 + 源码 zip），并刷新 C:/1MC/DND/battle_forge_panel/1/

背景：battle_forge_panel/1/ 是 2026-09-18 的旧快照（panel.json 无流式守卫/escHtml、
zip 缺 09-22 的全部引擎修复、世界书 txt 落后卡内 entry3、缺 README/encounter txt）。

本脚本做四件事（全部以卡内现用数据与 git 仓库当前状态为唯一事实源）：
1. 用卡内 battle-forge-panel 正则的当前内容回写仓库模板 st-integration/bootstrap-template.html
   （剥掉 ```html 包裹、真实 URL 还原为 {{APP_URL}} 占位），让生成管线不再产出过时模板
2. 运行 generate_st_package.py 重建 download/battle-forge-st-pack/（占位 URL 模板版）
3. 以仓库当前状态重打 download/battle-forge-app-src.zip（结构同旧 build_src_zip.py，但 BASE 锚定仓库根）
4. 重建 ../1/ 交付包：panel.json=卡内现用正则（真实 URL 可直接导入）、
   panel-local.json=URL 换 localhost、世界书 txt=说明壳+卡内 entry3 现文、
   补 encounter txt 与 README、放入新 zip

运行: python scripts/rebuild_st_pack.py
"""
import json
import os
import shutil
import subprocess
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent          # battle-forge 仓库根
PANEL_DIR = ROOT.parent                                 # C:/1MC/DND/battle_forge_panel
PACK = PANEL_DIR / "1"
CARD = Path(r"C:/1MC/【D&D 2024版】.json")
REAL_URL = "https://aiuewh.github.io/battle-forge/"
LOCAL_URL = "http://localhost:3000/"

INCLUDE_DIRS = [
    "src", "public",
    "scripts/ai-probe.ts", "scripts/build-embed-harness.py",
    "scripts/e2e-datalayer.sh", "scripts/e2e-initiative.sh",
    "scripts/test-fixtures/dmmsg.txt", "scripts/engine-tests.ts",
    "scripts/adversarial-tests.ts", "scripts/semantics-tests.ts",
    "scripts/st-pipeline-sim.mjs", "scripts/plan-probe.ts",
    "scripts/generate_st_package.py", "scripts/build_src_zip.py",
    "scripts/rebuild_st_pack.py", "scripts/regression-test.js",
    ".github", "st-integration", "prisma", "download/battle-forge-st-pack",
]
INCLUDE_FILES = [
    "package.json", "README.md", ".gitignore", "next.config.ts", "tsconfig.json",
    "eslint.config.mjs", "postcss.config.mjs", "tailwind.config.ts", "components.json",
]
EXCLUDE_PARTS = {"node_modules", ".next", "__pycache__", ".git", ".engtest", ".mimosa"}


def load_card() -> dict:
    with open(CARD, encoding="utf-8") as f:
        return json.load(f)


def sync_repo_template(card: dict) -> None:
    reg = next(r for r in card["data"]["extensions"]["regex_scripts"]
               if r.get("scriptName") == "battle-forge-panel")
    body = reg["replaceString"]
    assert body.startswith("```html") and body.rstrip().endswith("```"), "card regex wrapper changed?"
    body = body[len("```html"):].rstrip()
    assert body.endswith("```"), "trailing fence missing"
    body = body[: -len("```")].rstrip("\n")
    if REAL_URL in body:
        body = body.replace(REAL_URL, "{{APP_URL}}")
    (ROOT / "st-integration" / "bootstrap-template.html").write_text(body + "\n", encoding="utf-8")
    print(f"  模板已同步: st-integration/bootstrap-template.html ({len(body)} 字符)")


def run_generator() -> None:
    r = subprocess.run(["python", str(ROOT / "scripts" / "generate_st_package.py")],
                       cwd=ROOT, capture_output=True, text=True)
    print(r.stdout.strip())
    if r.returncode != 0:
        print(r.stderr)
        raise SystemExit("generate_st_package.py 失败")


def build_zip() -> Path:
    out = ROOT / "download" / "battle-forge-app-src.zip"
    entries: list[str] = []
    for inc in INCLUDE_DIRS:
        full = ROOT / inc
        if full.is_file():
            entries.append(inc)
            continue
        for root, dirs, files in os.walk(full):
            dirs[:] = [d for d in dirs if d not in EXCLUDE_PARTS]
            for f in files:
                entries.append(str(Path(root, f).relative_to(ROOT)))
    for f in INCLUDE_FILES:
        if (ROOT / f).exists():
            entries.append(f)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for rel in sorted(set(entries)):
            z.write(ROOT / rel, str(Path("battle-forge") / rel))
    n = len(zipfile.ZipFile(out).namelist())
    print(f"  zip 重建: {out} ({out.stat().st_size / 1024:.0f} KB, {n} 文件)")
    return out


def write_pack_file(path: Path, data, json_mode: bool) -> None:
    if json_mode:
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    else:
        path.write_text(data, encoding="utf-8")
    print(f"  写入 {path.name} ({path.stat().st_size} 字节)")


def rebuild_pack(card: dict, zip_path: Path) -> None:
    PACK.mkdir(exist_ok=True)
    reg = next(r for r in card["data"]["extensions"]["regex_scripts"]
               if r.get("scriptName") == "battle-forge-panel")
    hide = next(r for r in card["data"]["extensions"]["regex_scripts"]
                if r.get("scriptName") == "battle-forge-hide-legacy")
    e3 = card["data"]["character_book"]["entries"][3]["content"]

    # 1) panel.json = 卡内现用正则（真实 URL，导入即用）
    write_pack_file(PACK / "battle-forge-panel.json", [reg], True)

    # 2) panel-local.json = 同模板、URL 换本地联调
    local = json.loads(json.dumps(reg, ensure_ascii=False))
    local["id"] = "battle-forge-panel-local"
    local["scriptName"] = "battle-forge-panel-local"
    local["replaceString"] = local["replaceString"].replace(REAL_URL, LOCAL_URL)
    write_pack_file(PACK / "battle-forge-panel-local.json", [local], True)

    # 3) hide-legacy.json = 卡内同款
    write_pack_file(PACK / "battle-forge-hide-legacy.json", [hide], True)

    # 4) 世界书 txt = 说明壳 + 卡内 entry3 现文
    wrapper = """════════════════════════════════════════════════════════════════
【战斗全流程协议 · 前端结算权威】世界书条目 —— 直接粘贴进角色卡
════════════════════════════════════════════════════════════════

⚠ 本条目优先级高于旧的「战斗地图数据」「战斗检定」类条目。
当本条目与其他条目的战斗流程指令冲突时，一律以本条目为准。
核心原则：战斗的规则结算（命中/伤害/豁免/状态/回合/移动）全部由
前端战斗面板完成，你（DM）只负责：战前设计敌情 → 触发战斗 →
战后根据战报叙述剧情。你不得替任何单位掷骰或结算战斗数值。
多楼层语义：战斗进行中 AI 重发 <battle> 块时，面板是结算权威——
面板已结算的 HP/位置/先攻/死亡豁免永不被 AI 的过期快照覆盖
（不一致处写日志警告并保留面板值），状态只增不减；增援单位
入场时由面板掷先攻并插入回合序列，不打断当前回合。

用法：酒馆 → 角色卡编辑 → 世界书 → 添加条目
  · 标题/备注：[协议] 战斗全流程（前端结算权威）
  · 关键词：battle, 战斗, 遭遇, 敌人, encounter, battleresult
  · 触发位置：与你现有 <battle> 协议条目一致（通常 AI 输出 @D 较深）
  · 内容：把下方虚线之间的全部文本粘贴进去

────────────────────────────────────────────────
"""
    tail = """
────────────────────────────────────────────────

提示：
1. 完整数据流（三段式）：
   探索（<UpdateVariable> 持续同步角色 → 面板角色名单）
   → 战前（<encounter> 敌卡 → 面板暂存 + 显示敌情简报与难度预估）
   → 开战（<battle> → 点「掷先攻 · 开战」→ 面板全员掷先攻后依序行动）
   → 玩家在前端面板操作（移动/攻击/法术/队友可切换操控，AI 队友与敌人由面板 AI 驱动）
   → 玩家点「复制战报」→ <battleresult> 粘回酒馆 → 你叙述战后 + 应用变量补丁
2. 面板内置 2024 常用怪物预设：若 <battle> 中的敌方单位名与预设同名（如「哥布林」），
   即使没有 <encounter> 也会自动装配预设数据——但自制怪物必须先出敌卡。
3. 敌卡 JSON 允许小瑕疵：尾逗号、中文引号、字段别名（名称/name、生命值/hp、
   命中/attackBonus 均可识别），面板会容错解析并提示。
"""
    write_pack_file(PACK / "battle-protocol-worldbook-entry.txt", wrapper + e3.strip() + tail, False)

    # 5) encounter txt = 可选独立条目（沿用上级目录现版，未过时）
    src_enc = PANEL_DIR / "encounter-worldbook-entry.txt"
    if src_enc.exists():
        shutil.copyfile(src_enc, PACK / "encounter-worldbook-entry.txt")
        print(f"  复制 encounter-worldbook-entry.txt ({(PACK / 'encounter-worldbook-entry.txt').stat().st_size} 字节)")

    # 6) 新 zip
    shutil.copyfile(zip_path, PACK / "battle-forge-app-src.zip")
    print(f"  复制 battle-forge-app-src.zip ({(PACK / 'battle-forge-app-src.zip').stat().st_size} 字节)")


def write_readme(zip_path: Path) -> None:
    import datetime
    today = datetime.date.today().isoformat()
    head = open(zip_path, "rb").read()
    # 引擎版本取仓库当前 HEAD
    sha = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT,
                         capture_output=True, text=True).stdout.strip()
    readme = f"""# ⚔ Battle Forge · D&D 2024 战斗前端 —— 酒馆交付包

> 重建于 {today}。引擎版本：`{sha}`（已部署 GitHub Pages，与 zip 同源）。
> 卡片基线：`C:/1MC/【D&D 2024版】.json`（2026-09-22 晚，含本轮全部审查修复）。

## 文件清单

| 文件 | 用途 | 导入方式 |
|------|------|----------|
| battle-forge-panel.json | 正则脚本（核心）：捕获 <battle>/<encounter>/<UpdateVariable> 注入战斗面板 | 酒馆 → 扩展 → Regex → 导入，置于列表**最顶部** |
| battle-forge-panel-local.json | 本地联调版（面板指向 localhost:3000） | 同上，仅本地 `npm run dev` 时用 |
| battle-forge-hide-legacy.json | 深度≥4 楼层隐藏原始协议块（可选） | 酒馆 → 扩展 → Regex → 导入 |
| battle-protocol-worldbook-entry.txt | 世界书条目：战斗全流程协议（含多楼层语义） | 内容粘贴进世界书条目 |
| encounter-worldbook-entry.txt | 世界书条目（可选）：遭遇敌卡独立协议 | 同上（卡片版协议已内含敌卡格式，可不装） |
| battle-forge-app-src.zip | 引擎源码（与 Pages 部署同源的快照） | 解压即完整 Next.js 工程 |

## 核心原则：结算权威 = 前端面板

战斗的全部规则结算（命中/伤害/豁免/状态/回合/移动/敌我 AI）在面板内完成；
AI DM 只负责三件事：**战前设计敌情（<encounter>）→ 触发战斗（<battle>）→
收到战报（<battleresult>）后叙述战后并应用变量更新**。

### 先攻（PHB 步骤③）

`<battle>` 导入后是**战前集结态**：点「🎲 掷先攻 · 开战」，面板为全员掷
`1d20 + 先攻加值`（逐单位骰面明细进日志），平局按敏捷调整值/玩家方裁决。
惊讶/伏击：`surprise` 标记 → 2024 规则先攻劣势（设置面板可切 2014 首轮跳过）。
战斗中途增援：入场时掷先攻并插入回合序列，不打断当前回合。
设置面板可切「结算权威：面板 / 兼容旧卡」——兼容旧卡模式沿用 AI 给定先攻值。

### 多楼层语义（战斗中 AI 重发 <battle>）

面板权威模式下，战斗进行中收到的 AI 块视为**过期快照**：
- 面板已结算的 HP/位置/先攻/死亡豁免**永不被覆盖**，不一致处写日志警告（🛡️ 已保留面板值）；
- 状态取并集：AI 可叙事新增（恐惧/中毒等），不能移除面板结算的状态；
- 增援（新 ID）正常入场；完全不相交的 encounter = 新遭遇清场。

## 本轮引擎修复（09-22，已部署）

- 豁免/专注为 D20 Test：裸骰 20 自动成功、裸骰 1 自动失败（高 DC 吃满额伤害的矛盾已消除）
- Topple/Push 精通豁免按 `check.outcome` 判定（重度力竭下裸 20 不再误判倒地）
- 「0 HP 受伤记失败」开关真实生效（默认开 = 2024 规则，可关）
- 武器精通须 `已掌握: true` 才自动结算；隐匿检定补力竭 -2/级
- 力竭 2024：-2/级 d20 检定、-5 尺/级速度；重击全部伤害骰翻倍；祝福 +1d4
- 玩家角色支持 `抗性`/`免疫`/`易伤` 字段（变量结构 schema 已定义，面板自动结算）

## 安装顺序

1. 导入 battle-forge-panel.json（置顶）→ 刷新酒馆
2. 粘贴 battle-protocol-worldbook-entry.txt 内容为世界书条目（@D 深度与旧战斗条目一致）
3. （可选）导入 hide-legacy、encounter 条目
4. 无需部署：面板默认指向已上线的 GitHub Pages（可在面板 ⚙ 中改指本地/自建地址）
"""
    write_pack_file(PACK / "README.md", readme, False)


def main() -> None:
    card = load_card()
    print("1) 同步仓库模板 …")
    sync_repo_template(card)
    print("2) 重建 st-pack 生成物 …")
    run_generator()
    print("3) 重打源码 zip …")
    zp = build_zip()
    print("4) 重建交付包 ../1/ …")
    rebuild_pack(card, zp)
    write_readme(zp)
    print("✅ 完成")


if __name__ == "__main__":
    main()
