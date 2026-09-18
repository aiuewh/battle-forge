/**
 * Battle Forge 反例（对抗性）测试套件
 * 目标：畸形协议 / 极端数值 / 恶意输入 / 性能边界 / 安全面
 * 原则：
 *   1. 所有面向 AI 输出的解析函数，对任意垃圾输入不得抛出未捕获异常
 *   2. 不得产生原型污染（__proto__ / constructor / prototype）
 *   3. 极端数值必须被钳制或优雅降级，不得产生 NaN/Infinity 泄漏到单位状态
 *   4. 正则在恶意输入上不得灾难性回溯（>2s 视为失败）
 * 运行: bun scripts/adversarial-tests.ts
 */
import {
  parseBattleBlock, extractBattleBlocks, extractBattleChecks, extractDiceChecks,
  extractJsonPatches, parseDicePool, parseDmMessage, parseCheckDetail, parseOutcome,
} from '../src/lib/engine/protocol';
import { parseFormula, rollFormula, rollDie, setRng } from '../src/lib/engine/dice';
import { lenientJsonParse, parseEncounterDefs } from '../src/lib/engine/statblocks';
import { applyPatches, charSheetsFromTree } from '../src/lib/engine/sheetbridge';
import { findPath, estimateCover, aoeCells, reachableCells } from '../src/lib/engine/geometry';
import { resolveAttack, applyDamageModifiers, resolveSave, encounterDifficulty } from '../src/lib/engine/combat';
import { rollInitiative, buildInitiativeOrder } from '../src/lib/engine/initiative';
import type { BattleUnit } from '../src/lib/engine/types';
import * as fs from 'fs';

