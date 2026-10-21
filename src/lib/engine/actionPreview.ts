/** Pure previews shared by player UI and execution; never roll or mutate. */
import type { AiAbility, AoeTemplate, BattleUnit, Cell, MapConfig, MapObstacle } from './types';
import { aggregateEffects } from './conditions';
import { aoeCells, buildBlockedCells, cellKey, estimateCover, findPath, gridDistanceFeet, posToCell, unitDistance, unitOccupiedCells } from './geometry';
import { attackRollModeAgainst, remainingMovement, resolveCastSlot } from './rules';
import { opportunityAttackers, type AiContext } from './ai';

export function abilityCandidates(actor: BattleUnit, ability: AiAbility, units: BattleUnit[]) {
  return units.filter(u => !u.deathSaves?.dead && (ability.kind === 'heal'
    ? u.attitude === actor.attitude
    : ability.kind === 'save-aoe' || (ability.dice === '0' && !ability.saveAbility ? u.attitude === actor.attitude : u.attitude !== actor.attitude && u.attitude !== 1)));
}

export function abilityTargetCheck(actor: BattleUnit, ability: AiAbility, target: BattleUnit | undefined,
  obstacles: MapObstacle[], diagonal: MapConfig['diagonal'], originPos?: { x: number; y: number }) {
  if (actor.hp <= 0 || actor.deathSaves?.dead) return '行动者已倒下';
  if (aggregateEffects(actor.statuses).noActions) return '行动者失能，无法行动';
  if (ability.kind === 'save-aoe') {
    if (!ability.aoe) return '缺少范围定义';
    const origin = originPos ?? target?.pos;
    if (!origin) return '请在地图选择落点';
    if (!Number.isFinite(origin.x) || !Number.isFinite(origin.y)) return '落点无效';
    if (!ability.ignoresCover && buildBlockedCells(obstacles).get(cellKey(posToCell(origin))) === 'full') return '落点位于完全阻挡地形内';
    const dist = gridDistanceFeet(posToCell(actor.pos), posToCell(origin), diagonal);
    if (dist > ability.range) return `落点超出射程：${dist} 尺 / ${ability.range} 尺`;
    if (!ability.ignoresCover && estimateCover(actor, { ...actor, pos: origin }, obstacles, buildBlockedCells(obstacles)).cover === 'full') return '落点被完全掩护阻挡';
    return null;
  }
  if (!target) return '请选择目标';
  if (target.deathSaves?.dead) return '目标已死亡';
  const dist = unitDistance(actor, target, diagonal);
  if (dist > ability.range) return `超出射程：${dist} 尺 / ${ability.range} 尺`;
  if (!ability.ignoresCover && estimateCover(actor, target, obstacles, buildBlockedCells(obstacles)).cover === 'full') return '目标处于完全掩护';
  if (ability.requiresSight && (actor.statuses.includes('blinded') || target.statuses.includes('invisible'))) return '此能力需要看见目标';
  return null;
}

export function abilityPreview(actor: BattleUnit, ability: AiAbility, target: BattleUnit | undefined,
  units: BattleUnit[], obstacles: MapObstacle[], diagonal: MapConfig['diagonal'],
  opts: { originPos?: { x: number; y: number }; angle?: number; castLevel?: number; consumeSlot?: boolean } = {}) {
  const reason = abilityTargetCheck(actor, ability, target, obstacles, diagonal, opts.originPos);
  const dist = target ? unitDistance(actor, target, diagonal) : null;
  const cover = target ? estimateCover(actor, target, obstacles, buildBlockedCells(obstacles)) : null;
  const hostileWithin5Ft = units.some(u => u.id !== actor.id && u.hp > 0 && !u.deathSaves?.dead && u.attitude !== actor.attitude && u.attitude !== 1 && actor.attitude !== 1 && unitDistance(actor, u, diagonal) <= 5);
  const mode = target && ['melee', 'ranged'].includes(ability.kind)
    ? attackRollModeAgainst(actor, target, { distanceFeet: dist!, isMeleeAttack: ability.kind === 'melee', hostileWithin5Ft }) : null;
  const slot = opts.consumeSlot !== false ? resolveCastSlot(actor, ability.spellLevel ?? 0, opts.castLevel) : null;
  let template: AoeTemplate | null = null;
  if (ability.kind === 'save-aoe' && ability.aoe && (opts.originPos || target)) {
    template = { id: 'action-preview', ...ability.aoe, origin: opts.originPos ?? target!.pos,
      angle: opts.angle ?? (target ? Math.atan2(target.pos.y - actor.pos.y, target.pos.x - actor.pos.x) : 0), color: 'rgba(230,140,50,.35)', label: ability.name };
  }
  // Shared affected set: no blanket immunity for caster or downed creatures.
  const affected = template ? aoeCells(template, units).affectedUnitIds
    .map(id => units.find(u => u.id === id)!).filter(u => !u.deathSaves?.dead && !(ability.excludeSelf && u.id === actor.id)
      && (ability.ignoresCover || estimateCover({ ...actor, pos: template!.origin }, u, obstacles, buildBlockedCells(obstacles)).cover !== 'full')) : [];
  return { reason, dist, cover, mode, slot, template, affected, allies: affected.filter(u => u.attitude === actor.attitude) };
}

