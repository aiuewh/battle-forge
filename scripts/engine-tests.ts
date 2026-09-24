/**
 * Battle Forge 引擎全量单元测试
 * 运行: bun /home/z/my-project/scripts/engine-tests.ts
 * 覆盖: dice / protocol / geometry / initiative / combat / rules / conditions / snapshot
 */
import {
  setRng, rollDie, parseFormula, rollFormula, rollD20, formatDice, judgeCheck,
} from '../src/lib/engine/dice';
import {
  parseBattleBlock, generateBattleBlock, extractBattleBlocks, extractBattleChecks,
  extractDiceChecks, parseCheckDetail, parseOutcome, extractJsonPatches, parsePatchPath,
  parseDicePool, generateDicePool, parseDmMessage,
} from '../src/lib/engine/protocol';
import {
  CELL, feetToCell, cellToFeet, posToCell, unitOccupiedCells, gridDistanceCells,
  gridDistanceFeet, buildOccupancy, findPath, reachableCells, lineCells, estimateCover,
  aoeCells, AOE_PRESETS,
} from '../src/lib/engine/geometry';
import {
  rollInitiative, buildInitiativeOrder, startBattle, advanceTurn, checkBattleEnd,
  useLegendaryAction as tryLegendaryAction,
} from '../src/lib/engine/initiative';
import {
  resolveAttack, applyDamageModifiers, resolveSave, resolveDeathSave,
  resolveConcentration, escapeDc, encounterDifficulty, damageAtZeroHp,
} from '../src/lib/engine/combat';
import {
  abilityMod, proficiencyBonus, getSaveBonus, attackRollModeAgainst, coverBonus,
  concentrationDc, fallDamage, effectiveSpeed,
} from '../src/lib/engine/rules';
import { aggregateEffects, conditionName, CONDITIONS } from '../src/lib/engine/conditions';
import { snapshotFromUnits, diffSnapshots } from '../src/lib/engine/snapshot';
import type { BattleUnit, MapObstacle, RulesConfig } from '../src/lib/engine/types';
import { DEFAULT_RULES, SIZE_META } from '../src/lib/engine/types';

// ============ 测试框架 ============
let pass = 0, fail = 0, buggy = 0;
const failures: string[] = [];
const bugHits: string[] = [];

function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; }
  else { fail++; failures.push(`${name}${detail ? ` — ${detail}` : ''}`); }
}
/** 预期存在的 BUG 命中记录（不算 pass/fail，单独统计） */
function expectBug(name: string, cond: boolean, detail: string) {
  if (cond) { buggy++; bugHits.push(`${name}: ${detail}`); }
  else { pass++; }
}

// 固定 RNG 序列
function seqRng(seq: number[]) {
  let i = 0;
  return () => { const v = seq[i % seq.length]; i++; return (v - 0.5) / 20 + 0.01; };
}

// ============ 单位工厂 ============
let uid = 0;
function mkUnit(partial: Partial<BattleUnit> = {}): BattleUnit {
  return {
    id: partial.id ?? `u${uid++}`,
    name: partial.name ?? '测试单位',
    attitude: partial.attitude ?? 1,
    hp: partial.hp ?? 20, maxHp: partial.maxHp ?? 20,
    ac: partial.ac ?? 13,
    init: partial.init ?? 10, initMod: partial.initMod ?? 0,
    pos: partial.pos ?? { x: 10, y: 10 },
    size: partial.size ?? 'medium',
    speed: partial.speed ?? 30,
    statuses: partial.statuses ?? [],
    immunities: partial.immunities ?? [],
    resistances: partial.resistances ?? [],
    vulnerabilities: partial.vulnerabilities ?? [],
    tempHp: partial.tempHp ?? 0,
    concentration: partial.concentration ?? false,
    isPlayer: partial.isPlayer ?? false,
    actionEconomy: partial.actionEconomy ?? { action: true, bonus: true, reaction: true, movementUsed: 0 },
    ...partial,
  } as BattleUnit;
}

// ================================================================
console.log('━━━━━━━━ 1. 骰子引擎 dice.ts ━━━━━━━━');
// --- 公式解析 ---
try {
  const p = parseFormula('1d20');
  check('parse 1d20', p.terms.length === 1 && p.terms[0].count === 1 && p.terms[0].sides === 20 && p.modifier === 0);
} catch (e) { check('parse 1d20', false, String(e)); }

try {
  const p = parseFormula('2d6+3');
  check('parse 2d6+3', p.terms[0].count === 2 && p.terms[0].sides === 6 && p.modifier === 3);
} catch (e) { check('parse 2d6+3', false, String(e)); }

try {
  const p = parseFormula('1d8+2d4+1');
  check('parse 混合公式', p.terms.length === 2 && p.modifier === 1);
} catch (e) { check('parse 混合公式', false, String(e)); }

// 已修复 BUG #1: kh/kl/dl/dh 语法支持
try {
  const p = parseFormula('2d20kh1');
  check('parse 2d20kh1 (优势语法)', !!p.terms[0].keep && p.terms[0].keep!.mode === 'kh');
} catch (e) {
  check('parse 2d20kh1 (优势语法)', false, String(e).slice(0, 80));
}
try {
  const p = parseFormula('4d6dl1');
  check('parse 4d6dl1 (属性生成语法)', !!p.terms[0].keep && p.terms[0].keep!.mode === 'dl');
} catch (e) {
  check('parse 4d6dl1 (属性生成语法)', false, String(e).slice(0, 80));
}
setRng(seqRng([6, 3, 5, 6, 4, 5, 6]));
const kh = rollFormula('2d20kh1');
check('kh1 保留高骰', kh.rolls.filter(r => r.kept).length === 1 && kh.total === 6);
try { parseFormula('abc'); check('parse 非法输入抛错', false, '应抛错但未抛'); }
catch { check('parse 非法输入抛错', true); }

// --- rollFormula 固定 RNG（全最大/全最小可靠断言） ---
setRng(() => 0.999);
const r1 = rollFormula('2d6+3');
check('roll 2d6+3 总数(全最大)', r1.total === 6 + 6 + 3, `total=${r1.total} 期望 15`);
check('roll 2d6 骰子记录', r1.rolls.length === 2 && r1.rolls[0].value === 6 && r1.rolls[1].value === 6);
setRng(() => 0.001);
const r1b = rollFormula('2d6+3');
check('roll 2d6+3 总数(全最小)', r1b.total === 1 + 1 + 3, `total=${r1b.total} 期望 5`);

setRng(seqRng([5, 2]));
const r2 = rollFormula('1d20', { mode: 'advantage', bonus: 3 });
check('优势取高', r2.rawD20 === 5 && r2.total === 8, `rolls=${JSON.stringify(r2.rolls)} raw=${r2.rawD20}`);
check('优势弃骰标记', r2.rolls.length === 2 && r2.rolls.find(r => !r.kept)?.value === 2);

setRng(seqRng([5, 2]));
const r3 = rollFormula('1d20', { mode: 'disadvantage' });
check('劣势取低', r3.rawD20 === 2 && r3.total === 2);

// forcedRolls（酒馆骰子池对接）
const r4 = rollFormula('1d20+5', { forcedRolls: [16] });
check('forcedRolls 注入', r4.rolls[0].value === 16 && r4.total === 21);

// --- 判定（含 2024 优势劣势双骰 crit 规则） ---
check('judgeCheck 裸20大成功', judgeCheck(rollFormula('1d20', { forcedRolls: [20] }), 30).outcome === 'critical-success');
check('judgeCheck 裸1大失败', judgeCheck(rollFormula('1d20', { forcedRolls: [1] }), 5).outcome === 'critical-failure');
const rj = rollFormula('1d20', { bonus: 5, forcedRolls: [10] });
check('judgeCheck 15+5 vs DC15', judgeCheck(rj, 15).outcome === 'success');
const rj2 = rollFormula('1d20', { bonus: 4, forcedRolls: [10] });
check('judgeCheck 14 vs DC15', judgeCheck(rj2, 15).outcome === 'failure');
// 2024: 判定看保留骰——优势 [20,5] 保留 20 = 大成功；劣势 [1,12] 保留 1 = 大失败
setRng(() => 0.999);
const advNotCrit = rollFormula('1d20', { mode: 'advantage', forcedRolls: [20, 5] });
check('优势保留骰20即大成功(2024)', judgeCheck(advNotCrit, 15).outcome === 'critical-success', judgeCheck(advNotCrit, 15).outcome);
const advCrit = rollFormula('1d20', { mode: 'advantage', forcedRolls: [20, 20] });
check('优势双20大成功(2024)', judgeCheck(advCrit, 15).outcome === 'critical-success');
const disNotCrit = rollFormula('1d20', { mode: 'disadvantage', forcedRolls: [1, 12] });
check('劣势保留骰1即大失败(2024)', judgeCheck(disNotCrit, 15).outcome === 'critical-failure', judgeCheck(disNotCrit, 15).outcome);

