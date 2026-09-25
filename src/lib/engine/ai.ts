/**
 * AI 行动逻辑核心（敌我通用）
 *
 * 决策管线：planTurn() 按战术档案生成一份「回合脚本」（AiStep 列表），
 * 由 store 的 takeAiStep() 逐步执行（每步间隔驱动动画节奏），执行中校验
 * 前置条件，失效则重新规划。
 *
 * 设计原则：
 * - 目标评分：残血 > 脆皮(低AC) > 威胁(CR/等级) > 施法者/专注 > 掩护惩罚
 * - 移动规划：近战贴脸走最短路；远程保持射程+拉距+找掩体；打不到就冲刺
 * - 动作选择：期望伤害最高的动作；AoE 按「净命中数」评估（敌方允许战略误伤，队友严格无友伤）
 * - 队友协作：集火玩家当前目标 / 优先治疗倒地与重伤队友 / 贴身护卫
 * - 借机规避：游击单位先脱离再行动；其余单位接受借机（怪物常识）
 * - 士气：懦弱/游击单位低血量感知豁免，失败则溃逃
 */
import type { BattleUnit, MapObstacle, Cell, AiAbility, AIProfile } from './types';
import { SIZE_META } from './types';
import {
  CELL, posToCell, cellToFeet, cellCenter, cellKey, unitOccupiedCells,
  buildBlockedCells, buildOccupancy, reachableCells, findPath, gridDistanceCells,
  aoeCells, estimateCover,
} from './geometry';
import { effectiveSpeed, getAbilityMod } from './rules';
import { aggregateEffects } from './conditions';
import { rollFormula } from './dice';

// ============ 步骤模型 ============

export type AiStep =
  | { type: 'death-save' }
  | { type: 'stand-up' }
  | { type: 'disengage' }
  | { type: 'dash' }
  | { type: 'move'; path: Cell[]; cost: number }
  | { type: 'attack'; abilityId: string; targetId: string }
  | { type: 'aoe'; abilityId: string; origin: { x: number; y: number }; angle?: number; targets: string[] }
  | { type: 'heal'; abilityId: string; targetId: string }
  | { type: 'flee-note'; text: string }
  | { type: 'end-turn' };

export interface AiContext {
  units: BattleUnit[];
  obstacles: MapObstacle[];
  diagonal: 'equal' | 'alt';
  /** 地图尺寸（格）——移动规划不得越界 */
  mapWidth: number;
  mapHeight: number;
  /** 玩家上次攻击的目标（队友集火参考），可能为 null */
  playerTargetId: string | null;
}

function inMap(ctx: AiContext, c: Cell): boolean {
  return c.cx >= 0 && c.cy >= 0 && c.cx < ctx.mapWidth && c.cy < ctx.mapHeight;
}

// ============ 基础判断 ============

/** 该单位的回合是否由 AI 自动操控（敌方恒为 AI；队友默认 AI，可切玩家操控） */
export function isAiControlled(unit: BattleUnit): boolean {
  if (unit.hp <= 0 || unit.deathSaves?.dead) return unit.attitude !== 1; // 濒死也自动掷死亡豁免（除中立）
  if (unit.attitude === 2) return true;
  if (unit.attitude === 0 && !unit.isPlayer && !unit.playerControlled) return true;
  return false;
}

function isHostile(a: BattleUnit, b: BattleUnit): boolean {
  return a.attitude !== b.attitude && a.attitude !== 1 && b.attitude !== 1;
}

function livingEnemies(unit: BattleUnit, units: BattleUnit[]): BattleUnit[] {
  return units.filter(u => isHostile(unit, u) && u.hp > 0 && !u.deathSaves?.dead);
}

function livingAllies(unit: BattleUnit, units: BattleUnit[]): BattleUnit[] {
  return units.filter(u => !isHostile(unit, u) && u.id !== unit.id && u.hp > 0 && !u.deathSaves?.dead);
}

export function unitProfile(unit: BattleUnit): AIProfile {
  if (unit.aiProfile) return unit.aiProfile;
  if (unit.attitude === 0) return unit.isPlayer ? 'tactical' : 'tactical';
  return (unit.cr ?? 0) >= 3 ? 'aggressive' : 'tactical';
}

