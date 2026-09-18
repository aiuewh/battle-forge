#!/usr/bin/env node
/**
 * 酒馆正则管线模拟器（用真实角色卡的全部正则脚本 + Battle Forge 集成包）
 *
 * 模拟 SillyTavern 渲染一条消息时对「显示管线」的处理：
 *   - 按列表顺序执行（forge 置于最顶端）
 *   - 过滤 disabled / placement / markdownOnly / minDepth / maxDepth
 *   - JS 正则语义（与酒馆一致）
 *
 * 场景：
 *   A 战斗楼 depth0（完整协议消息，旧面板已禁用）
 *   B 探索楼 depth0（只有 content + UpdateVariable）
 *   C 旧战斗楼 depth4（forge maxDepth=3 之外 + hide-legacy 隐藏器）
 *   D 敌情楼 depth0（content + encounter + UV，无 battle —— 战前简报）
 *   E 战斗楼 depth0 但旧面板【未禁用】（应检测到污染标记）
 *   F 流式中间态（UV 未闭合）
 */
import { readFileSync } from 'fs';

const CARD = '/home/z/my-project/upload/【D&D 2024版】.json';
const PACK_DIR = '/home/z/my-project/download/battle-forge-st-pack';

const card = JSON.parse(readFileSync(CARD, 'utf-8'));
const data = card.data ?? card;
const cardScripts = data.extensions.regex_scripts.map(s => ({ ...s }));
const forge = JSON.parse(readFileSync(`${PACK_DIR}/battle-forge-panel.json`, 'utf-8'))[0];
const hider = JSON.parse(readFileSync(`${PACK_DIR}/battle-forge-hide-legacy.json`, 'utf-8'))[0];

function compile(findRegex) {
  // 酒馆兼容两种格式：/pattern/flags 定界符形式 与 裸字符串形式
  const m = /^\/([\s\S]+)\/([gimsuy]*)$/.exec(findRegex);
  if (m && findRegex.startsWith('/')) return new RegExp(m[1], m[2].replace('g', '') || m[2]);
  return new RegExp(findRegex, 'g');
}

/** 跑一遍显示管线 */
function runPipeline(scripts, msg, depth, placement = 2) {
  let s = msg;
  const trace = [];
  for (const sc of scripts) {
    if (sc.disabled) continue;
    const pl = Array.isArray(sc.placement) ? sc.placement : [sc.placement];
    if (!pl.includes(placement)) continue;
    if (!sc.markdownOnly) continue; // 显示管线只跑 markdownOnly
    if (sc.minDepth != null && depth < Number(sc.minDepth)) continue;
    if (sc.maxDepth != null && depth > Number(sc.maxDepth)) continue;
    try {
      const re = compile(sc.findRegex);
      const before = s;
      s = s.replace(re, sc.replaceString);
      if (s !== before) trace.push(sc.scriptName);
    } catch (e) {
      trace.push(`${sc.scriptName}!!ERR:${e.message}`);
    }
  }
  return { out: s, trace };
}

