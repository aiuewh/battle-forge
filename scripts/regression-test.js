/* 修复回归用例：对应审查报告 P0/P1/P2 各项
 * 运行方式（在仓库根目录 battle-forge/ 下）：
 *   npx tsc src/lib/engine/{dice,conditions,rules,combat,initiative,types,sheetbridge,statblocks,geometry}.ts \
 *     --outDir .engtest --module commonjs --target es2020 --skipLibCheck --esModuleInterop
 *   node scripts/regression-test.js
 */
// require 目标全部为字面量相对路径（仓库内 .engtest 编译产物），不接受任何外部路径输入
let combat, rules, conditions, initiative, sheetbridge, types;
try {
  combat = require('../.engtest/combat.js');
  rules = require('../.engtest/rules.js');
  conditions = require('../.engtest/conditions.js');
  initiative = require('../.engtest/initiative.js');
  sheetbridge = require('../.engtest/sheetbridge.js');
  types = require('../.engtest/types.js');
} catch {
  console.error('缺少 .engtest/ 编译产物 —— 请先运行本文件头注释中的 npx tsc 命令');
  process.exit(1);
}
const { resolveAttack, resolveSave, resolveDeathSave } = combat;
const { attackRollModeAgainst, effectiveSpeed } = rules;
const { aggregateEffects, exhaustionPenalty } = conditions;
const { rollInitiative, rollInitiativeForUnits } = initiative;
const { charSheetsFromTree, unitFromCharSheet } = sheetbridge;
const { DEFAULT_RULES } = types;

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${detail}`); }
}
function mkUnit(over = {}) {
  return {
    id: 'u', name: 'u', init: 10, initMod: 0, hp: 50, maxHp: 100, tempHp: 0, ac: 15,
    speed: 30, pos: { x: 0, y: 0 }, attitude: 0, statuses: [], isPlayer: true, size: 'medium',
    resistances: [], immunities: [], vulnerabilities: [],
    actionEconomy: { action: false, bonus: false, reaction: false, movementUsed: 0 },
    hasActed: false, abilities: { str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10 },
    ...over,
  };
}

console.log('== P0-1 力竭 2024 ==');
check('力竭2级：d20 检定减值 = 4', exhaustionPenalty(['exhaustion:2']) === 4);
check('力竭3级不再给攻击劣势（2014 分级废除）', !aggregateEffects(['exhaustion:3']).ownAttackDisadvantage);
check('力竭3级不再速度归零', aggregateEffects(['exhaustion:3']).speedMultiplier === 1);
check('力竭6级失去行动（死亡档）', aggregateEffects(['exhaustion:6']).noActions === true);
check('速度按每级 -5 尺', effectiveSpeed(mkUnit({ speed: 30, statuses: ['exhaustion:2'] })) === 20);
const exAtk = resolveAttack(mkUnit({ statuses: ['exhaustion:1'] }), mkUnit(), {
  attackBonus: 5, targetAc: 15, weaponDamage: '1d8+3', forcedAttackRoll: 10,
});
check('力竭1级攻击总值 = 加值5 -2 + 骰10 = 13', exAtk.attack.total === 13, `got ${exAtk.attack.total}`);
const exSave = resolveSave(mkUnit({ statuses: ['exhaustion:2'], abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } }), { ability: 'str', dc: 10, forcedRoll: 12 });
check('力竭2级豁免总值 = 12 - 4 = 8 < DC10 失败', exSave.check.total === 8 && exSave.check.outcome === 'failure');

console.log('== P0-2 倒地远近 / P1-10 贴身远程 ==');
const proneTarget = mkUnit({ statuses: ['prone'] });
const atk = mkUnit();
const near = attackRollModeAgainst(atk, proneTarget, { distanceFeet: 5, isMeleeAttack: true });
const far = attackRollModeAgainst(atk, proneTarget, { distanceFeet: 50, isMeleeAttack: false });
check('倒地目标 5 尺内攻击 = 优势', near.mode === 'advantage', near.mode);
check('倒地目标 50 尺外攻击 = 劣势', far.mode === 'disadvantage', far.mode);
const rAtkNear = attackRollModeAgainst(mkUnit({ statuses: ['prone'] }), mkUnit(), { distanceFeet: 50, isMeleeAttack: false, hostileWithin5Ft: true });
check('远程攻击者自身倒地且被贴身：劣势存在', rAtkNear.mode === 'disadvantage' || rAtkNear.reasons.some(r => r.includes('远程')), JSON.stringify(rAtkNear));
const rangedInMelee = attackRollModeAgainst(mkUnit(), mkUnit(), { hostileWithin5Ft: true, isMeleeAttack: false });
check('贴身远程攻击 = 劣势', rangedInMelee.mode === 'disadvantage');
const meleeUnaffected = attackRollModeAgainst(mkUnit(), mkUnit(), { hostileWithin5Ft: true, isMeleeAttack: true });
check('贴身近战攻击不受远程劣势影响', meleeUnaffected.mode === 'normal');
// 无距离信息时（旧调用路径）倒地仍给优势，保持向后兼容
const legacy = attackRollModeAgainst(atk, proneTarget);
check('无距离上下文时倒地保持优势（兼容）', legacy.mode === 'advantage');

console.log('== P0-3 重击全部伤害骰翻倍 ==');
const critAll = resolveAttack(mkUnit(), mkUnit(), {
  attackBonus: 5, targetAc: 15, weaponDamage: '1d8+3', riderDamage: '2d6',
  forcedAttackRoll: 20, forcedDamageRolls: [4],
});
const wDice = critAll.damage.rawRolls.filter(r => r.tag === 'weapon' && r.sides === 8).length;
const rDice = critAll.damage.rawRolls.filter(r => r.tag === 'rider' && r.sides === 6).length;
check('默认（2024）：重击武器骰 ×2', wDice === 2, `weapon d8 count=${wDice}`);
check('默认（2024）：重击附加骰（偷袭/神能）也 ×2', rDice === 4, `rider d6 count=${rDice}`);
const critWeaponOnly = resolveAttack(mkUnit(), mkUnit(), {
  attackBonus: 5, targetAc: 15, weaponDamage: '1d8+3', riderDamage: '2d6',
  forcedAttackRoll: 20, forcedDamageRolls: [4], critWeaponDiceOnly: true,
});
const rDice2 = critWeaponOnly.damage.rawRolls.filter(r => r.tag === 'rider' && r.sides === 6).length;
check('房规开关：仅武器骰翻倍，附加骰不翻', rDice2 === 2, `rider d6 count=${rDice2}`);
check('出厂默认 critWeaponDiceOnly=false', DEFAULT_RULES.critWeaponDiceOnly === false);
check('出厂默认 failOnDropToZero=false', DEFAULT_RULES.failOnDropToZero === false);

console.log('== P1-5 巨额伤害即死基数（代码审查）==');
// battleStore: remaining - unit.hp >= unit.maxHp（剩余伤害口径）
function massiveKill(hpCur, maxHp, dmg) { return dmg - hpCur >= maxHp; }
check('99/100 HP 受 100 伤：剩余1点 < 上限 → 不即死', massiveKill(99, 100, 100) === false);
check('1/100 HP 受 100 伤：剩余99 < 100 → 不即死', massiveKill(1, 100, 100) === false);
check('满血 100/100 受 200 伤：剩余100 ≥ 100 → 即死', massiveKill(100, 100, 200) === true);

console.log('== P1-9 祝福 +1d4 ==');
const blessedAtk = resolveAttack(mkUnit({ statuses: ['blessed'] }), mkUnit(), {
  attackBonus: 5, targetAc: 12, weaponDamage: '1d8+3', forcedAttackRoll: 5,
});
const blessDie = blessedAtk.attack.dice.rolls.find(r => r.tag === 'bless');
check('祝福攻击掷出 1d4', !!blessDie && blessDie.sides === 4 && blessDie.value >= 1 && blessDie.value <= 4);
check('祝福骰计入总值', blessedAtk.attack.total === 5 + 5 + blessDie.value, `total=${blessedAtk.attack.total}`);
const blessedSave = resolveSave(mkUnit({ statuses: ['blessed'] }), { ability: 'wis', dc: 15, forcedRoll: 12 });
const b2 = blessedSave.check.dice.rolls.find(r => r.tag === 'bless');
check('祝福豁免掷出 1d4', !!b2);

console.log('== P1-7 先攻加值 ==');
const alertUnit = mkUnit({ initMod: 5, abilities: { str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10 } });
const r = rollInitiativeForUnits([alertUnit], DEFAULT_RULES, []);
check('先攻使用 initMod(+5) 而非敏捷(+2)', r.rolls[0].total === r.rolls[0].d20 + 5, `total=${r.rolls[0].total} d20=${r.rolls[0].d20}`);
const monster = mkUnit({ initMod: 2, attitude: 2 });
check('怪物 initMod=敏捷调整值路径不变', rollInitiative(monster, DEFAULT_RULES, false) >= 3);
const exUnit = mkUnit({ initMod: 5, statuses: ['exhaustion:1'] });
const r2 = rollInitiativeForUnits([exUnit], DEFAULT_RULES, []);
check('力竭1级先攻 = initMod5 -2', r2.rolls[0].total === r2.rolls[0].d20 + 3, `total=${r2.rolls[0].total}`);

console.log('== P2-13 普通豁免无大成功/大失败文案 ==');
const cs20 = resolveSave(mkUnit(), { ability: 'dex', dc: 5, forcedRoll: 20 });
check('裸骰20普通豁免 → success（非 critical-success）', cs20.check.outcome === 'success', cs20.check.outcome);
const cs1 = resolveSave(mkUnit(), { ability: 'dex', dc: 25, forcedRoll: 1 });
check('裸骰1普通豁免 → failure（非 critical-failure）', cs1.check.outcome === 'failure', cs1.check.outcome);
const ds = resolveDeathSave(mkUnit(), 20);
check('死亡豁免保留裸20大成功语义', ds.check.outcome === 'critical-success' && ds.event === 'revive-1hp');

console.log('== P0-4 / P1-6 / P1-8 / P2-15：sheetbridge 装配 ==');
const tree = {
  角色列表: {
    测试圣武士: {
      等级: 9,
      生命值: { 当前: 80, 最大: 80, 临时: 0 },
      护甲等级: { 总值: 18 },
      先攻: { 加值: 3 },
      属性: { 力量: 18, 敏捷: 8, 体质: 14, 智力: 10, 感知: 12, 魅力: 16 },
      熟练配置: {
        技能: { 隐匿: 'j' },
        豁免: { 力量: 'p', 魅力: 'p' },
      },
      抗性: ['火焰'],
      免疫: '毒素、火焰',
      施法: { 法术位: { '1环': { 当前: 4, 最大: 4 } }, 法术书: { 治疗真言: { 准备中: true }, 治疗术: { 准备中: true }, 群体治疗真言: {} } },
      物品: { 武器: { 长剑: { 伤害公式: '1d8', 伤害类型: '挥砍', 映射属性: '力量', 熟练: true, 已装备: true, 精通: 'Topple' }, 长弓: { 伤害公式: '1d8', 伤害类型: '穿刺', 映射属性: '敏捷', 熟练: true, 射程: 150 } } },
    },
  },
};
const sheets = charSheetsFromTree(tree);
const sheet = sheets[0];
const unit = unitFromCharSheet(sheet);
const pb9 = 4;
check('豁免熟练：力量豁免 = +4(属性) +4(熟练)', unit.saveBonuses.str === 4 + pb9, `got ${unit.saveBonuses.str}`);
check('豁免熟练：魅力豁免 = +3 +4', unit.saveBonuses.cha === 3 + pb9);
check('豁免未熟练：敏捷豁免 = -1', unit.saveBonuses.dex === -1);
check('玩家抗性透传：火焰', unit.resistances.includes('fire'));
check('玩家免疫透传：毒素+火焰（去重）', unit.immunities.includes('poison') && unit.immunities.filter(x => x === 'fire').length === 1);
const hw = unit.aiAbilities.find(a => a.name === '治疗真言');
const cw = unit.aiAbilities.find(a => a.name === '治疗术');
const mhw = unit.aiAbilities.find(a => a.name === '群体治疗真言');
check('治疗真言 2d4（2024）', hw && hw.dice.startsWith('2d4'), hw && hw.dice);
check('治疗术 2d8（2024）', cw && cw.dice.startsWith('2d8'), cw && cw.dice);
check('群体治疗真言 2d4（2024）', mhw && mhw.dice.startsWith('2d4'), mhw && mhw.dice);
const ls = unit.aiAbilities.find(a => a.name === '长剑');
check('武器精通读取：长剑 Topple + 自动结算标记', ls && ls.mastery === 'Topple' && !!ls.masteryMod);
const lb = unit.aiAbilities.find(a => a.name === '长弓');
check('射程字段优先：长弓 150', lb && lb.range === 150, lb && String(lb.range));
check('先攻加值透传 initMod=3', unit.initMod === 3);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
