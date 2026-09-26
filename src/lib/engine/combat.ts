/**
 * 战斗结算引擎：攻击、伤害管线、豁免、死亡豁免、专注、擒抱/推撞
 * 纯函数：输入单位 + 参数，返回结果（由 store 应用变更）
 */
import type {
  BattleUnit, DamageType, RollMode, CheckResult, DamageResult,
  AttackResult, DieRoll, DeathSaves,
} from './types';
import { rollFormula, judgeCheck, rollDie } from './dice';
import {
  abilityMod, getSaveBonus, attackRollModeAgainst, coverBonus, concentrationDc, proficiencyBonus, getAbilityMod, getRules,
} from './rules';
import { aggregateEffects, exhaustionPenalty } from './conditions';

// ---------- 攻击 ----------

export interface AttackOptions {
  /** 攻击加值（默认自动算不了，必须传：武器熟练+属性） */
  attackBonus: number;
  /** 目标 AC（含掩护加值后的有效 AC） */
  targetAc: number;
  mode?: RollMode; // 不传则按条件自动判定
  /** 武器伤害公式，如 1d8+3 */
  weaponDamage: string;
  /** 额外伤害骰（神能/偷袭/猎人印记等），2024 重击时同样翻倍 */
  riderDamage?: string;
  riderType?: DamageType;
  weaponType?: DamageType;
  /** 远程攻击（贴身敌对生物造成劣势；用于倒地远近分支的近战判定） */
  isRanged?: boolean;
  /** 攻击者与目标距离（尺）；倒地目标 5 尺内优势 / 5 尺外劣势 */
  distanceFeet?: number;
  /** 攻击者 5 尺内是否存在敌对生物（2024：远程攻击检定劣势） */
  hostileWithin5Ft?: boolean;
  /** 房规：重击模式（优先级高于全局 rules.critMode；旧参 critWeaponDiceOnly=true 视为 weapon-dice-only） */
  critMode?: 'full-double' | 'weapon-dice-only' | 'max-plus-roll';
  /** 兼容旧参：重击仅翻倍武器骰（One D&D 试玩版房规）；新代码请传 critMode */
  critWeaponDiceOnly?: boolean;
  /** 是否应用目标抗性 */
  applyResistances?: boolean;
  /** 目标掩护类型：full（全掩护）→ 2024 规则禁止直接指定，攻击被拦截（不掷骰） */
  coverKind?: 'none' | 'half' | 'threeQuarters' | 'full';
  forcedAttackRoll?: number;
  forcedDamageRolls?: number[];
}

/** 祝福（blessed）：攻击检定与豁免检定 +1d4（不随优势/劣势双掷） */
function blessDie(unit: BattleUnit, rolls: DieRoll[]): number {
  if (!unit.statuses.includes('blessed')) return 0;
  const v = rollDie(4);
  rolls.push({ sides: 4, value: v, kept: true, tag: 'bless' });
  return v;
}

/**
 * 爆炸重击（2014 DMG 变体，critMode='max-plus-roll'）：伤害骰不掷、取最大面值，
 * 再加上一次普通掷骰（骰子照掷、修正值只计一次）。
 * diceSum = 取满骰和 + 普通掷骰骰和；total = diceSum + 修正；
 * maxRolls/normalRolls 为同一组骰的两种取值，供调用方一并展开进骰面记录。
 */
function maxPlusRoll(formula: string, forcedRolls?: number[]): { diceSum: number; total: number; modifier: number; maxRolls: DieRoll[]; normalRolls: DieRoll[] } {
  const normal = rollFormula(formula, { forcedRolls });
  const maxRolls = normal.rolls.map(r => ({ ...r, value: r.sides }));
  const maxDiceSum = maxRolls.filter(r => r.kept).reduce((s, r) => s + r.value, 0);
  const normalDiceSum = normal.rolls.filter(r => r.kept).reduce((s, r) => s + r.value, 0);
  return { diceSum: maxDiceSum + normalDiceSum, total: maxDiceSum + normal.total, modifier: normal.modifier, maxRolls, normalRolls: normal.rolls };
}

