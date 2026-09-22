/**
 * 回合引擎：先攻排序、回合推进、巢穴/传奇动作、结束判定
 */
import type { BattleUnit, TurnState, RulesConfig } from './types';
import { rollFormula, formatDice } from './dice';

/** 掷先攻（敏捷调整值），突袭单位劣势（2024） */
export function rollInitiative(unit: BattleUnit, rules: RulesConfig, surprised: boolean): number {
  const dexMod = Math.floor(((unit.abilities?.dex ?? 10) - 10) / 2);
  const mode = surprised && rules.surpriseMode === 'init-disadvantage' ? 'disadvantage' : 'normal';
  const r = rollFormula('1d20', { mode, bonus: dexMod });
  return r.total;
}

export interface InitiativeRollDetail {
  id: string;
  /** d20 保留骰面（劣势=两骰取低） */
  d20: number;
  dexMod: number;
  total: number;
  surprised: boolean;
  /** formatDice 完整明细（含劣势弆骰） */
  detail: string;
}

/**
 * 为一批单位掷先攻（PHB 战斗步骤③：战斗开始时全员敏捷检定 d20+敏捷调整值）
 * - 2024 规则：被惊讶者劣势（surpriseMode='init-disadvantage'）
 * - 倒地/死亡单位不掷（保留原值，排序时会被过滤）
 */
export function rollInitiativeForUnits(
  units: BattleUnit[],
  rules: RulesConfig,
  surprisedIds: string[] = [],
): { rolls: InitiativeRollDetail[]; initById: Map<string, number> } {
  const rolls: InitiativeRollDetail[] = [];
  const initById = new Map<string, number>();
  for (const u of units) {
    if (u.hp <= 0 || u.deathSaves?.dead) continue;
    const dexMod = Math.floor(((u.abilities?.dex ?? 10) - 10) / 2);
    const surprised = surprisedIds.includes(u.id) && rules.surpriseMode === 'init-disadvantage';
    const r = rollFormula('1d20', { mode: surprised ? 'disadvantage' : 'normal', bonus: dexMod });
    const d20 = r.rolls.find(x => x.kept && x.sides === 20)?.value ?? r.rolls[0]?.value ?? 0;
    rolls.push({ id: u.id, d20, dexMod, total: r.total, surprised, detail: formatDice(r) });
    initById.set(u.id, r.total);
  }
  return { rolls, initById };
}

/** 生成先攻顺序：先攻值降序 → 平局裁决；带巢穴动作的单位插入先攻20槽（输平局） */
export function buildInitiativeOrder(units: BattleUnit[], rules: RulesConfig, seed = 0): string[] {
  const alive = units.filter(u => u.hp > 0 && !(u.deathSaves?.dead ?? false));
  const sorted = [...alive].sort((a, b) => {
    if (b.init !== a.init) return b.init - a.init;
    // 平局裁决
    if (rules.tieBreak === 'modifier-then-player') {
      if (b.initMod !== a.initMod) return b.initMod - a.initMod;
      if (a.isPlayer !== b.isPlayer) return a.isPlayer ? -1 : 1;
    } else if (rules.tieBreak === 'player-first') {
      if (a.isPlayer !== b.isPlayer) return a.isPlayer ? -1 : 1;
    }
    // 稳定伪随机（同一场战斗一致）
    const ha = hashStr(a.id + seed);
    const hb = hashStr(b.id + seed);
    return ha - hb;
  });
  const order = sorted.map(u => u.id);
  // 巢穴动作槽：先攻 20（输所有平局，2024 规则），仅在存活施术者存在时插入
  const hasLairCaster = units.some(u => u.hp > 0 && !(u.deathSaves?.dead ?? false) && (u.lairActions?.length ?? 0) > 0);
  if (hasLairCaster) {
    let idx = order.length;
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].init < 20) { idx = i; break; }
    }
    order.splice(idx, 0, 'lair:primary');
  }
  return order;
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export interface TurnAdvanceResult {
  state: TurnState;
  /** 跳过的死亡/失能单位 */
  skipped: string[];
  /** 新回合开始的单位 */
  newUnitId: string | null;
  newRound: boolean;
  /** 巢穴动作触发（先攻20槽） */
  lairTrigger: boolean;
}

/** 起始战斗状态 */
export function startBattle(units: BattleUnit[], rules: RulesConfig): TurnState {
  const order = buildInitiativeOrder(units, rules, Date.now() % 100000);
  return {
    round: 1,
    order,
    turnIndex: 0,
    currentUnitId: order[0] ?? null,
    ended: false,
    surprisedIds: [],
  };
}

