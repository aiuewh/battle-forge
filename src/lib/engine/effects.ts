import type { ActiveEffect, AiAbility, BattleUnit } from './types';
import { aggregateEffects, exhaustionLevels } from './conditions';

/** Remove only the states owned by the removed effects; legacy manual states survive. */
export function removeEffects(unit: BattleUnit, predicate: (effect: ActiveEffect) => boolean): BattleUnit {
  const removed = (unit.effects ?? []).filter(predicate);
  if (!removed.length) return unit;
  const effects = (unit.effects ?? []).filter(e => !predicate(e));
  const statuses = unit.statuses.filter(status => !removed.some(e => e.status === status)
    || removed.some(e => e.status === status && e.preserveStatus) || effects.some(e => e.status === status));
  return { ...unit, effects, statuses };
}

export function endConcentrationEffects(units: BattleUnit[], sourceId: string): BattleUnit[] {
  return units.map(u => removeEffects(u, e => e.sourceId === sourceId && e.concentration));
}

export function addAbilityEffect(unit: BattleUnit, source: BattleUnit, ability: AiAbility, id: string): BattleUnit {
  if (!ability.applyStatus) return unit;
  const existing = (unit.effects ?? []).filter(e => e.status === ability.applyStatus);
  const effect: ActiveEffect = {
    id, sourceId: source.id, abilityId: ability.id, name: ability.name, status: ability.applyStatus,
    concentration: ability.concentration === true,
    remainingRounds: ability.durationRounds,
    repeatSave: ability.repeatSave,
    preserveStatus: existing.length ? existing.some(e => e.preserveStatus) : unit.statuses.includes(ability.applyStatus),
  };
  return { ...unit, effects: [...(unit.effects ?? []), effect], statuses: [...new Set([...unit.statuses, effect.status])] };
}

/** Idempotent migration: preserve unknown status sources rather than inventing effects. */
export function migrateUnits(units: BattleUnit[]): BattleUnit[] {
  const migrated = units.map(u => {
    const dead = exhaustionLevels(u.statuses) >= 6 || u.deathSaves?.dead;
    return { ...u, effects: u.effects ?? [], slotCastThisTurn: u.slotCastThisTurn ?? false,
      ...(dead ? { deathSaves: { successes: 0, failures: 3, stable: false, dead: true } } : {}) };
  });
  const invalid = new Set(migrated.filter(u => u.deathSaves?.dead || u.hp <= 0 || aggregateEffects(u.statuses).noActions).map(u => u.id));
  return migrated.map(u => ({ ...removeEffects(u, e => e.concentration && invalid.has(e.sourceId)),
    concentration: invalid.has(u.id) ? undefined : u.concentration }));
}
