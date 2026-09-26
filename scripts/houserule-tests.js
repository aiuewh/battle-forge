"use strict";
/* 房规模块化 + 玩家侧结构化动作 新功能测试
 * 运行方式（在仓库根目录 battle-forge/ 下）：
 *   npx tsc -p tsconfig.engtest.json
 *   node scripts/houserule-tests.js
 * require 目标全部为字面量相对路径（仓库内 .engtest_run 编译产物），不接受任何外部路径输入
 * 覆盖: normalizeRules 兼容映射 / critMode 三分支 / fixed10 固定先攻 /
 *       parseAttack 施法占位符 / charSheetsFromTree 自设结构化法术与特性动作 / HOUSE_RULE_MODULES 注册表完整性
 */
Object.defineProperty(exports, "__esModule", { value: true });
const rules_1 = require("../.engtest_run/src/lib/engine/rules");
const types_1 = require("../.engtest_run/src/lib/engine/types");
const combat_1 = require("../.engtest_run/src/lib/engine/combat");
const initiative_1 = require("../.engtest_run/src/lib/engine/initiative");
const statblocks_1 = require("../.engtest_run/src/lib/engine/statblocks");
const sheetbridge_1 = require("../.engtest_run/src/lib/engine/sheetbridge");

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail) {
    if (ok) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; failures.push(name); console.log(`  ❌ ${name}${detail ? ' —— ' + detail : ''}`); }
}

// ============ 1. normalizeRules 兼容映射 ============
console.log('\n── normalizeRules（旧持久化兼容） ──');
{
    const r1 = (0, types_1.normalizeRules)({ critWeaponDiceOnly: true });
    check('旧布尔 true → critMode=weapon-dice-only', r1.critMode === 'weapon-dice-only');
    const r2 = (0, types_1.normalizeRules)({ critWeaponDiceOnly: false });
    check('旧布尔 false → critMode=full-double', r2.critMode === 'full-double');
    const r3 = (0, types_1.normalizeRules)({ critWeaponDiceOnly: true, critMode: 'max-plus-roll' });
    check('显式 critMode 优先于旧布尔', r3.critMode === 'max-plus-roll' && r3.critWeaponDiceOnly === undefined);
    const r4 = (0, types_1.normalizeRules)({ minDamageOne: true });
    check('无旧布尔时不注入 critMode', r4.critMode === undefined);
}

// ============ 2. HOUSE_RULE_MODULES 注册表完整性 ============
console.log('\n── HOUSE_RULE_MODULES 注册表 ──');
{
    const base = { ...(0, types_1.DEFAULT_RULES) };
    let allFieldsExist = true, missing = [];
    for (const m of types_1.HOUSE_RULE_MODULES) {
        if (!(m.field in base)) { allFieldsExist = false; missing.push(m.field); }
        // enum 模块：当前默认值必须在 choices 里
        if (m.choices && !m.choices.some(c => c.value === base[m.field])) {
            allFieldsExist = false; missing.push(`${m.field}(默认值不在choices)`);
        }
    }
    check(`全部 ${types_1.HOUSE_RULE_MODULES.length} 个模块的 field 存在于 DEFAULT_RULES`, allFieldsExist, missing.join(', '));
    const groups = new Set(types_1.HOUSE_RULE_MODULES.map(m => m.group));
    check('注册表分组 ≥ 5（重击/濒死/先攻/动作经济/伤害/战场）', groups.size >= 5, [...groups].join(' | '));
    // 来源徽标完整性
    const srcOk = types_1.HOUSE_RULE_MODULES.every(m => types_1.HOUSE_RULE_SOURCE_LABEL[m.source]);
    check('全部模块来源均有徽标文案', srcOk);
}

