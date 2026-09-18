/**
 * D&D 2024 战斗引擎 - 类型定义
 * 兼容酒馆 <battle> 管道协议，并扩展引擎内部字段
 */

// ============ 基础枚举 ============

/** 阵营态度（协议 att 字段）：0友方 1中立 2敌对 */
export type Attitude = 0 | 1 | 2;

export const ATTITUDE_META: Record<Attitude, { label: string; color: string; ring: string; bg: string }> = {
  0: { label: '友方', color: '#4ea8de', ring: 'ring-sky-400/70', bg: 'bg-sky-500/15' },
  1: { label: '中立', color: '#d9c47a', ring: 'ring-amber-300/70', bg: 'bg-amber-400/10' },
  2: { label: '敌对', color: '#e05252', ring: 'ring-red-400/70', bg: 'bg-red-500/15' },
};

/** 六大属性 */
export type AbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

export const ABILITY_META: Record<AbilityKey, { name: string; short: string }> = {
  str: { name: '力量', short: '力' },
  dex: { name: '敏捷', short: '敏' },
  con: { name: '体质', short: '体' },
  int: { name: '智力', short: '智' },
  wis: { name: '感知', short: '感' },
  cha: { name: '魅力', short: '魅' },
};

export type Abilities = Record<AbilityKey, number>;

/** 伤害类型 */
export type DamageType =
  | 'slashing' | 'piercing' | 'bludgeoning'
  | 'fire' | 'cold' | 'acid' | 'lightning' | 'thunder'
  | 'poison' | 'radiant' | 'necrotic' | 'psychic' | 'force';

export const DAMAGE_TYPE_META: Record<DamageType, { name: string; icon: string }> = {
  slashing: { name: '挥砍', icon: '⚔️' },
  piercing: { name: '穿刺', icon: '🗡️' },
  bludgeoning: { name: '钝击', icon: '🔨' },
  fire: { name: '火焰', icon: '🔥' },
  cold: { name: '冷冻', icon: '❄️' },
  acid: { name: '强酸', icon: '🧪' },
  lightning: { name: '闪电', icon: '⚡' },
  thunder: { name: '雷鸣', icon: '💥' },
  poison: { name: '毒素', icon: '☠️' },
  radiant: { name: '光耀', icon: '✨' },
  necrotic: { name: '黯蚀', icon: '💀' },
  psychic: { name: '心灵', icon: '🌀' },
  force: { name: '力场', icon: '🔮' },
};

/** 体型（决定占格数与擒抱限制） */
export type Size = 'tiny' | 'small' | 'medium' | 'large' | 'huge' | 'gargantuan';

// ============ AI 行动逻辑 ============

/** 战术档案：决定目标选择 / 移动偏好 / 撤退倾向 */
export type AIProfile =
  | 'aggressive'   // 残暴：冲最近目标，多重攻击，绝不后退
  | 'tactical'     // 战术：集火残血，近战冲锋但会挑软柿子
  | 'skirmisher'   // 游击：打了就跑，脱离战场再射击
  | 'ranged'       // 远程：保持距离 + 找掩体 + 优先脆皮
  | 'defensive'    // 防御：贴保护对象，借机攻击优先
  | 'cowardly'     // 懦弱：低血量士气检定，失败即逃跑
  | 'support'      // 辅助（队友）：治疗优先级 > 增益 > 输出
  | 'blaster';     // 爆发（队友）：AoE 无友伤时倾泻，否则集火

export const AI_PROFILE_META: Record<AIProfile, { label: string; desc: string }> = {
  aggressive: { label: '残暴', desc: '冲锋最近目标，多重攻击，死战不退' },
  tactical: { label: '战术', desc: '集火残血与脆皮，挑选最优目标' },
  skirmisher: { label: '游击', desc: '攻击后脱离，避免被近战黏住' },
  ranged: { label: '远程', desc: '保持距离，依托掩体，优先施法者' },
  defensive: { label: '防御', desc: '贴守保护对象，坚守阵地' },
  cowardly: { label: '懦弱', desc: '半血后士气检定，失败即溃逃' },
  support: { label: '辅助', desc: '队友：治疗倒地/重伤者，其次输出' },
  blaster: { label: '爆发', desc: '队友：无友伤 AoE 倾泻，否则集火玩家目标' },
};

/** 动作类型（玩家与 AI 通用动作模型） */
export type AiAbilityKind = 'melee' | 'ranged' | 'save-aoe' | 'save' | 'heal';