export function unitAbilities(unit: BattleUnit): AiAbility[] {
  if (unit.aiAbilities && unit.aiAbilities.length > 0) return unit.aiAbilities;
  // 兜底：徒手打击
  return [{
    id: 'unarmed', name: '徒手打击', kind: 'melee',
    attackBonus: 2 + getAbilityMod(unit, 'str'),
    dice: '1', damageType: 'bludgeoning', range: 5, multiAttack: 1,
  }];
}

function abilityExpectedDamage(a: AiAbility): number {
  // "2d6+3" → 期望值
  const m = /^(\d+)d(\d+)([+-]\d+)?$/.exec(a.dice.trim());
  if (!m) return 3;
  const count = parseInt(m[1], 10);
  const sides = parseInt(m[2], 10);
  const mod = m[3] ? parseInt(m[3], 10) : 0;
  return count * (sides + 1) / 2 + mod;
}

function unitThreat(u: BattleUnit): number {
  const best = Math.max(...unitAbilities(u).map(abilityExpectedDamage), 1);
  return best + (u.cr ?? u.level ?? 0) * 2;
}

/** 该单位本回合还能行动吗（失能/震慑等） */
function canAct(unit: BattleUnit): boolean {
  const agg = aggregateEffects(unit.statuses);
  return !agg.noActions;
}

// ============ 目标评分 ============

export interface TargetScore { unit: BattleUnit; score: number }

