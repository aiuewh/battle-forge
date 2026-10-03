/**
 * D&D 2024 规则计算：属性调整值、熟练加值、被动数值
 */
import type { Abilities, AbilityKey, BattleUnit, RulesConfig } from './types';
import { DEFAULT_RULES, normalizeRules } from './types';
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

/** 掩护加值（AC）；full（全掩护）不提供 AC 加值——2024 规则下全掩护目标无法被攻击/伤害法术直接指定（拦截见 resolveAttack 的 coverKind） */
export function coverBonus(kind: 'none' | 'half' | 'threeQuarters' | 'full'): number {
  switch (kind) {
    case 'half': return 2;
    case 'threeQuarters': return 5;
    default: return 0;
  }
}

/** 专注豁免 DC：10 或 伤害一半（向下取整），取高 */
export function concentrationDc(damage: number): number {
  return Math.max(10, Math.floor(damage / 2));
}

// ============ 法术位：升环向上代打（D-2 / E7） ============

export interface CastSlotResolution {
  /** false = 基础环与更高环均无可用法术位（或单位无法术位模型） */
  ok: boolean;
  /** 实际施放环阶（0=戏法，不占法术位） */
  level: number;
  /** level > 基础环（用于战报口径与 applyUpcast） */
  upcast: boolean;
  /** 不可施放原因（ok=false 时给调用方出日志） */
  reason?: string;
}

/**
 * 施法环阶解析（纯函数）：从 max(requested, baseLevel) 起向上找首个有余的环阶。
 * - 0 环（戏法）直接通过，不查法术位；
 * - 单位没有法术位模型（spellSlots 缺失）→ ok:false（旧存档/非法术单位安全兜底；
 *   天生施法怪物的 AI 路径在调用方先行豁免，不走本函数）；
 * - requested 为弹窗显式指定的高环（高于基础环时仍可继续向上兜底）。
 */
export function resolveCastSlot(
  unit: Pick<BattleUnit, 'spellSlots' | 'name'>,
  baseLevel: number,
  requested?: number,
): CastSlotResolution {
  const base = Math.max(0, Math.floor(Number.isFinite(baseLevel) ? baseLevel : 0));
  if (base === 0) return { ok: true, level: 0, upcast: false };
  if (!unit.spellSlots) {
    return { ok: false, level: base, upcast: false, reason: `${unit.name ?? '该单位'} 没有法术位模型` };
  }
  const from = Math.min(9, Math.max(requested !== undefined ? Math.floor(requested) : base, base));
  for (let lv = Math.max(1, from); lv <= 9; lv++) {
    const slot = unit.spellSlots[lv];
    if (slot && slot.current > 0) return { ok: true, level: lv, upcast: lv > base };
  }
  return { ok: false, level: Math.max(1, from), upcast: false, reason: `${Math.max(1, from)} 环及更高环法术位均不足` };
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
  '擒抱/推撞（2024 徒手打击）：无攻击检定——由目标直接进行 STR 或 DEX 豁免（目标自选）对抗 DC 8+发起者力量调整值+熟练，失败分别被擒抱/被击倒或推离 5 尺（推撞二选一）；目标体型至多比发起者大一级',
  '专注：同时仅一个；受伤需体质豁免 DC=max(10, 伤害÷2)',
  '稳定伤势： DC10 医药检定使濒死单位稳定',
  '重击(2024)：攻击的全部伤害骰翻倍（含神能/偷袭/猎人印记等附加伤害骰），修正值不翻倍',
  '力竭(2024)：每级 -2 全部 d20 检定、速度 -5 尺（叠加）；10 级死亡',
  '突袭(2024)：被突袭单位先攻检定劣势',
];

let activeRules: RulesConfig = { ...DEFAULT_RULES };

export function getRules(): RulesConfig {
  return activeRules;
}

export function setRules(r: Partial<RulesConfig>) {
  activeRules = { ...activeRules, ...normalizeRules(r) };
}
