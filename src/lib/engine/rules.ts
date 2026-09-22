/**
 * D&D 2024 规则计算：属性调整值、熟练加值、被动数值
 */
import type { Abilities, AbilityKey, BattleUnit, RulesConfig } from './types';
import { DEFAULT_RULES } from './types';
import { aggregateEffects, exhaustionSpeedLoss } from './conditions';

export function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function formatMod(mod: number): string {
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

/** 熟练加值：等级 1-4→+2, 5-8→+3, 9-12→+4, 13-16→+5, 17-20→+6；怪物按 CR */
export function proficiencyBonus(levelOrCr: number | undefined): number {
  if (levelOrCr === undefined || levelOrCr === null) return 2;
  const v = Math.max(0, levelOrCr);
  if (v < 5) return 2;
  if (v < 9) return 3;
  if (v < 13) return 4;
  if (v < 17) return 5;
  return 6;
}

export function getAbilityScore(unit: BattleUnit, key: AbilityKey, fallback = 10): number {
  return unit.abilities?.[key] ?? fallback;
}

export function getAbilityMod(unit: BattleUnit, key: AbilityKey): number {
  return abilityMod(getAbilityScore(unit, key));
}

/** 豁免加值：显式加值 > 属性调整值 */
export function getSaveBonus(unit: BattleUnit, key: AbilityKey): number {
  if (unit.saveBonuses && unit.saveBonuses[key] !== undefined) {
    return unit.saveBonuses[key] as number;
  }
  return getAbilityMod(unit, key);
}

/** 单位有效速度（考虑条件；slow_time=时光缓速锁速度为0；2024 力竭 -5 尺/级） */
export function effectiveSpeed(unit: BattleUnit): number {
  if (unit.statuses.includes('slow_time')) return 0;
  const agg = aggregateEffects(unit.statuses);
  return Math.max(0, Math.floor(unit.speed * agg.speedMultiplier) - exhaustionSpeedLoss(unit.statuses));
}

/** 本回合剩余移动力 */
export function remainingMovement(unit: BattleUnit): number {
  return Math.max(0, effectiveSpeed(unit) - unit.actionEconomy.movementUsed);
}

export interface AttackModeContext {
  /** 攻击者与目标的距离（尺）；倒地目标 5 尺内优势 / 5 尺外劣势需要 */
  distanceFeet?: number;
  /** 是否近战攻击（未传则按未知处理） */
  isMeleeAttack?: boolean;
  /** 攻击者 5 尺内是否存在敌对生物（2024：远程攻击检定劣势） */
  hostileWithin5Ft?: boolean;
}

/**
 * 计算攻击该单位时攻击方的 roll mode
 * （条件互斥：同时有优势+劣势 = 正常）
 * 2024 规则：对倒地生物——攻击者在 5 尺内优势，否则劣势；
 * 远程攻击时若敌对生物处于攻击者 5 尺内则劣势。
 */
export function attackRollModeAgainst(attacker: BattleUnit, target: BattleUnit, ctx: AttackModeContext = {}): {
  mode: 'normal' | 'advantage' | 'disadvantage';
  reasons: string[];
} {
  const atkAgg = aggregateEffects(attacker.statuses);
  const defAgg = aggregateEffects(target.statuses);
  let advantage = false;
  let disadvantage = false;
  const reasons: string[] = [];

  if (atkAgg.ownAttackDisadvantage) { disadvantage = true; reasons.push('攻击者攻击劣势'); }
  if (atkAgg.ownAttackAdvantage) { advantage = true; reasons.push('攻击者攻击优势（隐藏/协助）'); }
  if (defAgg.attacksAgainstAdvantage) { advantage = true; reasons.push('防守方被攻击有优势'); }
  if (defAgg.attacksAgainstMeleeAdvantage) {
    // 倒地：5 尺内攻击有优势，更远有劣势（2024）
    if (ctx.distanceFeet === undefined || ctx.distanceFeet <= 5) {
      advantage = true; reasons.push('目标倒地·近距攻击优势');
    } else {
      disadvantage = true; reasons.push('目标倒地·远距攻击劣势');
    }
  }
  if (defAgg.attacksAgainstDisadvantage) { disadvantage = true; reasons.push('防守方闪避中'); }
  if (ctx.hostileWithin5Ft && ctx.isMeleeAttack === false) {
    disadvantage = true; reasons.push('敌对生物处于5尺内·远程攻击劣势');
  }

  if (advantage && disadvantage) return { mode: 'normal', reasons: ['优势劣势抵消'] };
  if (advantage) return { mode: 'advantage', reasons };
  if (disadvantage) return { mode: 'disadvantage', reasons };
  return { mode: 'normal', reasons };
}

/** 掩护加值 */
export function coverBonus(kind: 'none' | 'half' | 'threeQuarters' | 'full'): number {
  switch (kind) {
    case 'half': return 2;
    case 'threeQuarters': return 5;
    default: return 0;
  }
}

/** 专注豁免 DC：10 或 伤害一半，取高 */
export function concentrationDc(damage: number): number {
  return Math.max(10, Math.ceil(damage / 2));
}

/** 坠落伤害：每 10 尺 1d6 */
export function fallDamage(feet: number): string {
  const dice = Math.min(Math.floor(feet / 10), 20);
  return dice > 0 ? `${dice}d6` : '0';
}

/** 负重/双持/借机攻击提示常量 */
export const RULES_2024_NOTES = [
  '借机攻击：生物自愿离开你Reach范围时触发反应攻击（2024：仅离开时，接近不触发）',
  '借机攻击只在你移动离开5尺范围时触发，且每回合限一次（2024新增：机会攻击每轮一次）',
  '武器切换：与物品交互同一回合可免费一次',
  '擒抱/推撞：徒手打击选项——先攻击检定 vs AC，命中后目标 STR/DEX 豁免（自选）对抗 DC 8+攻击属性调整值+熟练，失败被擒抱/推离 5 尺',
  '专注：同时仅一个；受伤需体质豁免 DC=max(10, 伤害÷2)',
  '稳定伤势： DC10 医药检定使濒死单位稳定',
  '重击(2024)：攻击的全部伤害骰翻倍（含神能/偷袭/猎人印记等附加伤害骰），修正值不翻倍',
  '力竭(2024)：每级 -2 全部 d20 检定、速度 -5 尺（叠加）；6 级死亡',
  '突袭(2024)：被突袭单位先攻检定劣势',
];

let activeRules: RulesConfig = { ...DEFAULT_RULES };

export function getRules(): RulesConfig {
  return activeRules;
}

export function setRules(r: Partial<RulesConfig>) {
  activeRules = { ...activeRules, ...r };
}