// ============ 3. critMode 三分支结算 ============
console.log('\n── critMode 重击三分支（combat.ts） ──');
function mkUnit(hp) {
    return {
        id: 'u1', name: '测试单位', size: 'medium', init: 0, initMod: 0, hp, maxHp: hp, tempHp: 0,
        ac: 10, speed: 30, pos: { x: 0, y: 0 }, attitude: 2, statuses: [], isPlayer: false,
        playerControlled: false, level: 1, abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
        actionEconomy: { action: false, bonus: false, reaction: false, movementUsed: 0 }, hasActed: false,
    };
}
{
    // 强制重击（裸20）+ 固定伤害骰面：武器 1d6+3（骰面固定 2），无 rider
    // max-plus-roll 期望 = 6(取满) + 2(再掷) + 3(修正一次) = 11
    (0, rules_1.setRules)({ ...(0, types_1.DEFAULT_RULES), critMode: 'max-plus-roll' });
    const atk = (0, combat_1.resolveAttack)(mkUnit(10), mkUnit(10), {
        attackBonus: 5, targetAc: 1, weaponDamage: '1d6+3', forcedAttackRoll: 20, forcedDamageRolls: [2], applyResistances: false,
    });
    check('max-plus-roll: 命中且重击', atk.hit && atk.critical);
    check('max-plus-roll: 伤害 = 6+2+3 = 11', atk.damage?.final === 11, `实际 ${atk.damage?.final}（骰面 ${JSON.stringify(atk.damage?.rawRolls?.map(r => r.value))}）`);
    check('max-plus-roll: 骰面含取满6与再掷2', atk.damage?.rawRolls?.filter(r => r.tag === 'weapon').length === 2
        && atk.damage.rawRolls.some(r => r.value === 6) && atk.damage.rawRolls.some(r => r.value === 2));

    // full-double（2024 RAW）：1d6+3 重击 = 两次 d6 骰和 + 修正一次
    // forcedDamageRolls 只固定第一次骰（=2），第二次随机 → 断言结构：weapon 骰面 2 组、总数=骰和+3
    (0, rules_1.setRules)({ ...(0, types_1.DEFAULT_RULES), critMode: 'full-double' });
    const atk2 = (0, combat_1.resolveAttack)(mkUnit(10), mkUnit(10), {
        attackBonus: 5, targetAc: 1, weaponDamage: '1d6+3', forcedAttackRoll: 20, forcedDamageRolls: [2], applyResistances: false,
    });
    const w2rolls = atk2.damage?.rawRolls?.filter(r => r.tag === 'weapon') ?? [];
    const w2sum = w2rolls.reduce((s, r) => s + r.value, 0);
    check('full-double: weapon 骰面 2 组且首骰固定 2', w2rolls.length === 2 && w2rolls[0].value === 2, JSON.stringify(w2rolls.map(r => r.value)));
    check('full-double: 修正只加一次（总数 = 骰和+3）', atk2.damage?.final === w2sum + 3, `实际 ${atk2.damage?.final} vs 骰和+3=${w2sum + 3}`);

    // rider 翻倍差异：武器 1d4+0（骰面固定 1） rider 1d6+0
    // full-double：rider 掷 2 次（骰数=2 组）；weapon-dice-only：rider 1 组
    (0, rules_1.setRules)({ ...(0, types_1.DEFAULT_RULES), critMode: 'full-double' });
    const a3 = (0, combat_1.resolveAttack)(mkUnit(10), mkUnit(10), {
        attackBonus: 5, targetAc: 1, weaponDamage: '1d4', riderDamage: '1d6', forcedAttackRoll: 20, applyResistances: false,
    });
    const riderGroups3 = a3.damage?.rawRolls?.filter(r => r.tag === 'rider').length ?? 0;
    check('full-double: rider 骰翻倍（2组）', riderGroups3 === 2, `实际 ${riderGroups3} 组`);
    (0, rules_1.setRules)({ ...(0, types_1.DEFAULT_RULES), critMode: 'weapon-dice-only' });
    const a4 = (0, combat_1.resolveAttack)(mkUnit(10), mkUnit(10), {
        attackBonus: 5, targetAc: 1, weaponDamage: '1d4', riderDamage: '1d6', forcedAttackRoll: 20, applyResistances: false,
    });
    const riderGroups4 = a4.damage?.rawRolls?.filter(r => r.tag === 'rider').length ?? 0;
    check('weapon-dice-only: rider 不翻倍（1组）', riderGroups4 === 1, `实际 ${riderGroups4} 组`);
    // max-plus rider：取满 + 再掷 = 6 + d6(随机 1..6) → rider 骰面 2 组且至少一个为 6
    (0, rules_1.setRules)({ ...(0, types_1.DEFAULT_RULES), critMode: 'max-plus-roll' });
    const a5 = (0, combat_1.resolveAttack)(mkUnit(10), mkUnit(10), {
        attackBonus: 5, targetAc: 1, weaponDamage: '1d4', riderDamage: '1d6', forcedAttackRoll: 20, applyResistances: false,
    });
    const riderRolls5 = a5.damage?.rawRolls?.filter(r => r.tag === 'rider') ?? [];
    check('max-plus-roll: rider 取满 6 + 再掷', riderRolls5.some(r => r.value === 6), JSON.stringify(riderRolls5.map(r => r.value)));

    // 非重击不受 critMode 影响：1d6+3 骰面固定 2 → 5
    const a6 = (0, combat_1.resolveAttack)(mkUnit(10), mkUnit(10), {
        attackBonus: 5, targetAc: 10, weaponDamage: '1d6+3', forcedAttackRoll: 15, forcedDamageRolls: [2], applyResistances: false,
    });
    check('非重击伤害与 critMode 无关（=5）', a6.hit && a6.damage?.final === 5, `实际 ${a6.damage?.final}`);
    (0, rules_1.setRules)({ ...(0, types_1.DEFAULT_RULES) });
}

