#!/usr/bin/env python3
"""构造 bootstrap 嵌入链路测试 harness：正则包 replaceString + 模拟数据岛内容"""
import json, io

PACK = "/home/z/my-project/download/battle-forge-st-pack/battle-forge-panel-local.json"
OUT = "/home/z/my-project/scripts/embed-harness.html"

pack = json.load(io.open(PACK, encoding="utf-8"))[0]
rep = pack["replaceString"]
# 剥掉 ```html 围栏
body = rep.removeprefix("```html\n").removesuffix("\n```")

# 替换 $1 数据岛内容（模拟一条敌情+战斗消息）
DATA = """<encounter>
[
  {"名称": "地精萨满", "ac": 10, "生命值": 21, "挑战等级": 1, "战术": "爆发"}
]
</encounter>
<battle>
艾尔玛|init 17|hp 15/28|pos 10,15|att 0|next
地精萨满|init 11|hp 21/21|pos 30,15|att 2
</battle>
<UpdateVariable>
<JSONPatch>
[{ "op": "replace", "path": "/世界信息/时辰", "value": "21:00 夜晚" }]
</JSONPatch>
</UpdateVariable>"""

html = body.replace("<script type=\"text/plain\" id=\"bp-data\">$1</script>",
                    "<script type=\"text/plain\" id=\"bp-data\">" + DATA.replace("&", "&amp;") + "</script>")

io.open(OUT, "w", encoding="utf-8").write(
    "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>embed harness</title></head><body>\n"
    + html + "\n</body></html>"
)
print(f"harness 写入 {OUT} ({len(html)} 字符)")