export function resolveAttack(attacker: BattleUnit, target: BattleUnit, opts: AttackOptions): AttackResult {
  // 2024 全掩护：目标不能被攻击或伤害法术直接指定——不掷骰直接拦截
  if (opts.coverKind === 'full') {
    return {
      attack: {
        dice: { formula: 'blocked', rolls: [], modifier: 0, total: 0, mode: 'normal' },
        target: Number.isFinite(opts.targetAc) ? opts.targetAc : 15,
        total: 0,
        outcome: 'failure',
        label: '总掩护拦截',
      },
      hit: false,
      critical: false,
      blockedByCover: true,
    };
  }
  // 反 DoS/反 NaN：非法数值入口钳制（NaN 加值/AC 会泄漏 NaN 到检定结果与 UI）
  const safeBonus = Number.isFinite(opts.attackBonus) ? opts.attackBonus : 0;
  const safeAc = Number.isFinite(opts.targetAc) ? opts.targetAc : 15;
  opts = { ...opts, attackBonus: safeBonus, targetAc: safeAc };
  // 2024 力竭：攻击检定 -2/级
  const exPenalty = exhaustionPenalty(attacker.statuses);
  const attackBonus = safeBonus - exPenalty;
  // 攻击骰模式：显式指定 > 条件自动判定（含倒地远近、贴身远程劣势）
  let mode: RollMode = opts.mode ?? 'normal';
  let reason = '指定';
  if (!opts.mode) {
    const auto = attackRollModeAgainst(attacker, target, {
      distanceFeet: opts.distanceFeet,
      isMeleeAttack: opts.isRanged === undefined ? undefined : !opts.isRanged,
      hostileWithin5Ft: opts.hostileWithin5Ft,
    });
    mode = auto.mode;
    reason = auto.reasons.join('、') || '常规';
  }
  void reason;

  const attackDice = rollFormula('1d20', {
    mode,
    bonus: attackBonus,
    forcedRolls: opts.forcedAttackRoll !== undefined ? [opts.forcedAttackRoll] : undefined,
  });
  // 祝福 +1d4（攻击检定）
  const bless = blessDie(attacker, attackDice.rolls);
  attackDice.total += bless;
  const attack: CheckResult = {
    dice: attackDice,
    target: opts.targetAc,
    total: attackDice.total,
    outcome: 'failure',
    label: '攻击检定',
  };
  const raw = attackDice.rawD20 ?? 0;
  let isCrit = raw === 20;
  const isCritMiss = raw === 1;
  // 2024：麻痹/昏迷目标被 5 尺内近战命中即重击（meleeCritOnHit）
  if (!isCrit && !opts.isRanged) {
    const inMelee = opts.distanceFeet === undefined || opts.distanceFeet <= 5;
    if (inMelee && aggregateEffects(target.statuses).meleeCritOnHit) isCrit = true;
  }
  const hit = isCrit || (!isCritMiss && attackDice.total >= opts.targetAc);
  attack.outcome = isCrit ? 'critical-success' : isCritMiss ? 'critical-failure' : hit ? 'success' : 'failure';

  if (!hit) return { attack, hit: false, critical: false };

  // ----- 伤害 -----
  const rolls: DieRoll[] = [];
  let weaponTotal = 0;
  let riderTotal = 0;

  // 重击模式解析：显式 critMode > 旧参 critWeaponDiceOnly 映射 > 全局 rules.critMode
  const critMode: 'full-double' | 'weapon-dice-only' | 'max-plus-roll'
    = opts.critMode
      ?? (opts.critWeaponDiceOnly !== undefined ? (opts.critWeaponDiceOnly ? 'weapon-dice-only' : 'full-double') : undefined)
      ?? getRules().critMode;
  const weaponDiceOnly = critMode === 'weapon-dice-only';
  let weaponDiceSum = 0;
  let weaponMod = 0;
  if (isCrit && critMode === 'max-plus-roll') {
    // 爆炸重击（2014 DMG 变体）：武器骰取满 + 再掷一次普通伤害（修正值只计一次）
    const w = maxPlusRoll(opts.weaponDamage, opts.forcedDamageRolls);
    for (const r of w.maxRolls) rolls.push({ ...r, tag: 'weapon' });
    for (const r of w.normalRolls) rolls.push({ ...r, tag: 'weapon' });
    weaponDiceSum = w.diceSum;
    weaponMod = w.modifier;
  } else {
    // 2024 正式规则：重击翻倍攻击的全部伤害骰（修正值不翻倍）；
    // weapon-dice-only 房规（One D&D 试玩版提案） rider 部分不翻倍
    const critMultiplier = isCrit ? 2 : 1;
    for (let i = 0; i < critMultiplier; i++) {
      const w = rollFormula(opts.weaponDamage, {
        forcedRolls: opts.forcedDamageRolls && i === 0 ? opts.forcedDamageRolls : undefined,
      });
      for (const r of w.rolls) rolls.push({ ...r, tag: 'weapon' });
      weaponDiceSum += w.rolls.filter(r => r.kept).reduce((s, r) => s + r.value, 0);
      weaponMod = w.modifier;
    }
  }
  weaponTotal = weaponDiceSum + weaponMod;
  // rider 骰（神能/偷袭等附加伤害骰）：2024 重击同样翻倍（weapon-dice-only 房规时跳过翻倍）
  if (opts.riderDamage) {
    if (isCrit && critMode === 'max-plus-roll') {
      const rd = maxPlusRoll(opts.riderDamage);
      for (const r of rd.maxRolls) rolls.push({ ...r, tag: 'rider' });
      for (const r of rd.normalRolls) rolls.push({ ...r, tag: 'rider' });
      riderTotal = rd.diceSum + rd.modifier;
    } else {
      for (let i = 0; i < (isCrit && !weaponDiceOnly ? 2 : 1); i++) {
        const rd = rollFormula(opts.riderDamage);
        for (const r of rd.rolls) rolls.push({ ...r, tag: 'rider' });
        riderTotal += rd.rolls.filter(r => r.kept).reduce((s, r) => s + r.value, 0) + rd.modifier;
      }
    }
  }

  const rawTotal = weaponTotal + riderTotal;
  const damage = applyDamageModifiers(target, rawTotal, opts.weaponType ?? 'slashing', rolls, opts.applyResistances !== false);
  return {
    attack,
    hit: true,
    critical: isCrit,
    damage: { ...damage, rawRolls: rolls },
  };
}