/** Same endpoint threat semantics as moveUnit, including reaction budget and destination cover. */
export function movementThreats(ctx: AiContext, mover: BattleUnit, destination: { x: number; y: number }) {
  const moved = { ...mover, pos: mover.pos };
  return opportunityAttackers(ctx, mover, posToCell(mover.pos), posToCell(destination)).filter(t =>
    (!t.unit.reactions?.length || ((t.unit.reactionsUsedRound ?? 0) < (t.unit.reactionsPerRound ?? 1) && !t.unit.reactionUsedTurn))
    && estimateCover(t.unit, moved, ctx.obstacles, buildBlockedCells(ctx.obstacles)).cover !== 'full');
}

export function movementPreview(unit: BattleUnit, destination: Cell, units: BattleUnit[], obstacles: MapObstacle[], cfg: MapConfig,
  battleActive: boolean, currentUnitId: string | null) {
  const pos = { x: destination.cx * 5, y: destination.cy * 5 };
  const route = findPath(posToCell(unit.pos), destination, units, obstacles, unit, cfg.diagonal, { ignoreFullObstacles: unit.moveMode === 'fly', mapWidth: cfg.width, mapHeight: cfg.height });
  const cost = route.costCells * 5;
  const left = remainingMovement(unit);
  const span = unitOccupiedCells(unit).length > 1 ? Math.sqrt(unitOccupiedCells(unit).length) : 1;
  let reason: string | null = null;
  if (unit.hp <= 0 || unit.deathSaves?.dead) reason = '单位已倒下';
  else if (battleActive && (unit.id !== currentUnitId || !(unit.isPlayer || unit.playerControlled) || unit.attitude !== 0)) reason = '请移动本回合的玩家操控单位';
  else if (destination.cx < 0 || destination.cy < 0 || destination.cx + span > cfg.width || destination.cy + span > cfg.height) reason = '超出地图边界';
  else {
    const occupied = new Set(units.filter(u => u.id !== unit.id).flatMap(u => unitOccupiedCells(u).map(cellKey)));
    if (unitOccupiedCells({ ...unit, pos }).some(c => occupied.has(cellKey(c)))) reason = '目标格已被占用';
    else if (!route.reachable || cost > left) reason = '目标不可达或移动力不足';
  }
  const threatMap = new Map<string, ReturnType<typeof movementThreats>[number]>();
  if (!reason && battleActive) for (let i = 1; i < route.path.length; i++) {
    const previous = route.path[i - 1], next = route.path[i];
    const ghost = { ...unit, pos: { x: previous.cx * 5, y: previous.cy * 5 } };
    for (const threat of movementThreats({ units, obstacles, diagonal: cfg.diagonal, mapWidth: cfg.width, mapHeight: cfg.height, playerTargetId: null }, ghost, { x: next.cx * 5, y: next.cy * 5 })) threatMap.set(threat.unit.id, threat);
  }
  return { pos, cost, path: route.path, left: Math.max(0, left - cost), reason, threats: [...threatMap.values()] };
}
