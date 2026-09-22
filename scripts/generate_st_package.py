#!/usr/bin/env python3
"""
生成酒馆（SillyTavern）集成包（v2 —— 结算权威=前端 架构）：

在仓库根目录运行：python scripts/generate_st_package.py

1. battle-forge-panel.json —— 正则脚本（核心）
   · 必须置于正则列表【最顶部】（先于「[美化]完整变量更新」运行，才能拿到原始 <UpdateVariable>）
   · 捕获规则：锚点块（battle/encounter/statblock）开头，链式吞并相邻的
     UpdateVariable 等协议块；块间只允许纯文本（不得穿越 <dice>/<content> 等其他标签）
   · 探索楼（只有 UpdateVariable）不渲染面板；敌情楼（只有 encounter）渲染战前简报
   · maxDepth=3：最近 4 楼渲染面板，更早的楼层由 hide-legacy 隐藏原始协议文本
   · 数据岛在 [0] 变量美化之后仍保留可解析的 <JSONPatch>（面板从岛内提取补丁）
2. battle-forge-hide-legacy.json —— 深度≥4 楼层的协议块隐藏器（可选导入）
3. battle-forge-panel-local.json —— 本地联调版（localhost:3000）

安全约束：所有输出路径均为相对仓库根的字面量常量，写入前经 resolve() +
is_relative_to(OUT_DIR) 双重校验，任何越界路径直接抛错拒绝写入。
"""
import json
from pathlib import Path

# 输出目录：仓库根下的 download/battle-forge-st-pack（脚本须从仓库根运行）
OUT_DIR = Path("download") / "battle-forge-st-pack"
OUT_DIR.mkdir(parents=True, exist_ok=True)

with open(Path("st-integration") / "bootstrap-template.html", "r", encoding="utf-8") as f:
    template = f.read()

# ---- findRegex 设计（JS 引擎语义） ----
# GAP  = (?:(?!<[A-Za-z_\/])[\s\S])*?      纯文本间隙：任何「<字母/下划线/斜线」都会终止链
# 锚点 = <(battle|encounter|statblock)> BODY </\2>          必须存在（渲染面板的依据）
# 链块 = GAP <(battle|encounter|statblock|update_?variable)> BODY </\3>
# BODY = (?:(?!<\/?(?:battle|encounter|statblock|update_?variable)>)[\s\S])*?
#        tempered 扫描：块体不可穿越下一个协议标签开/闭形态 → 恶意重复开标签时
#        每个起点在下一个标签处立即失败，复杂度 O(n)（修复前 [\s\S]*? 无界为 O(n²) ReDoS）
# 分组1 = 整个捕获（注入数据岛 $1）；update_?variable 兼容 UpdateVariable/update_variable/updatevariable
FIND_REGEX = (
    "/("
    "<(battle|encounter|statblock)>"
    "(?:(?!<\\/?(?:battle|encounter|statblock|update_?variable)>)[\\s\\S])*?<\\/\\2>"
    "(?:"
    "(?:(?!<[A-Za-z_\\/])[\\s\\S])*?"
    "<(battle|encounter|statblock|update_?variable)>"
    "(?:(?!<\\/?(?:battle|encounter|statblock|update_?variable)>)[\\s\\S])*?<\\/\\3>"
    ")*"
    ")/gi"
)

# 深度≥4 的原始协议块隐藏器（forge maxDepth=3 之后的楼层）
HIDE_FIND = "/<(?:battle|encounter|statblock)>[\\s\\S]*?<\\/(?:battle|encounter|statblock)>/g"


def make_panel_json(app_url: str) -> dict:
    bootstrap = template.replace("{{APP_URL}}", app_url)
    replace_string = "```html\n" + bootstrap + "\n```"
    return {
        "id": "battle-forge-panel",
        "scriptName": "battle-forge-panel",
        "findRegex": FIND_REGEX,
        "replaceString": replace_string,
        "placement": [1, 2],
        "disabled": False,
        "markdownOnly": True,
        "promptOnly": False,
        "runOnEdit": True,
        "substituteRegex": 0,
        "minDepth": None,
        "maxDepth": 3,
        "invert": {},
    }


def make_hide_json() -> dict:
    return {
        "id": "battle-forge-hide-legacy",
        "scriptName": "battle-forge-hide-legacy",
        "findRegex": HIDE_FIND,
        "replaceString": "",
        "placement": [1, 2],
        "disabled": False,
        "markdownOnly": True,
        "promptOnly": False,
        "runOnEdit": True,
        "substituteRegex": 0,
        "minDepth": 4,
        "maxDepth": None,
        "invert": {},
    }


def dump(obj, out_path: Path) -> None:
    # 路径安全护栏：resolve() 规范化后必须仍位于 OUT_DIR 内，否则拒绝写入
    resolved = out_path.resolve()
    if not resolved.is_relative_to(OUT_DIR.resolve()):
        raise ValueError(f"输出路径越界，已拒绝写入: {resolved}")
    resolved.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  {resolved} ({resolved.stat().st_size} bytes)")


print("生成完成：")
dump([make_panel_json("https://YOUR-NAME.github.io/battle-forge/")], OUT_DIR / "battle-forge-panel.json")
dump([make_panel_json("http://localhost:3000/")], OUT_DIR / "battle-forge-panel-local.json")
dump([make_hide_json()], OUT_DIR / "battle-forge-hide-legacy.json")