// ---------- 伤害管线：2024 顺序 抗性×½ → 易伤×2 → 免疫（依次应用） ----------

/**
 * 伤害类型修正管线（纯计算，不含临时HP/专注）。
 * 2024 PHB 术语表 Order of Application：修正 → 抗性（减半向下取整）→ 易伤（翻倍）→ 免疫置 0；
 * 同类抗性+易伤并存且伤害为奇数时结果不同（5 → 抗性2 → 易伤4）。
 * 石化：对所有伤害具抗性（补充在类型修正之后）。
 * minDamageOne 房规（SettingsPanel 可切换）：免疫之外，伤害经抗性/石化减至 0 时至少结算 1 点。
 */
export function applyTypeModifiers(
  target: Pick<BattleUnit, 'resistances' | 'immunities' | 'vulnerabilities' | 'statuses'>,
  raw: number,
  type: DamageType,
): { final: number; note: string } {
  let final = raw;
  const notes: string[] = [];
  let immune = false;
  if (target.resistances.includes(type)) {
    final = Math.floor(final / 2);
    notes.push(`${type} 抗性 ×½`);
  }
  if (target.vulnerabilities.includes(type)) {
    final = final * 2;
    notes.push(`${type} 易伤 ×2`);
  }
  if (target.immunities.includes(type)) {
    final = 0;
    immune = true;
    notes.push(`${type} 免疫`);
  }
  if (final > 0 && target.statuses?.includes('petrified')) {
    final = Math.floor(final / 2);
    notes.push('石化·全伤害抗性 ×½');
  }
  if (!immune && raw > 0 && final < 1 && getRules().minDamageOne) {
    final = 1;
    notes.push('房规·最小伤害1');
  }
  return { final, note: notes.join(' · ') };
}

export function applyDamageModifiers(
  target: BattleUnit,
  raw: number,
  type: DamageType,
  rolls?: DieRoll[],
  applyMods = true,
): DamageResult {
  let final = raw;
  let note = '';
  if (applyMods) {
    const r = applyTypeModifiers(target, raw, type);
    final = r.final;
    note = r.note;
  }
  // 临时 HP 先扣
  let appliedToHp = final;
  if (target.tempHp > 0) {
    const absorbed = Math.min(target.tempHp, final);
    appliedToHp = final - absorbed;
    if (absorbed > 0) note += `${note ? ' · ' : ''}临时HP吸收 ${absorbed}`;
  }
  const willDrop = target.hp - appliedToHp <= 0;
  const concentration = target.concentration && appliedToHp > 0 ? concentrationDc(appliedToHp) : null;
  return {
    rawRolls: rolls ?? [],
    rawTotal: raw,
    final,
    multiplierNote: note,
    appliedToHp,
    targetId: target.id,
    concentrationDc: concentration,
    deathFailures: 0,
    killed: false,
  };
}

// ---------- 豁免 ----------