// formatDice
const fd = rollFormula('1d20+5', { forcedRolls: [17] });
const s = formatDice(fd);
check('formatDice 输出', s.includes('17') && s.includes('+5') && s.includes('= 22'), s);

// ================================================================
console.log('\n━━━━━━━━ 2. 协议层 protocol.ts ━━━━━━━━');
const battleRaw = `艾尔玛|init 18|hp 32/40|pos 10,15|next
哥布林甲|init 14|hp 7/7|pos 30,25|att 0|status prone,poisoned
哥布林乙|init 10|hp 0/7|pos 35,25|att 0
# 注释行应被忽略
灰烬法师|init 12|hp 25/25|pos 50,10|att 2|portrait 🧙|concentration`;
const units1 = parseBattleBlock(battleRaw);
check('battle 解析单位数', units1.length === 4, `got ${units1.length}`);
check('battle 解析 HP', units1[0].hp?.current === 32 && units1[0].hp?.max === 40);
check('battle 解析 pos', units1[0].pos?.x === 10 && units1[0].pos?.y === 15);
check('battle 解析 next', units1[0].next === true && units1[1].next === false);
check('battle 解析 status 多值', units1[1].statuses.includes('prone') && units1[1].statuses.includes('poisoned'));
check('battle 解析态度', units1[1].attitude === 0 && units1[3].attitude === 2);
check('battle 未知字段进 extras', units1[3].extras.some(e => e.key === 'concentration'));
check('battle 注释行忽略', !units1.some(u => u.id.startsWith('#')));

// round-trip
const gen = generateBattleBlock([
  { id: '艾尔玛', init: 18, hp: 32, maxHp: 40, pos: { x: 10, y: 15 }, attitude: 1, statuses: ['prone'], next: true },
  { id: '哥布林', init: 14, hp: 7, maxHp: 7, pos: { x: 30, y: 25 }, attitude: 0, statuses: [] },
]);
const reUnits = parseBattleBlock(gen.replace(/<\/?battle>/g, ''));
check('generate→parse round-trip', reUnits.length === 2 && reUnits[0].hp?.current === 32 && reUnits[0].next === true && reUnits[1].attitude === 0, gen);
check('生成含标签', gen.startsWith('<battle>') && gen.endsWith('</battle>'));

// 多块提取取最新
const two = '<battle>\nA|init 10|hp 5/5|pos 0,0\n</battle>\n中间文本\n<battle>\nB|init 12|hp 8/8|pos 1,1\n</battle>';
const blocks = extractBattleBlocks(two);
check('多 battle 块提取', blocks.length === 2 && blocks[1].units[0].id === 'B');
const dm = parseDmMessage(two);
check('parseDmMessage latestBattle', dm.latestBattle?.[0].id === 'B');

// 纯管道行容错
const bare = parseDmMessage('艾尔玛|init 18|hp 32/40|pos 10,15');
check('无标签管道行容错', bare.latestBattle?.length === 1 && bare.latestBattle[0].id === '艾尔玛');

// battlecheck
const checkText = `<battlecheck>
发动者：艾尔玛
目标：哥布林甲
行动：长剑攻击
检定类型：攻击检定
检定细节：1d20(裸骰16)+5=21 vs AC13
判定结果：成功
伤害结算：1d8+3=7点挥砍伤害
</battlecheck>`;
const checks = extractBattleChecks(checkText);
check('battlecheck 提取', checks.length === 1);
check('battlecheck 字段', checks[0].fields['发动者'] === '艾尔玛' && checks[0].fields['行动'] === '长剑攻击');
const detail = parseCheckDetail(checks[0].fields['检定细节'] ?? '');
check('检定细节数值', detail.raw === 16 && detail.bonus === 5 && detail.total === 21 && detail.ac === 13, JSON.stringify(detail));
check('判定结果解析', parseOutcome('大成功') === 'critical-success' && parseOutcome('失败') === 'failure' && parseOutcome('Critical Success') === 'critical-success');

// dice 块（含缺字段容错验证 BUG#5）
const diceText = `<dice>
发动技能：隐匿
检定细节：1d20(裸骰14)+7=21 DC15
判定结果：成功
</dice>`;
const dchecks = extractDiceChecks(diceText);
check('dice 块提取', dchecks.length === 1 && dchecks[0].fields['发动技能'] === '隐匿', JSON.stringify(dchecks[0]?.fields));
check('dice 块缺字段不丢字段(修复#5)', dchecks[0]?.fields['判定结果'] === '成功' && dchecks[0]?.fields['检定细节']?.includes('裸骰14'));
// battlecheck 缺中间字段容错
const partialCheck = `<battlecheck>
发动者：艾尔玛
检定类型：攻击检定
判定结果：大成功
</battlecheck>`;
const pchecks = extractBattleChecks(partialCheck);
check('battlecheck 缺字段容错(修复#5)', pchecks.length === 1 && pchecks[0].fields['发动者'] === '艾尔玛' && pchecks[0].fields['判定结果'] === '大成功' && pchecks[0].fields['检定类型'] === '攻击检定', JSON.stringify(pchecks[0]?.fields));

// JSONPatch
const patchText = `<UpdateVariable>
<JSONPatch>
[
  {"op":"delta","path":"/角色列表/艾尔玛/生命值/当前","value":-7},
  {"op":"replace","path":"/角色列表/艾尔玛/状态","value":["prone"]}
]
</JSONPatch>
</UpdateVariable>`;
const patches = extractJsonPatches(patchText);
check('JSONPatch 提取', patches.length === 2 && patches[0].op === 'delta');
const pp = parsePatchPath('/角色列表/艾尔玛/生命值/当前');
check('patch 路径解析', pp.char === '艾尔玛' && pp.rest.join('/') === '生命值/当前');

// 骰子池
const poolText = `<dices>
d20：
[ 1: (15) | 2: (8) | 3: (20) ]
d6：
[ 1: (4) | 2: (2) ]
</dices>`;
const pool = parseDicePool(poolText);
check('骰子池解析', pool?.d20.length === 3 && pool?.d20[2] === 20 && pool?.d6.length === 2, JSON.stringify(pool));
const genPool = generateDicePool();
check('骰子池生成含宏', genPool.includes('{{roll:1d20}}') && genPool.includes('d12'));
const genPoolParsed = parseDicePool(genPool);
check('未替换骰子池安全解析', genPoolParsed !== null && genPoolParsed.d20.length === 0);

// ================================================================
console.log('\n━━━━━━━━ 3. 几何引擎 geometry.ts ━━━━━━━━');
check('CELL=5', CELL === 5);
check('feetToCell(23)=5', feetToCell(23) === 5);
check('cellToFeet(5)=25', cellToFeet(5) === 25);
check('网格距离 equal 对角(2024切比雪夫)', gridDistanceCells({ cx: 0, cy: 0 }, { cx: 3, cy: 2 }) === 3, `got ${gridDistanceCells({ cx: 0, cy: 0 }, { cx: 3, cy: 2 })}`);
check('网格距离 alt 5-10-5', gridDistanceCells({ cx: 0, cy: 0 }, { cx: 2, cy: 2 }, 'alt') === 3, `got ${gridDistanceCells({ cx: 0, cy: 0 }, { cx: 2, cy: 2 }, 'alt')}`);
check('gridDistanceFeet', gridDistanceFeet({ cx: 0, cy: 0 }, { cx: 1, cy: 0 }) === 5);

// 大型单位占据格
const large = mkUnit({ id: 'ogre', size: 'large', pos: { x: 10, y: 10 } });
check('大型单位占4格', unitOccupiedCells(large).length === (SIZE_META['large']?.cells ?? 2) ** 2);

// A* 寻路
const pathUnits = [mkUnit({ id: 'a', pos: { x: 10, y: 10 }, attitude: 1 })];
const noObstacle = findPath({ cx: 2, cy: 2 }, { cx: 5, cy: 2 }, pathUnits, [], pathUnits[0]);
check('A* 直线可达', noObstacle.reachable && noObstacle.costCells === 3);

// 墙绕行
const wall: MapObstacle[] = [{ kind: 'full', cells: [{ cx: 3, cy: 1 }, { cx: 3, cy: 2 }, { cx: 3, cy: 3 }] }];
const around = findPath({ cx: 2, cy: 2 }, { cx: 4, cy: 2 }, pathUnits, wall, pathUnits[0]);
check('A* 绕墙', around.reachable && around.costCells > 2, `cost=${around.costCells}`);
const blockedStraight = findPath({ cx: 2, cy: 2 }, { cx: 4, cy: 2 }, pathUnits, wall, pathUnits[0]);
check('A* 绕墙路径不穿墙', blockedStraight.path.every(c => c.cx !== 3 || c.cy !== 2) || blockedStraight.reachable);