export const AI_ABILITY_KIND_META: Record<AiAbilityKind, { label: string; icon: string; hint: string }> = {
  melee: { label: '近战', icon: '⚔️', hint: '触及内武器攻击，命中 vs AC' },
  ranged: { label: '远程', icon: '🏹', hint: '射程内攻击检定 vs AC' },
  'save-aoe': { label: '范围豁免', icon: '💥', hint: 'AoE 范围内目标掷豁免，失败受伤（可半伤）' },
  save: { label: '单体豁免', icon: '🎯', hint: '目标掷豁免对抗 DC（控制/减益法术）' },
  heal: { label: '治疗', icon: '💚', hint: '恢复目标生命值' },
};

/** AI 可用动作（从预设推导或手动配置；玩家单位同样用它表示武器与法术） */
export interface AiAbility {
  id: string;
  name: string;
  kind: AiAbilityKind;
  attackBonus?: number;
  /** 伤害/治疗公式，如 2d6+3 */
  dice: string;
  damageType?: DamageType;
  /** 射程（英尺），5 = 近战触及 */
  range: number;
  /** AoE 形状（save-aoe 必填） */
  aoe?: { kind: AoeShapeKind; size: number };
  /** 豁免属性与 DC（save-aoe / save / 附加毒伤） */
  saveAbility?: AbilityKey;
  saveDc?: number;
  /** 半伤豁免 */
  halfOnSuccess?: boolean;
  /** 每回合攻击次数（多重攻击） */
  multiAttack?: number;
  /** 法术环阶（0=戏法，不占法术位；undefined=非法术） */
  spellLevel?: number;
  /** 需要专注 */
  concentration?: boolean;
  /** 附赠动作施放 */
  bonusAction?: boolean;
  /** 攻击/豁免后的附加状态效果（如 麻痹/恐惧），豁免失败时施加 */
  applyStatus?: string;
  note?: string;
}

export const SIZE_META: Record<Size, { name: string; cells: number }> = {
  tiny: { name: '微型', cells: 1 },
  small: { name: '小型', cells: 1 },
  medium: { name: '中型', cells: 1 },
  large: { name: '大型', cells: 2 },
  huge: { name: '巨型', cells: 3 },
  gargantuan: { name: '超巨型', cells: 4 },
};

// ============ 单位模型 ============

/** 死亡豁免追踪 */
export interface DeathSaves {
  successes: number;
  failures: number;
  stable: boolean;
  dead: boolean;
}

/** 法术位 */
export interface SpellSlots {
  [level: number]: { current: number; max: number };
}

/** 每回合动作经济 */
export interface ActionEconomy {
  action: boolean;
  bonus: boolean;
  reaction: boolean;
  movementUsed: number;
}

/** 战斗单位 */
export interface BattleUnit {
  /** 协议 UnitId（唯一标识） */
  id: string;
  name: string;
  /** 数据来源标记：敌卡/角色名单自动配装时记录，便于追溯 */
  dataSource?: 'statblock' | 'roster' | 'preset' | 'manual' | 'ai-parsed';
  init: number;
  initMod: number;
  /** 先攻是否已由面板掷骰（false=AI给定值/占位值，开战时会重掷） */
  initRolled?: boolean;
  hp: number;
  maxHp: number;
  tempHp: number;
  ac: number;
  speed: number;
  pos: { x: number; y: number };
  attitude: Attitude;
  statuses: string[];
  portrait?: string;

  // ---- 引擎扩展字段（协议外，UI 可编辑） ----
  isPlayer: boolean;
  size: Size;
  cr?: number;
  level?: number;
  abilities?: Abilities;
  saveBonuses?: Partial<Record<AbilityKey, number>>;
  resistances: DamageType[];
  immunities: DamageType[];
  vulnerabilities: DamageType[];
  deathSaves?: DeathSaves;
  concentration?: string;
  spellSlots?: SpellSlots;
  legendary?: { points: number; max: number };
  actionEconomy: ActionEconomy;
  notes?: string;
  color?: string;
  hasActed: boolean;
  reach?: number;

  // ---- AI 行动逻辑扩展 ----
  /** 战术档案（无则按 CR/体型推导默认值） */
  aiProfile?: AIProfile;
  /** 队友是否玩家操控（isPlayer 恒为玩家操控）；敌方忽略 */
  playerControlled?: boolean;
  /** AI 动作表（无则从基础攻击推导；玩家单位用它表示武器与法术） */
  aiAbilities?: AiAbility[];
  /** 隐匿加值（隐藏动作检定用） */
  stealthBonus?: number;
}