export interface SaveOptions {
  ability: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
  dc: number;
  mode?: RollMode;
  /** 半伤（成功伤害减半） */
  halfOnSuccess?: boolean;
  sourceDamage?: number;
  forcedRoll?: number;
}

export interface SaveResult {
  check: CheckResult;
  damageTaken: number;
  halfApplied: boolean;
}

export function resolveSave(target: BattleUnit, opts: SaveOptions): SaveResult {
  const agg = aggregateEffects(target.statuses);
  // 自动失败（麻痹：力量/敏捷自动失败）
  if (agg.autoFailSaves.has(opts.ability)) {
    const check: CheckResult = {
      dice: { formula: 'auto-fail', rolls: [], modifier: 0, total: 0, mode: 'normal' },
      target: opts.dc,
      total: 0,
      outcome: 'failure',
      label: `${opts.ability.toUpperCase()} 豁免（自动失败）`,
    };
    return {
      check,
      damageTaken: opts.sourceDamage ?? 0,
      halfApplied: false,
    };
  }
  // 条件劣势：束缚→敏捷劣势、中毒不影响豁免
  let mode: RollMode = opts.mode ?? 'normal';
  if (mode === 'normal' && opts.ability === 'dex' && target.statuses.includes('restrained')) {
    mode = 'disadvantage';
  }

  // 2024 力竭：豁免检定 -2/级（替代 2014 的 3 级劣势分级）
  const exPenalty = exhaustionPenalty(target.statuses);
  const bonus = getSaveBonus(target, opts.ability) - exPenalty;
  const dice = rollFormula('1d20', {
    mode, bonus,
    forcedRolls: opts.forcedRoll !== undefined ? [opts.forcedRoll] : undefined,
  });
  // 祝福 +1d4（豁免检定）
  const bless = blessDie(target, dice.rolls);
  dice.total += bless;
  const judged = judgeCheck(dice, opts.dc);
  // 普通豁免文案无大成功/大失败；但 2024 D20 Test：保留裸骰 20 自动成功、裸骰 1 自动失败（与 DC/加值无关）
  const outcome = judged.outcome === 'critical-success' ? 'success'
    : judged.outcome === 'critical-failure' ? 'failure'
      : judged.outcome;
  const natNote = dice.rawD20 === 20 ? '（裸20自动成功）' : dice.rawD20 === 1 ? '（裸1自动失败）' : '';
  const check: CheckResult = { dice, target: opts.dc, total: dice.total, outcome, label: `${opts.ability.toUpperCase()} 豁免 DC${opts.dc}${exPenalty ? `（力竭-${exPenalty}）` : ''}${natNote}` };
  const success = judged.outcome === 'success' || judged.outcome === 'critical-success';
  let damageTaken = opts.sourceDamage ?? 0;
  let halfApplied = false;
  if (success && opts.halfOnSuccess && opts.sourceDamage !== undefined) {
    damageTaken = Math.floor(opts.sourceDamage / 2);
    halfApplied = true;
  }
  return { check, damageTaken, halfApplied };
}

// ---------- 死亡豁免 ----------

export interface DeathSaveResult {
  check: CheckResult;
  success: boolean;
  newState: DeathSaves;
  event: 'none' | 'stable' | 'dead' | 'revive-1hp' | 'double-fail';
}

export function resolveDeathSave(unit: BattleUnit, forcedRoll?: number): DeathSaveResult {
  const ds: DeathSaves = unit.deathSaves
    ? { ...unit.deathSaves }
    : { successes: 0, failures: 0, stable: false, dead: false };
  // 死亡豁免也是 d20 检定：2024 力竭 -2/级、祝福 +1d4 均适用
  const exPenalty = exhaustionPenalty(unit.statuses);
  const dice = rollFormula('1d20', {
    bonus: -exPenalty,
    forcedRolls: forcedRoll !== undefined ? [forcedRoll] : undefined,
  });
  const bless = blessDie(unit, dice.rolls);
  dice.total += bless;
  const raw = dice.rawD20 ?? 0;
  let event: DeathSaveResult['event'] = 'none';

  if (raw === 20) {
    // 裸20：恢复 1 HP
    ds.successes = 0; ds.failures = 0; ds.stable = false; ds.dead = false;
    event = 'revive-1hp';
  } else if (raw === 1) {
    ds.failures += 2;
    event = 'double-fail';
  } else if (dice.total >= 10) {
    ds.successes += 1;
    if (ds.successes >= 3) { ds.stable = true; ds.successes = 0; ds.failures = 0; event = 'stable'; }
  } else {
    ds.failures += 1;
  }
  if (ds.failures >= 3) { ds.dead = true; event = 'dead'; }

  return {
    check: {
      dice, target: 10, total: dice.total,
      outcome: raw === 20 ? 'critical-success' : raw === 1 ? 'critical-failure' : dice.total >= 10 ? 'success' : 'failure',
      label: '死亡豁免 DC10',
    },
    success: dice.total >= 10,
    newState: ds,
    event,
  };
}