// 已修复 BUG #2: 终点不可落在墙格
const intoWall = findPath({ cx: 2, cy: 2 }, { cx: 3, cy: 2 }, pathUnits, wall, pathUnits[0]);
check('寻路终点不可落墙格', !intoWall.reachable, `reachable=${intoWall.reachable} 应不可达`);

// 敌方格不可达
const enemyBlock = [mkUnit({ id: 'me', attitude: 1, pos: { x: 10, y: 10 } }), mkUnit({ id: 'foe', attitude: 0, pos: { x: 15, y: 10 } })];
const toEnemy = findPath({ cx: 2, cy: 2 }, { cx: 3, cy: 2 }, enemyBlock, [], enemyBlock[0]);
check('敌方占据格不可停留', !toEnemy.reachable);

// 可达域（起点 (2,2)，30尺=6格）
const reach = reachableCells(mkUnit({ id: 'r1', pos: { x: 10, y: 10 }, attitude: 1 }), pathUnits, [], 30);
check('移动力30六格内可达', reach.has('8,2') && (reach.get('8,2') as number) <= 6, `d(8,2)=${reach.get('8,2')}`);
check('移动力30七格外不可达', !reach.has('9,2'), `d(9,2)=${reach.get('9,2')}`);

// 视线
const line = lineCells({ cx: 0, cy: 0 }, { cx: 3, cy: 3 });
check('布雷森汉姆对角线', line.length === 4 && line[3].cx === 3 && line[3].cy === 3, JSON.stringify(line));

// 掩护
const coverObs = new Map<string, MapObstacle['kind']>([['4,2', 'half']]);
const atk = mkUnit({ id: 'atk', pos: { x: 10, y: 10 } });
const tgt = mkUnit({ id: 'tgt', pos: { x: 30, y: 10 } });
const cover1 = estimateCover(atk, tgt, [], coverObs);
check('半身掩护+2', cover1.cover === 'half' && cover1.bonus === 2, JSON.stringify(cover1));
const coverObsFull = new Map<string, MapObstacle['kind']>([['4,2', 'full']]);
const cover2 = estimateCover(atk, tgt, [], coverObsFull);
check('完全掩护', cover2.cover === 'full');

// AoE
const aoeUnits = [
  mkUnit({ id: 'in', pos: { x: 45, y: 10 } }),   // 火球中心旁 5尺
  mkUnit({ id: 'edge', pos: { x: 60, y: 10 } }),  // 20尺边缘
  mkUnit({ id: 'out', pos: { x: 90, y: 10 } }),   // 远处
];
const fb = aoeCells({ id: 't-sphere', kind: 'sphere', size: 20, origin: { x: 45, y: 10 }, color: '' }, aoeUnits);
check('火球命中范围内单位', fb.affectedUnitIds.includes('in') && fb.affectedUnitIds.includes('edge') && !fb.affectedUnitIds.includes('out'), JSON.stringify(fb.affectedUnitIds));
const cone = aoeCells({ id: 't-cone', kind: 'cone', size: 15, origin: { x: 10, y: 10 }, angle: 0, color: '' }, [
  mkUnit({ id: 'front', pos: { x: 20, y: 10 } }),
  mkUnit({ id: 'behind', pos: { x: 0, y: 10 } }),
]);
check('锥形只打前方', cone.affectedUnitIds.includes('front') && !cone.affectedUnitIds.includes('behind'));
const lineAoe = aoeCells({ id: 't-line', kind: 'line', size: 30, origin: { x: 10, y: 10 }, angle: 0, color: '' }, [
  mkUnit({ id: 'onLine', pos: { x: 30, y: 10 } }),
  mkUnit({ id: 'offLine', pos: { x: 30, y: 30 } }),
]);
check('闪电直线只打线上', lineAoe.affectedUnitIds.includes('onLine') && !lineAoe.affectedUnitIds.includes('offLine'));
check('AoE 预设数量', AOE_PRESETS.length >= 8);

// ================================================================
console.log('\n━━━━━━━━ 4. 回合引擎 initiative.ts ━━━━━━━━');
const rules: RulesConfig = { ...DEFAULT_RULES };
const sq = (n: number) => n * n + 0.001; // 固定简单映射
setRng(seqRng([15, 10, 18, 12, 20, 14]));
const party = [
  mkUnit({ id: 'p1', init: 18, isPlayer: true, attitude: 1 }),
  mkUnit({ id: 'p2', init: 14, isPlayer: true, attitude: 1 }),
  mkUnit({ id: 'e1', init: 16, attitude: 0 }),
  mkUnit({ id: 'e2', init: 14, attitude: 0 }),
];
const order = buildInitiativeOrder(party, rules, 42);
check('先攻降序', order[0] === 'p1' && order[1] === 'e1', JSON.stringify(order));
check('平局玩家优先', order.indexOf('p2') < order.indexOf('e2'));

const st = startBattle(party, rules);
check('startBattle 首个行动', st.currentUnitId === 'p1' && st.round === 1);

// 推进：击杀 e1
let units = party.map(u => u.id === 'e1' ? { ...u, hp: 0, deathSaves: { successes: 0, failures: 3, stable: false, dead: true } } : u);
const adv1 = advanceTurn(st, units, rules);
check('推进到下一单位', adv1.newUnitId === 'e1' || adv1.state.currentUnitId !== 'p1');
check('死亡单位过滤', !adv1.state.order.includes('e1'));

// 跳过震慑单位
const stunUnits = [
  mkUnit({ id: 's1', init: 20, attitude: 1 }),
  mkUnit({ id: 's2', init: 15, attitude: 1, statuses: ['stunned'] }),
  mkUnit({ id: 's3', init: 10, attitude: 1 }),
];
const st2 = startBattle(stunUnits, rules);
const adv2 = advanceTurn({ ...st2, currentUnitId: 's1' }, stunUnits, rules);
check('跳过震慑单位', adv2.skipped.includes('s2') && adv2.newUnitId === 's3', JSON.stringify({ skipped: adv2.skipped, next: adv2.newUnitId }));

// 已修复 BUG #3: 全员失能不再空转
const allStun = [
  mkUnit({ id: 'a1', init: 20, attitude: 0, statuses: ['stunned'] }),
  mkUnit({ id: 'a2', init: 10, attitude: 2, statuses: ['stunned'] }),
];
const st3 = startBattle(allStun, rules);
const adv3 = advanceTurn(st3, allStun, rules);
check('全员失能正常终止', adv3.state.round <= 3 && adv3.state.ended === true,
  `round=${adv3.state.round} ended=${adv3.state.ended} 应 round≤3 且 ended`);

// 战斗结束判定（0友方 1中立 2敌对）
check('敌方全灭友方胜', (() => { const r = checkBattleEnd([mkUnit({ attitude: 0, hp: 10 })]); return r.ended && r.winner === 0; })());
check('友方全灭敌方胜', (() => { const r = checkBattleEnd([mkUnit({ attitude: 2, hp: 10 })]); return r.ended && r.winner === 2; })());
const onlyNeutral = checkBattleEnd([mkUnit({ attitude: 1, hp: 10 })]);
check('只剩中立结束无胜者(修复#6)', onlyNeutral.ended && onlyNeutral.winner === null, JSON.stringify(onlyNeutral));
check('双方在场不结束', checkBattleEnd([mkUnit({ attitude: 0, hp: 10 }), mkUnit({ attitude: 2, hp: 10 })]).ended === false);
const allDown = checkBattleEnd([mkUnit({ attitude: 0, hp: 0 }), mkUnit({ attitude: 2, hp: 0 })]);
check('全灭无胜者', allDown.ended && allDown.winner === null);

// 传奇动作（纯函数：需构造独立状态）
const legend = mkUnit({ id: 'ld', legendary: { points: 3, max: 3 } });
check('传奇可用', canUseLeg(legend) === true);
const used = tryLegendaryAction(legend, 2);
check('传奇扣点', used.ok && used.remaining === 1);
const legendLow = mkUnit({ id: 'ld2', legendary: { points: 1, max: 3 } });
const overused = tryLegendaryAction(legendLow, 2);
check('传奇不足拒绝', !overused.ok && overused.remaining === 1);
function canUseLeg(u: BattleUnit) { return (u.legendary?.points ?? 0) > 0; }

// 惊喜先攻劣势
setRng(seqRng([10, 20]));
const surprised = rollInitiative(mkUnit({ abilities: { dex: 14, str: 10, con: 10, int: 10, wis: 10, cha: 10 } }), rules, true);
check('惊喜先攻劣势掷骰', surprised === 20 + 2 || surprised >= 3, `init=${surprised}`);

// ================================================================
console.log('\n━━━━━━━━ 5. 战斗结算 combat.ts ━━━━━━━━');
const attacker = mkUnit({ id: 'atk5', ac: 15, attackBonus: undefined } as never);
const target = mkUnit({ id: 'tgt5', hp: 20, maxHp: 20, ac: 13 });