// ============ 4. fixed10 固定先攻 ============
console.log('\n── initiativeMode=fixed10 固定先攻 ──');
{
    const u = { ...mkUnit(10), abilities: { str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10 } };
    u.initMod = 2;
    const rulesFixed = { ...(0, types_1.DEFAULT_RULES), initiativeMode: 'fixed10' };
    const r1 = (0, initiative_1.rollInitiative)(u, rulesFixed, false);
    check('fixed10: 值 = 10+加值 = 12', r1 === 12, `实际 ${r1}`);
    const r2 = (0, initiative_1.rollInitiative)(u, rulesFixed, true);
    check('fixed10: 被突袭也恒定（无骰）', r2 === 12, `实际 ${r2}`);
    const { rolls } = (0, initiative_1.rollInitiativeForUnits)([u], rulesFixed, []);
    check('fixed10: 批量明细含「固定先攻」文案', rolls.length === 1 && rolls[0].detail.includes('固定先攻'), rolls[0]?.detail);
    const rulesRoll = { ...(0, types_1.DEFAULT_RULES) };
    const vals = new Set();
    for (let i = 0; i < 20; i++) vals.add((0, initiative_1.rollInitiative)(u, rulesRoll, false));
    check('roll 模式仍为掷骰（20次出现多值）', vals.size > 1, `仅 ${vals.size} 种值`);
}

// ============ 5. parseAttack 施法占位符 ============
console.log('\n── parseAttack 施法占位符（玩家侧结构化法术） ──');
{
    const parsed = (0, statblocks_1.parseAttack)({
        名称: '霜火交汇', 类型: '范围豁免', 伤害: '8d6', 伤害类型: '火焰',
        豁免: { 属性: '敏捷', DC: '施法', 半伤: true }, 范围: { 形状: '球体', 尺寸: 20 }, 环阶: 3, 专注: false,
    }, 0, [], { spellAttack: 7, spellDc: 15 });
    check('结构化法术: 解析成功', !!parsed, 'parseAttack 返回空');
    check('结构化法术: DC占位 → 15', parsed?.saveDc === 15, `实际 ${parsed?.saveDc}`);
    check('结构化法术: kind=save-aoe', parsed?.kind === 'save-aoe', `实际 ${parsed?.kind}`);
    check('结构化法术: 半伤', parsed?.halfOnSuccess === true);
    check('结构化法术: 环阶 3', parsed?.spellLevel === 3, `实际 ${parsed?.spellLevel}`);

    const parsed2 = (0, statblocks_1.parseAttack)({
        名称: '幻影飞刃', 类型: '远程', 伤害: '2d8+3', 伤害类型: '力场', 射程: 60, 命中: '施法',
    }, 0, [], { spellAttack: 7, spellDc: 15 });
    check('攻击型法术: 命中占位 → 7', parsed2?.attackBonus === 7, `实际 ${parsed2?.attackBonus}`);
    check('攻击型法术: kind=ranged', parsed2?.kind === 'ranged');
}

