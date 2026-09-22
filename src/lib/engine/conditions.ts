/**
 * D&D 2024 状态条件注册表
 * 覆盖协议 13 种条件 + 力竭等级 + 常用扩展
 */
import type { AbilityKey } from './types';

export interface ConditionEffect {
  /** 对该单位的攻击掷骰 */
  ownAttacks?: 'disadvantage' | 'advantage';
  /** 攻击该单位的掷骰 */
  attacksAgainst?: 'advantage' | 'disadvantage' | 'melee-advantage';
  /** 速度倍率（0=无法移动） */
  speedMultiplier?: number;
  /** 自动失败的豁免 */
  autoFailSaves?: AbilityKey[];
  /** 攻击者近战5尺内命中即重击 */
  meleeCritOnHit?: boolean;
  /** 无法进行反应 */
  noReactions?: boolean;
  /** 无法进行任何动作 */
  noActions?: boolean;
  /** 俯卧站起消耗半速 */
  standCostHalfSpeed?: boolean;
  /** 不能主动靠近恐惧源 */
  cantApproachSource?: boolean;
}

export interface ConditionDef {
  key: string;
  name: string;
  en: string;
  icon: string;   // emoji 图标
  color: string;  // chip 颜色
  brief: string;  // 一句话规则摘要（2024版）
  effect: ConditionEffect;
}