// ============ 断言工具 ============
let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ` — ${detail}` : ''}`); }
}

function panelCount(out) {
  // 只统计 Battle Forge 面板（含 bp-data 数据岛），不把卡自身的状态栏/其他围栏算进去
  return (out.match(/```html[\s\S]*?bp-data[\s\S]*?```/g) || []).length;
}
function islandOf(out) {
  const m = out.match(/<script type="text\/plain" id="bp-data">([\s\S]*?)<\/script>/);
  return m ? m[1] : null;
}
function withoutFences(out) { return out.replace(/```html[\s\S]*?```/g, ''); }

// ============ 消息样本（贴合卡的真实协议） ============
const battleReply = [
  '<konatan_planning~> （DM 构思中：哥布林伏击，先攻检定后进入战斗） </konatan_planning~>',
  '<content>你推开锈蚀的铁门，三只哥布林从瓦砾后窜起。「抓活口！」领头的尖啸着挥舞弯刀。</content>',
  '<dice>\n发动技能: 先攻\n目标: 哥布林×3\n情境: 遭遇战\n检定细节: d20(15)+2=17\n判定结果: 成功（Success）\n结果描述: 你抢先出手。\n</dice>',
  '<encounter>\n[\n  {"名称": "哥布林", "体型": "小型", "挑战等级": 0.25, "ac": 13, "生命值": 10, "速度": 30, "属性": {"力量": 8, "敏捷": 14, "体质": 10, "智力": 10, "感知": 8, "魅力": 8}, "攻击": [{"名称": "弯刀", "类型": "近战", "命中": 4, "伤害": "1d6+2", "伤害类型": "挥砍", "射程": 5}], "抗性": [], "免疫": [], "易伤": [], "战术": "游击"}\n]\n</encounter>',
  '<battle>\n艾尔玛|init 17|hp 22/22|pos 0,15|att 0|next\n米拉|init 12|hp 14/14|pos 5,20|att 0\n哥布林1|init 9|hp 10/10|pos 20,20|att 2\n哥布林2|init 7|hp 10/10|pos 25,15|att 2\n</battle>',
  '<UpdateVariable>\n<Analysis>\n- Time passed: ~6 seconds\n</Analysis>\n<JSONPatch>\n[\n  { "op": "replace", "path": "/世界信息/时辰", "value": "20:15 夜晚" },\n  { "op": "delta", "path": "/角色列表/艾尔玛/生命值/当前", "value": -2 }\n]\n</JSONPatch>\n</UpdateVariable>',
].join('\n');

const exploreReply = [
  '<content>你在废弃的祭坛前搜索，找到一枚古旧的护符。</content>',
  '<UpdateVariable>\n<Analysis>\n- Time passed: ~20 分钟\n</Analysis>\n<JSONPatch>\n[\n  { "op": "insert", "path": "/角色列表/艾尔玛/物品/武器/护符之锤/-", "value": { "伤害公式": "1d8+3", "伤害类型": "挥砍" } }\n]\n</JSONPatch>\n</UpdateVariable>',
].join('\n');

const briefReply = [
  '<content>你趴在山脊后窥探：营地里有四只哥布林和一名驯兽师，笼中关着两头座狼。</content>',
  '<encounter>\n[\n  {"名称": "哥布林", "ac": 13, "生命值": 10, "挑战等级": 0.25, "战术": "游击"},\n  {"名称": "哥布林驯兽师", "ac": 12, "生命值": 16, "挑战等级": 1, "战术": "远程"},\n  {"名称": "座狼", "ac": 13, "生命值": 22, "挑战等级": 1, "战术": "残暴"}\n]\n</encounter>',
  '<UpdateVariable>\n<Analysis>\n- Time passed: ~40 秒\n</Analysis>\n<JSONPatch>\n[]\n</JSONPatch>\n</UpdateVariable>',
].join('\n');

const streamingReply = [
  '<content>战斗一触即发，你握紧武器。</content>',
  '<encounter>[{"名称": "哥布林", "ac": 13, "生命值": 10}]</encounter>',
  '<UpdateVariable>\n<Analysis>\n- Time passed: ~2 秒\n</Analysis>',
].join('\n');

// ============ 管线配置 ============
function buildPipeline({ disableOldPanel = true, withHider = true } = {}) {
  const list = cardScripts.map(s => ({ ...s }));
  // 旧面板（dnnd-battle-panel）按合并方案禁用
  const oldPanel = list.find(s => s.scriptName === 'dnnd-battle-panel');
  if (oldPanel && disableOldPanel) oldPanel.disabled = true;
  // forge 置于最顶端（先于 [0] 变量美化拿到原始协议块）
  const pack = { ...forge };
  list.unshift(pack);
  if (withHider) list.push({ ...hider });
  return list;
}

// ============ 场景 A：战斗楼 depth0 ============
{
  const { out, trace } = runPipeline(buildPipeline(), battleReply, 0);
  const island = islandOf(out);
  check('A1 战斗楼恰好 1 个面板', panelCount(out) === 1, `实际 ${panelCount(out)}`);
  check('A2 数据岛存在', island != null);
  check('A3 岛内保留原始 <battle>', island?.includes('<battle>') && island?.includes('艾尔玛|init 17'));
  check('A4 岛内保留原始 <encounter>', island?.includes('<encounter>'));
  check('A5 岛内 UV 被[0]美化（👾变量更新）', island?.includes('变量更新'));
  check('A6 岛内 <JSONPatch> 完好可解析', (island?.match(/<JSONPatch>/g) || []).length === 1 && (island?.match(/"op": "(?:replace|delta|insert|remove)"/g) || []).length === 2);
  check('A7 正文被[16]美化（raw <content> 消失）', !out.includes('<content>'));
  check('A8 骰子被[10]美化（raw <dice> 消失）', !withoutFences(out).includes('<dice>'));
  check('A9 正文内容保留', out.includes('锈蚀的铁门'));
  check('A9b 卡自身世界信息条状态栏保留', out.includes('```html') && /世界信息|wb/.test(out));
  check('A10 围栏外无裸协议块泄漏', !/<\/?(?:battle|encounter|statblock)>/.test(withoutFences(out)));
  check('A11 岛内无旧面板污染标记', !island?.includes('raw-data'));
  check('A12 forge 与 [0] 均已执行', trace.includes('battle-forge-panel') && trace.includes('[美化]完整变量更新'), trace.join(','));
  // 模拟面板端解析岛内数据
  const patches = [...island.matchAll(/<JSONPatch>([\s\S]*?)<\/JSONPatch>/g)].map(m => m[1]);
  let parsed = 0;
  for (const p of patches) {
    const s = p.slice(p.indexOf('['), p.lastIndexOf(']') + 1);
    try { parsed += JSON.parse(s).length; } catch { /* ignore */ }
  }
  check('A13 面板可从岛内提取 2 条变量补丁', parsed === 2, `实际 ${parsed}`);
}