export function scoreTargets(ctx: AiContext, unit: BattleUnit): TargetScore[] {
  const blocked = buildBlockedCells(ctx.obstacles);
  const enemies = livingEnemies(unit, ctx.units);
  const isAllySide = unit.attitude === 0;
  const out: TargetScore[] = [];
  for (const t of enemies) {
    let score = 50;
    const distCells = gridDistanceCells(posToCell(unit.pos), posToCell(t.pos), ctx.diagonal);
    score -= distCells * 1.6;                                   // 距离惩罚
    score += (1 - t.hp / Math.max(1, t.maxHp)) * 22;            // 残血集火
    score += Math.max(-6, Math.min(12, (18 - t.ac) * 1.2));     // 低 AC 脆皮
    score += unitThreat(t) * 0.8;                               // 威胁权重
    if (t.isPlayer) score += 8;                                 // 敌方略优先玩家
    if (t.spellSlots || unitProfile(t) === 'support' || unitProfile(t) === 'blaster') score += 10; // 优先斩杀施法者
    if (t.concentration) score += 8;                            // 打断专注
    const cover = estimateCover(unit, t, ctx.obstacles, blocked);
    if (cover.cover === 'full') {
      if (unitProfile(unit) === 'ranged') continue;             // 远程打不到完全掩护目标 → 换目标
      score -= 25;
    } else {
      score -= cover.bonus * 2.5;                               // 掩护惩罚
    }
    // 队友协作：集火玩家当前目标
    if (isAllySide && ctx.playerTargetId === t.id) score += 30;
    // 恐惧源规避（简化：恐慌状态不选可见恐惧源）
    if (unit.statuses.includes('frightened') && distCells <= 4) score -= 30;
    out.push({ unit: t, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

// ============ AoE 评估 ============

interface AoePlan {
  ability: AiAbility;
  origin: { x: number; y: number };
  angle?: number;
  targets: string[];
  net: number;
}

/** 扫描 AoE 最佳放置点：敌方 +1 / 己方 -2（队友 AI 严格禁友伤） */
export function bestAoePlacement(ctx: AiContext, unit: BattleUnit, ability: AiAbility): AoePlan | null {
  if (ability.kind !== 'save-aoe' || !ability.aoe) return null;
  const isAllySide = unit.attitude === 0;
  const myCell = posToCell(unit.pos);
  const reachCells = Math.floor(ability.range / CELL);
  const originCandidates: Array<{ cell: Cell; isSelf: boolean }> = [];
  const shapeFromSelf = ability.aoe.kind === 'cone' || ability.aoe.kind === 'line';

  if (shapeFromSelf) {
    originCandidates.push({ cell: myCell, isSelf: true });
  } else {
    // 球体/立方：以每个敌人格与自身周围为原点候选（射程内）
    for (const t of ctx.units) {
      if (t.hp <= 0 || t.deathSaves?.dead) continue;
      for (const c of unitOccupiedCells(t)) {
        if (gridDistanceCells(myCell, c, ctx.diagonal) <= reachCells) originCandidates.push({ cell: c, isSelf: false });
      }
    }
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      originCandidates.push({ cell: { cx: myCell.cx + dx, cy: myCell.cy + dy }, isSelf: false });
    }
  }

  let best: AoePlan | null = null;
  const angles = [0, Math.PI / 8, Math.PI / 4, (3 * Math.PI) / 8, Math.PI / 2, (5 * Math.PI) / 8,
    (3 * Math.PI) / 4, (7 * Math.PI) / 8, Math.PI, (-7 * Math.PI) / 8, (-3 * Math.PI) / 4,
    (-5 * Math.PI) / 8, -Math.PI / 2, (-3 * Math.PI) / 8, -Math.PI / 4, -Math.PI / 8];

  for (const cand of originCandidates) {
    const origin = cellCenter(cand.cell);
    const angleList = shapeFromSelf ? angles : [undefined];
    for (const angle of angleList) {
      const affected = aoeCells(
        { id: 'scan', kind: ability.aoe.kind, size: ability.aoe.size, origin, angle, color: '' },
        ctx.units,
      ).affectedUnitIds;
      let foes = 0, friends = 0;
      const targets: string[] = [];
      for (const id of affected) {
        const u = ctx.units.find(x => x.id === id);
        if (!u || u.hp <= 0 || u.deathSaves?.dead) continue;
        if (u.id === unit.id) continue; // 自身不受伤的假设（火球自己也会炸，保守算作 -1？按规则自伤，这里允许但不鼓励）
        if (isHostile(unit, u)) { foes++; targets.push(u.id); }
        else friends++;
      }
      const net = foes - friends * 2;
      const minFoes = isAllySide ? 2 : 2;
      if (foes < minFoes) continue;
      if (isAllySide && friends > 0) continue;       // 队友 AI：严格零友伤
      if (!isAllySide && net < 1) continue;          // 敌方 AI：净收益 ≥1
      if (!best || net > best.net) {
        best = { ability, origin, angle, targets, net };
      }
    }
  }
  return best;
}

// ============ 移动规划 ============

interface MovePlan { path: Cell[]; cost: number }

/** 近战：找能贴到目标身边的可达格（多格目标检查所有邻格） */
function planMeleeApproach(ctx: AiContext, unit: BattleUnit, target: BattleUnit, movementCells: number): MovePlan | null {
  const reachMax = Math.max(1, Math.floor((unitAbilities(unit).find(a => a.kind === 'melee')?.range ?? 5) / CELL));
  const reachable = reachableCells(unit, ctx.units, ctx.obstacles, movementCells * CELL, ctx.diagonal);
  const targetCells = unitOccupiedCells(target);
  const myCell = posToCell(unit.pos);
  let best: { cell: Cell; cost: number } | null = null;
  for (const [k, cost] of reachable.entries()) {
    const [cx, cy] = k.split(',').map(Number);
    const cell = { cx, cy };
    if (!inMap(ctx, cell)) continue;
    const adjacent = targetCells.some(tc => gridDistanceCells(cell, tc, ctx.diagonal) <= reachMax);
    if (!adjacent) continue;
    if (best === null || cost < best.cost) best = { cell, cost };
  }
  if (!best) return null;
  const r = findPath(myCell, best.cell, ctx.units, ctx.obstacles, unit, ctx.diagonal);
  if (!r.reachable || r.path.length < 2) return { path: [myCell], cost: 0 };
  return { path: r.path.slice(1), cost: r.costCells };
}

/** 无法贴脸时：向目标方向推进到最近可达格 */
function planApproachOnly(ctx: AiContext, unit: BattleUnit, target: BattleUnit, movementCells: number): MovePlan | null {
  const reachable = reachableCells(unit, ctx.units, ctx.obstacles, movementCells * CELL, ctx.diagonal);
  const myCell = posToCell(unit.pos);
  const targetCell = posToCell(target.pos);
  const curDist = gridDistanceCells(myCell, targetCell, ctx.diagonal);
  let best: { cell: Cell; cost: number; dist: number } | null = null;
  for (const [k, cost] of reachable.entries()) {
    const [cx, cy] = k.split(',').map(Number);
    const cell = { cx, cy };
    if (!inMap(ctx, cell)) continue;
    const dist = gridDistanceCells(cell, targetCell, ctx.diagonal);
    if (dist >= curDist) continue;
    if (!best || dist < best.dist || (dist === best.dist && cost < best.cost)) {
      best = { cell, cost, dist };
    }
  }
  if (!best) return null;
  const r = findPath(myCell, best.cell, ctx.units, ctx.obstacles, unit, ctx.diagonal);
  if (!r.reachable || r.path.length < 2) return null;
  return { path: r.path.slice(1), cost: r.costCells };
}

/** 远程/游击：找「有视线 + 距敌最远 + 有掩体」的可达格 */
function planRangedPosition(ctx: AiContext, unit: BattleUnit, target: BattleUnit, movementCells: number, abilityRange: number): MovePlan | null {
  const blocked = buildBlockedCells(ctx.obstacles);
  const reachable = reachableCells(unit, ctx.units, ctx.obstacles, movementCells * CELL, ctx.diagonal);
  const myCell = posToCell(unit.pos);
  const enemies = livingEnemies(unit, ctx.units);
  const targetCell = posToCell(target.pos);

  const evalCell = (cell: Cell, cost: number): number => {
    const distToTarget = gridDistanceCells(cell, targetCell, ctx.diagonal);
    if (distToTarget * CELL > abilityRange) return -Infinity;      // 必须在射程内
    const ghost = { ...unit, pos: { x: cellToFeet(cell.cx), y: cellToFeet(cell.cy) } };
    const cover = estimateCover(ghost, target, ctx.obstacles, blocked);
    if (cover.cover === 'full') return -Infinity;                   // 必须有视线
    let score = 0;
    score -= cost * 0.6;                                            // 少走路
    score += cover.bonus * 3;                                       // 自身掩体（对目标方向）
    // 距离最近近战威胁越远越好（上限 6 格）
    let minThreat = 99;
    for (const e of enemies) {
      const d = gridDistanceCells(cell, posToCell(e.pos), ctx.diagonal);
      minThreat = Math.min(minThreat, d);
    }
    score += Math.min(minThreat, 6) * 3;
    return score;
  };

  let bestCell: { cell: Cell; cost: number; score: number } | null = null;
  for (const [k, cost] of reachable.entries()) {
    const [cx, cy] = k.split(',').map(Number);
    const cell = { cx, cy };
    if (!inMap(ctx, cell)) continue;
    const s = evalCell(cell, cost);
    if (s === -Infinity) continue;
    if (!bestCell || s > bestCell.score) bestCell = { cell, cost, score: s };
  }
  if (!bestCell) return null;
  if (cellKey(bestCell.cell) === cellKey(myCell)) return null;      // 原地已最优
  const r = findPath(myCell, bestCell.cell, ctx.units, ctx.obstacles, unit, ctx.diagonal);
  if (!r.reachable || r.path.length < 2) return null;
  return { path: r.path.slice(1), cost: r.costCells };
}

/** 脱离/溃逃：向离所有敌人最远的可达格移动 */
function planRetreat(ctx: AiContext, unit: BattleUnit, movementCells: number): MovePlan | null {
  const reachable = reachableCells(unit, ctx.units, ctx.obstacles, movementCells * CELL, ctx.diagonal);
  const myCell = posToCell(unit.pos);
  const enemies = livingEnemies(unit, ctx.units);
  if (enemies.length === 0) return null;
  let best: { cell: Cell; cost: number; dist: number } | null = null;
  for (const [k, cost] of reachable.entries()) {
    const [cx, cy] = k.split(',').map(Number);
    const cell = { cx, cy };
    if (!inMap(ctx, cell)) continue;
    let minDist = 99;
    for (const e of enemies) minDist = Math.min(minDist, gridDistanceCells(cell, posToCell(e.pos), ctx.diagonal));
    if (!best || minDist > best.dist || (minDist === best.dist && cost < best.cost)) {
      best = { cell, cost, dist: minDist };
    }
  }
  if (!best || cellKey(best.cell) === cellKey(myCell)) return null;
  const r = findPath(myCell, best.cell, ctx.units, ctx.obstacles, unit, ctx.diagonal);
  if (!r.reachable || r.path.length < 2) return null;
  return { path: r.path.slice(1), cost: r.costCells };
}

// ============ 借机攻击辅助 ============

export interface AooThreat { unit: BattleUnit; ability: AiAbility }

/** 移动者从 fromCell 走到 toCell 时，谁可对他做借机攻击（有反应 + 近战触及 + 正在脱离触及） */
export function opportunityAttackers(ctx: AiContext, mover: BattleUnit, fromCell: Cell, toCell: Cell): AooThreat[] {
  if (mover.statuses.includes('disengaging')) return [];
  const out: AooThreat[] = [];
  for (const e of livingEnemies(mover, ctx.units)) {
    if (e.actionEconomy.reaction) continue;               // 反应已用
    const agg = aggregateEffects(e.statuses);
    if (agg.noReactions) continue;
    const melee = unitAbilities(e).find(a => a.kind === 'melee' && a.range <= (e.reach ?? 5) + 5);
    if (!melee) continue;
    const reach = Math.max(1, Math.floor(melee.range / CELL));
    const eCells = unitOccupiedCells(e);
    const wasIn = eCells.some(ec => gridDistanceCells(ec, fromCell, ctx.diagonal) <= reach);
    const stillIn = eCells.some(ec => gridDistanceCells(ec, toCell, ctx.diagonal) <= reach);
    if (wasIn && !stillIn) out.push({ unit: e, ability: melee });
  }
  return out;
}

// ============ 回合规划主入口 ============

export function planTurn(ctx: AiContext, unit: BattleUnit): AiStep[] {
  const steps: AiStep[] = [];
  const profile = unitProfile(unit);

  // 0) 濒死：死亡豁免 + 结束
  if (unit.hp <= 0 || unit.deathSaves?.dead) {
    return [{ type: 'death-save' }, { type: 'end-turn' }];
  }
  // 失能/震慑：直接结束
  if (!canAct(unit)) {
    return [{ type: 'end-turn' }];
  }
  // 中立单位不行动
  if (unit.attitude === 1) return [{ type: 'end-turn' }];

  const abilities = unitAbilities(unit);
  let remainingCells = Math.floor(Math.max(0, effectiveSpeed(unit) - unit.actionEconomy.movementUsed) / CELL);
  const hasAction = !unit.actionEconomy.action;

  // 1) 倒地起身（半速）
  if (unit.statuses.includes('prone') && remainingCells > 0) {
    steps.push({ type: 'stand-up' });
    remainingCells = Math.max(0, remainingCells - Math.floor(effectiveSpeed(unit) / CELL / 2));
  }

  const enemies = livingEnemies(unit, ctx.units);
  if (enemies.length === 0) return [...steps, { type: 'end-turn' }];

  // 2) 士气检定（懦弱/游击，低血量）
  if ((profile === 'cowardly' || profile === 'skirmisher') && unit.hp < unit.maxHp * 0.4) {
    const wisMod = getAbilityMod(unit, 'wis');
    const r = rollFormula('1d20', { bonus: wisMod });
    if (r.total < 10) {
      steps.push({ type: 'flee-note', text: `士气崩溃！${unit.name} 感知豁免 ${r.total} < DC10 —— 溃逃` });
      const flee = planRetreat(ctx, unit, remainingCells);
      if (flee) {
        for (const c of flee.path) steps.push({ type: 'move', path: [c], cost: 1 });
      }
      return [...steps, { type: 'end-turn' }];
    }
  }

  const scores = scoreTargets(ctx, unit);
  if (scores.length === 0) return [...steps, { type: 'end-turn' }];
  const target = scores[0].unit;

  // 3) 队友（辅助档案）：紧急治疗 > 一切
  if (unit.attitude === 0) {
    const urgent = planUrgentHeal(ctx, unit, abilities, remainingCells);
    if (urgent) return [...steps, ...urgent, { type: 'end-turn' }];
  }

  // 4) AoE 评估（爆发/远程施法档案优先）；法术位只对有 spellSlots 模型的单位结算
  //    （角色名单装配的施法者有 spellSlots；怪物敌卡的天生施法无 spellSlots 模型，不受环阶限制）
  const hasSlotFor = (a: AiAbility) =>
    !a.spellLevel || !unit.spellSlots || (unit.spellSlots[a.spellLevel]?.current ?? 0) > 0;
  const aoeAbility = abilities.find(a => a.kind === 'save-aoe' && hasSlotFor(a));
  if (aoeAbility && hasAction && (profile === 'blaster' || profile === 'ranged' || (unit.cr ?? 0) >= 5)) {
    const plan = bestAoePlacement(ctx, unit, aoeAbility);
    if (plan && plan.net >= (profile === 'blaster' ? 2 : 2)) {
      steps.push({ type: 'aoe', abilityId: aoeAbility.id, origin: plan.origin, angle: plan.angle, targets: plan.targets });
      // AoE 后仍可用剩余移动力拉开距离（施法者保命）
      if (profile === 'ranged' || profile === 'blaster') {
        const retreat = planRetreat(ctx, unit, remainingCells);
        if (retreat) for (const c of retreat.path.slice(0, Math.min(retreat.path.length, 2))) {
          steps.push({ type: 'move', path: [c], cost: 1 });
        }
      }
      return [...steps, { type: 'end-turn' }];
    }
  }

  // 5) 选择攻击动作与移动（攻击法术同样受法术位约束，见 hasSlotFor）
  const meleeAbilities = abilities.filter(a => a.kind === 'melee' && hasSlotFor(a));
  const rangedAbilities = abilities.filter(a => a.kind === 'ranged' && hasSlotFor(a));
  const inMeleeNow = enemies.some(e => gridDistanceCells(posToCell(unit.pos), posToCell(e.pos), ctx.diagonal) <= 1);

  // 游击单位被黏住 → 先脱离（免疫借机）再攻击
  if (profile === 'skirmisher' && inMeleeNow && hasAction) {
    steps.push({ type: 'disengage' });
  }

  // 攻击方式选择：
  // - 近战单位 / 目标已贴脸 → 近战
  // - 远程档案 → 优先远程（被黏住时后撤拉距）
  // - 通用 → 期望伤害高者（近战通常更高，但要先跑过去）
  let attackAbility: AiAbility | null = null;
  if (meleeAbilities.length > 0 && rangedAbilities.length === 0) attackAbility = bestDamage(meleeAbilities);
  else if (rangedAbilities.length > 0 && meleeAbilities.length === 0) attackAbility = bestDamage(rangedAbilities);
  else if (meleeAbilities.length > 0 && rangedAbilities.length > 0) {
    const bestMelee = bestDamage(meleeAbilities);
    const bestRanged = bestDamage(rangedAbilities);
    if (profile === 'ranged' || profile === 'blaster') {
      attackAbility = bestRanged ?? bestMelee;
    } else if (inMeleeNow) {
      attackAbility = bestMelee; // 已被黏住就挥武器
    } else {
      attackAbility = abilityExpectedDamage(bestMelee!) > abilityExpectedDamage(bestRanged!) * 1.2 ? bestMelee! : bestRanged!;
    }
  }

  if (!attackAbility) {
    // 只有治疗/辅助动作：辅助逻辑已在上方处理，这里保底治疗自己或结束
    const heal = abilities.find(a => a.kind === 'heal');
    if (heal && unit.hp < unit.maxHp * 0.6) {
      steps.push({ type: 'heal', abilityId: heal.id, targetId: unit.id });
    }
    return [...steps, { type: 'end-turn' }];
  }

  const isMeleeAttack = attackAbility.kind === 'melee';
  const targetCell = posToCell(target.pos);
  const distToTarget = gridDistanceCells(posToCell(unit.pos), targetCell, ctx.diagonal);
  const rangeCells = Math.max(1, Math.floor(attackAbility.range / CELL));
  const inRange = distToTarget <= rangeCells;

  // 6) 移动规划
  if (!inRange || (profile === 'ranged' && inMeleeNow)) {
    let movePlan: MovePlan | null = null;
    if (isMeleeAttack) {
      movePlan = planMeleeApproach(ctx, unit, target, remainingCells);
      if (!movePlan && hasAction && unit.actionEconomy.movementUsed === 0) {
        // 冲刺（Dash）：移动力翻倍再试
        const dashCells = remainingCells + Math.floor(effectiveSpeed(unit) / CELL);
        const dashPlan = planMeleeApproach(ctx, unit, target, dashCells);
        if (dashPlan) {
          steps.push({ type: 'dash' });
          remainingCells = dashCells;
          movePlan = dashPlan;
        } else {
          const approach = planApproachOnly(ctx, unit, target, dashCells);
          if (approach) {
            steps.push({ type: 'dash' });
            remainingCells = dashCells;
            movePlan = approach;
          }
        }
      }
      if (!movePlan) movePlan = planApproachOnly(ctx, unit, target, remainingCells);
    } else {
      // 远程：找射程内有视线的好位置（被黏住时后撤优先）
      movePlan = planRangedPosition(ctx, unit, target, remainingCells, attackAbility.range);
      if (!movePlan && !inRange) movePlan = planApproachOnly(ctx, unit, target, remainingCells);
    }
    if (movePlan) {
      for (const c of movePlan.path) steps.push({ type: 'move', path: [c], cost: 1 });
      remainingCells = Math.max(0, remainingCells - movePlan.cost);
    }
  }

  // 7) 攻击（多重攻击）—— 仅当移动后最终位置在射程内才排入（避免无效步骤烧重规划）
  const finalCell = (() => {
    const lastMove = [...steps].reverse().find(s => s.type === 'move');
    if (lastMove && lastMove.type === 'move') return lastMove.path[lastMove.path.length - 1];
    return posToCell(unit.pos);
  })();
  const finalInRange = gridDistanceCells(finalCell, targetCell, ctx.diagonal) <= rangeCells;
  const attacks = Math.max(1, attackAbility.multiAttack ?? 1);
  if (hasAction && (inRange || finalInRange)) {
    for (let i = 0; i < attacks; i++) {
      steps.push({ type: 'attack', abilityId: attackAbility.id, targetId: target.id });
    }
  }

  // 8) 游击：攻击后脱离
  if (profile === 'skirmisher' && remainingCells > 0) {
    const retreat = planRetreat(ctx, unit, remainingCells);
    if (retreat) {
      for (const c of retreat.path.slice(0, Math.max(1, Math.floor(retreat.path.length)))) {
        steps.push({ type: 'move', path: [c], cost: 1 });
      }
    }
  }

  // 9) 防御/辅助队友：贴向玩家护卫
  if (unit.attitude === 0 && (profile === 'defensive' || profile === 'support') && remainingCells > 0) {
    const player = ctx.units.find(u => u.isPlayer && u.hp > 0);
    if (player) {
      const dist = gridDistanceCells(posToCell(unit.pos), posToCell(player.pos), ctx.diagonal);
      if (dist > 5) {
        const approach = planApproachOnly(ctx, unit, player, remainingCells);
        if (approach) for (const c of approach.path) steps.push({ type: 'move', path: [c], cost: 1 });
      }
    }
  }

  // 10) 残血自疗（有治疗动作且没治疗过）
  const selfHeal = abilities.find(a => a.kind === 'heal');
  if (selfHeal && unit.hp < unit.maxHp * 0.35 && hasAction && !steps.some(s => s.type === 'heal' || s.type === 'aoe')) {
    steps.push({ type: 'heal', abilityId: selfHeal.id, targetId: unit.id });
  }

  return [...steps, { type: 'end-turn' }];
}

function bestDamage(list: AiAbility[]): AiAbility | null {
  if (list.length === 0) return null;
  return list.reduce((a, b) => (abilityExpectedDamage(a) >= abilityExpectedDamage(b) ? a : b));
}

/** 队友紧急治疗：倒地队友 > 重伤队友（<40%）。返回 null 表示无需治疗 */
function planUrgentHeal(ctx: AiContext, unit: BattleUnit, abilities: AiAbility[], remainingCells: number): AiStep[] | null {
  // 无法术位余量的治疗法术不进入规划
  const heals = abilities.filter(a => a.kind === 'heal'
    && (!a.spellLevel || (unit.spellSlots?.[a.spellLevel]?.current ?? 0) > 0));
  if (heals.length === 0) return null;
  const allies = [...livingAllies(unit, ctx.units), unit];
  // 排序：倒地 > 血量比例
  const queue = allies
    .filter(a => a.hp > 0 ? a.hp < a.maxHp * 0.4 : !a.deathSaves?.dead)
    .sort((a, b) => {
      const ra = a.hp <= 0 ? -1 : a.hp / a.maxHp;
      const rb = b.hp <= 0 ? -1 : b.hp / b.maxHp;
      return ra - rb;
    });
  if (queue.length === 0) return null;
  const patient = queue[0];
  const dist = gridDistanceCells(posToCell(unit.pos), posToCell(patient.pos), ctx.diagonal) * CELL;

  // 远程治疗（治疗真言类）直接奶
  const rangedHeal = heals.find(h => h.range >= dist && h.range > 5);
  if (rangedHeal) return [{ type: 'heal', abilityId: rangedHeal.id, targetId: patient.id }];

  // 近战治疗：走过去再奶
  const touchHeal = heals.find(h => h.range <= 5);
  if (touchHeal) {
    if (dist <= 5) return [{ type: 'heal', abilityId: touchHeal.id, targetId: patient.id }];
    const approach = planApproachOnly(ctx, unit, patient, remainingCells);
    if (approach) {
      const steps: AiStep[] = approach.path.map(c => ({ type: 'move' as const, path: [c], cost: 1 }));
      const finalDist = gridDistanceCells(approach.path[approach.path.length - 1], posToCell(patient.pos), ctx.diagonal) * CELL;
      if (finalDist <= 5) steps.push({ type: 'heal', abilityId: touchHeal.id, targetId: patient.id });
      return steps;
    }
  }
  return null;
}

// ============ 步骤校验（执行前检查，失效则要求重规划） ============

export function validateStep(ctx: AiContext, unit: BattleUnit, step: AiStep): boolean {
  switch (step.type) {
    case 'move': {
      const cell = step.path[0];
      if (!cell) return false;
      if (!inMap(ctx, cell)) return false;
      const occupied = buildOccupancy(ctx.units, unit.id);
      const span = SIZE_META[unit.size]?.cells ?? 1;
      for (let dx = 0; dx < span; dx++) {
        for (let dy = 0; dy < span; dy++) {
          const occId = occupied.get(cellKey({ cx: cell.cx + dx, cy: cell.cy + dy }));
          if (occId === undefined) continue;
          const other = ctx.units.find(u => u.id === occId);
          // 敌对/中立占用 → 不可；友方 → 可穿行（D&D 2024 允许穿过盟友格子，终点由寻路保证不占用）
          if (!other || other.attitude !== unit.attitude) return false;
        }
      }
      return true;
    }
    case 'attack': {
      const t = ctx.units.find(u => u.id === step.targetId);
      if (!t || t.hp <= 0 || t.deathSaves?.dead) return false;
      const ability = unitAbilities(unit).find(a => a.id === step.abilityId);
      if (!ability) return false;
      const dist = gridDistanceCells(posToCell(unit.pos), posToCell(t.pos), ctx.diagonal) * CELL;
      return dist <= ability.range + CELL; // 容差一格（规划时已计算好位置）
    }
    case 'aoe': {
      return ctx.units.some(u => step.targets.includes(u.id) && u.hp > 0 && !u.deathSaves?.dead);
    }
    case 'heal': {
      const t = ctx.units.find(u => u.id === step.targetId);
      if (!t || t.deathSaves?.dead) return false;
      const ability = unitAbilities(unit).find(a => a.id === step.abilityId);
      if (!ability) return false;
      const dist = gridDistanceCells(posToCell(unit.pos), posToCell(t.pos), ctx.diagonal) * CELL;
      return dist <= Math.max(ability.range, 5) + CELL;
    }
    default:
      return true;
  }
}