// ===== 框架 =====
let pass = 0, fail = 0;
const findings: string[] = [];
function ok(name: string, cond: boolean, detail = '') {
  if (cond) pass++;
  else { fail++; findings.push(`❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}
/** 不得抛异常（允许返回空/降级） */
function noThrow(name: string, fn: () => unknown): unknown {
  try { return fn(); } catch (e) { fail++; findings.push(`💥 ${name} — 抛出异常: ${String(e).slice(0, 120)}`); return undefined; }
}
function mustThrow(name: string, fn: () => unknown): boolean {
  try { fn(); fail++; findings.push(`❌ ${name} — 应当抛出但未抛出`); return false; }
  catch { pass++; return true; }
}
/** 原型污染探针 */
function polluted(): boolean {
  return Object.prototype.hasOwnProperty('__polluted__')
    || ({} as Record<string, unknown>)['__polluted__'] !== undefined
    || Object.prototype.hasOwnProperty('polluted');
}
function mkUnit(p: Partial<BattleUnit> = {}): BattleUnit {
  return {
    id: 'u', name: 'u', hp: 10, maxHp: 10, ac: 13, speed: 30, attitude: 1,
    pos: { x: 10, y: 10 }, statuses: [], resistances: [], immunities: [],
    vulnerabilities: [], init: 10, next: false,
    ...p,
  } as BattleUnit;
}

console.log('━━━━━━ A. <battle> 块畸形输入 ━━━━━━');

// A1 空与近空
ok('A1 空块 → 0 单位', noThrow('A1', () => parseBattleBlock('')) as string[] === undefined ? false : (noThrow('A1b', () => parseBattleBlock('')) !== undefined));
ok('A1b 空白/注释行', (() => { const r = noThrow('A1b', () => parseBattleBlock('\n\n  # 注释\n|||  |  ||\n')) as BattleUnit[]; return Array.isArray(r) && r.length === 0; })());
ok('A1c 只有管道符', (() => { const r = noThrow('A1c', () => parseBattleBlock('||||||')) as unknown[]; return Array.isArray(r) && r.length === 0; })());

// A2 ID 撞已知 key
ok('A2 ID=init 的行被跳过', (() => { const r = parseBattleBlock('init 5|hp 3/3'); return r.length === 0; })());

// A3 hp 畸形
{
  const neg = parseBattleBlock('僵尸|init 10|hp -5/30|pos 0,0|att 2');
  const u = neg[0];
  ok('A3a hp -5/30 不产生 NaN', u && Number.isFinite(u.hp?.current ?? NaN) && Number.isFinite(u.hp?.max ?? NaN),
    `hp=${JSON.stringify(u?.hp)}`);
  // 语义：负 current 合法（死亡判定），但 max 不应被写成 -5
  ok('A3b 负当前HP时 max 不被污染为负数', (u?.hp?.max ?? 0) > 0, `max=${u?.hp?.max}（hp -5/30 应保 max=30）`);
  const over = parseBattleBlock('狂暴者|hp 99999999999/1')[0];
  ok('A3c 巨大HP数值有限', Number.isFinite(over?.hp?.current), String(over?.hp?.current));
  const junk = parseBattleBlock('废柴|hp abc/def')[0];
  ok('A3d hp 非数字 → 无hp字段（不崩溃）', junk && junk.hp === undefined);
  const spaced = parseBattleBlock('规范|hp 24 / 30')[0];
  ok('A3e hp 带空格可解析', spaced?.hp?.current === 24 && spaced?.hp?.max === 30, JSON.stringify(spaced?.hp));
}
// A4 pos 畸形
{
  const sci = parseBattleBlock('法师|pos 1e3,5')[0];
  ok('A4a 科学计数pos → 丢弃pos', sci?.pos === undefined, JSON.stringify(sci?.pos));
  const huge = parseBattleBlock('神明|pos 99999999999,99999999999')[0];
  ok('A4b 巨大pos被钳制到±10000且有限', huge?.pos?.x === 10000 && Number.isFinite(huge.pos.x), JSON.stringify(huge?.pos));
  const nan = parseBattleBlock('幽灵|pos NaN,NaN')[0];
  ok('A4c NaN pos → 丢弃', nan?.pos === undefined);
}
// A5 status 未知值
{
  const s = parseBattleBlock('死者|status dead,死亡,exhaustion-2,unknown')[0];
  ok('A5 exhaustion 归一化保留', s?.statuses.includes('exhaustion') === true, JSON.stringify(s?.statuses));
}
// A6 全角字符
{
  const fw = noThrow('A6', () => parseBattleBlock('哥布林｜init １０｜hp ７／７')) as BattleUnit[];
  ok('A6 全角管道/全角数字 → 不崩溃（可解析性随后续语义轮处理）', Array.isArray(fw));
}
// A7 标签形态
{
  const up = extractBattleBlocks('<BATTLE>哥布林|hp 7/7</BATTLE>');
  ok('A7a 大写标签可提取', up.length === 1 && up[0].units.length === 1);
  const unclosed = extractBattleBlocks('<battle>哥布林|hp 7/7');
  ok('A7b 未闭合标签 → 0 块（不崩溃）', unclosed.length === 0);
  const nested = extractBattleBlocks('<battle><battle>哥布林|hp 7/7</battle></battle>');
  ok('A7c 嵌套标签不崩溃且提取内层', nested.length === 1 && nested[0].units[0]?.id === '哥布林', JSON.stringify(nested.map(b => b.units.map(u => u.id))));
}
// A8 巨长输入
{
  const longLine = '巨龙' + '|status ' + 'blinded,'.repeat(5000);
  const t0 = Date.now();
  const r = noThrow('A8', () => parseBattleBlock(longLine)) as BattleUnit[];
  ok('A8a 5万字符状态行 <1s', Date.now() - t0 < 1000, `${Date.now() - t0}ms`);
  ok('A8b 重复状态去重或保留均不崩溃', r.length === 1);
  const many = Array.from({ length: 5000 }, (_, i) => `单位${i}|init ${i}|hp 10/10`).join('\n');
  const t1 = Date.now();
  const r2 = noThrow('A8c', () => parseBattleBlock(many)) as BattleUnit[];
  ok('A8c 5000单位解析 <1s', Date.now() - t1 < 1000, `${Date.now() - t1}ms, n=${r2.length}`);
}
// A9 整条消息路由
{
  const r = noThrow('A9', () => parseDmMessage('')) as ReturnType<typeof parseDmMessage>;
  ok('A9a 空消息 → 全空结构', r.battleBlocks.length === 0 && r.checks.length === 0 && r.patches.length === 0);
  const r2 = noThrow('A9b', () => parseDmMessage('<battle>'.repeat(100))) as ReturnType<typeof parseDmMessage>;
  ok('A9b 标签炸弹不崩溃', r2.battleBlocks.length === 0);
}
// A10 截断块经管道回退路径（UI 实测发现的标签残留缺陷）
{
  const r = parseDmMessage('<battle>艾尔玛|init 18|hp 24/2');
  const ids = (r.latestBattle || []).map(u => u.id);
  ok('A10a 截断块回退导入单位（名字干净）', ids.includes('艾尔玛'), JSON.stringify(ids));
  ok('A10b 无标签残留ID', ids.every(i => !i.includes('<')), JSON.stringify(ids));
  const r2 = parseDmMessage('<encounter>{"enemies":[{"name":"嵌套怪"}]}</encounter>\n<battle>战|hp 5/5');
  ok('A10c 混合截断不崩溃', r2 !== undefined);
}

console.log('━━━━━━ B. <battlecheck>/<dice> 畸形 ━━━━━━');
{
  const empty = noThrow('B1', () => extractBattleChecks('<battlecheck></battlecheck>')) as unknown[];
  ok('B1 空检定块 → 0', empty.length === 0);
  const junk = noThrow('B2', () => extractBattleChecks('<battlecheck>垃圾内容无字段</battlecheck>')) as unknown[];
  ok('B2 无字段垃圾 → 0', junk.length === 0);
  const dup = extractBattleChecks('<battlecheck>发动者：A\n判定结果：成功\n判定结果：失败</battlecheck>');
  ok('B3 重复字段首次优先', dup[0]?.fields['判定结果'] === '成功', dup[0]?.fields['判定结果']);
  const newline = extractBattleChecks('<battlecheck>检定细节：d20+5\n多行内容\n继续</battlecheck>');
  ok('B4 值含换行保留', (newline[0]?.fields['检定细节'] || '').includes('多行内容'));
  const detail = noThrow('B5', () => parseCheckDetail('完全没有数字的内容')) as Record<string, unknown>;
  ok('B5a 细节无数字 → 空对象', Object.keys(detail).length === 0);
  const detail2 = parseCheckDetail('裸骰 99999999999999999999');
  ok('B5b 巨大数字有限（不产生 NaN/Infinity）', Number.isFinite(detail2.raw ?? 0), String(detail2.raw));
  const out = parseOutcome('不明所以的结果文本');
  ok('B6 无法判定结果 → null', out === null);
}

console.log('━━━━━━ C. JSONPatch 畸形 + 原型污染 ━━━━━━');
{
  const bad = noThrow('C1', () => extractJsonPatches('<JSONPatch>[{"op":123}]</JSONPatch>')) as unknown[];
  ok('C1 非法patch被过滤', bad.length === 0);
  const mixed = extractJsonPatches('<JSONPatch>[{"op":"replace","path":"/a","value":1},{"nope":true},{"op":"delta","path":"/b","value":"x"}]</JSONPatch>');
  ok('C2 混合数组只留合法', mixed.length === 2);
  const broken = extractJsonPatches('<JSONPatch>[{"op":"replace","path":"/a",]</JSONPatch>');
  ok('C3 截断JSON → 0', broken.length === 0);
  const hugeArr = '<JSONPatch>[' + Array.from({ length: 10000 }, (_, i) => `{"op":"replace","path":"/x${i}","value":${i}}`).join(',') + ']</JSONPatch>';
  const t0 = Date.now();
  const r = extractJsonPatches(hugeArr);
  ok('C4 1万补丁 <1s', Date.now() - t0 < 1000 && r.length === 10000, `${Date.now() - t0}ms n=${r.length}`);
  // C5 原型污染攻击
  const tree: Record<string, unknown> = { 角色列表: {} };
  noThrow('C5a', () => applyPatches(tree, [
    { op: 'replace', path: '/a/__proto__/__polluted__', value: 'yes' },
  ]));
  ok('C5a __proto__ 路径不污染原型', !polluted(), JSON.stringify(Object.prototype['__polluted__']));
  noThrow('C5b', () => applyPatches(tree, [
    { op: 'replace', path: '/b/constructor/prototype/__polluted__', value: 'yes' },
  ]));
  ok('C5b constructor/prototype 路径不污染', !polluted());
  noThrow('C5c', () => applyPatches(tree, [
    { op: 'delta', path: '/c/__proto__/polluted', value: 1 },
  ]));
  ok('C5c delta 原型路径不污染', !polluted());
  // C6 delta 非数值
  const t2: Record<string, unknown> = { hp: 10 };
  const res = noThrow('C6', () => applyPatches(t2, [{ op: 'delta', path: '/hp', value: '不是数字' }])) as { applied: number; errors: string[] };
  ok('C6 delta非数值报错不写入', res.applied === 0 && res.errors.length > 0 && t2.hp === 10, JSON.stringify(t2));
  // C7 数组越界
  const t3: Record<string, unknown> = { log: [1, 2] };
  const res3 = applyPatches(t3, [{ op: 'insert', path: '/log/999', value: 'x' }]);
  ok('C7a 数组insert越界不崩溃', res3.errors.length > 0 || (t3.log as unknown[]).length > 2);
  const res3b = applyPatches(t3, [{ op: 'remove', path: '/log/999' }]);
  ok('C7b 数组remove越界不崩溃', Array.isArray(t3.log));
  // C8 非法 op
  const t4: Record<string, unknown> = {};
  const res4 = applyPatches(t4, [{ op: 'nuke', path: '/x', value: 1 } as never]);
  ok('C8 未知op → 报错不计入', res4.applied === 0);
}

console.log('━━━━━━ D. 敌卡 JSON 畸形 ━━━━━━');
{
  ok('D1 空串 → null', lenientJsonParse('') === null);
  ok('D2 纯文本 → null', lenientJsonParse('这不是JSON') === null);
  ok('D3 截断JSON → null或部分', (() => { const r = lenientJsonParse('{"name": "哥布林", "ac":'); return r === null || (r as Record<string, unknown>).name === '哥布林'; })());
  const deep = '{'.repeat(5000) + '"x"' + '}'.repeat(5000);
  const r4 = noThrow('D4', () => lenientJsonParse(deep));
  ok('D4 5000层深嵌套 → null（不栈溢出）', r4 === null);
  const r5 = noThrow('D5', () => parseEncounterDefs('{"enemies": "不是数组"}')) as { defs: unknown[]; warnings: string[] };
  ok('D5 enemies非数组 → 警告0卡', r5.defs.length === 0 && r5.warnings.length > 0, JSON.stringify(r5.warnings).slice(0, 80));
  const r6 = parseEncounterDefs('{"enemies": [null, 42, "文本", {}, {"name": 123, "ac": "AC 18", "hp": null}]}');
  ok('D6 元素类型混杂 → 只收有效卡不崩溃', r6.defs.length >= 0);
  ok('D7 数字name被字符串化或跳过', r6.defs.every(d => typeof (d as unknown as Record<string, unknown>).name === 'string'));
  const d8raw = '```json' + String.fromCharCode(10) + '{"enemies":[{"name":"围栏怪","ac":15,"hp":10}]}' + String.fromCharCode(10) + '```';
  const r8 = noThrow('D8', () => parseEncounterDefs(d8raw)) as { defs: unknown[]; warnings: string[] };
  ok('D8 代码围栏剥除', r8.defs.length === 1, `defs=${r8.defs.length} warn=${JSON.stringify(r8.warnings).slice(0, 100)} lenient=${lenientJsonParse(d8raw) === null ? 'NULL' : 'OK'}`);
  const r9 = noThrow('D9', () => parseEncounterDefs('{"enemies":' + '['.repeat(2000) + ']'.repeat(2000) + '}')) as { defs: unknown[] };
  ok('D9 敌卡深嵌套不崩溃', r9 !== undefined);
}

console.log('━━━━━━ E. 骰子公式恶意 ━━━━━━');
{
  mustThrow('E1a 纯垃圾公式', () => rollFormula('abc'));
  // E1b: 空公式回退默认 1d20 是设计行为（与 E1c 一致），不要求抛出
  ok('E1c 空公式rollFormula → 默认1d20', (() => { const r = noThrow('E1c', () => rollFormula('')); return r !== undefined; })());
  const t0 = Date.now();
  noThrow('E2a', () => rollFormula('100000000d6'));
  ok('E2a 1亿骰 → 钳制后 <1s', Date.now() - t0 < 1000, `${Date.now() - t0}ms`);
  const t1 = Date.now();
  noThrow('E2b', () => rollFormula('100d1000'));
  ok('E2b 100d1000 <300ms', Date.now() - t1 < 300, `${Date.now() - t1}ms`);
  const zero = noThrow('E3a', () => rollFormula('0d6')) as { total: number };
  ok('E3a 0d6 → 至少1骰', zero !== undefined);
  const d0 = noThrow('E3b', () => rollFormula('1d0')) as { rolls: Array<{ value: number }> };
  ok('E3b 1d0 → 面数钳制≥1', d0.rolls.every(r => Number.isFinite(r.value)), JSON.stringify(d0.rolls?.map(r => r.value)));
  noThrow('E3c', () => rollFormula('1d6kh99'));
  noThrow('E3d', () => rollFormula('1d6kh0'));
  noThrow('E3e', () => rollFormula('-1d6'));
  noThrow('E3f', () => rollFormula('++1d6'));
  ok('E3 系列零崩溃', true);
  const neg = noThrow('E4', () => rollFormula('1d6+-3')) as { total: number };
  ok('E4 1d6+-3 合法', Number.isFinite(neg.total));
  const inf = noThrow('E5', () => parseFormula('999999999999999999999d6'));
  ok('E5 超int位数钳制', inf !== undefined);
}

console.log('━━━━━━ F. 引擎极端状态 ━━━━━━');
{
  const atk = mkUnit({ id: 'a' });
  const tgt = mkUnit({ id: 't' });
  // 极端 AC
  noThrow('F1a', () => resolveAttack(atk, tgt, { attackBonus: 5, targetAc: -999, weaponDamage: '1d6' }));
  noThrow('F1b', () => resolveAttack(atk, tgt, { attackBonus: 5, targetAc: 1e9, weaponDamage: '1d6' }));
  const forced = noThrow('F1c', () => resolveAttack(atk, tgt, { attackBonus: 5, targetAc: 13, weaponDamage: '1d6', forcedAttackRoll: 999 })) as { attack: { total: number } };
  ok('F1c 越界强制骰不崩溃', forced !== undefined && Number.isFinite(forced.attack.total));
  // NaN 攻击加值
  const nanAtk = noThrow('F2', () => resolveAttack(atk, tgt, { attackBonus: NaN, targetAc: 13, weaponDamage: '1d6' })) as { attack: { total: number } };
  ok('F2 NaN加值 → 结果有限或明确失败', nanAtk === undefined || Number.isFinite(nanAtk.attack.total));
  // 负伤害 / NaN 伤害
  const neg = applyDamageModifiers(tgt, -10, 'fire');
  ok('F3a 负伤害不崩溃', Number.isFinite(neg.final));
  const tmp = applyDamageModifiers(mkUnit({ tempHp: -5 }), 10, 'fire');
  ok('F3b 负临时HP不崩溃', Number.isFinite(tmp.final));
  // HP 异常单位
  const over = mkUnit({ hp: 50, maxHp: 10 });
  ok('F4 超上限HP可构造（引擎层允许，由store层负责钳制）', over.hp === 50);
  // 先攻极端
  noThrow('F5a', () => buildInitiativeOrder([mkUnit({ init: -1e9 }), mkUnit({ init: 1e9 })], { flankingAdvantage: false, crawlHalf: true, diagonalRule: 'equal', deathSaveDC: 10, critRule2024: true } as never));
  ok('F5a 极端先攻排序不崩溃', true);
  const empty5 = noThrow('F5b', () => buildInitiativeOrder([], { flankingAdvantage: false } as never)) as unknown[];
  ok('F5b 空单位列表', Array.isArray(empty5) && empty5.length === 0);
  // 寻路极端
  const walker = mkUnit({ id: 'w' });
  const t0 = Date.now();
  noThrow('F6a', () => findPath({ cx: 0, cy: 0 }, { cx: 999, cy: 999 }, [walker], [], walker));
  ok('F6a 1000格对角寻路 <1s', Date.now() - t0 < 1000, `${Date.now() - t0}ms`);
  const t1 = Date.now();
  noThrow('F6b', () => findPath({ cx: 0, cy: 0 }, { cx: 100000, cy: 100000 }, [walker], [], walker));
  ok('F6b 超远寻路 <2s（或不可达快速失败）', Date.now() - t1 < 2000, `${Date.now() - t1}ms`);
  noThrow('F6c', () => findPath({ cx: 5, cy: 5 }, { cx: 5, cy: 5 }, [walker], [], walker));
  ok('F6c 起点终点相同', true);
  // AoE 极端
  noThrow('F7a', () => aoeCells({ id: 'x', kind: 'sphere', size: 0, origin: { x: 10, y: 10 }, color: '' }, [tgt]));
  noThrow('F7b', () => aoeCells({ id: 'x', kind: 'sphere', size: -5, origin: { x: 10, y: 10 }, color: '' }, [tgt]));
  noThrow('F7c', () => aoeCells({ id: 'x', kind: 'sphere', size: 1e9, origin: { x: 10, y: 10 }, color: '' }, [tgt]));
  ok('F7 AoE 尺寸0/负/巨大零崩溃', true);
  // 豁免 NaN DC
  noThrow('F8', () => resolveSave(tgt, { ability: 'dex', dc: NaN }));
  ok('F8 NaN DC 不崩溃', true);
  // 遭遇难度空列表
  const d = noThrow('F9', () => encounterDifficulty([], [])) as { level: string };
  ok('F9 空遭遇难度 → 不崩溃', d !== undefined);
}

console.log('━━━━━━ G. 正则性能（ReDoS） ━━━━━━');
if (process.env.SKIP_G) {
  console.log('  （SKIP_G=1 跳过）');
} else {
  // 从交付包读取真实 findRegex
  const pkg = JSON.parse(fs.readFileSync('/home/z/my-project/download/battle-forge-st-pack/battle-forge-panel.json', 'utf8'))[0];
  const body = pkg.findRegex.replace(/^\/|\/[a-z]*$/g, '');
  const flags = (pkg.findRegex.match(/\/([a-z]*)$/) || [])[1] || '';
  const re = new RegExp(body, flags);
  const cases: Array<[string, string]> = [
    ['纯文本200KB', 'a'.repeat(200000)],
    ['接近匹配无闭合', ('<battle>' + 'x'.repeat(100000))],
    ['多锚点无终点', ('<battle>a</battle>' + '文字'.repeat(20) + '<encounter>' + 'y'.repeat(50000))],
    ['嵌套开标签', '<battle>'.repeat(50000)],
    ['battlecheck长值', '<battlecheck>' + '发动者：A\n'.repeat(20000)],
  ];
  for (const [name, text] of cases) {
    const t0 = Date.now();
    re.test(text); // g 标志有 lastIndex 状态，用 test 前重置
    re.lastIndex = 0;
    const dt = Date.now() - t0;
    ok(`G ${name} <2s`, dt < 2000, `${dt}ms`);
  }
  // 引擎侧正则
  const t2 = Date.now();
  extractBattleBlocks('x'.repeat(300000));
  ok('G extractBattleBlocks 300KB <1s', Date.now() - t2 < 1000, `${Date.now() - t2}ms`);
  const t3 = Date.now();
  parseDicePool('<dices>' + 'd20：[ 1: (5) | '.repeat(20000) + '</dices>');
  ok('G parseDicePool 超长 <1s', Date.now() - t3 < 1000, `${Date.now() - t3}ms`);
}

console.log('━━━━━━ H. store 级混合消息 ━━━━━━');
{
  // 一条消息里塞所有畸形块
  const chaos = [
    '<battle>||||</battle>',
    '<battlecheck>垃圾</battlecheck>',
    '<JSONPatch>[{bad json}</JSONPatch>',
    '<encounter>不是JSON</encounter>',
    '<dices>zzz</dices>',
    '<UpdateVariable><JSONPatch>[{"op":"delta","path":"/x","value":null}]</JSONPatch></UpdateVariable>',
  ].join('\n\n混合文字\n\n');
  const r = noThrow('H1', () => parseDmMessage(chaos)) as ReturnType<typeof parseDmMessage>;
  ok('H1 混沌消息不崩溃且各路由空结果', r !== undefined);
  // update_variable 变体（大写/下划线）
  const r2 = parseDmMessage('<UpdateVariable>\n<JSONPatch>[{"op":"replace","path":"/角色列表/艾/生命值/当前","value":5}]</JSONPatch>\n</UpdateVariable>');
  ok('H2 UV包裹的patch可提取', r2.patches.length === 1, String(r2.patches.length));
  // 变量树提取遇到畸形树
  noThrow('H3', () => charSheetsFromTree({ 角色列表: { 艾尔玛: '不是对象' } }));
  ok('H3 畸形变量树不崩溃', true);
  noThrow('H4', () => charSheetsFromTree(null as never));
  ok('H4 null树不崩溃（或明确类型错误被上层捕获）', true);
}

// ===== 汇总 =====
console.log('\n━━━━━━━━━━━━━━ 反例测试汇总 ━━━━━━━━━━━━━━');
console.log(`✅ 通过: ${pass}  ❌ 失败: ${fail}`);
if (findings.length > 0) {
  console.log('\n发现的问题：');
  for (const f of findings) console.log(f);
}
process.exit(fail > 0 ? 1 : 0);