// 普通命中
setRng(() => 0.999);
const atk1 = resolveAttack(attacker, target, {
  attackBonus: 5, targetAc: 13, weaponDamage: '1d8+3', forcedAttackRoll: 16, forcedDamageRolls: [6],
});
check('16+5=21 vs AC13 命中', atk1.hit === true && atk1.attack.total === 21);
check('伤害=骰+修正', atk1.damage?.final === 6 + 3, `final=${atk1.damage?.final}`);
check('命中结果标记', atk1.attack.outcome === 'success');

// 未命中
const atk2 = resolveAttack(attacker, target, { attackBonus: 2, targetAc: 18, weaponDamage: '1d8+3', forcedAttackRoll: 10 });
check('10+2=12 vs AC18 未命中', atk2.hit === false);

// 裸1必失
const atk3 = resolveAttack(attacker, target, { attackBonus: 20, targetAc: 5, weaponDamage: '1d8', forcedAttackRoll: 1 });
check('裸1必失', atk3.hit === false && atk3.attack.outcome === 'critical-failure');

// 已修复 BUG #4: 重击仅骰子翻倍，修正值不翻倍
setRng(() => 0.999);
const crit = resolveAttack(attacker, target, {
  attackBonus: 5, targetAc: 13, weaponDamage: '1d8+3', forcedAttackRoll: 20, forcedDamageRolls: [5],
});
// 第一遍 forced=5，第二遍 RNG 全最大=8；骰 5+8 + 修正 3 = 16（修复前为 (5+3)+(8+3)=19）
check('重击骰翻倍修正不翻倍(修复#4)', crit.damage?.final === 5 + 8 + 3, `final=${crit.damage?.final} 期望 16`);

// 2024 正式规则：重击时全部伤害骰翻倍（含 rider），修正值不翻倍
setRng(() => 0.999);
const critRider = resolveAttack(attacker, target, {
  attackBonus: 5, targetAc: 13, weaponDamage: '1d8+3', riderDamage: '2d6', forcedAttackRoll: 20, forcedDamageRolls: [4],
});
// 武器双骰 4+8 + 修正3 + rider 翻倍两遍各 6+6 = 39（修正值不翻倍）
const riderExpect = 4 + 8 + 3 + (6 + 6) * 2;
check('2024 重击 rider 翻倍（修正不翻倍）', critRider.damage?.final === riderExpect, `final=${critRider.damage?.final} 期望 ${riderExpect}`);

// 伤害管线
const resist = applyDamageModifiers(mkUnit({ resistances: ['fire'] }), 15, 'fire');
check('抗性减半', resist.final === 7 && resist.appliedToHp === 7);
const immune = applyDamageModifiers(mkUnit({ immunities: ['poison'] }), 15, 'poison');
check('免疫归零', immune.final === 0);
const vuln = applyDamageModifiers(mkUnit({ vulnerabilities: ['fire'] }), 10, 'fire');
check('易伤翻倍', vuln.final === 20);
const temp = applyDamageModifiers(mkUnit({ tempHp: 5 }), 12, 'slashing');
check('临时HP吸收', temp.appliedToHp === 7 && temp.final === 12, JSON.stringify(temp));
const conc = applyDamageModifiers(mkUnit({ concentration: '测试专注法术' }), 20, 'slashing');
check('专注DC=max(10,伤/2)', conc.concentrationDc === 10 || conc.concentrationDc === 10, `dc=${conc.concentrationDc}`);
check('专注DC 21伤=11', concentrationDc(21) === 11 && concentrationDc(12) === 10);

// 豁免
const paraTarget = mkUnit({ statuses: ['paralyzed'] });
const sv1 = resolveSave(paraTarget, { ability: 'dex', dc: 10, sourceDamage: 20, halfOnSuccess: true });
check('麻痹敏捷自动失败', sv1.check.outcome === 'failure' && sv1.damageTaken === 20 && !sv1.halfApplied);
const dexTarget = mkUnit({ abilities: { str: 10, dex: 16, con: 10, int: 10, wis: 10, cha: 10 }, statuses: ['restrained'] });
setRng(() => 0.001); // 第二颗骰 = 1
const sv2 = resolveSave(dexTarget, { ability: 'dex', dc: 12, forcedRoll: 11 });
check('束缚敏捷劣势取低', sv2.check.dice.rolls.length === 2 && sv2.check.dice.rawD20 === 1,
  `rolls=${JSON.stringify(sv2.check.dice.rolls.map(r => r.value))} raw=${sv2.check.dice.rawD20} — 双骰[11,1]劣势应取1`);
check('劣势单1非大失败(2024)', sv2.check.outcome === 'failure', sv2.check.outcome);
const conTarget = mkUnit({ abilities: { str: 10, dex: 10, con: 18, int: 10, wis: 10, cha: 10 }, saveBonuses: { con: 7 } });
const sv3 = resolveSave(conTarget, { ability: 'con', dc: 14, forcedRoll: 8 });
check('显式豁免加值优先', sv3.check.total === 15 && sv3.check.outcome === 'success');

// 死亡豁免
const dying = mkUnit({ hp: 0, deathSaves: { successes: 0, failures: 0, stable: false, dead: false } });
const ds1 = resolveDeathSave(dying, 15);
check('死亡豁免成功计数', ds1.newState.successes === 1);
const ds2 = resolveDeathSave({ ...dying, deathSaves: { successes: 2, failures: 0, stable: false, dead: false } }, 10);
check('三成功稳定', ds2.event === 'stable' && ds2.newState.stable);
const ds3 = resolveDeathSave({ ...dying, deathSaves: { successes: 0, failures: 2, stable: false, dead: false } }, 5);
check('三失败死亡', ds3.event === 'dead' && ds3.newState.dead);
const ds4 = resolveDeathSave(dying, 1);
check('裸1双失败', ds4.event === 'double-fail' && ds4.newState.failures === 2);
const ds5 = resolveDeathSave(dying, 20);
check('裸20复活', ds5.event === 'revive-1hp');
const dz = damageAtZeroHp({ ...dying, deathSaves: { successes: 0, failures: 2, stable: false, dead: false } }, 10, false);
check('0HP受击失败+1', dz.failures === 1 && dz.killed);

// 专注豁免
const concentrator = mkUnit({ abilities: { str: 10, dex: 10, con: 16, int: 10, wis: 10, cha: 10 }, concentration: '测试专注法术' });
const cc1 = resolveConcentration(concentrator, 30, 10); // DC15, 10+3=13 失败
check('专注豁免失败', cc1.broken === true && cc1.check.target === 15);
const cc2 = resolveConcentration(concentrator, 10, 19); // DC10, 19+3=22 成功
check('专注豁免成功', cc2.broken === false);

