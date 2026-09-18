#!/bin/bash
# 数据层 E2E 回归：UpdateVariable 角色同步 → encounter 敌卡暂存 → battle 自动配装 → 行动栏作战 → 敌人设计师 → 移动端/恢复/嵌入
set -u
BASE=http://localhost:3456
SS=/home/z/my-project/scripts
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ✅ $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  ❌ $1"; }
check() { if [ "$2" = "0" ]; then ok "$1"; else bad "$1"; fi; }
# 从快照提取 ref：$1=rg 匹配模式, $2=first|last
ref_of() {
  local pat="$1" which="${2:-first}"
  local line ref
  if [ "$which" = "last" ]; then line=$(agent-browser snapshot -i 2>/dev/null | rg "$pat" | tail -1)
  else line=$(agent-browser snapshot -i 2>/dev/null | rg "$pat" | head -1); fi
  ref=$(echo "$line" | sed -E 's/.*\[ref=(e[0-9]+)\].*/\1/')
  echo "$ref"
}

echo "══ 1. 空状态 ══"
agent-browser open $BASE/ >/dev/null
agent-browser wait --load networkidle >/dev/null 2>&1
agent-browser wait 1500 >/dev/null
agent-browser storage local clear >/dev/null 2>&1
agent-browser reload >/dev/null
agent-browser wait --load networkidle >/dev/null 2>&1
agent-browser wait 1800 >/dev/null
agent-browser get text "body" 2>/dev/null | rg -q "Battle Forge"; check "空状态欢迎页" $?

echo "══ 2. 粘贴完整 DM 消息（变量+敌卡+战斗 三块合一）══"
DMMSG=$(cat /home/z/my-project/scripts/test-fixtures/dmmsg.txt)
TA=$(ref_of 'textbox "支持格式')
echo "  import textarea: $TA"
[ -n "$TA" ]; check "找到导入文本域" $?
agent-browser fill @$TA "$DMMSG" >/dev/null
IMPORT_BTN=$(ref_of 'button "解析导入"')
agent-browser click @$IMPORT_BTN >/dev/null
agent-browser wait 1800 >/dev/null
BODY=$(agent-browser get text "body" 2>/dev/null)
echo "$BODY" | rg -q "变量同步：7 条补丁"; check "变量同步（7 补丁 · 名单 1 人）" $?
echo "$BODY" | rg -q "遭遇暂存：1 张敌卡"; check "敌卡暂存" $?
echo "$BODY" | rg -q "艾尔玛 ← 角色名单「艾尔玛」"; check "自动配装：艾尔玛←名单" $?
echo "$BODY" | rg -q "豺狼人猎手 ← 敌卡「豺狼人猎手」"; check "自动配装：豺狼人猎手←暂存敌卡" $?

echo "══ 3. 行动栏（武器数学 / 法术 / 通用动作）══"
SNAP=$(agent-browser snapshot -i 2>/dev/null)
echo "$SNAP" | rg -q '\+1长剑 \+4 · 1d8\+2'; check "武器 +1长剑 +4 · 1d8+2" $?
echo "$SNAP" | rg -q '治疗真言.*1环.*附赠'; check "法术 治疗真言（1环·附赠）" $?
echo "$SNAP" | rg -q 'button "冲刺"'; check "通用动作：冲刺" $?
echo "$SNAP" | rg -q 'button "闪避"'; check "通用动作：闪避" $?
BODY3=$(agent-browser get text "body" 2>/dev/null)
echo "$BODY3" | rg -q "1环 4/4"; check "法术位 1环 4/4" $?

echo "══ 4. 角色 tab 名单卡片 ══"
ROSTER_TAB=$(ref_of 'tab "角色"')
agent-browser click @$ROSTER_TAB >/dev/null; agent-browser wait 700 >/dev/null
BODY4=$(agent-browser get text "body" 2>/dev/null)
echo "$BODY4" | rg -q "艾尔玛" && echo "$BODY4" | rg -q "Lv\.3"; check "名单卡片（艾尔玛 Lv.3）" $?
EXPAND=$(ref_of '武器 \d+ · 法术书')
[ -n "$EXPAND" ] && agent-browser click @$EXPAND >/dev/null; agent-browser wait 500 >/dev/null
BODY4B=$(agent-browser get text "body" 2>/dev/null)
echo "$BODY4B" | rg -q "命中 \+4"; check "武器命中预览 +4" $?

echo "══ 5. 掷先攻·开战（新流程：导入=集结，开战按钮=全员掷先攻）══"
agent-browser get text "body" 2>/dev/null | rg -q "待战"; check "导入后战前集结态（待战）" $?
ROLLBTN=$(ref_of 'button "掷先攻 · 开战"')
[ -n "$ROLLBTN" ]; check "掷先攻·开战按钮在场" $?
agent-browser click @$ROLLBTN >/dev/null; agent-browser wait 1500 >/dev/null
agent-browser get text "body" 2>/dev/null | rg -q "🎲 掷先攻"; check "面板掷先攻（全员敏捷检定）" $?
# 敌方先手时等待 AI 自动行动 → 玩家回合横幅
W=0
until agent-browser get text "body" 2>/dev/null | rg -q "轮到你了" || [ $W -ge 15 ]; do agent-browser wait 1000 >/dev/null; W=$((W+1)); done
agent-browser get text "body" 2>/dev/null | rg -q "轮到你了"; check "玩家回合（轮到你了横幅）" $?
ETEST=$(ref_of 'button "结束回合"' last)
[ -n "$ETEST" ]; check "结束回合按钮在场" $?
WPN=$(ref_of '\+1长剑')
agent-browser click @$WPN >/dev/null; agent-browser wait 600 >/dev/null
agent-browser get text "body" 2>/dev/null | rg -q "选择目标"; check "目标选择模式" $?
EXEC=$(ref_of 'button "执行"')
agent-browser click @$EXEC >/dev/null; agent-browser wait 1000 >/dev/null
agent-browser get text "body" 2>/dev/null | rg -q "发动【\+1长剑】"; check "长剑攻击结算" $?
agent-browser get text "body" 2>/dev/null | rg -q "vs AC14"; check "命中检定 vs 敌卡 AC14" $?

