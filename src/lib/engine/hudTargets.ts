import type { AiAbility, BattleUnit, MapConfig, MapObstacle } from './types';
import { aggregateEffects } from './conditions';
import { canUnarmedStrikeTarget } from './combat';
import { inMeleeRange } from './geometry';
import { abilityCandidates, abilityTargetCheck } from './actionPreview';

export type HudPlayerAction = 'potion' | 'help' | 'grapple' | 'shove' | 'shove-away';
export interface HudTargetRequest { ability: AiAbility; playerAction?: HudPlayerAction; }

export function hudCandidates(request: HudTargetRequest, actor: BattleUnit, units: BattleUnit[]) {
  if (!request.playerAction) return abilityCandidates(actor, request.ability, units);
  if (request.playerAction === 'potion') return units.filter(u => u.attitude === actor.attitude && !u.deathSaves?.dead);
  if (request.playerAction === 'help') return units.filter(u => u.id !== actor.id && u.attitude === actor.attitude && u.hp > 0 && !u.deathSaves?.dead);
  return units.filter(u => u.id !== actor.id && u.attitude !== actor.attitude && u.hp > 0 && !u.deathSaves?.dead);
}

export function hudTargetReason(request: HudTargetRequest, actor: BattleUnit, target: BattleUnit | undefined,
  units: BattleUnit[], obstacles: MapObstacle[], diagonal: MapConfig['diagonal'], originPos?: { x: number; y: number }) {
  if (!request.playerAction) {
    if (target && !hudCandidates(request, actor, units).some(u => u.id === target.id)) return '该单位不是此动作的合法目标';
    return abilityTargetCheck(actor, request.ability, target, obstacles, diagonal, originPos);
  }
  if (actor.hp <= 0 || actor.deathSaves?.dead || aggregateEffects(actor.statuses).noActions) return '行动者已倒下或无法行动';
  if (!target) return '请在地图选择目标';
  if (!hudCandidates(request, actor, units).some(u => u.id === target.id)) return '该单位不是此动作的合法目标';
  if (request.playerAction === 'help') return null; // Preserve the existing help engine's target semantics.
  if (request.playerAction === 'potion') return inMeleeRange(actor, target, 5, diagonal) ? null : '喂药需要在 5 尺内';
  if (!canUnarmedStrikeTarget(actor, target)) return '目标体型过大，无法擒抱或推撞';
  return inMeleeRange(actor, target, actor.reach ?? 5, diagonal) ? null : '目标不在近战触及内';
}