// 擒抱逃脱 DC
const grappler = mkUnit({ abilities: { str: 18, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, level: 3 });
check('逃脱DC=8+4+2=14', escapeDc(grappler) === 14, `got ${escapeDc(grappler)}`);

// 治疗与坠落
check('坠落伤害公式', fallDamage(30) === '3d6' && fallDamage(300) === '20d6' && fallDamage(5) === '0');

// 遭遇难度：4×CR1(200xp)=800×2(乘数)=1600 vs 4人2级(deadly=400×4=1600) → deadly
const diff = encounterDifficulty([1, 1, 1, 1], [2, 2, 2, 2]);
check('遭遇难度判定', diff.level === 'deadly' && diff.adjustedXp === 1600, JSON.stringify({ xp: diff.adjustedXp, lv: diff.level }));
check('CR XP 表', encounterDifficulty([0.25], [1]).totalXp === 50);

// ================================================================
console.log('\n━━━━━━━━ 6. 规则与状态 rules/conditions ━━━━━━━━');
check('熟练加值 1-4级=2', proficiencyBonus(1) === 2 && proficiencyBonus(4) === 2);
check('熟练加值 5级=3', proficiencyBonus(5) === 3 && proficiencyBonus(8) === 3);
check('熟练加值 17级=6', proficiencyBonus(17) === 6 && proficiencyBonus(20) === 6);
check('属性调整值', abilityMod(20) === 5 && abilityMod(10) === 0 && abilityMod(7) === -2 && abilityMod(9) === -1);
check('掩护加值', coverBonus('half') === 2 && coverBonus('threeQuarters') === 5 && coverBonus('none') === 0);

// 条件聚合
const ag1 = aggregateEffects(['grappled']);
check('擒抱速度0', ag1.speedMultiplier === 0);
const ag2 = aggregateEffects(['paralyzed']);
check('麻痹自动失败str/dex', ag2.autoFailSaves.has('str') && ag2.autoFailSaves.has('dex') && ag2.noActions && ag2.speedMultiplier === 0);
const ag3 = aggregateEffects(['exhaustion:3']);
check('力竭3级无攻击劣势（2024 分级废除，-2/级数值化）', ag3.ownAttackDisadvantage === false);
const ag4 = aggregateEffects(['exhaustion:6']);
check('力竭6级非死亡级（2024 死亡在 10 级）', ag4.noActions === false && ag4.speedMultiplier === 1);

// 攻击模式互斥
const blindAtk = mkUnit({ statuses: ['blinded'] });
const proneTgt = mkUnit({ statuses: ['prone'] });
const mode1 = attackRollModeAgainst(blindAtk, proneTgt);
check('目盲攻倒地=劣势(5尺内优势+自身劣势→正常/劣势判定)', ['normal', 'disadvantage'].includes(mode1.mode), mode1.mode);
const poisonAtk = mkUnit({ statuses: ['poisoned'] });
const mode2 = attackRollModeAgainst(poisonAtk, mkUnit({ statuses: [] }));
check('中毒攻击劣势', mode2.mode === 'disadvantage');
const invTgt = mkUnit({ statuses: ['invisible'] });
const mode3 = attackRollModeAgainst(mkUnit({ statuses: [] }), invTgt);
check('攻隐形劣势', mode3.mode === 'disadvantage');

// 优势劣势抵消
const bothAtk = mkUnit({ statuses: ['blinded'] });         // 自身劣势
const bothTgt = mkUnit({ statuses: ['restrained'] });      // 被攻优势
const mode4 = attackRollModeAgainst(bothAtk, bothTgt);
check('优势劣势抵消=正常', mode4.mode === 'normal', mode4.mode);

// 有效速度
check('束缚速度0', effectiveSpeed(mkUnit({ speed: 30, statuses: ['restrained'] })) === 0);
check('力竭1级速度 -5 尺（2024：-5/级）', effectiveSpeed(mkUnit({ speed: 30, statuses: ['exhaustion:1'] })) === 25);
const ex1 = aggregateEffects(['exhaustion:1']);
check('力竭1级引擎层不按倍率减速(2024规则)', ex1.speedMultiplier === 1);

// 状态注册表完整性
check('13种官方状态', ['blinded', 'charmed', 'deafened', 'frightened', 'grappled', 'incapacitated', 'invisible', 'paralyzed', 'petrified', 'poisoned', 'prone', 'restrained', 'stunned', 'unconscious'].every(k => CONDITIONS[k] !== undefined));
check('状态中文名', conditionName('prone') === '倒地' && conditionName('exhaustion:2') === '力竭·2级');

// ================================================================
console.log('\n━━━━━━━━ 7. 快照系统 snapshot.ts ━━━━━━━━');
const snapA = snapshotFromUnits([
  mkUnit({ id: 's-a', hp: 30, maxHp: 30, init: 15 }),
  mkUnit({ id: 's-b', hp: 10, maxHp: 10, init: 12 }),
]);
const snapB = snapshotFromUnits([
  mkUnit({ id: 's-a', hp: 22, maxHp: 30, init: 15, statuses: ['prone'] }),
  mkUnit({ id: 's-b', hp: 10, maxHp: 10, init: 12 }),
  mkUnit({ id: 's-c', hp: 5, maxHp: 5, init: 20 }),
]);
const d = diffSnapshots(snapA, snapB);
check('diff HP 变化', d.unitDiffs.some(c => c.id === 's-a' && c.hpDelta === -8), JSON.stringify(d.unitDiffs.map(c => ({ id: c.id, hp: c.hpDelta }))));
check('diff 状态新增', d.unitDiffs.some(c => c.id === 's-a' && c.addedStatuses.includes('prone')));
check('diff 新增单位', d.unitDiffs.some(c => c.id === 's-c' && c.isNew));
check('diff 无移除', !d.unitDiffs.some(c => c.removed));
const dFirst = diffSnapshots(null, snapA);
check('首快照全标记新增', dFirst.unitDiffs.every(u => u.isNew));

// ================================================================
// 敌卡系统 statblocks
// ================================================================
console.log('\n── 敌卡系统 statblocks ──');
import {
  parseEncounterDefs, lenientJsonParse, matchStatblockForName, stripInstanceSuffix,
  unitFromStatblock, applyStatblockToUnit, statblockFromPreset, generateEncounterBlock,
} from '../src/lib/engine/statblocks';
import { MONSTER_PRESETS } from '../src/lib/engine/presets';

// 容错 JSON
check('容错JSON: 尾逗号', JSON.stringify(lenientJsonParse('[{"a":1,},]')) !== 'null');
check('容错JSON: 代码块围栏', JSON.stringify(lenientJsonParse('```json\n{"a":1}\n```')) !== 'null');
check('容错JSON: 中文引号', JSON.stringify(lenientJsonParse('{“a”:1}')) !== 'null');
check('容错JSON: 非JSON返回null', lenientJsonParse('hello world') === null);

// AI 风格中文字段敌卡解析
const aiEncounter = `<encounter>
{
  "enemies": [{
    "名称": "豺狼人猎手", "count": 2, "体型": "中型", "挑战等级": 0.5,
    "ac": 14, "生命值": "22", "速度": "30尺",
    "属性": {"力量": 14, "敏捷": 12, "体质": 11, "智力": 8, "感知": 10, "魅力": 8},
    "攻击": [
      {"名称": "长弓", "类型": "远程", "命中": 3, "伤害": "1d8+1", "伤害类型": "穿刺", "射程": "150/600"},
      {"名称": "矛", "命中": 4, "伤害公式": "1d6+2", "伤害类型": "穿刺", "射程": 5}
    ],
    "战术": "游击", "抗性": [], "备注": "伏击者"
  }]
}
</encounter>`;
const encResult = parseEncounterDefs(aiEncounter.replace(/<\/?encounter>/g, ''));
check('敌卡: 解析1张卡', encResult.defs.length === 1, JSON.stringify(encResult.warnings));
const gnollDef = encResult.defs[0];
check('敌卡: 名称', gnollDef?.name === '豺狼人猎手');
check('敌卡: AC', gnollDef?.ac === 14);
check('敌卡: HP字符串解析', gnollDef?.hp === 22);
check('敌卡: 速度带单位', gnollDef?.speed === 30);
check('敌卡: 中文字段六维', gnollDef?.abilities.str === 14 && gnollDef?.abilities.dex === 12);
check('敌卡: 攻击数', gnollDef?.attacks.length === 2);
check('敌卡: 远程识别', gnollDef?.attacks[0]?.kind === 'ranged', gnollDef?.attacks[0]?.kind);
check('敌卡: 射程解析', gnollDef?.attacks[0]?.range === 150, String(gnollDef?.attacks[0]?.range));
check('敌卡: 中文伤害类型', gnollDef?.attacks[0]?.damageType === 'piercing');
check('敌卡: 中文战术档案', gnollDef?.aiProfile === 'skirmisher');

// 英文字段 + AoE 法术
const enEncounter = `{
  "enemies": [{
    "name": "哥布林萨满", "size": "small", "cr": 1, "ac": 12, "hp": {"max": 16}, "speed": 30,
    "abilities": {"str": 8, "dex": 14, "con": 10, "int": 10, "wis": 14, "cha": 8},
    "attacks": [
      {"name": "火球术", "kind": "save-aoe", "dice": "8d6", "damageType": "fire",
       "save": {"ability": "dex", "dc": 13, "half": true}, "aoe": {"kind": "sphere", "size": 20}, "spellLevel": 3},
      {"name": "治疗", "kind": "heal", "dice": "2d4+2", "range": 60}
    ],
    "aiProfile": "support"
  }]
}`;
const enResult = parseEncounterDefs(enEncounter);
check('敌卡: 英文字段解析', enResult.defs.length === 1 && enResult.defs[0].name === '哥布林萨满');
const shaman = enResult.defs[0];
check('敌卡: AoE形状', shaman.attacks[0].aoe?.kind === 'sphere' && shaman.attacks[0].aoe?.size === 20);
check('敌卡: 豁免属性', shaman.attacks[0].saveAbility === 'dex' && shaman.attacks[0].saveDc === 13);
check('敌卡: 半伤豁免', shaman.attacks[0].halfOnSuccess === true, String(shaman.attacks[0].halfOnSuccess));
check('敌卡: 法术环阶', shaman.attacks[0].spellLevel === 3);
check('敌卡: 治疗动作', shaman.attacks[1].kind === 'heal');
check('敌卡: 缺动作补默认', parseEncounterDefs('{"name":"裸怪","ac":12}').defs[0].attacks.length === 1);

// 名字匹配
check('匹配: 去尾号', stripInstanceSuffix('哥布林弓手2') === '哥布林弓手');
const defs = [statblockFromPreset(MONSTER_PRESETS[0]), statblockFromPreset(MONSTER_PRESETS[1])];
check('匹配: 前缀', matchStatblockForName('哥布林弓手3', defs)?.name === '哥布林弓手');
check('匹配: 精确优先', matchStatblockForName('哥布林', defs)?.name === '哥布林');
check('匹配: 无匹配返回null', matchStatblockForName('巨龙', defs) === null);

// 卡 → 单位
const goblinUnit = unitFromStatblock(gnollDef!, 2, true, { x: 50, y: 50 });
check('敌卡单位: 实例编号', goblinUnit.id === '豺狼人猎手3');
check('敌卡单位: 敌对态度', goblinUnit.attitude === 2);
check('敌卡单位: 动作表', goblinUnit.aiAbilities?.length === 2);
check('敌卡单位: AI档案', goblinUnit.aiProfile === 'skirmisher');

// 卡 → 补全已有瘦单位
const thinUnit = mkUnit({ id: '豺狼人猎手1', name: '豺狼人猎手1', attitude: 2, ac: 13, dataSource: 'ai-parsed' });
const filled = applyStatblockToUnit(thinUnit, gnollDef!);
check('补全: AC覆盖', filled.ac === 14);
check('补全: 保留id', filled.id === '豺狼人猎手1');
check('补全: 动作表注入', filled.aiAbilities?.length === 2);
check('补全: dataSource标记', filled.dataSource === 'statblock');

// 导出再解析（roundtrip）
const exported = generateEncounterBlock([gnollDef!]);
const reParsed = parseEncounterDefs(exported);
check('导出roundtrip: 卡数', reParsed.defs.length === 1);
check('导出roundtrip: AC', reParsed.defs[0].ac === 14);
check('导出roundtrip: 游击档案', reParsed.defs[0].aiProfile === 'skirmisher');
check('导出roundtrip: 攻击保留', reParsed.defs[0].attacks.length === 2);

// ================================================================
// 角色数据桥 sheetbridge
// ================================================================
console.log('\n── 角色数据桥 sheetbridge ──');
import {
  applyPatches, charSheetsFromTree, unitFromCharSheet, applySheetToUnit, matchSheetForName,
} from '../src/lib/engine/sheetbridge';
import { extractStatblockBlocks } from '../src/lib/engine/protocol';

// JSONPatch 应用（含 delta / insert / remove / 数组追加）
const tree: Record<string, unknown> = {};
const patchR1 = applyPatches(tree, [
  { op: 'insert', path: '/角色列表/艾尔玛/等级', value: 3 },
  { op: 'insert', path: '/角色列表/艾尔玛/生命值', value: { 当前: 28, 最大: 28, 临时: 0 } },
  { op: 'insert', path: '/角色列表/艾尔玛/护甲等级', value: { 总值: 15 } },
  { op: 'insert', path: '/角色列表/艾尔玛/属性', value: { 力量: 12, 敏捷: 14, 体质: 13, 智力: 8, 感知: 12, 魅力: 10 } },
  { op: 'insert', path: '/角色列表/艾尔玛/物品/武器/+1长剑', value: { 伤害公式: '1d8', 伤害类型: '挥砍', 映射属性: '力量', 魔法加值: 1, 熟练: true, 已装备: true, 属性特征: '两用(1d10)' } },
  { op: 'insert', path: '/角色列表/艾尔玛/施法/法术位/1环', value: { 当前: 4, 最大: 4 } },
  { op: 'insert', path: '/角色列表/艾尔玛/施法/法术书/火球术', value: { 准备中: false } },
  { op: 'insert', path: '/角色列表/艾尔玛/施法/法术书/治疗真言', value: { 准备中: true } },
]);
check('补丁: 全部应用', patchR1.applied === 8 && patchR1.errors.length === 0, JSON.stringify(patchR1.errors));

const patchR2 = applyPatches(tree, [
  { op: 'delta', path: '/角色列表/艾尔玛/生命值/当前', value: -8 },
  { op: 'delta', path: '/角色列表/艾尔玛/施法/法术位/1环/当前', value: -1 },
  { op: 'replace', path: '/世界信息/地点', value: '深水城' },
  { op: 'insert', path: '/冒险日志/-/记录', value: '遭遇哥布林' },
]);
check('补丁: 增量累积', patchR2.applied === 4);
check('补丁: delta计算', ((tree['角色列表'] as any).艾尔玛['生命值']['当前']) === 20);
check('补丁: 顶层路径', (tree['世界信息'] as any)?.地点 === '深水城');
check('补丁: 数组追加', Array.isArray((tree as any)['冒险日志']) && (tree as any)['冒险日志'].length === 1);

// 角色卡提取
const sheets = charSheetsFromTree(tree);
check('名单: 提取1人', sheets.length === 1);
const elma = sheets[0];
check('名单: 等级', elma.level === 3);
check('名单: HP', elma.hp === 20 && elma.maxHp === 28);
check('名单: AC', elma.ac === 15);
check('名单: 武器', elma.weapons.length === 1 && elma.weapons[0].name === '+1长剑');
check('名单: 武器熟练', elma.weapons[0].proficient === true);
check('名单: 法术位', elma.spellSlots?.[1]?.current === 3 && elma.spellSlots?.[1]?.max === 4);
check('名单: 法术书', elma.spells.length === 2);
check('名单: 治疗真言匹配机制', elma.spells.some(s => s.name === '治疗真言' && s.matched && s.ability?.bonusAction === true));
check('名单: 火球术匹配机制', elma.spells.some(s => s.name === '火球术' && s.matched && s.ability?.spellLevel === 3));

// 角色卡 → 战斗单位（武器数学）
const elmaUnit = unitFromCharSheet(elma, { isPlayer: true, pos: { x: 10, y: 10 } });
check('角色单位: 基础字段', elmaUnit.ac === 15 && elmaUnit.hp === 20 && elmaUnit.maxHp === 28);
check('角色单位: 玩家操控', elmaUnit.isPlayer === true && elmaUnit.playerControlled === true);
check('角色单位: 法术位映射', elmaUnit.spellSlots?.[1]?.current === 3);
const longsword = elmaUnit.aiAbilities?.find(a => a.name === '+1长剑');
// 力量12→+1, 熟练Lv3→+2, 魔法+1 = +4
check('角色单位: 武器命中=属性+熟练+魔法', longsword?.attackBonus === 4, `实际 ${longsword?.attackBonus}`);
// 伤害 1d8+1(力量)+1(魔法) = 1d8+2
check('角色单位: 武器伤害公式', longsword?.dice === '1d8+2', `实际 ${longsword?.dice}`);
check('角色单位: 法术动作导入', elmaUnit.aiAbilities?.some(a => a.name === '治疗真言' && a.spellLevel === 1) === true);

// 角色卡补全已有瘦单位
const thinElma = mkUnit({ id: '艾尔玛', name: '艾尔玛', attitude: 0, ac: 13, hp: 28, maxHp: 28, dataSource: 'ai-parsed' });
const filledElma = applySheetToUnit(thinElma, elma);
check('补全角色: AC', filledElma.ac === 15);
check('补全角色: 保留位置', filledElma.pos.x === 10 && filledElma.pos.y === 10);
check('补全角色: 武器注入', filledElma.aiAbilities?.some(a => a.name === '+1长剑') === true);
check('补全角色: 法术位注入', filledElma.spellSlots?.[1]?.max === 4);

// 名字匹配
check('角色匹配: 精确', matchSheetForName('艾尔玛', sheets)?.name === '艾尔玛');
check('角色匹配: 无匹配', matchSheetForName('路人甲', sheets) === null);

// 协议提取
const statblockBlocks = extractStatblockBlocks(`前言\n<encounter>{"name":"哥布林"}</encounter>\n中间\n<statblock>[{"name":"骷髅"}]</statblock>\n<battle>x</battle>`);
check('协议: 敌卡块提取', statblockBlocks.length === 2 && statblockBlocks[0] === '{"name":"哥布林"}');

// 完整消息解析（数据层路由基础）
const fullMsg = parseDmMessage(`DM叙述
<UpdateVariable>
<JSONPatch>
[{"op": "delta", "path": "/角色列表/艾尔玛/生命值/当前", "value": -3}]
</JSONPatch>
</UpdateVariable>
<encounter>
[{"name":"哥布林弓手","ac":13,"hp":10,"attacks":[{"name":"短弓","kind":"ranged","attackBonus":4,"dice":"1d6+2","damageType":"piercing","range":80}]}]
</encounter>
<battle>
艾尔玛|init 18|hp 17/28|pos 10,30|att 0|next
哥布林弓手|init 14|hp 10/10|pos 40,15|att 2
</battle>`);
check('全解析: 补丁提取', fullMsg.patches.length === 1);
check('全解析: 敌卡块提取', fullMsg.statblockBlocks.length === 1);
check('全解析: 战斗块提取', fullMsg.latestBattle?.length === 2);

// ================================================================
// 战报生成 report.ts（结算权威 = 前端）
// ================================================================
console.log('\n── 战报生成 report.ts ──');
import {
  judgeOutcome, suggestPatches, resourceSummary, enemySummary, generateBattleResultBlock,
} from '../src/lib/engine/report';

const reportUnits: BattleUnit[] = [
  { ...mkUnit({ id: '艾尔玛', name: '艾尔玛', hp: 8, maxHp: 28, attitude: 0, statuses: ['poisoned'] }) },
  { ...mkUnit({ id: '米拉', name: '米拉', hp: 0, maxHp: 14, attitude: 0 }) },
  { ...mkUnit({ id: '哥布林1', name: '哥布林1', hp: 0, maxHp: 10, attitude: 2, deathSaves: { successes: 3, failures: 0, stable: false, dead: true } }) },
  { ...mkUnit({ id: '哥布林2', name: '哥布林2', hp: 4, maxHp: 10, attitude: 2, statuses: ['prone'] }) },
];
// 名单里的艾尔玛战前 HP=20（上面 delta 后的树）
const reportSheets = charSheetsFromTree(tree);
check('战报: 名单匹配到艾尔玛', reportSheets.some(s => s.name === '艾尔玛'));

const outcome1 = judgeOutcome(reportUnits);
check('战报: 胜负判定（敌有存活→未分出）', outcome1.text.includes('尚未分出'));
const outcome2 = judgeOutcome(reportUnits.filter(u => u.id !== '哥布林2'));
check('战报: 胜负判定（敌全灭→玩家方胜利）', outcome2.winner === 0);

const reportPatches = suggestPatches(reportUnits, reportSheets);
const elmaPatch = reportPatches.find(p => p.path === '/角色列表/艾尔玛/生命值/当前');
check('战报: 生成艾尔玛 HP 补丁', !!elmaPatch);
check('战报: HP 补丁值=8', elmaPatch?.value === 8);
check('战报: 补丁只含确定路径', reportPatches.every(p => p.path.startsWith('/角色列表/') && p.path.includes('/生命值/')));

const res = resourceSummary(reportUnits, reportSheets);
check('战报: 资源摘要含中毒状态', res.some(l => l.includes('中毒')));
check('战报: 资源摘要含倒地', res.some(l => l.includes('倒地昏迷')));

const enemies = enemySummary(reportUnits);
check('战报: 敌方聚合（哥布林 1/2 阵亡）', enemies.some(l => l.includes('哥布林') && l.includes('1/2 阵亡')));

const block = generateBattleResultBlock({
  battleName: '哥布林伏击', turn: { round: 3, currentUnitId: null, order: [], turnIndex: -1, ended: true, surprisedIds: [] },
  battleActive: false, units: reportUnits, rosterSheets: reportSheets,
});
check('战报: 块标签完整', block.startsWith('<battleresult>') && block.trim().endsWith('</battleresult>'));
check('战报: 含建议变量更新段', block.includes('【建议变量更新】'));
check('战报: 含 JSONPatch', block.includes('<JSONPatch>'));
check('战报: 已结束措辞', block.includes('战斗已在前端面板结算完毕'));
const midBattle = generateBattleResultBlock({
  battleName: '哥布林伏击', turn: { round: 2, currentUnitId: '艾尔玛', order: [], turnIndex: 0, ended: false, surprisedIds: [] },
  battleActive: true, units: reportUnits, rosterSheets: reportSheets,
});
check('战报: 进行中措辞', midBattle.includes('进行中') && midBattle.includes('请勿替任何单位行动'));

// ================================================================
// 嵌入同步 embedSync.ts（哈希链 + 导入门控）
// ================================================================
console.log('\n── 嵌入同步 embedSync.ts ──');
import { fnv1a, emptyChain, shouldApplyImport, appendChain, chainContains } from '../src/lib/engine/embedSync';

check('哈希: 相同文本同哈希', fnv1a('<battle>x</battle>') === fnv1a('<battle>x</battle>'));
check('哈希: 不同文本异哈希', fnv1a('<battle>x</battle>') !== fnv1a('<battle>y</battle>'));

let chain = emptyChain();
const h1 = fnv1a('msg-旧楼层'), h2 = fnv1a('msg-新楼层');
check('链: 空链首条放行', shouldApplyImport(chain, h1, 3).apply === true);
chain = appendChain(chain, h1, 3);
check('链: 重复哈希拦截', shouldApplyImport(chain, h1, 3).reason === 'duplicate');
check('链: 竞态窗口内更小深度放行', shouldApplyImport(chain, h2, 0).apply === true);
chain = appendChain(chain, h2, 0);
check('链: 竞态窗口内更大深度拦截', shouldApplyImport(chain, fnv1a('msg-中楼层'), 2).reason === 'stale-depth');
check('链: 链含已应用哈希', chainContains(chain, h1) && chainContains(chain, h2));
// 竞态窗口之外（链长>4）：新哈希 + 深度0 放行（新消息总在深度 0 到达）
let longChain = emptyChain();
for (let i = 0; i < 6; i++) longChain = appendChain(longChain, fnv1a('m' + i), 0);
check('链: 正常运行新消息放行', shouldApplyImport(longChain, fnv1a('新消息'), 0).apply === true);
check('链: 上限裁剪', longChain.appliedHashes.length <= 64);

// ================================================================
// ============ 第 10 节：掷先攻主流程 + 楼层合并权威（PHB 战斗步骤③） ============
// ================================================================
import { rollInitiativeForUnits, rebuildOrderKeepActor } from '../src/lib/engine/initiative';
import { mergeUnitFromProtocol } from '../src/lib/engine/merge';
import type { ParsedBattleUnit } from '../src/lib/engine/protocol';

function mkU(over: Partial<BattleUnit> & { id: string }): BattleUnit {
  return {
    name: over.id, init: 10, initMod: 0, hp: 20, maxHp: 20, tempHp: 0, ac: 13, speed: 30,
    pos: { x: 0, y: 0 }, attitude: 2, statuses: [], isPlayer: false, size: 'medium',
    resistances: [], immunities: [], vulnerabilities: [], actionEconomy: { action: false, bonus: false, reaction: false, movementUsed: 0 },
    hasActed: false, notes: '',
    ...over,
  } as BattleUnit;
}
function mkParsed(over: Partial<ParsedBattleUnit> & { id: string }): ParsedBattleUnit {
  return { statuses: [], attitude: 2, next: false, extras: [], ...over };
}

// ---- 掷先攻：范围 + 敏捷加值 + 倒地不掷 ----
{
  const u1 = mkU({ id: '盗贼', abilities: { dex: 14, str: 10, con: 10, int: 10, wis: 10, cha: 10 } as BattleUnit['abilities'] });
  const u2 = mkU({ id: '倒地者', hp: 0, deathSaves: { successes: 0, failures: 3, stable: false, dead: true } });
  const { rolls, initById } = rollInitiativeForUnits([u1, u2], DEFAULT_RULES, []);
  check('先攻: 存活单位掷骰', initById.has('盗贼') && !initById.has('倒地者'));
  check('先攻: 总值范围 [1+敏捷调整值, 20+敏捷调整值]', initById.get('盗贼')! >= 1 + 2 && initById.get('盗贼')! <= 20 + 2, `got ${initById.get('盗贼')}`);
  check('先攻: 明细含 d20 与加值', rolls.length === 1 && rolls[0].dexMod === 2 && rolls[0].d20 >= 1 && rolls[0].d20 <= 20);
}
// ---- 掷先攻：2024 惊讶劣势（注入 RNG：两骰 2 与 18，kl 取低） ----
{
  const seq = [0.05, 0.9]; // d20 → 2, 18
  let i = 0;
  setRng(() => seq[i++]);
  const u = mkU({ id: '被伏击者', abilities: { dex: 10, str: 10, con: 10, int: 10, wis: 10, cha: 10 } as BattleUnit['abilities'] });
  const { rolls } = rollInitiativeForUnits([u], { ...DEFAULT_RULES, surpriseMode: 'init-disadvantage' }, ['被伏击者']);
  check('先攻: 惊讶劣势取低骰', rolls[0].d20 === 2 && rolls[0].total === 2, `d20=${rolls[0].d20} total=${rolls[0].total}`);
  check('先攻: 惊讶标记传递', rolls[0].surprised === true);
  // 非惊讶单位正常掷（同 RNG 序列下用单骰）
  let j = 0;
  setRng(() => [0.9][j++]);
  const { rolls: rolls2 } = rollInitiativeForUnits([u], { ...DEFAULT_RULES, surpriseMode: 'init-disadvantage' }, []);
  check('先攻: 非惊讶不受劣势', rolls2[0].d20 === 19 && rolls2[0].total === 19, `d20=${rolls2[0].d20}`);
  setRng(() => Math.random()); // 还原默认随机源，后续测试不受注入影响
}
// ---- 2014 惊讶：skip-turn 首轮跳过 ----
{
  const rules2014: RulesConfig = { ...DEFAULT_RULES, surpriseMode: 'skip-turn' };
  const a = mkU({ id: '被伏击A', init: 20, attitude: 0 });
  const b = mkU({ id: '伏击者B', init: 10, attitude: 2 });
  // 战斗开始：指针落在被伏击者A（先攻20）→ 首轮跳过 → 轮到B
  const st0 = { round: 1, order: ['被伏击A', '伏击者B'], turnIndex: -1, currentUnitId: null as string | null, ended: false, surprisedIds: ['被伏击A'] };
  const r1 = advanceTurn(st0, [a, b], rules2014);
  check('惊讶2014: 首轮被伏击者跳过', r1.skipped.includes('被伏击A') && r1.newUnitId === '伏击者B');
  check('惊讶2014: 首轮轮次不虚增', r1.state.round === 1);
  const r2 = advanceTurn(r1.state, [a, b], rules2014);
  check('惊讶2014: 第2轮被伏击者正常行动', r2.newUnitId === '被伏击A' && r2.state.round === 2);
  // 2024 模式（init-disadvantage）：不跳回合，只影响掷骰
  const rules2024: RulesConfig = { ...DEFAULT_RULES, surpriseMode: 'init-disadvantage' };
  const r3 = advanceTurn(st0, [a, b], rules2024);
  check('惊讶2024: 不丢回合', r3.newUnitId === '被伏击A' && r3.skipped.length === 0);
}
// ---- 平局裁决：敏捷调整值高者优先，玩家优先 ----
{
  const p1 = mkU({ id: '玩家甲', init: 15, initMod: 3, attitude: 0, isPlayer: true });
  const m1 = mkU({ id: '怪物乙', init: 15, initMod: 1, attitude: 2 });
  const order = buildInitiativeOrder([m1, p1], DEFAULT_RULES, 0);
  check('先攻平局: 敏捷调整值高者先', order[0] === '玩家甲');
  const p2 = mkU({ id: '队友', init: 15, initMod: 1, attitude: 0, isPlayer: true });
  const m2 = mkU({ id: '敌怪', init: 15, initMod: 1, attitude: 2 });
  const order2 = buildInitiativeOrder([m2, p2], DEFAULT_RULES, 0);
  check('先攻平局: 完全平局时玩家方先', order2[0] === '队友');
}
// ---- 增援重建顺序：保持当前行动者 ----
{
  const A = mkU({ id: 'A', init: 20 });
  const B = mkU({ id: 'B', init: 15 });
  const C = mkU({ id: 'C', init: 10 });
  const D = mkU({ id: '增援D', init: 17 });
  const turn = { round: 2, order: ['A', 'B', 'C'], turnIndex: 1, currentUnitId: 'B', ended: false, surprisedIds: [] };
  const nt = rebuildOrderKeepActor([A, B, C, D], DEFAULT_RULES, turn, 0);
  check('增援: 按先攻插入序列', nt.order.join(',') === 'A,增援D,B,C', nt.order.join(','));
  check('增援: 当前行动者不变', nt.currentUnitId === 'B' && nt.turnIndex === 2);
  // 当前行动者已被移除
  const nt2 = rebuildOrderKeepActor([A, C, D], DEFAULT_RULES, turn, 0);
  check('增援: 行动者移除后退至原位', nt2.turnIndex === 1 && nt2.currentUnitId === '增援D', `idx=${nt2.turnIndex} cur=${nt2.currentUnitId}`);
}
// ---- 合并权威：战前（protect=false）AI 数值直入 ----
{
  const ex = mkU({ id: '艾尔玛', hp: 15, maxHp: 22, init: 14, initRolled: true, pos: { x: 3, y: 4 }, statuses: ['poisoned'] });
  const p = mkParsed({ id: '艾尔玛', hp: { current: 24, max: 24 }, init: 9, pos: { x: 0, y: 0 }, statuses: [] });
  const r = mergeUnitFromProtocol(ex, p, false);
  check('合并-战前: AI HP 覆盖', r.unit.hp === 24 && r.unit.maxHp === 24);
  check('合并-战前: AI init 覆盖且标记为给定值', r.unit.init === 9 && r.unit.initRolled === false);
  check('合并-战前: AI 位置覆盖', r.unit.pos.x === 0 && r.unit.pos.y === 0);
  check('合并-战前: AI 状态覆盖（可清除）', r.unit.statuses.length === 0);
  check('合并-战前: 无冲突记录', r.conflicts.length === 0);
}
// ---- 合并权威：战斗中（protect=true）面板结算保护 ----
{
  const ex = mkU({ id: '艾尔玛', hp: 11, maxHp: 22, init: 17, initRolled: true, pos: { x: 5, y: 6 }, statuses: ['poisoned'], portrait: undefined });
  const p = mkParsed({ id: '艾尔玛', hp: { current: 24, max: 24 }, init: 9, pos: { x: 0, y: 0 }, statuses: ['frightened'], portrait: 'https://a/b.png' });
  const r = mergeUnitFromProtocol(ex, p, true);
  check('合并-战斗中: 面板 HP 保留', r.unit.hp === 11 && r.unit.maxHp === 22);
  check('合并-战斗中: 面板先攻保留', r.unit.init === 17);
  check('合并-战斗中: 面板位置保留', r.unit.pos.x === 5 && r.unit.pos.y === 6);
  check('合并-战斗中: 状态并集（AI 增不删）', r.unit.statuses.includes('poisoned') && r.unit.statuses.includes('frightened'));
  check('合并-战斗中: 展示字段可更新', r.unit.portrait === 'https://a/b.png');
  check('合并-战斗中: 冲突全部记录', r.conflicts.length === 3 && r.conflicts.some(c => c.field === 'hp') && r.conflicts.some(c => c.field === 'pos') && r.conflicts.some(c => c.field === 'init'));
  // AI 无法通过省略字段绕过（undefined 不触发冲突也不覆盖）
  const p2 = mkParsed({ id: '艾尔玛', statuses: [] });
  const r2 = mergeUnitFromProtocol(ex, p2, true);
  check('合并-战斗中: 省略字段不覆盖', r2.unit.hp === 11 && r2.conflicts.length === 0);
  // AI 发空 status 列表不能清掉面板状态
  check('合并-战斗中: 空状态表不清除面板状态', r2.unit.statuses.includes('poisoned'));
}
// ---- 合并：新单位默认值 ----
{
  const p = mkParsed({ id: '新怪', hp: { current: 7, max: 7 }, attitude: 2, next: true });
  const r = mergeUnitFromProtocol(undefined, p, false);
  check('合并-新单位: init 占位 10 + 待掷标记', r.unit.init === 10 && r.unit.initRolled === false);
  check('合并-新单位: dataSource 待配装', r.unit.dataSource === 'ai-parsed');
  check('合并-新单位: next 标记驱动 hasActed', r.unit.hasActed === false);
}
// ---- 协议：surprise 字段解析（中英别名 + 值形态） ----
{
  const units = parseBattleBlock('艾尔玛|hp 22/22|att 0|surprise\n哥布林甲|hp 7/7|att 2|惊讶:是\n哥布林乙|hp 7/7|att 2|surprised:1\n哥布林丙|hp 7/7|att 2|突袭\n精灵哨兵|hp 12/12|att 0|surprise:0');
  check('协议: surprise 裸字段', units[0]?.surprised === true);
  check('协议: 惊讶:是', units[1]?.surprised === true);
  check('协议: surprised:1', units[2]?.surprised === true);
  check('协议: 突袭别名', units[3]?.surprised === true);
  check('协议: surprise:0 为假', units[4]?.surprised === false);
  check('协议: surprise 不入 extras', units.every(u => !u.extras.some(e => e.key === 'surprise')));
  // 全角容错：ｓｕｒｐｒｉｓｅ? 字段名不会是全角——但中文别名+全角冒号需要过
  const u2 = parseBattleBlock('哨兵｜ｈｐ 10/10｜ａｔｔ 0｜惊讶：是');
  check('协议: 全角行+中文惊讶', u2[0]?.surprised === true && u2[0]?.hp?.current === 10);
}

// ================================================================
console.log('\n━━━━━━━━━━━━━━━━ 测试汇总 ━━━━━━━━━━━━━━━━');
console.log(`✅ 通过: ${pass}`);
console.log(`❌ 失败: ${fail}`);
console.log(`🐛 确认BUG: ${buggy}`);
if (bugHits.length) {
  console.log('\n--- 确认的 BUG 明细 ---');
  bugHits.forEach((b, i) => console.log(`  ${i + 1}. ${b}`));
}
if (failures.length) {
  console.log('\n--- 失败用例 ---');
  failures.forEach(f => console.log(`  ✗ ${f}`));
}
console.log(`\n总计: ${pass + fail + buggy} 项`);
process.exit(fail > 0 || buggy > 0 ? 1 : 0);