// ============ 地图模型 ============

export interface Cell { cx: number; cy: number }

export interface MapObstacle {
  cells: Cell[];
  kind: 'half' | 'threeQuarters' | 'full';
  label?: string;
}

export type AoeShapeKind = 'circle' | 'sphere' | 'cylinder' | 'cone' | 'line' | 'cube' | 'square';

export interface AoeTemplate {
  id: string;
  kind: AoeShapeKind;
  size: number;
  origin: { x: number; y: number };
  angle?: number;
  color: string;
  label?: string;
}

export interface MapConfig {
  width: number;
  height: number;
  cellSize: number;
  diagonal: 'equal' | 'alt';
}

// ============ 回合引擎 ============

export interface LairActionSlot {
  init: number;
  label: string;
}

export interface TurnState {
  round: number;
  currentUnitId: string | null;
  order: string[];
  turnIndex: number;
  ended: boolean;
  surprisedIds: string[];
}

// ============ 骰子与检定 ============

export type RollMode = 'normal' | 'advantage' | 'disadvantage';

export interface DieRoll {
  sides: number;
  value: number;
  kept: boolean;
  tag?: string;
}

export interface DiceResult {
  formula: string;
  rolls: DieRoll[];
  modifier: number;
  total: number;
  rawD20?: number;
  mode: RollMode;
}

export type CheckOutcome = 'critical-success' | 'success' | 'failure' | 'critical-failure';

export interface CheckResult {
  dice: DiceResult;
  target: number | null;
  total: number;
  outcome: CheckOutcome;
  label: string;
}

export interface AttackResult {
  attack: CheckResult;
  hit: boolean;
  critical: boolean;
  damage?: DamageResult;
}

export interface DamageResult {
  rawRolls: DieRoll[];
  rawTotal: number;
  final: number;
  multiplierNote: string;
  appliedToHp: number;
  targetId: string;
  concentrationDc: number | null;
  deathFailures: number;
  killed: boolean;
}

// ============ 战斗日志 ============

export type BattleEventType =
  | 'round-start' | 'turn-start' | 'turn-end'
  | 'attack' | 'damage' | 'heal' | 'save' | 'check'
  | 'status-add' | 'status-remove' | 'move'
  | 'death' | 'stabilize' | 'revive' | 'spell-slot'
  | 'concentration' | 'legendary' | 'lair'
  | 'unit-add' | 'unit-remove' | 'note' | 'custom';

export interface BattleEvent {
  id: string;
  ts: number;
  round: number;
  type: BattleEventType;
  actorId?: string;
  targetId?: string;
  text: string;
  data?: Record<string, unknown>;
  level?: 'info' | 'good' | 'bad' | 'crit';
}

// ============ 快照 / diff ============

export interface BattleSnapshot {
  ts: number;
  source: 'embed' | 'manual' | 'import';
  units: Array<Pick<BattleUnit, 'id' | 'init' | 'hp' | 'maxHp' | 'pos' | 'attitude' | 'statuses'>>;
}

export interface UnitDiff {
  id: string;
  hpDelta: number;
  posDelta: { x: number; y: number } | null;
  addedStatuses: string[];
  removedStatuses: string[];
  isNew: boolean;
  removed: boolean;
  died: boolean;
  revived: boolean;
}

export interface SnapshotDiff {
  prevTs: number | null;
  nextTs: number;
  unitDiffs: UnitDiff[];
}

// ============ 规则配置 ============

export interface RulesConfig {
  critWeaponDiceOnly: boolean;
  failOnDropToZero: boolean;
  failOnDamageAtZero: boolean;
  surpriseMode: 'init-disadvantage' | 'skip-turn' | 'none';
  tieBreak: 'modifier-then-player' | 'player-first' | 'random';
  diagonal: 'equal' | 'alt';
  minDamageOne: boolean;
  /** 结算权威：panel=面板（默认，先攻由面板掷骰、战斗中 AI 数据不覆盖已结算数值）
   *  ai-legacy=兼容旧卡（先攻用 AI 给定值、战斗中 AI 块数值直入） */
  authorityMode: 'panel' | 'ai-legacy';
}

export const DEFAULT_RULES: RulesConfig = {
  critWeaponDiceOnly: true,
  failOnDropToZero: true,
  failOnDamageAtZero: true,
  surpriseMode: 'init-disadvantage',
  tieBreak: 'modifier-then-player',
  diagonal: 'equal',
  minDamageOne: false,
  authorityMode: 'panel',
};