/** 对 0 HP 单位造成伤害时结算死亡豁免失败 */
export function damageAtZeroHp(unit: BattleUnit, amount: number, isCrit: boolean): { failures: number; killed: boolean } {
  let failures = 1;
  if (isCrit) failures = 2;
  const ds = unit.deathSaves ?? { successes: 0, failures: 0, stable: false, dead: false };
  const totalFails = ds.failures + failures;
  return { failures, killed: totalFails >= 3 };
}

// ---------- 专注 ----------

export interface ConcentrationResult {
  check: CheckResult;
  broken: boolean;
}

export function resolveConcentration(unit: BattleUnit, damage: number, forcedRoll?: number): ConcentrationResult {
  const dc = concentrationDc(damage);
  // 体质豁免：2024 力竭 -2/级、祝福 +1d4；D20 Test：裸骰 20 自动成功、裸骰 1 自动失败
  const bonus = getSaveBonus(unit, 'con') - exhaustionPenalty(unit.statuses);
  const dice = rollFormula('1d20', { bonus, forcedRolls: forcedRoll !== undefined ? [forcedRoll] : undefined });
  const bless = blessDie(unit, dice.rolls);
  dice.total += bless;
  const raw = dice.rawD20 ?? 0;
  const success = raw === 20 || (raw !== 1 && dice.total >= dc);
  return {
    check: {
      dice, target: dc, total: dice.total,
      outcome: success ? 'success' : 'failure',
      label: `专注豁免 DC${dc}（伤害${damage}）${raw === 20 ? '（裸20自动成功）' : raw === 1 ? '（裸1自动失败）' : ''}`,
    },
    broken: !success,
  };
}

// ---------- 擒抱 / 推撞（2024：武装打击选项） ----------

export interface UnarmedStrikeResult {
  check: CheckResult;
  grappled: boolean;
  shoved: 'none' | 'prone' | 'push5';
}

/** 擒抓：攻击检定 vs 目标 AC；逃脱 DC = 8 + 力量调整 + 熟练 */
export function escapeDc(grappler: BattleUnit): number {
  return 8 + getAbilityMod(grappler, 'str') + proficiencyBonus(grappler.level ?? grappler.cr);
}

export function grappleAttack(grappler: BattleUnit, target: BattleUnit, bonus: number, forcedRoll?: number): UnarmedStrikeResult {
  // 攻击检定：2024 力竭 -2/级、祝福 +1d4
  const dice = rollFormula('1d20', {
    bonus: bonus - exhaustionPenalty(grappler.statuses),
    mode: 'normal',
    forcedRolls: forcedRoll !== undefined ? [forcedRoll] : undefined,
  });
  const bless = blessDie(grappler, dice.rolls);
  dice.total += bless;
  const success = (dice.rawD20 === 20) || (dice.rawD20 !== 1 && dice.total >= target.ac);
  return {
    check: {
      dice, target: target.ac, total: dice.total,
      outcome: dice.rawD20 === 20 ? 'critical-success' : dice.rawD20 === 1 ? 'critical-failure' : success ? 'success' : 'failure',
      label: `擒抱检定 vs AC${target.ac}`,
    },
    grappled: success,
    shoved: 'none',
  };
}

// ---------- 治疗 ----------

export interface HealResult {
  amount: number;
  newHp: number;
  fromZero: boolean;
  deathSavesReset: boolean;
}

export function resolveHeal(unit: BattleUnit, amount: number): HealResult {
  const fromZero = unit.hp <= 0;
  const newHp = Math.min(unit.maxHp, Math.max(0, unit.hp) + amount);
  return {
    amount,
    newHp,
    fromZero,
    deathSavesReset: fromZero, // 恢复 HP 时死亡豁免重置
  };
}

// ---------- 稳定伤势 ----------

export function stabilize(unit: BattleUnit): boolean {
  return unit.hp <= 0;
}

// ---------- 遭遇难度预算（DM 工具） ----------