/** 协议支持的 13 种条件 + 扩展 */
export const CONDITIONS: Record<string, ConditionDef> = {
  blinded: {
    key: 'blinded', name: '目盲', en: 'Blinded', icon: '🚫', color: '#8b8b8b',
    brief: '无法视物。攻击它有优势；它的攻击有劣势；依赖视觉的检定自动失败。',
    effect: { ownAttacks: 'disadvantage', attacksAgainst: 'advantage' },
  },
  charmed: {
    key: 'charmed', name: '魅惑', en: 'Charmed', icon: '💗', color: '#e07ab8',
    brief: '不能攻击魅惑者；魅惑者对其社交检定有优势（2024）。不能自愿伤害魅惑者。',
    effect: {},
  },
  deafened: {
    key: 'deafened', name: '失聪', en: 'Deafened', icon: '🔇', color: '#7a8ba0',
    brief: '无法听见。依赖听觉的检定自动失败。突袭检定依赖听觉时劣势。',
    effect: {},
  },
  frightened: {
    key: 'frightened', name: '恐慌', en: 'Frightened', icon: '😱', color: '#b56ee0',
    brief: '能看见恐惧源时攻击检定与属性检定劣势；不能自愿向恐惧源移动。',
    effect: { ownAttacks: 'disadvantage', cantApproachSource: true },
  },
  grappled: {
    key: 'grappled', name: '擒抱', en: 'Grappled', icon: '🤼', color: '#c98b4e',
    brief: '速度归 0（2024：擒抱者倒下/失能则结束）。逃脱：力量或敏捷检定对抗 DC 8+力量调整+熟练。',
    effect: { speedMultiplier: 0 },
  },
  incapacitated: {
    key: 'incapacitated', name: '失能', en: 'Incapacitated', icon: '💤', color: '#6b7b8c',
    brief: '不能进行任何动作、附赠动作或反应，不能说话。',
    effect: { noActions: true, noReactions: true },
  },
  invisible: {
    key: 'invisible', name: '隐形', en: 'Invisible', icon: '👻', color: '#9ab8d8',
    brief: '攻击它有劣势；它的攻击有优势；可以尝试躲藏。仍会留下痕迹。',
    effect: { attacksAgainst: 'disadvantage' },
  },
  paralyzed: {
    key: 'paralyzed', name: '麻痹', en: 'Paralyzed', icon: '⚡', color: '#e0d44e',
    brief: '失能+不能移动或说话。攻击它有优势；5尺内攻击者命中即重击。力量/敏捷豁免自动失败。',
    effect: {
      attacksAgainst: 'advantage', autoFailSaves: ['str', 'dex'],
      noActions: true, noReactions: true, speedMultiplier: 0, meleeCritOnHit: true,
    },
  },
  petrified: {
    key: 'petrified', name: '石化', en: 'Petrified', icon: '🗿', color: '#a0a0a0',
    brief: '失能+不能移动或说话。攻击它有优势；力量/敏捷豁免自动失败；对毒素伤害免疫（2024）。抗性：所有伤害。',
    effect: {
      attacksAgainst: 'advantage', autoFailSaves: ['str', 'dex'],
      noActions: true, noReactions: true, speedMultiplier: 0, meleeCritOnHit: true,
    },
  },
  poisoned: {
    key: 'poisoned', name: '中毒', en: 'Poisoned', icon: '🤢', color: '#6eb54e',
    brief: '攻击检定与属性检定劣势。',
    effect: { ownAttacks: 'disadvantage' },
  },
  prone: {
    key: 'prone', name: '倒地', en: 'Prone', icon: '🛌', color: '#c9a04e',
    brief: '自身攻击劣势。5尺内攻击它有优势，更远则有劣势。站起消耗一半速度。倒地时只能爬行。',
    effect: { ownAttacks: 'disadvantage', attacksAgainst: 'melee-advantage', standCostHalfSpeed: true },
  },
  restrained: {
    key: 'restrained', name: '束缚', en: 'Restraint', icon: '🪢', color: '#b06e4e',
    brief: '速度 0。攻击它有优势；它的攻击劣势；敏捷豁免劣势。',
    effect: { speedMultiplier: 0, attacksAgainst: 'advantage', ownAttacks: 'disadvantage' },
  },
  stunned: {
    key: 'stunned', name: '震慑', en: 'Stunned', icon: '💫', color: '#e08a4e',
    brief: '失能+不能移动。攻击它有优势；力量/敏捷豁免自动失败（2024）。',
    effect: {
      attacksAgainst: 'advantage', autoFailSaves: ['str', 'dex'],
      noActions: true, noReactions: true, speedMultiplier: 0,
    },
  },
  unconscious: {
    key: 'unconscious', name: '昏迷', en: 'Unconscious', icon: '😵', color: '#7a5ee0',
    brief: '失能+倒地+不能移动或说话， unaware。攻击它有优势；5尺内命中即重击；掉落手中物品。',
    effect: {
      attacksAgainst: 'advantage', autoFailSaves: ['str', 'dex'],
      noActions: true, noReactions: true, speedMultiplier: 0, meleeCritOnHit: true,
    },
  },
  // ---- 扩展条件（协议外，引擎内部） ----
  exhaustion: {
    key: 'exhaustion', name: '力竭', en: 'Exhaustion', icon: '🥀', color: '#8c6b5a',
    brief: '2024：每级力竭使所有 d20 检定（攻击/属性/豁免）-2、速度 -5 尺（均叠加）；6 级死亡。长休恢复 1 级。',
    effect: {},
  },
  concentration: {
    key: 'concentration', name: '专注中', en: 'Concentrating', icon: '🎯', color: '#5eb0c9',
    brief: '专注被打断法术终止。受伤需体质豁免 DC=10或伤害一半（取高）。同时只能专注一个法术。',
    effect: {},
  },
  surprised: {
    key: 'surprised', name: '被突袭', en: 'Surprised', icon: '❗', color: '#e0c04e',
    brief: '2024：先攻检定劣势。',
    effect: {},
  },
  flying: {
    key: 'flying', name: '飞行', en: 'Flying', icon: '🕊️', color: '#8ab8d8',
    brief: '飞行中。若失去飞行能力立即坠落，受坠落伤害。',
    effect: {},
  },
  blessed: {
    key: 'blessed', name: '祝福', en: 'Blessed', icon: '🙏', color: '#e8d44e',
    brief: '攻击检定与豁免检定 +1d4。',
    effect: {},
  },
  // ---- 行动系统内部状态（回合内动作姿态） ----
  dodging: {
    key: 'dodging', name: '闪避中', en: 'Dodging', icon: '🌀', color: '#7ab8e0',
    brief: '闪避动作：本回合对自身的一切攻击检定有劣势（看不见攻击者时无效）。',
    effect: { attacksAgainst: 'disadvantage' },
  },
  hiding: {
    key: 'hiding', name: '隐藏中', en: 'Hiding', icon: '🕳️', color: '#6b8c7a',
    brief: '隐藏动作：敏捷(隐匿)成功。对看不到自身的目标攻击有优势；攻击后暴露。',
    effect: { ownAttacks: 'advantage' },
  },
  helped: {
    key: 'helped', name: '受协助', en: 'Helped', icon: '🤝', color: '#e0b07a',
    brief: '协助动作：下次攻击检定有优势（一次性，攻击后消耗）。',
    effect: { ownAttacks: 'advantage' },
  },
  disengaging: {
    key: 'disengaging', name: '脱离中', en: 'Disengaging', icon: '🏃', color: '#8ce07a',
    brief: '脱离动作：本回合移动不触发任何借机攻击。',
    effect: {},
  },
};

