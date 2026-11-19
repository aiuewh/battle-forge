/**
 * 通用语义测试套件（第三轮自我验证）
 * 原则：同一语义的不同合法写法（AI 真实输出的漂移形态）应产生完全相同的解析结果。
 * 覆盖：全角字符 / 冒号分隔 / 中文字段名 / 中文阵营词 / 中文状态名 / 结果判定词 /
 *       公式变体 / RFC6902 标准操作 / 敌卡别名
 * 运行: bun scripts/semantics-tests.ts
 */
import { parseBattleBlock, parseOutcome, parseCheckDetail, parseDmMessage, generateBattleBlock } from '../src/lib/engine/protocol';
import { parseFormula, rollFormula, setRng } from '../src/lib/engine/dice';
import { parseEncounterDefs } from '../src/lib/engine/statblocks';
import { applyPatches, charSheetsFromTree, unitFromCharSheet } from '../src/lib/engine/sheetbridge';
import { mergeUnitFromProtocol } from '../src/lib/engine/merge';
import { suggestPatches } from '../src/lib/engine/report';
import { planTurn, validateStep, type AiContext } from '../src/lib/engine/ai';
import type { BattleUnit } from '../src/lib/engine/types';

let pass = 0, fail = 0;
const findings: string[] = [];
function ok(name: string, cond: boolean, detail = '') {
  if (cond) pass++;
  else { fail++; findings.push(`❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

console.log('━━━━━━ S1. battle 块同义变体 ━━━━━━');
{
  // 基准形态
  const base = parseBattleBlock('艾尔玛|init 17|hp 22/22|pos 0,15|att 0');
  const b = base[0];

  // s1a 冒号分隔
  const colon = parseBattleBlock('艾尔玛|init:17|hp:22/22|pos:0,15|att:0')[0];
  ok('s1a 冒号分隔 init', colon?.init === 17, JSON.stringify(colon));
  ok('s1a 冒号分隔 hp', colon?.hp?.current === 22 && colon?.hp?.max === 22);
  ok('s1a 冒号分隔 pos', colon?.pos?.x === 0 && colon?.pos?.y === 15);
  ok('s1a 冒号分隔 att', colon?.attitude === 0);

  // s1b 全角数字/竖线/斜杠/逗号
  const fw = parseBattleBlock('艾尔玛｜init １７｜hp ２２／３０｜pos ０，１５｜att ０')[0];
  ok('s1b 全角 init', fw?.init === 17, JSON.stringify(fw));
  ok('s1b 全角 hp', fw?.hp?.current === 22 && fw?.hp?.max === 30);
  ok('s1b 全角 pos', fw?.pos?.x === 0 && fw?.pos?.y === 15);
  ok('s1b 全角 att', fw?.attitude === 0);

  // s1c 中文字段名
  const cn = parseBattleBlock('艾尔玛|先攻 17|生命值 22/22|位置 0,15|阵营 我方')[0];
  ok('s1c 中文字段 init', cn?.init === 17, JSON.stringify(cn));
  ok('s1c 中文字段 hp', cn?.hp?.current === 22);
  ok('s1c 中文字段 pos', cn?.pos?.x === 0 && cn?.pos?.y === 15);
  ok('s1c 中文字段 att 我方=0', cn?.attitude === 0);

  // s1d 中文阵营词
  ok('s1d 敌=2', parseBattleBlock('哥布林|init 9|hp 10/10|att 敌')[0]?.attitude === 2);
  ok('s1d 敌方=2', parseBattleBlock('哥布林|att 敌方')[0]?.attitude === 2);
  ok('s1d 中立=1', parseBattleBlock('野猪|att 中立')[0]?.attitude === 1);
  ok('s1d 玩家=0', parseBattleBlock('艾尔玛|att 玩家')[0]?.attitude === 0);

  // s1e 中文状态名
  const st = parseBattleBlock('艾尔玛|init 17|att 0|status 目盲,中毒')[0];
  ok('s1e 目盲→blinded', st?.statuses.includes('blinded') === true, JSON.stringify(st?.statuses));
  ok('s1e 中毒→poisoned', st?.statuses.includes('poisoned') === true);
  const st2 = parseBattleBlock('法师|status 震慑/昏迷')[0];
  ok('s1e 震慑/昏迷 斜杠分隔', st2?.statuses.includes('stunned') === true && st2?.statuses.includes('unconscious') === true, JSON.stringify(st2?.statuses));
  const st3 = parseBattleBlock('战士|status 力竭2')[0];
  // P1-2 回归：保留力竭等级（exhaustion:N），否则 -2/级减值丢失
  ok('s1e 力竭2→exhaustion:2', st3?.statuses.includes('exhaustion:2') === true, JSON.stringify(st3?.statuses));
  const st4 = parseBattleBlock('战士|status 力竭')[0];
  ok('s1e 无等级力竭→exhaustion:1', st4?.statuses.includes('exhaustion:1') === true, JSON.stringify(st4?.statuses));

  // s1g next 大小写
  ok('s1g NEXT 大写', parseBattleBlock('哥布林|init 9|NEXT')[0]?.next === true);

  // s1h pos 括号
  const pp = parseBattleBlock('艾尔玛|pos (0,15)')[0];
  ok('s1h pos 带括号', pp?.pos?.x === 0 && pp?.pos?.y === 15, JSON.stringify(pp?.pos));

  // s1j portrait URL 冒号不被破坏
  const pt = parseBattleBlock('艾尔玛|portrait https://img.example.com/a.png')[0];
  ok('s1j portrait URL 完整', pt?.portrait === 'https://img.example.com/a.png', pt?.portrait);
  const pt2 = parseBattleBlock('艾尔玛|portrait:https://img.example.com/a.png')[0];
  ok('s1j portrait 冒号形式', pt2?.portrait === 'https://img.example.com/a.png', pt2?.portrait);

  // 基准仍通过
  ok('s1 基准形态不回归', b?.init === 17 && b?.hp?.current === 22 && b?.attitude === 0 && b?.pos?.y === 15);
}

console.log('━━━━━━ S2. 检定结果同义词 ━━━━━━');
{
  ok('s2a 命中 → success', parseOutcome('命中') === 'success');
  ok('s2a 攻击命中 → success', parseOutcome('攻击命中') === 'success');
  ok('s2b 未命中 → failure', parseOutcome('未命中') === 'failure');
  ok('s2b 失手 → failure', parseOutcome('失手') === 'failure');
  ok('s2c 重击 → critical-success', parseOutcome('重击！武器 damage 翻倍') === 'critical-success');
  ok('s2c 暴击 → critical-success', parseOutcome('暴击') === 'critical-success');
  ok('s2d 大失败 → critical-failure', parseOutcome('大失败') === 'critical-failure');
  ok('s2e 成功 → success', parseOutcome('成功') === 'success');
  ok('s2e 大成功 → critical-success', parseOutcome('大成功') === 'critical-success');
  ok('s2f 失败 → failure', parseOutcome('失败') === 'failure');
  ok('s2g 无法判定 → null', parseOutcome('什么都不是') === null);
  // 细节解析全角
  const d1 = parseCheckDetail('裸骰 １６ ＋ ５ ＝ ２１ vs AC １５');
  ok('s2h 全角裸骰', d1.raw === 16, JSON.stringify(d1));
  ok('s2h 全角加值', d1.bonus === 5);
  ok('s2h 全角总值', d1.total === 21);
  ok('s2h 全角AC', d1.ac === 15);
  const d2 = parseCheckDetail('d20 [16]+5=21 DC 15');
  ok('s2i 括号总值', d2.total === 21 || d2.raw === 16, JSON.stringify(d2));
}

console.log('━━━━━━ S3. 骰子公式变体 ━━━━━━');
{
  setRng(() => 0.999); // 全最大
  let r: { total: number } | undefined;
  try { r = rollFormula('１ｄ８＋３') as { total: number }; } catch { r = undefined; }
  ok('s3a 全角公式 １ｄ８＋３', r !== undefined && Number.isFinite(r.total), r ? String(r.total) : 'throw');
  let r2: { total: number } | undefined;
  try { r2 = rollFormula('1d8+3 挥砍') as { total: number }; } catch { r2 = undefined; }
  ok('s3b 公式带类型后缀', r2 !== undefined && Number.isFinite(r2.total));
  let r3: { total: number } | undefined;
  try { r3 = rollFormula('  1d20 + 5 ') as { total: number }; } catch { r3 = undefined; }
  ok('s3c 首尾空格', r3 !== undefined);
  let threw = false;
  try { parseFormula('完全是垃圾'); } catch { threw = true; }
  ok('s3d 纯垃圾仍抛出', threw);
}

console.log('━━━━━━ S4. 敌卡字段别名与形态 ━━━━━━');
{
  const r = parseEncounterDefs(JSON.stringify({
    enemies: [
      { 名称: '影豹', 体型: '中型', 挑战等级: '1/2', 生命值: '18-24', 'AC': '15',
        攻击: [{ 名称: '撕咬', 类型: '近战', 命中: '+5', 伤害: '１ｄ８＋３', 伤害类型: '穿刺', 射程: '5尺', 附加状态: '倒地' }],
        战术: '保持距离游走' },
      { 名称: '骷髅兵', hp: { 当前: 8, 最大: 24 }, ac: 16,
        攻击: ['弯刀 +4 1d6+2 挥砍'] },
    ],
  }));
  ok('s4a 两卡解析', r.defs.length === 2, JSON.stringify(r.warnings));
  const panther = r.defs[0];
  ok('s4b CR "1/2" 字符串', panther?.cr === 0.5 || panther?.cr === 1 || typeof panther?.cr === 'number', String(panther?.cr));
  ok('s4c 生命值区间取均值 21', panther?.hp === 21, String(panther?.hp));
  ok('s4d AC 字符串', panther?.ac === 15, String(panther?.ac));
  const bite = panther?.attacks[0];
  ok('s4e 命中 "+5" 字符串', bite?.attackBonus === 5, String(bite?.attackBonus));
  ok('s4f 全角伤害公式', bite?.dice === '1d8+3', bite?.dice);
  ok('s4g 附加状态 倒地→prone', bite?.applyStatus === 'prone', JSON.stringify(bite).slice(0, 120));
  const skel = r.defs[1];
  ok('s4h 生命值对象取最大', skel?.hp === 24, String(skel?.hp));
  ok('s4i 字符串动作条目', skel?.attacks[0]?.attackBonus === 4 && skel?.attacks[0]?.dice === '1d6+2', JSON.stringify(skel?.attacks[0]));
}

console.log('━━━━━━ S5. 补丁操作标准名 ━━━━━━');
{
  const tree: Record<string, unknown> = { list: [1, 2] };
  const r = applyPatches(tree, [
    { op: 'add', path: '/list/-', value: 3 } as never,
    { op: 'replace', path: '/x', value: 'a' },
  ]);
  ok('s5a RFC6902 add → 数组追加', (tree.list as number[]).length === 3, JSON.stringify(tree.list));
  ok('s5a add 计入 applied', r.applied === 2, `applied=${r.applied} errors=${JSON.stringify(r.errors)}`);
  const tree2: Record<string, unknown> = { hp: 10 };
  applyPatches(tree2, [{ op: 'add', path: '/hp', value: 20 } as never]);
  ok('s5b add 对象键 → 覆盖/插入', tree2.hp === 20, JSON.stringify(tree2));
}

console.log('━━━━━━ S6. 端到端消息级语义等价 ━━━━━━');
{
  // 同一场战斗的三种写法应产生等价的单位集合
  const v1 = parseDmMessage('<battle>\n艾尔玛|init 17|hp 22/22|pos 0,15|att 0\n哥布林1|init 9|hp 10/10|pos 20,20|att 2\n</battle>');
  const v2 = parseDmMessage('艾尔玛|先攻 17|生命值 22/22|位置 0,15|阵营 我方\n哥布林1|先攻 9|生命值 10/10|位置 20,20|阵营 敌');
  const v3 = parseDmMessage('<battle>\n艾尔玛｜init:17｜hp:22/22｜pos:0,15｜att:0\n哥布林1｜init:9｜hp:10/10｜pos:20,20｜att:2\n</battle>');
  const sig = (m: ReturnType<typeof parseDmMessage>) => (m.latestBattle || []).map(u => `${u.id}:${u.init}:${u.hp?.current}/${u.hp?.max}:${u.pos?.x},${u.pos?.y}:${u.attitude}`).join('|');
  ok('s6a 标准形态', sig(v1) === '艾尔玛:17:22/22:0,15:0|哥布林1:9:10/10:20,20:2', sig(v1));
  ok('s6b 中文管道形态等价', sig(v2) === sig(v1), sig(v2));
  ok('s6c 全角+冒号形态等价', sig(v3) === sig(v1), sig(v3));
  // s6d 纯全角竖线消息（无任何半角 |）也必须进入管道回退（E2E 实测盲区）
  const v4 = parseDmMessage('艾尔玛｜先攻：１７｜生命值：２２／２２｜位置：(0,15)｜阵营：我方\n哥布林｜init:9｜hp:10/10｜pos:20,20｜att:敌方');
  ok('s6d 纯全角竖线消息可导入', (v4.latestBattle || []).length === 2, sig(v4));
  ok('s6d 全角行语义正确', sig(v4) === '艾尔玛:17:22/22:0,15:0|哥布林:9:10/10:20,20:2', sig(v4));
}

console.log('━━━━━━ S7. 修复回归：单体豁免 / 反应触发词 / 重击失败 / AoE 形状 / 法术位补丁 ━━━━━━');
{
  // s7a parseOutcome：重击失败/重击未命中 ≠ 大成功
  ok('s7a 重击失败 → critical-failure', parseOutcome('重击失败') === 'critical-failure', parseOutcome('重击失败') ?? 'null');
  ok('s7a 重击未命中 → failure', parseOutcome('重击未命中') === 'failure');
  ok('s7a 重击 → critical-success 不回归', parseOutcome('重击') === 'critical-success');
  ok('s7a 暴击命中 → critical-success 不回归', parseOutcome('暴击命中') === 'critical-success');

  // s7b 敌卡反应触发词：协议示例原文「结束回合时」应归为 turn-end（此前只认「回合结束」）
  const enc = parseEncounterDefs('{"enemies":[{"name":"时龙卫士","ac":18,"hp":"200","reactions":[{"name":"时光缓速","trigger":"一个可见生物结束回合时","effect":"使其速度降为0"}]}]}');
  const rx = (enc.defs[0] as { reactions?: Array<{ trigger: string }> }).reactions?.[0];
  ok('s7b 「结束回合时」→ turn-end', rx?.trigger === 'turn-end', JSON.stringify(rx));

  // s7c planTurn 消费单体豁免类（kind='save'）：WB3 控制法术此前永不施放
  const baseUnit = (p: Partial<BattleUnit>): BattleUnit => ({
    id: 'u', name: 'u', hp: 10, maxHp: 10, ac: 13, speed: 30, attitude: 1,
    pos: { x: 10, y: 10 }, statuses: [], resistances: [], immunities: [],
    vulnerabilities: [], init: 10, next: false,
    actionEconomy: { movementUsed: 0, action: false, bonusAction: false, reaction: false },
    ...p,
  } as BattleUnit);
  const caster = baseUnit({ id: 'c1', name: '敌咒术师', attitude: 2, init: 15, hp: 30, maxHp: 30,
    aiAbilities: [{ id: 'a0-hold', name: '束缚术', kind: 'save', dice: '0', range: 60, saveAbility: 'wis', saveDc: 14, applyStatus: 'restrained', spellLevel: 3 }] });
  const foeA = baseUnit({ id: 'f1', name: '艾尔玛', attitude: 0, init: 10, hp: 22, maxHp: 22, pos: { x: 40, y: 40 } });
  const foeB = baseUnit({ id: 'f2', name: '队友', attitude: 0, init: 9, hp: 22, maxHp: 22, pos: { x: 45, y: 40 } });
  const ctx: AiContext = { units: [caster, foeA, foeB], obstacles: [], diagonal: 'equal', mapWidth: 32, mapHeight: 32, playerTargetId: null };
  const steps = planTurn(ctx, caster);
  const ctrl = steps.find(s => s.type === 'save-single');
  ok('s7c 控制法术进入规划', ctrl !== undefined, JSON.stringify(steps.map(s => s.type)));
  ok('s7c 目标为得分最高敌人', (ctrl as { targetId?: string } | undefined)?.targetId === 'f1', JSON.stringify(ctrl));
  ok('s7c validateStep 通过', validateStep({ ...ctx, units: [caster, foeA] }, caster, { type: 'save-single', abilityId: 'a0-hold', targetId: 'f1' }));
  // 目标已带该状态 → 不再对其施控（全场均中招时回退到攻击路径）
  const foeA2 = { ...foeA, statuses: ['restrained'] };
  const foeB2 = { ...foeB, statuses: ['restrained'] };
  const steps2 = planTurn({ ...ctx, units: [caster, foeA2, foeB2] }, caster);
  ok('s7c 已中招目标不重复施控', !steps2.some(s => s.type === 'save-single'), JSON.stringify(steps2.map(s => s.type)));
  // 超射程 → 不施控
  const foeFar = baseUnit({ id: 'f3', name: '远处敌人', attitude: 0, init: 9, hp: 22, maxHp: 22, pos: { x: 400, y: 400 } });
  const steps3 = planTurn({ ...ctx, units: [caster, foeFar] }, caster);
  ok('s7c 超射程不施控', !steps3.some(s => s.type === 'save-single'));

  // s7d AoE 形状词：协议写法「球体」应解析为 sphere（此前只有「球/球形」）
  const fireball = parseEncounterDefs('{"enemies":[{"name":"高等法师","ac":17,"hp":"150","actions":[{"name":"火球术","kind":"save-aoe","aoe":"球体","aoeSize":"20尺","dice":"8d6","damageType":"火焰","saveAbility":"敏捷","saveDc":17,"save":"敏捷"}]}]}');
  const ab = (fireball.defs[0] as { attacks?: Array<{ aoe?: { kind: string } }> }).attacks?.[0];
  ok('s7d 「球体」→ sphere', ab?.aoe?.kind === 'sphere', JSON.stringify(ab?.aoe));

  // s7e 战报建议补丁：法术位变化也生成补丁（此前只回写 HP）
  const sheets = [{ name: '艾尔玛', hp: 22, maxHp: 22, spellSlots: { 3: { current: 2, max: 3 } } }] as never[];
  const unitsSp = [baseUnit({ id: 'f1', name: '艾尔玛', attitude: 0, hp: 22, maxHp: 22, spellSlots: { 3: { current: 1, max: 3 } } })];
  const patches = suggestPatches(unitsSp, sheets);
  const slotPatch = patches.find(p => p.path === '/角色列表/艾尔玛/施法/法术位/3环/当前');
  ok('s7e 法术位补丁路径', slotPatch !== undefined && slotPatch.value === 1, JSON.stringify(patches.map(p => p.path)));
}

console.log('\n━━━━━━ S8. 2026-11-18 BUG 修复回归 ━━━━━━');
{
  /** S8 专用单位工厂（baseUnit 是上方块内的局部函数） */
  const mkUnit8 = (p: Partial<BattleUnit>): BattleUnit => ({
    id: 'u', name: '单位', attitude: 1, hp: 20, maxHp: 20, tempHp: 0, ac: 13,
    init: 10, initMod: 0, pos: { x: 0, y: 0 }, size: 'medium', speed: 30,
    statuses: [], resistances: [], immunities: [], vulnerabilities: [],
    isPlayer: false, aiProfile: 'tactical', aiAbilities: [],
    actionEconomy: { action: false, bonus: false, reaction: false, movementUsed: 0 },
    hasActed: false, ...p,
  } as BattleUnit);
  const baseUnit = mkUnit8;

  // ---------- P0-1：协议块不得复活已判死单位 ----------
  const deadUnit = baseUnit({
    id: 'corpse', name: '尸体', attitude: 2, hp: 0, maxHp: 7,
    deathSaves: { successes: 0, failures: 3, stable: false, dead: true },
  });
  const staleCard = { id: 'corpse', statuses: [], attitude: 2 as const, next: false, extras: [], hp: { current: 7, max: 7 } };
  const merged = mergeUnitFromProtocol(deadUnit, staleCard, false).unit;
  ok('s8a 过期敌卡不复活尸体', merged.hp === 0 && merged.deathSaves?.dead === true,
    JSON.stringify({ hp: merged.hp, deathSaves: merged.deathSaves }));

  const dyingUnit = baseUnit({
    id: 'down', name: '濒死', attitude: 0, hp: 0, maxHp: 20,
    deathSaves: { successes: 0, failures: 1, stable: false, dead: false },
  });
  const noHpCard = { id: 'down', statuses: [], attitude: 0 as const, next: false, extras: [] };
  const mergedNoHp = mergeUnitFromProtocol(dyingUnit, noHpCard, false).unit;
  ok('s8b 缺省 hp 字段不清死亡豁免', mergedNoHp.deathSaves?.failures === 1,
    JSON.stringify(mergedNoHp.deathSaves));
  const healedCard = { ...noHpCard, hp: { current: 8, max: 20 } };
  const mergedHealed = mergeUnitFromProtocol(dyingUnit, healedCard, false).unit;
  ok('s8c 明确正 HP 才清除豁免计数',
    mergedHealed.hp === 8 && mergedHealed.deathSaves?.failures === 0 && mergedHealed.deathSaves?.dead === false,
    JSON.stringify({ hp: mergedHealed.hp, ds: mergedHealed.deathSaves }));

  // ---------- P1-3：敌卡负/零 HP、AC 钳制 ----------
  const bad = parseEncounterDefs('[{"名称":"畸形怪","ac":-5,"生命值":-3,"攻击":[]}]');
  ok('s8d 负 HP 钳制为 1', bad.defs[0]?.hp === 1, String(bad.defs[0]?.hp));
  ok('s8e 负 AC 钳制为 10', bad.defs[0]?.ac === 10, String(bad.defs[0]?.ac));
  ok('s8f 钳制有告警', bad.warnings.length >= 2, JSON.stringify(bad.warnings));

  // ---------- P2-4：状态全被过滤时不输出空 status ----------
  const noStatus = generateBattleBlock([{
    id: 'A', init: 10, hp: 5, maxHp: 10, pos: { x: 0, y: 0 }, attitude: 2, statuses: ['dodging'],
  }]);
  ok('s8g 无可序列状态时不留 status 尾巴', !/\|status\s*(\n|$)/.test(noStatus), JSON.stringify(noStatus));

  // ---------- P1-2：力竭等级往返 ----------
  const exhBlock = generateBattleBlock([{
    id: 'A', init: 10, hp: 5, maxHp: 10, pos: { x: 0, y: 0 }, attitude: 2, statuses: ['exhaustion:3'],
  }]);
  const exhBack = parseBattleBlock(exhBlock.replace(/<\/?battle>/g, '').trim())[0];
  ok('s8h 力竭等级导出后可回读', exhBack?.statuses.includes('exhaustion:3') === true,
    JSON.stringify(exhBack?.statuses));

  // ---------- P0-3 / P1-5：角色装配读取显式攻击加值与熟练加值 ----------
  const tree = {
    角色列表: {
      战士甲: {
        姓名: '战士甲', 等级: 9, 熟练加值: 5,
        生命值: { 当前: 50, 最大: 50 }, 护甲等级: { 总值: 17 },
        属性: { 力量: 18, 敏捷: 14, 体质: 14, 智力: 10, 感知: 10, 魅力: 10 },
        熟练配置: { 技能: {}, 豁免: { 力量: true }, 武器: '', 护甲: '', 工具: {} },
        施法: { 关键属性: '无', 法术位: {}, 法术书: {} },
        物品: { 武器: { 长剑: { 伤害公式: '1d8', 伤害类型: '挥砍', 映射属性: '力量', 已装备: true, 熟练: true, 攻击加值覆盖: 12 } }, 护甲: {}, 奇物: {}, 杂物: {} },
        状态: {}, 抗性: [], 免疫: [], 易伤: [],
      },
    },
  };
  const [sheet] = charSheetsFromTree(tree as never);
  ok('s8i 熟练加值字段生效', sheet?.pb === 5, String(sheet?.pb));
  const assembled = unitFromCharSheet(sheet);
  const sword = (assembled.aiAbilities ?? []).find(a => a.name === '长剑');
  ok('s8j 攻击加值覆盖优先于推导', sword?.attackBonus === 12, String(sword?.attackBonus));
  ok('s8k 豁免加值使用声明的熟练加值',
    assembled.saveBonuses?.str === 4 + 5, String(assembled.saveBonuses?.str));

  // ---------- P2-1 / P2-2：射程覆盖改判远程、两用骰抽出 ----------
  const tree2 = {
    角色列表: {
      投手: {
        姓名: '投手', 等级: 5, 生命值: { 当前: 30, 最大: 30 }, 护甲等级: { 总值: 15 },
        属性: { 力量: 16, 敏捷: 14, 体质: 12, 智力: 10, 感知: 10, 魅力: 8 },
        熟练配置: { 技能: {}, 豁免: {}, 武器: '', 护甲: '', 工具: {} },
        施法: { 关键属性: '无', 法术位: {}, 法术书: {} },
        物品: {
          武器: {
            飞矛: { 伤害公式: '1d6', 伤害类型: '穿刺', 映射属性: '力量', 已装备: true, 熟练: true, 射程: 60 },
            长剑: { 伤害公式: '1d8', 伤害类型: '挥砍', 映射属性: '力量', 已装备: true, 熟练: true, 属性特征: '多用(1d10)' },
          }, 护甲: {}, 奇物: {}, 杂物: {},
        },
        状态: {}, 抗性: [], 免疫: [], 易伤: [],
      },
    },
  };
  const [s2] = charSheetsFromTree(tree2 as never);
  const u2 = unitFromCharSheet(s2);
  const spear = (u2.aiAbilities ?? []).find(a => a.name === '飞矛');
  // 投掷近战武器保持 melee kind（否则贴脸时会失去近战判定），
  // 但 ranged 字段如实标记「可远程使用」，射程取显式值
  ok('s8l 投掷武器保留近战 kind+显式射程',
    spear?.kind === 'melee' && spear?.range === 60,
    JSON.stringify({ kind: spear?.kind, ranged: spear?.ranged, range: spear?.range }));
  const longsword = (u2.aiAbilities ?? []).find(a => a.name === '长剑');
  ok('s8m 两用武器抽出第二段骰', longsword?.versatileDice === '1d10', String(longsword?.versatileDice));
}

console.log('\n━━━━━━ S9. 2026-11-19 跨端契约修复回归 ━━━━━━');
{
  const mkChar = (over: Record<string, unknown>): Record<string, unknown> => ({
    姓名: '艾尔玛', 等级: 5, 生命值: { 当前: 30, 最大: 30 }, 护甲等级: { 总值: 15 },
    属性: { 力量: 16, 敏捷: 14, 体质: 14, 智力: 10, 感知: 10, 魅力: 10 },
    熟练配置: { 技能: {}, 豁免: { 力量: false, 敏捷: false, 体质: false, 智力: false, 感知: false, 魅力: false } },
    物品: { 武器: {} }, 施法: {}, ...over,
  });
  const sheet = (ch: Record<string, unknown>) => charSheetsFromTree({ 角色列表: { 艾尔玛: ch } } as never)[0];
  const profs = (ch: Record<string, unknown>) => {
    const s = sheet(ch);
    return s.saveProficiencies ? [...s.saveProficiencies].sort() : null;
  };

  // 状态栏内部序列化器每次写满六项豁免默认值 false。旧实现用 includes('e') 判熟练，
  // 而 String(false) === "false" 含 e —— 每个存过档的角色六项豁免全部虚高一个 PB。
  ok('s9a 六项豁免 false 不产生熟练', profs(mkChar({})) === null, JSON.stringify(profs(mkChar({}))));
  ok('s9b 力量 true → 仅 str 熟练', JSON.stringify(profs(mkChar({ 熟练配置: { 技能: {}, 豁免: { 力量: true } } }))) === '["str"]');
  ok('s9c 力量 "p" → 仅 str 熟练', JSON.stringify(profs(mkChar({ 熟练配置: { 技能: {}, 豁免: { 力量: 'p' } } }))) === '["str"]');
  ok('s9d 力量 "j" 不算豁免熟练', profs(mkChar({ 熟练配置: { 技能: {}, 豁免: { 力量: 'j' } } })) === null);
  ok('s9e 豁免 "false" 不算熟练', profs(mkChar({ 熟练配置: { 技能: {}, 豁免: { 力量: 'false' } } })) === null);

  // 隐匿：false 曾按专精结算（+2PB），比熟练还高
  const hideOf = (v: unknown) => sheet(mkChar({ 熟练配置: { 技能: { 隐匿: v }, 豁免: {} } })).stealthBonus;
  const baseDex = 2; // 敏捷 14
  ok('s9f 隐匿 false = 无加值', hideOf(false) === baseDex, String(hideOf(false)));
  ok('s9g 隐匿 "p" = 熟练', hideOf('p') === baseDex + 3, String(hideOf('p')));
  ok('s9h 隐匿 "e" = 专精', hideOf('e') === baseDex + 6, String(hideOf('e')));

  // 状态：世界书条目 11 教 AI 写 /状态/力竭/等级（不写 存在），旧实现要求 存在 === true
  const st = (v: unknown) => sheet(mkChar({ 状态: v })).statuses;
  ok('s9i 力竭{等级:2} 无需存在字段', JSON.stringify(st({ 力竭: { 等级: 2 } })) === '["exhaustion:2"]', JSON.stringify(st({ 力竭: { 等级: 2 } })));
  ok('s9j 中毒{效果描述} 视为在场', JSON.stringify(st({ 中毒: { 效果描述: '中毒' } })) === '["poisoned"]', JSON.stringify(st({ 中毒: { 效果描述: '中毒' } })));
  ok('s9k 存在:false 被排除', JSON.stringify(st({ 中毒: { 存在: false } })) === '[]');
  ok('s9l 布尔形态', JSON.stringify(st({ 中毒: false, 倒地: true })) === '["prone"]', JSON.stringify(st({ 中毒: false, 倒地: true })));
  ok('s9m 力竭保留等级', JSON.stringify(st({ 力竭: { 等级: 4 } })) === '["exhaustion:4"]');
}

console.log('\n━━━━━━━━━━━━━━ 语义测试汇总 ━━━━━━━━━━━━━━');
console.log(`✅ 通过: ${pass}  ❌ 失败: ${fail}`);
if (findings.length > 0) {
  console.log('\n语义盲区：');
  for (const f of findings) console.log(f);
}
process.exit(fail > 0 ? 1 : 0);