// ============ 场景 B：探索楼 depth0 ============
{
  const { out } = runPipeline(buildPipeline(), exploreReply, 0);
  check('B1 探索楼零面板渲染', panelCount(out) === 0, `实际 ${panelCount(out)}`);
  check('B2 探索楼 UV 仍被[0]美化', out.includes('变量更新'));
  check('B3 探索楼正文保留', out.includes('护符'));
  check('B4 探索楼无残留裸 UpdateVariable', !/<UpdateVariable>/.test(withoutFences(out).replace(/变量更新/g, '')) || !out.includes('<UpdateVariable>'));
}

// ============ 场景 C：旧战斗楼 depth4 ============
{
  const { out } = runPipeline(buildPipeline(), battleReply, 4);
  check('C1 depth4 无面板渲染（maxDepth=3）', panelCount(out) === 0, `实际 ${panelCount(out)}`);
  check('C2 hide-legacy 隐藏裸 battle/encounter', !/<\/?(?:battle|encounter|statblock)>/.test(out));
  check('C3 depth4 UV 仍被[0]美化', out.includes('变量更新'));
  check('C4 depth4 正文保留', out.includes('锈蚀的铁门'));
}

// ============ 场景 D：敌情楼 depth0（战前简报） ============
{
  const { out } = runPipeline(buildPipeline(), briefReply, 0);
  const island = islandOf(out);
  check('D1 敌情楼恰好 1 个面板', panelCount(out) === 1, `实际 ${panelCount(out)}`);
  check('D2 岛内含 3 张敌卡', island != null && ['哥布林', '驯兽师', '座狼'].every(n => island.includes(n)));
  check('D3 岛内无 battle 数据（战斗未触发）', !island?.includes('<battle>'));
  check('D4 正文保留', out.includes('山脊'));
  check('D5 UV 被[0]美化', island?.includes('变量更新') || !out.includes('<UpdateVariable>'));
}

// ============ 场景 E：旧面板未禁用（污染演示 + 检测标记） ============
{
  const { out } = runPipeline(buildPipeline({ disableOldPanel: false }), battleReply, 0);
  const island = islandOf(out);
  check('E1 污染场景：岛内出现旧面板 raw-data 标记（可被 bootstrap 检测告警）', island?.includes('raw-data') === true);
  check('E2 面板数仍为 1（旧面板在岛内的替换不再产生新围栏）', panelCount(out) === 1, `实际 ${panelCount(out)}`);
}

// ============ 场景 F：流式中间态（UV 未闭合） ============
{
  const { out } = runPipeline(buildPipeline(), streamingReply, 0);
  const island = islandOf(out);
  check('F1 流式态不崩溃且有面板', panelCount(out) === 1);
  check('F2 岛内含 encounter（已闭合部分正常捕获）', island?.includes('<encounter>'));
  check('F3 未闭合 UV 不进岛（链在锚点后自然截断）', !island?.includes('Time passed'));
  check('F4 未闭合 UV 由[1]美化兜底', out.includes('变量更新'));
}

console.log(`\n========== 管线模拟结果：${pass} 通过 / ${fail} 失败 ==========`);
if (failures.length > 0) {
  console.log('失败项：');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