echo "══ 6. 动作经济与附赠动作法术 ══"
agent-browser snapshot -i 2>/dev/null | rg -q 'button "闪避" \[disabled'; check "动作用尽后通用动作禁用" $?
SPELL=$(ref_of '治疗真言')
agent-browser click @$SPELL >/dev/null; agent-browser wait 600 >/dev/null
EXEC=$(ref_of 'button "执行"')
agent-browser click @$EXEC >/dev/null; agent-browser wait 1000 >/dev/null
BODY6=$(agent-browser get text "body" 2>/dev/null)
echo "$BODY6" | rg -q "施放【治疗真言】治疗"; check "治疗真言结算（自动目标）" $?
echo "$BODY6" | rg -q "消耗 1 环法术位（余 3/4）"; check "法术位消耗 4→3" $?

echo "══ 7. 结束回合 → 敌方 AI（暂存敌卡动作）══"
ET=$(ref_of 'button "结束回合"' last)
agent-browser click @$ET >/dev/null; agent-browser wait 3500 >/dev/null
BODY7=$(agent-browser get text "body" 2>/dev/null)
echo "$BODY7" | rg -q "轮到 豺狼人猎手 行动"; check "回合推进至敌方" $?
echo "$BODY7" | rg -q "豺狼人猎手 发动【矛】"; check "敌方 AI 使用敌卡动作【矛】" $?
echo "$BODY7" | rg -q "vs AC15"; check "敌方攻击 vs 名单 AC15" $?

echo "══ 8. 敌人设计师 ══"
TAB=$(ref_of 'tab "敌卡"')
agent-browser click @$TAB >/dev/null; agent-browser wait 700 >/dev/null
NAME=$(ref_of 'textbox "名称"')
agent-browser fill @$NAME "影子豹" >/dev/null
DEPLOY=$(ref_of '上阵（敌方）')
agent-browser click @$DEPLOY >/dev/null; agent-browser wait 800 >/dev/null
agent-browser get text "body" 2>/dev/null | rg -q "影子豹 登场"; check "自定义敌人 影子豹 登场" $?

echo "══ 9. 截图 + 390px 移动端 ══"
agent-browser screenshot $SS/verify-datalayer.png >/dev/null 2>&1
agent-browser set viewport 390 844 >/dev/null; agent-browser wait 1200 >/dev/null
OV=$(agent-browser eval "document.documentElement.scrollWidth > 395 ? 1 : 0" 2>/dev/null | tr -d '"' | head -1)
if [ "$OV" != "OK" ]; then
  echo "  scrollWidth=$(agent-browser eval "document.documentElement.scrollWidth" 2>/dev/null)"; echo "  ⚠ 溢出调试：$(agent-browser eval "const w=[];document.querySelectorAll('*').forEach(e=>{const r=e.getBoundingClientRect();if(r.right>392&&r.width>40)w.push(e.tagName+'|'+String(e.className).split(' ').slice(0,2).join('.')+'|r='+Math.round(r.right))});[...new Set(w)].slice(0,8).join(' ;; ')" 2>/dev/null)"
fi
[ "$OV" = "0" ]; check "390px 无横向溢出" $?
agent-browser screenshot $SS/verify-datalayer-mobile.png >/dev/null 2>&1
agent-browser set viewport 1440 900 >/dev/null

echo "══ 10. localStorage 恢复 ══"
agent-browser reload >/dev/null
agent-browser wait --load networkidle >/dev/null 2>&1; agent-browser wait 1800 >/dev/null
BODY10=$(agent-browser get text "body" 2>/dev/null)
echo "$BODY10" | rg -q "艾尔玛" && echo "$BODY10" | rg -q "影子豹"; check "刷新后单位恢复" $?

echo "══ 11. 嵌入模式 ══"
agent-browser open "$BASE/?embed=1" >/dev/null
agent-browser wait --load networkidle >/dev/null 2>&1; agent-browser wait 1800 >/dev/null
BODY12=$(agent-browser get text "body" 2>/dev/null)
echo "$BODY12" | rg -q "战斗面板"; check "嵌入模式加载" $?
echo "$BODY12" | rg -q "\+1长剑"; check "嵌入模式行动栏" $?
agent-browser screenshot $SS/verify-datalayer-embed.png >/dev/null 2>&1

echo ""
echo "━━━━━━━━ 数据层 E2E 汇总 ━━━━━━━━"
echo "✅ 通过: $PASS   ❌ 失败: $FAIL"
exit $FAIL
