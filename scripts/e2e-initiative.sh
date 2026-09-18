#!/bin/bash
# 先攻主流程 + 楼层合并权威 E2E：
# ① 导入 battle → 战前集结态（掷先攻·开战按钮 + 待掷🎲标记，battleActive=false）
# ② 点「掷先攻·开战」→ 日志逐单位掷骰明细 + 第1轮开始
# ③ 面板结算伤害 → 重导入过期 AI 块（旧HP）→ HP 保留 + 🛡️冲突警告
# ④ 导入增援块（仅新单位）→ 🆕入场掷先攻 + 先攻序列含增援
# ⑤ 清场重导 surprise 块 → 惊讶日志 → 开战掷骰含「惊讶·劣势」
set -u
BASE=http://localhost:3456
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ✅ $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  ❌ $1"; }
check() { if [ "$2" = "0" ]; then ok "$1"; else bad "$1"; fi; }
ref_of() {
  local pat="$1" which="${2:-first}"
  local line ref
  if [ "$which" = "last" ]; then line=$(agent-browser snapshot -i 2>/dev/null | rg "$pat" | rg '\[ref=' | tail -1)
  else line=$(agent-browser snapshot -i 2>/dev/null | rg "$pat" | rg '\[ref=' | head -1); fi
  ref=$(echo "$line" | tr -d '\r\n' | sed -E 's/.*\[ref=(e[0-9]+)\].*/\1/')
  echo "$ref"
}
safe_click() { local r="$1"; [ -n "$r" ] && agent-browser click @$r >/dev/null 2>&1; }

BATTLE1='<battle>
艾尔玛|hp 24/24|pos 2,2|att 0
米拉|hp 20/20|pos 3,2|att 0
哥布林甲|hp 7/7|pos 10,8|att 2
</battle>'

STALE='<battle>
艾尔玛|hp 24/24|init 17|pos 2,2|att 0
米拉|hp 20/20|init 12|pos 3,2|att 0
哥布林甲|hp 7/7|init 9|pos 10,8|att 2
</battle>'

REINFORCE='<battle>
哥布林援军|hp 7/7|pos 12,10|att 2
</battle>'

SURPRISE='<battle>
艾尔玛|hp 24/24|pos 2,2|att 0|surprise
米拉|hp 20/20|pos 3,2|att 0|surprise
伏击者|hp 13/13|pos 10,8|att 2
</battle>'

# 导入一条消息：空状态直接可见导入卡；战斗视图需先切「导入导出」标签
import_msg() {
  local msg="$1"
  agent-browser open "$BASE/" >/dev/null 2>&1
  agent-browser wait --load networkidle >/dev/null 2>&1
  agent-browser wait 1500 >/dev/null
  local TA=$(ref_of 'textbox "支持格式')
  if [ -z "$TA" ]; then
    local TAB=$(ref_of 'tab "导入导出"')
    [ -n "$TAB" ] && agent-browser click @$TAB >/dev/null && agent-browser wait 900 >/dev/null
    TA=$(ref_of 'textbox "支持格式')
  fi
  [ -z "$TA" ] && { echo "  ⚠️ 未找到导入文本域"; return 1; }
  agent-browser fill @$TA "$msg" >/dev/null
  local BTN=$(ref_of 'button "解析导入"')
  safe_click "$BTN"
  agent-browser wait 1500 >/dev/null
}

fresh_page() {
  agent-browser open $BASE/ >/dev/null
  agent-browser wait --load networkidle >/dev/null 2>&1
  agent-browser wait 1500 >/dev/null
  agent-browser storage local clear >/dev/null 2>&1
  # 预置 aiAutoPlay=false（消除 AI 自动行动与脚本操作的竞态，保证确定性）
  agent-browser storage local set dnd-battle-state-v1 '{"units":[],"aiAutoPlay":false}' >/dev/null 2>&1
  agent-browser reload >/dev/null
  agent-browser wait --load networkidle >/dev/null 2>&1
  agent-browser wait 1800 >/dev/null
}