/** 2024 XP 阈值表（简化：按玩家等级数组） */
export const XP_THRESHOLDS: Record<number, { easy: number; medium: number; hard: number; deadly: number }> = {
  1: { easy: 50, medium: 100, hard: 150, deadly: 200 },
  2: { easy: 100, medium: 200, hard: 300, deadly: 400 },
  3: { easy: 150, medium: 300, hard: 450, deadly: 600 },
  4: { easy: 250, medium: 500, hard: 750, deadly: 1000 },
  5: { easy: 500, medium: 1000, hard: 1500, deadly: 2000 },
  6: { easy: 600, medium: 1200, hard: 1900, deadly: 2500 },
  7: { easy: 750, medium: 1500, hard: 2300, deadly: 3200 },
  8: { easy: 1000, medium: 2000, hard: 3000, deadly: 4000 },
  9: { easy: 1300, medium: 2600, hard: 3900, deadly: 5200 },
  10: { easy: 1600, medium: 3200, hard: 4800, deadly: 6400 },
  11: { easy: 1900, medium: 3900, hard: 5800, deadly: 7700 },
  12: { easy: 2200, medium: 4500, hard: 6700, deadly: 8900 },
  13: { easy: 2600, medium: 5300, hard: 7900, deadly: 10500 },
  14: { easy: 2900, medium: 5900, hard: 8800, deadly: 11600 },
  15: { easy: 3300, medium: 6700, hard: 10000, deadly: 13300 },
  16: { easy: 3700, medium: 7500, hard: 11300, deadly: 15000 },
  17: { easy: 4100, medium: 8300, hard: 12500, deadly: 16700 },
  18: { easy: 4500, medium: 9100, hard: 13800, deadly: 18400 },
  19: { easy: 4900, medium: 9900, hard: 15000, deadly: 20100 },
  20: { easy: 5300, medium: 10700, hard: 16300, deadly: 21800 },
};

/** CR → XP（2024 MM 简表） */
export const CR_XP: Array<[number, number]> = [
  [0, 10], [0.125, 25], [0.25, 50], [0.5, 100],
  [1, 200], [2, 450], [3, 700], [4, 1100], [5, 1800], [6, 2300],
  [7, 2900], [8, 3900], [9, 5000], [10, 5900], [11, 7200], [12, 8400],
  [13, 10000], [14, 11500], [15, 13000], [16, 15000], [17, 18000],
  [18, 20000], [19, 22000], [20, 25000], [21, 33000], [22, 41000],
  [23, 50000], [24, 62000], [25, 75000], [26, 90000], [30, 155000],
];

export function crToXp(cr: number): number {
  for (const [c, xp] of CR_XP) {
    if (Math.abs(c - cr) < 0.001) return xp;
  }
  return cr >= 26 ? 90000 + (cr - 26) * 15000 : 25;
}

/** 遭遇难度评估 */
export function encounterDifficulty(
  monsterCrs: number[],
  partyLevels: number[],
): { totalXp: number; adjustedXp: number; threshold: { easy: number; medium: number; hard: number; deadly: number }; level: 'easy' | 'medium' | 'hard' | 'deadly' | 'trivial' } {
  const totalXp = monsterCrs.reduce((s, cr) => s + crToXp(cr), 0);
  const n = monsterCrs.length;
  const multiplier = n <= 1 ? 1 : n === 2 ? 1.5 : n <= 6 ? 2 : n <= 10 ? 2.5 : n <= 14 ? 3 : 4;
  const adjustedXp = Math.round(totalXp * multiplier);
  const avgLevel = Math.max(1, Math.min(20, Math.round(partyLevels.reduce((s, l) => s + l, 0) / Math.max(1, partyLevels.length))));
  const perPlayer = XP_THRESHOLDS[avgLevel] ?? XP_THRESHOLDS[20];
  const scale = Math.max(1, partyLevels.length);
  const threshold = {
    easy: perPlayer.easy * scale,
    medium: perPlayer.medium * scale,
    hard: perPlayer.hard * scale,
    deadly: perPlayer.deadly * scale,
  };
  let level: 'easy' | 'medium' | 'hard' | 'deadly' | 'trivial' = 'trivial';
  if (adjustedXp >= threshold.deadly) level = 'deadly';
  else if (adjustedXp >= threshold.hard) level = 'hard';
  else if (adjustedXp >= threshold.medium) level = 'medium';
  else if (adjustedXp >= threshold.easy) level = 'easy';
  return { totalXp, adjustedXp, threshold, level };
}