/** 协议官方支持的 key 列表（解析 <battle> status 字段用） */
export const PROTOCOL_STATUSES = [
  'blinded', 'charmed', 'deafened', 'frightened', 'grappled',
  'incapacitated', 'invisible', 'paralyzed', 'petrified', 'poisoned',
  'prone', 'restrained', 'stunned', 'unconscious',
] as const;

export function getCondition(key: string): ConditionDef | undefined {
  return CONDITIONS[key];
}

export function conditionName(key: string): string {
  if (key.startsWith('exhaustion:')) {
    const lv = key.split(':')[1];
    return `力竭·${lv}级`;
  }
  return CONDITIONS[key]?.name ?? key;
}

export function conditionIcon(key: string): string {
  return CONDITIONS[key]?.icon ?? '❓';
}

/** 2024 力竭等级：所有 d20 检定 -2/级、速度 -5 尺/级；6 级死亡 */
export function exhaustionLevels(statuses: string[]): number {
  let max = 0;
  for (const s of statuses) {
    if (!s.startsWith('exhaustion:')) continue;
    const lv = parseInt(s.split(':')[1] || '0', 10);
    if (Number.isFinite(lv) && lv > max) max = lv;
  }
  return max;
}

/** 2024 力竭减值：d20 检定 -2/级（攻击检定、属性检定、豁免检定） */
export function exhaustionPenalty(statuses: string[]): number {
  return 2 * exhaustionLevels(statuses);
}

/** 2024 力竭降速：-5 尺/级 */
export function exhaustionSpeedLoss(statuses: string[]): number {
  return 5 * exhaustionLevels(statuses);
}

/** 汇总一个单位所有条件的效果（乘法速度、优势劣势等） */
export function aggregateEffects(statuses: string[]): {
  speedMultiplier: number;
  ownAttackDisadvantage: boolean;
  ownAttackAdvantage: boolean;
  attacksAgainstAdvantage: boolean;
  attacksAgainstMeleeAdvantage: boolean;
  attacksAgainstDisadvantage: boolean;
  noActions: boolean;
  noReactions: boolean;
  autoFailSaves: Set<AbilityKey>;
  meleeCritOnHit: boolean;
} {
  let speedMultiplier = 1;
  let ownAttackDisadvantage = false;
  let ownAttackAdvantage = false;
  let attacksAgainstAdvantage = false;
  let attacksAgainstMeleeAdvantage = false;
  let attacksAgainstDisadvantage = false;
  let noActions = false;
  let noReactions = false;
  let meleeCritOnHit = false;
  const autoFailSaves = new Set<AbilityKey>();

  for (const s of statuses) {
    let key = s;
    if (key.startsWith('exhaustion:')) {
      // 2024：每级 -2 全 d20 检定、-5 尺速度（见 exhaustionPenalty / exhaustionSpeedLoss）；
      // 6 级死亡——以失去行动表达（死亡事件由 store 在状态写入时结算）
      const lv = parseInt(key.split(':')[1] || '0', 10);
      if (lv >= 6) noActions = true;
      key = 'exhaustion';
    }
    const def = CONDITIONS[key];
    if (!def) continue;
    const e = def.effect;
    if (e.speedMultiplier !== undefined) speedMultiplier = Math.min(speedMultiplier, e.speedMultiplier);
    if (e.ownAttacks === 'disadvantage') ownAttackDisadvantage = true;
    if (e.ownAttacks === 'advantage') ownAttackAdvantage = true;
    if (e.attacksAgainst === 'advantage') attacksAgainstAdvantage = true;
    if (e.attacksAgainst === 'melee-advantage') attacksAgainstMeleeAdvantage = true;
    if (e.attacksAgainst === 'disadvantage') attacksAgainstDisadvantage = true;
    if (e.noActions) noActions = true;
    if (e.noReactions) noReactions = true;
    if (e.meleeCritOnHit) meleeCritOnHit = true;
    for (const a of e.autoFailSaves ?? []) autoFailSaves.add(a);
  }
  return {
    speedMultiplier, ownAttackDisadvantage, ownAttackAdvantage, attacksAgainstAdvantage,
    attacksAgainstMeleeAdvantage, attacksAgainstDisadvantage, noActions, noReactions, autoFailSaves, meleeCritOnHit,
  };
}