echo "══ 1. 导入 battle 块（无 next 标记）→ 战前集结态 ══"
fresh_page
import_msg "$BATTLE1"
BODY=$(agent-browser get text "body" 2>/dev/null)
echo "$BODY" | rg -q "掷先攻 · 开战"; check "战前集结态：掷先攻·开战按钮可见" $?
echo "$BODY" | rg -q "待战"; check "battleActive=false（待战徽标）" $?
echo "$BODY" | rg -q "艾尔玛"; check "单位已集结" $?
echo "══ 2. 点击掷先攻·开战 ══"
ROLLBTN=$(ref_of 'button "掷先攻 · 开战"')
[ -n "$ROLLBTN" ]; check "找到掷先攻按钮" $?
agent-browser click @$ROLLBTN >/dev/null
agent-browser wait 1800 >/dev/null
BODY=$(agent-browser get text "body" 2>/dev/null)
echo "$BODY" | rg -q "掷先攻（1d20 \+ 敏捷调整值）"; check "日志：先攻检定表头" $?
echo "$BODY" | rg -q "🎲 艾尔玛：1d20"; check "日志：艾尔玛掷骰明细" $?
echo "$BODY" | rg -q "🎲 哥布林甲：1d20"; check "日志：哥布林掷骰明细" $?
echo "$BODY" | rg -q "战斗开始！第 1 轮"; check "日志：第 1 轮开始" $?
echo "$BODY" | rg -q "第 1 轮"; check "回合徽标：第 1 轮" $?

echo "══ 3. 战斗中重导入过期 AI 块 → 面板权威保护 ══"
GID=$(agent-browser snapshot -i 2>/dev/null | rg '哥布林甲' | head -1 | sed -E 's/.*\[ref=(e[0-9]+)\].*/\1/')
[ -n "$GID" ]; check "先攻条可见哥布林甲" $?
agent-browser click @$GID >/dev/null
agent-browser wait 900 >/dev/null
DMG=$(ref_of 'spinbutton "伤害"')
[ -n "$DMG" ]; check "详情卡伤害输入框" $?
agent-browser fill @$DMG "5" >/dev/null
HURT=$(ref_of 'button "伤害"' last)
agent-browser click @$HURT >/dev/null
agent-browser wait 1000 >/dev/null
BODY=$(agent-browser get text "body" 2>/dev/null)
echo "$BODY" | rg -q "2/7"; check "面板结算：哥布林甲 HP 7→2" $?
import_msg "$STALE"
BODY=$(agent-browser get text "body" 2>/dev/null)
echo "$BODY" | rg -q "2/7"; check "权威保护：HP 仍为 2/7（未被过期快照回滚）" $?
echo "$BODY" | rg -q "过期快照"; check "日志：🛡️ 过期快照警告" $?
echo "$BODY" | rg -q "24/24"; check "未参战单位数值不受影响（艾尔玛 24/24）" $?

echo "══ 4. 增援入场掷先攻 ══"
import_msg "$REINFORCE"
BODY=$(agent-browser get text "body" 2>/dev/null)
echo "$BODY" > /tmp/e2e-sec4-body.txt
echo "$BODY" | rg -q "增援入场：哥布林援军"; check "日志：🆕 增援入场掷先攻" $?
echo "$BODY" | rg -q "哥布林援军"; check "先攻序列含增援" $?
echo "$BODY" | rg -q "2/7"; check "增援导入未破坏面板 HP（仍 2/7）" $?
echo "$BODY" | rg -q "第 1 轮"; check "当前回合未被打断（仍第 1 轮）" $?

echo "══ 5. 清场 + surprise 块 → 惊讶劣势 ══"
fresh_page
import_msg "$SURPRISE"
BODY=$(agent-browser get text "body" 2>/dev/null)
echo "$BODY" | rg -q "惊讶方：艾尔玛"; check "日志：惊讶方宣告" $?
ROLLBTN=$(ref_of 'button "掷先攻 · 开战"')
agent-browser click @$ROLLBTN >/dev/null
agent-browser wait 1800 >/dev/null
BODY=$(agent-browser get text "body" 2>/dev/null)
echo "$BODY" | rg -q "艾尔玛：1d20[^\n]*劣势"; check "日志：艾尔玛掷骰含「惊讶·劣势」" $?
echo "$BODY" | rg -q "伏击者：1d20"; check "日志：伏击者正常掷骰" $?
if echo "$BODY" | rg -q "伏击者：1d20[^\n]*劣势"; then bad "伏击者不应有劣势"; else ok "伏击者无劣势标记"; fi

echo ""
echo "━━━━━━ 先攻 E2E 汇总：$PASS 通过 / $FAIL 失败 ━━━━━━"
exit $([ "$FAIL" -gt 0 ] && echo 1 || echo 0)