/** 推进到下一回合；死亡/已行动单位自动跳过（可配置） */
export function advanceTurn(
  state: TurnState,
  units: BattleUnit[],
  rules: RulesConfig,
  opts: { skipIncapacitated?: boolean } = {},
): TurnAdvanceResult {
  const skip = opts.skipIncapacitated ?? true;
  const skipped: string[] = [];
  let lairTrigger = false;
  let s: TurnState = { ...state, order: [...state.order] };

  // 过滤已死亡的
  const aliveIds = new Set(units.filter(u => !(u.deathSaves?.dead ?? false)).map(u => u.id));
  s.order = s.order.filter(id => aliveIds.has(id) || id.startsWith('lair:'));

  let guard = 0;
  let wraps = 0; // 完整轮转计数：转满两圈（本轮剩余+完整一圈）仍无可行动单位 → 战斗结束
  while (guard++ < 200) {
    s.turnIndex += 1;
    if (s.turnIndex >= s.order.length) {
      // 新一轮
      s.round += 1;
      s.turnIndex = 0;
      wraps++;
      if (wraps >= 2) {
        // 一整圈内无任何可行动单位（全场失能/倒地）：终止而非空转
        s.ended = true;
        break;
      }
      // 巢穴动作不再在回绕时触发：先攻序列中已有真实的巢穴槽（init 20），
      // 回绕触发会造成同一轮执行两次；由槽位命中处统一触发
    }
    const id = s.order[s.turnIndex];
    if (!id) { s.ended = true; break; }
    if (id.startsWith('lair:')) {
      // 巢穴槽：标记触发（由 nextTurn 调 executeLairAction），槽本身不占回合
      lairTrigger = true;
      continue;
    }
    const unit = units.find(u => u.id === id);
    if (!unit) { skipped.push(id); continue; }
    const isDown = unit.hp <= 0 || unit.deathSaves?.dead;
    const isIncap = skip && aggregateNoActions(unit);
    // 2014 惊讶：被惊讶者在第 1 轮自己的回合不能行动（2024 默认改为先攻劣势，不丢回合）
    const isSurprisedR1 = rules.surpriseMode === 'skip-turn' && s.round === 1 && s.surprisedIds.includes(id);
    if (isDown || isIncap || isSurprisedR1) {
      skipped.push(id);
      continue;
    }
    s.currentUnitId = id;
    break;
  }
  return {
    state: s,
    skipped,
    newUnitId: s.currentUnitId,
    newRound: s.turnIndex === 0,
    lairTrigger,
  };
}

function aggregateNoActions(unit: BattleUnit): boolean {
  // 深度失能的单位跳过回合（麻痹/昏迷/震慑）
  const deep = ['paralyzed', 'unconscious', 'stunned', 'petrified'];
  return unit.statuses.some(s => deep.includes(s));
}

/** 巢穴动作：先攻 20（平局后手）触发；以单位上的巢穴动作列表为准 */
export function checkLairSlot(state: TurnState, units: BattleUnit[]): boolean {
  return units.some(u => (u.lairActions?.length ?? 0) > 0 && u.hp > 0) && state.round > 1;
}

/** 战斗结束判定：一方全灭/全倒 */
export function checkBattleEnd(units: BattleUnit[]): { ended: boolean; winner: 0 | 1 | 2 | null } {
  const active = units.filter(u => !u.deathSaves?.dead && u.hp > 0);
  if (active.length === 0) return { ended: true, winner: null };
  const attitudes = new Set(active.map(u => u.attitude));
  // 只剩一种态度 → 结束；中立(1)单独存在时结束但无胜者
  if (attitudes.size === 1) {
    const w = [...attitudes][0] as 0 | 1 | 2;
    if (w === 1) return { ended: true, winner: null };
    return { ended: true, winner: w };
  }
  return { ended: false, winner: null };
}

/** 传奇动作：在其他单位回合结束后可用，每轮 3 点 */
export function canUseLegendary(unit: BattleUnit): boolean {
  return (unit.legendary?.points ?? 0) > 0 && !unit.deathSaves?.dead && unit.hp > 0;
}

export function useLegendaryAction(unit: BattleUnit, cost = 1): { ok: boolean; remaining: number } {
  if (!canUseLegendary(unit) || (unit.legendary?.points ?? 0) < cost) {
    return { ok: false, remaining: unit.legendary?.points ?? 0 };
  }
  return { ok: true, remaining: (unit.legendary?.points ?? 0) - cost };
}

/**
 * 重建回合顺序但保持当前行动者位置（增援入场/重掷先攻后调用）
 * 2024：战斗中途加入的生物掷先攻后按值插入序列
 */
export function rebuildOrderKeepActor(
  units: BattleUnit[],
  rules: RulesConfig,
  turn: TurnState,
  seed = 0,
): TurnState {
  const order = buildInitiativeOrder(units, rules, seed);
  const cur = turn.currentUnitId;
  let idx = cur ? order.indexOf(cur) : -1;
  if (idx < 0) {
    // 当前行动者已不在序列（被移除/死亡）：停在最近的有效位置
    idx = Math.min(turn.turnIndex, order.length - 1);
  }
  return {
    ...turn,
    order,
    turnIndex: Math.max(0, idx),
    currentUnitId: order[Math.max(0, idx)] ?? turn.currentUnitId,
  };
}

/** 惊喜轮初始化（2024：先攻劣势重掷） */
export function applySurprise(
  units: BattleUnit[],
  surprisedIds: string[],
  rules: RulesConfig,
): Array<{ id: string; init: number }> {
  const results: Array<{ id: string; init: number }> = [];
  for (const u of units) {
    if (surprisedIds.includes(u.id)) {
      results.push({ id: u.id, init: rollInitiative(u, rules, true) });
    }
  }
  return results;
}