// ============ 6. charSheetsFromTree：自设结构化法术 + 特性动作 ============
console.log('\n── charSheetsFromTree 自设结构化法术/特性动作 ──');
{
    const tree = {
        '角色列表': {
            'Test': {
                '等级': 5,
                '生命值': { 当前: 30, 最大: 30, 临时: 0 },
                '护甲等级': { 总值: 15 },
                '属性': { 力量: 10, 敏捷: 14, 体质: 12, 智力: 16, 感知: 10, 魅力: 10 },
                '施法': {
                    '关键属性': '智力',
                    '法术位': { '3环': { 当前: 2, 最大: 2 } },
                    '法术书': {
                        '火球术': { 准备中: true },                       // 内置库命中 → ✨
                        '霜火交汇': {                                       // 结构化自设 → 🛠
                            准备中: true, 类型: '范围豁免', 伤害: '8d6', 伤害类型: '火焰',
                            豁免: { 属性: '敏捷', DC: '施法', 半伤: true }, 范围: '球体20尺', 环阶: 3,
                        },
                        '心灵低语': { 准备中: true, 描述: '精神系自创法术，影响心智。' }, // 纯描述 → ○
                    },
                },
                '特性': {
                    '种族': { '黑暗视觉': { 描述: '60尺黑暗视觉' } },      // 纯描述，不进动作栏
                    '职业': { '奥术冲击': { 类型: '远程', 伤害: '2d10', 伤害类型: '力场', 射程: 60, 命中: '施法' } },
                },
            },
        },
    };
    const sheets = (0, sheetbridge_1.charSheetsFromTree)(tree);
    const s = sheets.find(x => x.name === 'Test');
    check('角色卡解析成功', !!s);
    const fire = s?.spells.find(x => x.name === '火球术');
    const frost = s?.spells.find(x => x.name === '霜火交汇');
    const whisper = s?.spells.find(x => x.name === '心灵低语');
    check('内置法术仍走库（matched, ability 来自模板）', fire?.matched === true && fire?.custom !== true && !!fire?.ability);
    check('结构化自设法术 custom=true 且可结算', frost?.matched === false && frost?.custom === true && !!frost?.ability, JSON.stringify({ matched: frost?.matched, custom: frost?.custom }));
    check('结构化自设法术: DC = 8+PB(3)+智调(3) = 14', frost?.ability?.saveDc === 14, `实际 ${frost?.ability?.saveDc}`);
    check('纯描述法术 custom 不置位、无 ability', whisper?.custom !== true && !whisper?.ability);
    check('特性动作解析进 traitActions', (s?.traitActions.length ?? 0) === 1, `实际 ${s?.traitActions.length}`);
    const arcane = s?.traitActions[0];
    check('特性动作: 命中=施法占位 PB3+智调3=6', arcane?.attackBonus === 6, `实际 ${arcane?.attackBonus}`);
    check('特性动作: 纯描述特性（黑暗视觉）未被误解析', !s?.traitActions.some(a => a.name === '黑暗视觉'));

    // 装配为战斗单位：动作栏含 武器+法术(内置+自定义)+特性
    const unit = (0, sheetbridge_1.unitFromCharSheet)(s, { isPlayer: true, pos: { x: 0, y: 0 } });
    const names = unit.aiAbilities.map(a => a.name);
    check('战斗单位动作栏含自定义法术「霜火交汇」', names.includes('霜火交汇'), names.join(' | '));
    check('战斗单位动作栏含特性动作「奥术冲击」', names.includes('奥术冲击'), names.join(' | '));
    check('战斗单位动作栏含内置火球术', names.includes('火球术'));
    // 法术位挂钩：自定义 3 环法术施放应消耗 3 环位（ability.spellLevel=3 已带入）
    check('自定义法术带环阶（耗3环法术位）', unit.aiAbilities.find(a => a.name === '霜火交汇')?.spellLevel === 3);
}

// ============ 汇总 ============
console.log('\n━━━━━━━━━━━━━━━━ 新功能测试汇总 ━━━━━━━━━━━━━━━━');
console.log(`✅ 通过: ${pass}`);
console.log(`❌ 失败: ${fail}`);
if (fail > 0) { console.log('失败项:', failures.join(' | ')); process.exit(1); }
